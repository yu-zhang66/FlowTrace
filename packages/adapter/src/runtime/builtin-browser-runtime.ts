/**
 * Builtin browser runtime for FlowTrace.
 *
 * Provides generic Playwright primitives:
 *  - independent BrowserContext per scenario (no shared cookies across actors)
 *  - navigation (goto page path / raw URL)
 *  - fill / click / select / upload / wait (network-idle / selector / ms)
 *  - observe (text / attribute) and extract (slot capture)
 *  - screenshot evidence
 *
 * The runtime is driven by the DSL interpreter and the project's `systems:`
 * mapping. It MUST NOT contain any hard-coded URL, selector, account or
 * business state name.
 *
 * Playwright is loaded lazily via dynamic `import('playwright')` so that
 * projects that only need the HTTP runtime do not pay the import cost.
 */

import { createRedactor } from './redaction.js';
import { writeEvidenceFrame, writeEvidenceScreenshot } from './evidence-writer.js';
import type {
  RuntimeSystemConfig,
  DslActionObservation,
  DslScenarioObservation,
} from './types.js';

export interface BuiltinBrowserRuntimeOptions {
  system: RuntimeSystemConfig;
  side: string;
  evidenceRoot: string | null;
}

// We use the structural subset of Playwright's `Browser` / `BrowserContext` /
// `Page` types via `any` to avoid coupling the SDK to a particular Playwright
// version's full type surface. The runtime is loaded only when channel ===
// 'browser', so type drift in non-essential APIs cannot break callers.

type MinimalPage = any;
type MinimalBrowserContext = any;
type MinimalBrowser = any;

let cachedChromium: ((opts?: any) => Promise<MinimalBrowser>) | null = null;
let playwrightLoadTried = false;

async function loadChromium(): Promise<((opts?: any) => Promise<MinimalBrowser>) | null> {
  if (cachedChromium) return cachedChromium;
  if (playwrightLoadTried) return cachedChromium;
  playwrightLoadTried = true;
  try {
    const mod = await import('playwright');
    cachedChromium = (mod as any).chromium?.launch?.bind((mod as any).chromium) ?? null;
    return cachedChromium;
  } catch {
    cachedChromium = null;
    return null;
  }
}

export class BuiltinBrowserRuntime {
  readonly system: RuntimeSystemConfig;
  readonly side: string;
  readonly evidenceRoot: string | null;
  readonly redactor;

  private browser: MinimalBrowser | null = null;
  private context: MinimalBrowserContext | null = null;
  private page: MinimalPage | null = null;
  private readonly slotStore = new Map<string, unknown>();
  private readonly captureStore = new Map<string, unknown>();
  private semanticPath: string[] = [];
  private lastStateBefore: string | null = null;
  private scenarioId: string | null = null;
  private loggedInActor: string | null = null;

  constructor(options: BuiltinBrowserRuntimeOptions) {
    this.system = options.system;
    this.side = options.side;
    this.evidenceRoot = options.evidenceRoot;
    this.redactor = createRedactor({
      fields: options.system.redact?.fields ?? [],
      headers: options.system.redact?.headers ?? [],
    });
  }

  setScenario(scenarioId: string): void {
    this.scenarioId = scenarioId;
    this.slotStore.clear();
    this.captureStore.clear();
    this.semanticPath = [];
    this.lastStateBefore = null;
  }

  /** Start a fresh BrowserContext for the next scenario so that cookies/session
   * state from a previous scenario never leak into it (e.g. a current-system
   * login redirecting a still-authenticated session away from the login page).
   * The browser itself is reused; only the context is reset. */
  async resetScenario(): Promise<void> {
    if (!this.browser) throw new Error('initialize() must be called before resetScenario()');
    const headed = this.system.browser?.headless === false;
    this.loggedInActor = null;
    if (headed) {
      // In headed mode creating a new BrowserContext opens a brand-new browser
      // window. Clear storage on the current page before closing it to avoid
      // the flash caused by opening a temporary page and navigating to baseUrl.
      try {
        const current = this.page;
        if (current && !current.isClosed?.()) {
          await current.evaluate('window.localStorage.clear(); window.sessionStorage.clear();').catch(() => undefined);
          await current.close();
        }
      } catch { /* ignore */ }
      this.page = null;
      try { await this.context?.clearCookies?.(); } catch { /* ignore */ }
      return;
    }
    try { await this.context?.close?.(); } catch { /* ignore */ }
    this.context = await this.browser.newContext();
    this.page = null;
  }

