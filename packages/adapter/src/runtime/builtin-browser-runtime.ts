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
  private semanticPath: string[] = [];
  private lastStateBefore: string | null = null;
  private scenarioId: string | null = null;

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
    this.semanticPath = [];
    this.lastStateBefore = null;
  }

  isChromiumAvailable(): boolean { return Boolean(cachedChromium); }

  async initialize(): Promise<void> {
    const launch = await loadChromium();
    if (!launch) {
      throw new Error(
        `[flowtrace] browser runtime requested for system "${this.system.id}" but the optional \`playwright\` dependency is not installed. Install it with \`npm i playwright\` or switch the system to channel: http.`,
      );
    }
    const launchOpts: Record<string, unknown> = { headless: this.system.browser?.headless ?? true };
    if (this.system.browser?.args) launchOpts.args = this.system.browser.args;
    if (this.system.browser?.executablePath) launchOpts.executablePath = this.system.browser.executablePath;
    this.browser = await launch(launchOpts);
    this.context = await this.browser.newContext();
  }

  async ensurePage(): Promise<MinimalPage> {
    if (!this.context) throw new Error('initialize() must be called before ensurePage()');
    if (!this.page || this.page.isClosed?.()) {
      this.page = await this.context.newPage();
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

  private nowIso(): string { return new Date().toISOString(); }

  private resolveSelector(selectorOrKey: string): string {
    const map = this.system.selectors ?? {};
    return map[selectorOrKey] ?? selectorOrKey;
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

  async goto(input: { page?: string; url?: string; actionIndex: number; action: string; actor?: string }): Promise<{ url: string; evidencePath: string | null }> {
    const page = await this.ensurePage();
    const target = input.url ?? (input.page ? this.resolvePagePath(input.page) : null);
    if (!target) throw new Error('goto step requires `page` or `url`');

    const timeoutMs = this.system.browser?.timeoutMs;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const finalUrl = page.url();
    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      action: input.action,
      actor: input.actor,
      request: { method: 'GET', url: target },
      response: { status: 200, body: null, headers: { 'content-type': 'text/html' } },
      stateBefore: this.lastStateBefore,
      stateAfter: null,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });
    return { url: finalUrl, evidencePath };
  }

  async fill(input: { selector: string; value: string; valueRef?: string; actionIndex: number; action: string; actor?: string }): Promise<{ evidencePath: string | null }> {
    const page = await this.ensurePage();
    const value = input.valueRef ? (process.env[input.valueRef] ?? '') : input.value;
    const sel = this.resolveSelector(input.selector);
    const timeoutMs = this.system.browser?.timeoutMs;
    await page.fill(sel, value, { timeout: timeoutMs });
    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
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

  async click(input: { selector: string; actionIndex: number; action: string; actor?: string }): Promise<{ evidencePath: string | null; screenshotPath: string | null }> {
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
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined),
        page.click(sel, { timeout: timeoutMs }),
      ]);
    } finally {
      page.off?.('response', listener);
    }
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    const screenshotPath = screenshot
      ? await writeEvidenceScreenshot({
          evidenceRoot: this.evidenceRoot ?? '',
          side: this.side,
          scenarioId: this.scenarioId ?? 'unknown-scenario',
          actionIndex: input.actionIndex,
          action: input.action,
          buffer: screenshot,
        })
      : null;
    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      action: input.action,
      actor: input.actor,
      request: { method: 'CLICK', url: page.url() },
      response: { status: responseStatus, body: null },
      stateBefore: this.lastStateBefore,
      stateAfter: null,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });
    return { evidencePath, screenshotPath };
  }

  async observe(input: { selector: string; field: 'text' | { attribute: string }; actionIndex: number; action: string; captureAs?: string; actor?: string }): Promise<{ state: string | null; evidencePath: string | null }> {
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
    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      action: input.action,
      actor: input.actor,
      request: { method: 'OBSERVE', url: page.url(), body: { selector: sel, field: input.field } },
      response: { status: 200, body: { captured } },
      stateBefore: this.lastStateBefore,
      stateAfter: null,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });
    return { state: captured, evidencePath };
  }

  async screenshot(input: { name: string; actionIndex: number; action: string; actor?: string }): Promise<{ path: string | null }> {
    const page = await this.ensurePage();
    const buffer = await page.screenshot({ fullPage: true }).catch(() => null);
    const filePath = await writeEvidenceScreenshot({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      action: input.action,
      buffer,
    });
    return { path: filePath };
  }

  async wait(input: { for: 'network-idle' | 'domcontentloaded' | 'load' | { selector: string; state?: 'visible' | 'hidden' | 'attached' | 'detached' } | { urlMatches: string } | { ms: number }; timeoutMs?: number; actionIndex: number; action: string; actor?: string }): Promise<void> {
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
    await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId ?? 'unknown-scenario',
      actionIndex: input.actionIndex,
      action: input.action,
      actor: input.actor,
      request: { method: 'WAIT', url: page.url(), body: { for: target } },
      response: { status: 200, body: null },
      stateBefore: this.lastStateBefore,
      stateAfter: null,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });
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
      error: input.error,
      startedAt: this.nowIso(),
      finishedAt: this.nowIso(),
    };
  }
}