  /**
   * Determine whether the current session is already authenticated.
   *
   * Navigates to the login page for this system. If the app stays on the
   * login page the session is logged out; if it redirects away (to the
   * authenticated home), the session is still logged in. Works for both
   * hash-based (legacy `#/login`) and path-based (current `/login`) routes.
   */
  async isLoggedIn(): Promise<boolean> {
    const page = await this.ensurePage();
    const loginPath = this.system.login?.path ?? this.system.pages?.login?.path ?? '#/login';
    const base = this.system.baseUrl.replace(/\/$/, '');
    const loginUrl = `${base}${loginPath.startsWith('/') || loginPath.startsWith('#') ? '' : '/'}${loginPath}`;
    const timeoutMs = this.system.browser?.timeoutMs ?? 15000;
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => undefined);
    const current = page.url();
    // If we are still on the login page (or the login hash), not logged in.
    const stillOnLogin = current.includes(loginPath) || new URL(current).pathname.endsWith('/login');
    return !stillOnLogin;
  }

  /**
   * Ensure the session is logged out before a scenario starts. If the current
   * session is authenticated it performs the logout sequence via the system's
   * configured logout selectors, then verifies we have returned to the login
   * page. If already logged out this is a no-op.
   */
  async ensureLoggedOut(): Promise<void> {
    const page = await this.ensurePage();
    const timeoutMs = this.system.browser?.timeoutMs ?? 15000;
    const loginPath = this.system.login?.path ?? this.system.pages?.login?.path ?? '#/login';
    const base = this.system.baseUrl.replace(/\/$/, '');
    const loginUrl = `${base}${loginPath.startsWith('/') || loginPath.startsWith('#') ? '' : '/'}${loginPath}`;

    const currentUrl = page.url();

    // If the page is still about:blank (fresh context/page), do not wait for a
    // logout redirect that can never happen; jump straight to the login page so
    // the headed browser window starts rendering real content immediately.
    if (currentUrl === 'about:blank' || currentUrl.startsWith('about:blank')) {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => undefined);
      this.loggedInActor = null;
      return;
    }

    // If we are already on the login page, there is no need to navigate back
    // and forth just to check the session state. This avoids the flashing
    // caused by isLoggedIn() jumping to the login URL on every scenario.
    const onLoginPage = currentUrl.includes(loginPath) || new URL(currentUrl).pathname.endsWith('/login');
    if (onLoginPage) {
      this.loggedInActor = null;
      return;
    }

    const logoutEntry = this.system.selectors?.logout_entry;
    const logoutMenuItem = this.system.selectors?.logout_menu_item;
    const logoutConfirm = this.system.selectors?.logout_confirm_btn ?? this.system.selectors?.logout_confirm;

    if (logoutEntry) {
      await page.click(this.resolveSelector('logout_entry'), { timeout: timeoutMs }).catch(() => undefined);
    }
    if (logoutMenuItem) {
      await page.waitForSelector(this.resolveSelector('logout_menu_item'), { state: 'visible', timeout: timeoutMs }).catch(() => undefined);
      await page.click(this.resolveSelector('logout_menu_item'), { timeout: timeoutMs }).catch(() => undefined);
    }
    if (logoutConfirm) {
      await page.click(this.resolveSelector('logout_confirm_btn'), { timeout: timeoutMs }).catch(() => undefined);
    }
    // Legacy systems need a moment for the confirm dialog to disappear and the
    // app to return to the login page; wait for the login page to be reached.
    const escaped = loginPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.waitForURL(new RegExp(escaped), { timeout: timeoutMs }).catch(() => undefined);

    // Fallback: if the logout flow did not redirect to the login page (e.g. the
    // session cookie was cleared or the SPA stayed on an internal page), force
    // navigation so the next login attempt starts from a known URL.
    const currentUrlAfterLogout = page.url();
    const stillOnLoginPage = currentUrlAfterLogout.includes(loginPath) || new URL(currentUrlAfterLogout).pathname.endsWith('/login');
    if (!stillOnLoginPage) {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => undefined);
    }
    this.loggedInActor = null;
  }

  /**
   * Ensure the session is logged in as a specific actor before a scenario
   * starts. Logs out any existing session first, then performs the login
   * sequence with the actor's credentials. This guarantees every scenario
   * starts from a known, correct authentication state regardless of what a
   * previous scenario left behind.
   */
  async ensureLoggedIn(actor: string): Promise<void> {
    if (this.loggedInActor === actor) return;
    await this.ensureLoggedOut();
    const page = await this.ensurePage();
    const timeoutMs = this.system.browser?.timeoutMs ?? 15000;

    const loginPath = this.system.login?.path ?? this.system.pages?.login?.path ?? '#/login';
    const base = this.system.baseUrl.replace(/\/$/, '');
    const loginUrl = `${base}${loginPath.startsWith('/') || loginPath.startsWith('#') ? '' : '/'}${loginPath}`;
    // Avoid reloading the login page if ensureLoggedOut() already brought us there.
    // This removes the extra flash caused by navigating to the same login URL twice.
    const currentUrl = page.url();
    const alreadyOnLogin = currentUrl.includes(loginPath) || new URL(currentUrl).pathname.endsWith('/login');
    if (!alreadyOnLogin) {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    }
    // SPA login form may not be rendered immediately after domcontentloaded;
    // wait for the username field before filling.
    await page.waitForSelector(this.resolveSelector('username'), { state: 'visible', timeout: timeoutMs });

    const username = this.resolveCredential(actor, 'username') ?? process.env.TEST_USERNAME ?? '';
    const password = this.resolveCredential(actor, 'password') ?? process.env.TEST_PASSWORD ?? '';

    await page.fill(this.resolveSelector('username'), username, { timeout: timeoutMs });
    await page.fill(this.resolveSelector('password'), password, { timeout: timeoutMs });
    await page.click(this.resolveSelector('submit'), { timeout: timeoutMs });

    const successPattern = this.system.login?.successUrlPattern;
    if (successPattern) {
      const stillOnLogin = await page.waitForURL(new RegExp(successPattern), { timeout: 30000 })
        .then(() => false)
        .catch(() => true);
      if (stillOnLogin) {
        const pageError = await this.detectPageError(page);
        throw new Error(pageError ? `Login failed: ${pageError}` : `Login failed: URL did not match success pattern ${successPattern}`);
      }
      // After login redirect, wait for the SPA to fully render before the
      // scenario starts interacting with the page. Without this, the first
      // run (cold cache) may fail because the page content is not ready yet
      // while subsequent runs (warm cache) succeed.
      await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
    } else {
      await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
      const pageError = await this.detectPageError(page);
      if (pageError) throw new Error(`Login failed: ${pageError}`);
    }
    this.loggedInActor = actor;
  }

  async initialize(): Promise<void> {
    const launch = await loadChromium();
    if (!launch) {
      throw new Error(
        `[flowtrace] browser runtime requested for system "${this.system.id}" but the optional \`playwright\` dependency is not installed. Install it with \`npm i playwright\` or switch the system to channel: http.`,
      );
    }
    const launchOpts: Record<string, unknown> = {
      headless: this.system.browser?.headless ?? true,
      args: [...(this.system.browser?.args ?? [])],
    };
    if (this.system.browser?.executablePath) launchOpts.executablePath = this.system.browser.executablePath;
    this.browser = await launch(launchOpts);
    // Record video in headed mode to diagnose page flickering during automation.
    const videoDir = this.evidenceRoot ? `${this.evidenceRoot}/videos` : '.flowtrace/videos';
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: {
        dir: videoDir,
        size: { width: 1280, height: 720 },
      },
    });
  }

  async ensurePage(): Promise<MinimalPage> {
    if (!this.context) throw new Error('initialize() must be called before ensurePage()');
    if (!this.page || this.page.isClosed?.()) {
      this.page = await this.context.newPage();
      // In headed mode an inactive window may not render/navigate until it is
      // focused, which looks like a blank browser that blocks execution.
      if (this.system.browser?.headless === false) {
        await (this.page as any).bringToFront?.().catch(() => undefined);
      }
    }
    return this.page;
  }

  async cleanup(): Promise<void> {
    try { await this.context?.close?.(); } catch { /* ignore */ }
    try { await this.browser?.close?.(); } catch { /* ignore */ }
    this.context = null;
    this.browser = null;
    this.page = null;
  }

  getSlot(name: string): unknown { return this.slotStore.get(name); }
  setSlot(name: string, value: unknown): void { this.slotStore.set(name, value); }
  getSemanticPath(): string[] { return [...this.semanticPath]; }
  getCaptures(): Record<string, unknown> { return Object.fromEntries(this.captureStore.entries()); }
  setCapture(name: string, value: unknown): void { this.captureStore.set(name, value); }

  private nowIso(): string { return new Date().toISOString(); }

  /**
   * Capture a screenshot after giving the page a short moment to settle.
   * Uses the actionIndex and optional stepIndex so each step within a
   * scenario action gets its own evidence file instead of overwriting the
   * same filename.
   */
  private async captureScreenshot(
    input: { actionIndex: number; stepIndex?: number; action: string; actor?: string },
    _hint?: string,
  ): Promise<string | null> {
    const page = await this.ensurePage();
    // Give the page a short moment to settle after the previous action.
    await page.waitForTimeout(200);
    // Detect common popup / modal / overlay / drawer containers and wait for
    // their animation to finish. This is critical for Element Plus / Ant
    // Design style UIs where dialogs fade/slide in after a click.
    const overlaySelectors = [
      '.el-dialog__wrapper:not([style*="display: none"])',
      '.el-overlay:not([style*="display: none"])',
      '.el-drawer.open',
      '.el-message-box__wrapper:not([style*="display: none"])',
      '.ant-modal-wrap:not([style*="display: none"])',
      '.ant-drawer-open',
      '.modal.show',
      '.dialog-open',
    ];
    const combinedOverlay = overlaySelectors.join(', ');
    const hasOverlay = await page.locator(combinedOverlay).first().isVisible().catch(() => false);
    if (hasOverlay) {
      // Modal animations commonly take 200-400ms; wait a bit more so the
      // screenshot captures the fully rendered popup instead of an empty page.
      await page.waitForTimeout(300);
      // Try to bring any focused popup into the viewport so fullPage capture
      // still centers the meaningful content. Use a string script so this
      // Node-only package does not need DOM lib declarations.
      await page.evaluate(`(() => {
        const active = document.querySelector('.el-dialog, .el-drawer, .ant-modal, .el-message-box, [role="dialog"]');
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'center', behavior: 'instant' });
      })()`).catch(() => undefined);
    }
    const buffer = await page.screenshot({ fullPage: false }).catch(() => null);
    if (!buffer) return null;
    return writeEvidenceScreenshot({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      stepIndex: input.stepIndex,
      action: input.action,
      buffer,
    });
  }

  private resolveSelector(selectorOrKey: string): string {
    const map = this.system.selectors ?? {};
    return map[selectorOrKey] ?? selectorOrKey;
  }

  /**
   * Resolve a browser `fill` value from the system's per-actor credential map.
   *
   * `valueRef` is a logical credential field key (e.g. `username` / `password`).
   * When the system declares `login.actorMap[actor].<field>` (an env var name),
   * the value is read from that system-specific env var, so a dual-run can
   * inject different accounts per system (e.g. legacy `zhangjw` vs current
   * `admin` for the same logical role). Falls back to `null` when no actorMap
   * entry applies, letting the caller use the plain `process.env[valueRef]`.
   */
  private resolveCredential(actor: string, valueRef: string): string | null {
    const login = this.system.login;
    const entry = login?.actorMap?.[actor];
    if (!entry) return null;
    const envVar = (entry as Record<string, string>)[valueRef];
    if (!envVar) return null;
    const value = process.env[envVar];
    return value === undefined ? null : value;
  }

  private resolvePagePath(pageKey: string): string {
    const pages = this.system.pages ?? {};
    if (pages[pageKey]) {
      const p = pages[pageKey]!;
      const base = this.system.baseUrl.replace(/\/$/, '');
      return `${base}${p.path.startsWith('/') ? '' : '/'}${p.path}`;
    }
    const base = this.system.baseUrl.replace(/\/$/, '');
    return pageKey.startsWith('/') ? `${base}${pageKey}` : `${base}/${pageKey}`;
  }

  async goto(input: { page?: string; url?: string; actionIndex: number; stepIndex?: number; action: string; actor?: string }): Promise<{ url: string; evidencePath: string | null; screenshotPath: string | null }> {
    const page = await this.ensurePage();
    const target = input.url ?? (input.page ? this.resolvePagePath(input.page) : null);
    if (!target) throw new Error('goto step requires `page` or `url`');

    const timeoutMs = this.system.browser?.timeoutMs;
    const currentUrl = page.url();
    // Avoid redundant navigation when the page is already on the target URL.
    // This removes the flashing caused by reloading the same page at the start
    // of every scenario.
    const alreadyThere = currentUrl.includes(target) || target.includes(currentUrl);
    if (!alreadyThere) {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
    } else {
      // Even when already on the target URL (e.g. after login redirect), the
      // SPA may still be rendering its content. Wait for network idle so the
      // scenario doesn't interact with a half-loaded page.
      await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
    }
    // In headed mode an inactive window can stall the scenario; bring it to the
    // front after every navigation so the user sees the live page and Playwright
    // receives window focus events.
    if (this.system.browser?.headless === false) {
      await (page as any).bringToFront?.().catch(() => undefined);
    }
    const finalUrl = page.url();
    const screenshotPath = await this.captureScreenshot(input, '页面加载完成');
    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      stepIndex: input.stepIndex,
      action: input.action,
      actor: input.actor,
      request: { method: 'GET', url: target },
      response: { status: 200, body: null, headers: { 'content-type': 'text/html' } },
      stateBefore: this.lastStateBefore,
      stateAfter: null,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });
    return { url: finalUrl, evidencePath, screenshotPath };
  }

  async fill(input: { selector: string; value: string; valueRef?: string; actionIndex: number; stepIndex?: number; action: string; actor?: string }): Promise<{ evidencePath: string | null; error?: { code: string; message: string } }> {
    const page = await this.ensurePage();
    const value = input.valueRef
      ? (this.resolveCredential(input.actor ?? '', input.valueRef) ?? process.env[input.valueRef] ?? '')
      : input.value;
    const sel = this.resolveSelector(input.selector);
    const timeoutMs = this.system.browser?.timeoutMs;
    await page.fill(sel, value, { timeout: timeoutMs });
    // Verify the value was actually written. Some dynamic forms clear or
    // reject inputs silently; catching an empty required field here stops
    // the scenario before a later submit fails with a cryptic error.
    if (value && value.trim() !== '') {
      const actualValue = await page.inputValue(sel).catch(() => '');
      if ((actualValue ?? '').trim() === '') {
        const evidencePath = await writeEvidenceFrame({
          evidenceRoot: this.evidenceRoot ?? '',
          side: this.side,
          scenarioId: this.scenarioId ?? 'unknown-scenario',
          actionIndex: input.actionIndex,
          stepIndex: input.stepIndex,
          action: input.action,
          actor: input.actor,
          request: { method: 'FORM', url: page.url(), body: { [input.selector]: '[redacted]' } },
          response: { status: 400, body: { error: `Field ${sel} is empty after fill` }, headers: { 'content-type': 'text/html' } },
          stateBefore: this.lastStateBefore,
          stateAfter: null,
          semanticPath: this.semanticPath,
          redactor: this.redactor,
        });
        return { evidencePath, error: { code: 'FIELD_EMPTY', message: `Field ${sel} is empty after fill` } };
      }
    }
    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      stepIndex: input.stepIndex,
      action: input.action,
      actor: input.actor,
      request: { method: 'FORM', url: page.url(), body: { [input.selector]: '[redacted]' } },
      response: { status: 200, body: null, headers: { 'content-type': 'text/html' } },
      stateBefore: this.lastStateBefore,
      stateAfter: null,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });
    return { evidencePath };
  }

  async click(input: { selector: string; actionIndex: number; stepIndex?: number; action: string; actor?: string }): Promise<{ evidencePath: string | null; screenshotPath: string | null; error?: { code: string; message: string } }> {
    const page = await this.ensurePage();
    const sel = this.resolveSelector(input.selector);
    const timeoutMs = this.system.browser?.timeoutMs;
    let responseStatus: number | null = null;
    const listener = (resp: any) => {
      try {
        if (resp.request().method() === 'POST' && resp.status() >= 400) responseStatus = resp.status();
      } catch { /* ignore */ }
    };
    page.on?.('response', listener);
    try {
      const locator = page.locator(sel).first();
      // Ensure the target is scrolled into view, including inside nested
      // scrollable containers such as task drawers.
      await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs }).catch(() => undefined);
      await locator.click({ timeout: timeoutMs });
      await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined);
    } finally {
      page.off?.('response', listener);
    }
    const screenshotPath = await this.captureScreenshot(input, '点击后');
    const pageError = await this.detectPageError(page);
    const status = responseStatus ?? (pageError ? 400 : 200);
    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      stepIndex: input.stepIndex,
      action: input.action,
      actor: input.actor,
      request: { method: 'CLICK', url: page.url() },
      response: { status, body: pageError ? { error: pageError } : null },
      stateBefore: this.lastStateBefore,
      stateAfter: null,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });
    if (pageError) {
      return { evidencePath, screenshotPath, error: { code: 'PAGE_ERROR', message: pageError } };
    }
    return { evidencePath, screenshotPath };
  }

  private async detectPageError(page: MinimalPage): Promise<string | null> {
    const errorSelectors = [
      '.el-message--error .el-message__content',
      '.el-message--error',
      '.el-message__content:has-text(失败)',
      '.el-message__content:has-text(错误)',
      '.el-message .el-message__content:has-text(不能为空)',
      '.el-form-item__error',
      '.el-notification__content:has-text(失败)',
      '.el-notification__content:has-text(错误)',
      '.ant-message-error .ant-message-error-content',
      '.ant-form-item-explain-error',
    ];
    const combinedSelector = errorSelectors.join(', ');
    const text = await page.locator(combinedSelector).first().textContent({ timeout: 1000 }).catch(() => null);
    if (text?.trim()) return text.trim();
    // Also detect common HTTP error pages or blank error states.
    const title = await page.title().catch(() => null);
    if (title && /^(500|502|503|504|错误|Error)/i.test(title)) return `Page error title: ${title}`;
    return null;
  }

  async observe(input: { selector: string; field: 'text' | { attribute: string }; actionIndex: number; stepIndex?: number; action: string; captureAs?: string; actor?: string }): Promise<{ state: string | null; evidencePath: string | null }> {
    const page = await this.ensurePage();
    const sel = this.resolveSelector(input.selector);
    const timeoutMs = this.system.browser?.timeoutMs;
    let captured: string | null = null;
    try {
      if (input.field === 'text') {
        const t = await page.textContent(sel, { timeout: timeoutMs });
        captured = (t ?? '').trim() || null;
      } else {
        captured = await page.getAttribute(sel, input.field.attribute, { timeout: timeoutMs });
      }
    } catch {
      captured = null;
    }
    const slotName = input.captureAs ?? 'state';
    this.slotStore.set(slotName, captured);
    if (slotName !== 'state' && captured) {
      this.slotStore.set('state', captured);
    }
    if (captured) {
      this.pushSemanticState(captured);
    }
    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      stepIndex: input.stepIndex,
      action: input.action,
      actor: input.actor,
      request: { method: 'OBSERVE', url: page.url(), body: { selector: sel, field: input.field } },
      response: { status: 200, body: { captured } },
      stateBefore: this.lastStateBefore,
      stateAfter: captured,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });
    return { state: captured, evidencePath };
  }

  async screenshot(input: { name: string; actionIndex: number; stepIndex?: number; action: string; actor?: string }): Promise<{ path: string | null }> {
    const filePath = await this.captureScreenshot(input, input.name);
    return { path: filePath };
  }

  async evaluate(input: { script: string; captureAs?: string; pushToPath?: boolean; actionIndex: number; stepIndex?: number; action: string; actor?: string }): Promise<{ result: unknown; evidencePath: string | null }> {
    const page = await this.ensurePage();
    const timeoutMs = this.system.browser?.timeoutMs;
    let result: unknown = null;
    // Wrap plain expressions in an async IIFE so `await` and multi-line
    // statements work reliably inside `page.evaluate`, and fetch promise
    // rejections are surfaced as a returned object rather than an uncaught
    // evaluation error.
    const script = input.script.trim();
    const needsWrapper = !/^(function\s*\(|\(|async\s+(function\s*\(|\(|[\w$]+\s*=>))/.test(script);
    const wrapped = needsWrapper ? `(async () => { return (${script}); })()` : script;
    try {
      result = await page.evaluate(wrapped, { timeout: timeoutMs });
    } catch (err) {
      const errorResult = { error: err instanceof Error ? err.message : String(err), wrappedScript: wrapped };
      if (input.captureAs) {
        this.setCapture(input.captureAs, errorResult);
        this.setSlot(input.captureAs, errorResult);
      }
      const evidencePath = await writeEvidenceFrame({
        evidenceRoot: this.evidenceRoot ?? '',
        side: this.side,
        scenarioId: this.scenarioId ?? 'unknown-scenario',
        actionIndex: input.actionIndex,
        stepIndex: input.stepIndex,
        action: input.action,
        actor: input.actor,
        request: { method: 'EVALUATE', url: page.url(), body: { script: input.script, captureAs: input.captureAs } },
        response: { status: 500, body: errorResult },
        stateBefore: this.lastStateBefore,
        stateAfter: null,
        semanticPath: this.semanticPath,
        redactor: this.redactor,
      });
      return { result: errorResult, evidencePath };
    }
    if (input.captureAs) {
      this.setCapture(input.captureAs, result);
      this.setSlot(input.captureAs, result);
    }
    if (input.pushToPath && result != null) {
      this.pushSemanticState(String(result));
    }
    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      stepIndex: input.stepIndex,
      action: input.action,
      actor: input.actor,
      request: { method: 'EVALUATE', url: page.url(), body: { script: input.script, captureAs: input.captureAs } },
      response: { status: 200, body: { result } },
      stateBefore: this.lastStateBefore,
      stateAfter: input.captureAs && result != null ? String(result) : null,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });
    return { result, evidencePath };
  }

  async wait(input: { for: 'network-idle' | 'domcontentloaded' | 'load' | { selector: string; state?: 'visible' | 'hidden' | 'attached' | 'detached' } | { urlMatches: string } | { ms: number }; timeoutMs?: number; actionIndex: number; stepIndex?: number; action: string; actor?: string }): Promise<{ evidencePath: string | null; screenshotPath: string | null }> {
    const page = await this.ensurePage();
    const timeoutMs = input.timeoutMs ?? this.system.browser?.timeoutMs;
    const target = input.for;
    if (target === 'network-idle' || target === 'domcontentloaded' || target === 'load') {
      const mapped = target === 'network-idle' ? 'networkidle' : target;
      await page.waitForLoadState(mapped, { timeout: timeoutMs });
    } else if ('ms' in target) {
      await page.waitForTimeout(target.ms);
    } else if ('urlMatches' in target) {
      await page.waitForURL(new RegExp(target.urlMatches), { timeout: timeoutMs });
    } else if ('selector' in target) {
      const sel = this.resolveSelector(target.selector);
      await page.waitForSelector(sel, { state: target.state ?? 'visible', timeout: timeoutMs });
    }
    const screenshotPath = await this.captureScreenshot(input, '等待后');
    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      stepIndex: input.stepIndex,
      action: input.action,
      actor: input.actor,
      request: { method: 'WAIT', url: page.url(), body: { for: target } },
      response: { status: 200, body: null },
      stateBefore: this.lastStateBefore,
      stateAfter: null,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });
    return { evidencePath, screenshotPath };
  }

  pushSemanticState(state: string | null): void {
    if (!state) return;
    const last = this.semanticPath[this.semanticPath.length - 1];
    if (last !== state) this.semanticPath.push(state);
    this.lastStateBefore = state;
  }

  recordAction(actionInput: {
    actionId: string;
    actionIndex: number;
    actor?: string;
    status: number | null;
    errorCode: string | null;
    message: string | null;
    stateBefore: string | null;
    stateAfter: string | null;
    evidencePaths: string[];
    illegal: { errorCode: string; message?: string; actionIndex: number } | null;
  }): DslActionObservation {
    return {
      actionId: actionInput.actionId,
      index: actionInput.actionIndex,
      actor: actionInput.actor,
      status: actionInput.status,
      errorCode: actionInput.errorCode,
      message: actionInput.message,
      stateBefore: actionInput.stateBefore,
      stateAfter: actionInput.stateAfter,
      evidencePaths: actionInput.evidencePaths,
      illegalTransition: actionInput.illegal
        ? {
            actionIndex: actionInput.illegal.actionIndex,
            errorCode: actionInput.illegal.errorCode,
            message: actionInput.illegal.message,
            stateBefore: actionInput.stateBefore,
            stateAfter: actionInput.stateAfter,
          }
        : null,
      captures: this.getCaptures(),
      startedAt: this.nowIso(),
      finishedAt: this.nowIso(),
    };
  }

  buildScenarioObservation(input: { scenarioId: string; actions: DslActionObservation[]; error: string | null; finalState: string | null }): DslScenarioObservation {
    return {
      scenarioId: input.scenarioId,
      systemId: this.system.id,
      finalState: input.finalState,
      semanticPath: [...this.semanticPath],
      actions: input.actions,
      captures: this.getCaptures(),
      error: input.error,
      startedAt: this.nowIso(),
      finishedAt: this.nowIso(),
    };
  }
}