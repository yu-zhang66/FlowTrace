/**
 * Builtin HTTP runtime for FlowTrace.
 *
 * Provides generic primitives:
 *  - per-actor cookie jar with isolated Cookie headers
 *  - structured JSON / form request execution
 *  - redacted response capture (status + headers + JSON body up to a size cap)
 *  - end-to-end call to login / named endpoints / arbitrary paths
 *  - no business assumptions: no hard-coded URL, selector, account or
 *    scenario identifier
 *
 * The runtime is driven by the DSL interpreter and the project's `systems:`
 * mapping. It is intentionally generic so a second target project with
 * different pages / actions / states can be driven without modifying this
 * code.
 */

import { createRedactor } from './redaction.js';
import { writeEvidenceFrame, writeEvidenceScreenshot } from './evidence-writer.js';
import type {
  RuntimeSystemConfig,
  RuntimeLoginConfig,
  RuntimeEndpointConfig,
  DslActionObservation,
  DslScenarioObservation,
} from './types.js';

export interface BuiltinHttpRuntimeOptions {
  system: RuntimeSystemConfig;
  /** Side label, e.g. `legacy` or `current`. */
  side: string;
  /** Directory under which evidence JSON files are written. */
  evidenceRoot: string | null;
  /** Optional request body cap (bytes). Defaults to 1 MiB. */
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 1024 * 1024;

type MinimalPage = any;
type MinimalBrowserContext = any;
type MinimalBrowser = any;
let cachedChromium: ((opts?: any) => Promise<MinimalBrowser>) | null = null;
let playwrightLoadTried = false;

async function loadChromium(): Promise<((opts?: any) => Promise<MinimalBrowser>) | null> {
  if (cachedChromium || playwrightLoadTried) return cachedChromium;
  playwrightLoadTried = true;
  try {
    const mod = await import('playwright');
    cachedChromium = (mod as any).chromium?.launch?.bind((mod as any).chromium) ?? null;
  } catch {
    cachedChromium = null;
  }
  return cachedChromium;
}

export interface CookieJar {
  headerFor(actor: string | undefined): string;
  storeFromResponse(actor: string, response: Response): void;
  clear(): void;
}

class MemoryCookieJar implements CookieJar {
  private readonly byActor = new Map<string, string>();

  headerFor(actor: string | undefined): string {
    if (!actor) return '';
    return this.byActor.get(actor) || '';
  }

  storeFromResponse(actor: string, response: Response): void {
    const raw = response.headers.get('set-cookie');
    if (!raw) return;
    const pair = raw.split(';')[0];
    const existing = this.byActor.get(actor);
    this.byActor.set(actor, existing ? `${existing}; ${pair}` : pair);
  }

  clear(): void {
    this.byActor.clear();
  }
}

export class BuiltinHttpRuntime {
  readonly system: RuntimeSystemConfig;
  readonly side: string;
  readonly evidenceRoot: string | null;
  readonly redactor;
  private readonly cookieJar: CookieJar = new MemoryCookieJar();
  private readonly maxBody: number;
  private readonly slotStore = new Map<string, unknown>();
  private semanticPath: string[] = [];
  private purchaseStateSlot: string | null = null;
  private lastStateBefore: string | null = null;
  private scenarioId: string | null = null;
  private screenshotBrowser: MinimalBrowser | null = null;
  private screenshotContext: MinimalBrowserContext | null = null;
  private screenshotPage: MinimalPage | null = null;

  constructor(options: BuiltinHttpRuntimeOptions) {
    this.system = options.system;
    this.side = options.side;
    this.evidenceRoot = options.evidenceRoot;
    this.maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
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
    this.purchaseStateSlot = null;
    this.cookieJar.clear();
  }

  getCookieJar(): CookieJar { return this.cookieJar; }
  getSlot(name: string): unknown { return this.slotStore.get(name); }
  setSlot(name: string, value: unknown): void { this.slotStore.set(name, value); }
  listSlots(): string[] { return [...this.slotStore.keys()]; }
  getSemanticPath(): string[] { return [...this.semanticPath]; }
  getLastState(): string | null { return this.lastStateBefore; }

  private nowIso(): string { return new Date().toISOString(); }

  private buildUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const base = this.system.baseUrl.replace(/\/$/, '');
    return pathOrUrl.startsWith('/') ? `${base}${pathOrUrl}` : `${base}/${pathOrUrl}`;
  }

  private async captureResponseBody(response: Response): Promise<unknown> {
    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > this.maxBody) {
      return { _truncated: true, bytes: Number(lengthHeader) };
    }
    try {
      const text = await response.text();
      if (!text) return null;
      if (text.length > this.maxBody) {
        return { _truncated: true, length: text.length, preview: text.slice(0, 1024) };
      }
      try { return JSON.parse(text); } catch { return { _raw: text }; }
    } catch (err) {
      return { _readError: err instanceof Error ? err.message : String(err) };
    }
  }

  private resolveScreenshotUrl(): string | null {
    const pages = this.system.pages ?? {};
    const detail = pages.detail?.path;
    const list = pages.list?.path;
    let id: unknown = this.slotStore.get('purchaseId');
    if (id === undefined) {
      for (const name of ['createResponse', 'response', 'created']) {
        const value = this.slotStore.get(name);
        if (value && typeof value === 'object') {
          id = (value as Record<string, unknown>).id ?? (value as Record<string, unknown>).purchaseId;
          if (id !== undefined) break;
        }
      }
    }
    if (detail && id !== undefined && id !== null && String(id) !== '') {
      return this.buildUrl(detail.replace(/\{(?:id|purchaseId)\}/g, encodeURIComponent(String(id))));
    }
    if (list) return this.buildUrl(list);
    return null;
  }

  private async captureScreenshot(input: { actor?: string; action: string; actionIndex: number; stepIndex?: number }): Promise<string | null> {
    if (!this.system.browser?.captureScreenshots || !this.evidenceRoot || !this.scenarioId) return null;
    const targetUrl = this.resolveScreenshotUrl();
    if (!targetUrl) return null;
    const launch = await loadChromium();
    if (!launch) return null;
    try {
      if (!this.screenshotBrowser) {
        this.screenshotBrowser = await launch({
          headless: this.system.browser?.headless ?? true,
          executablePath: this.system.browser?.executablePath,
          args: this.system.browser?.args,
        });
        this.screenshotContext = await this.screenshotBrowser.newContext();
        this.screenshotPage = await this.screenshotContext.newPage();
      }
      const cookie = this.cookieJar.headerFor(input.actor);
      await this.screenshotPage.setExtraHTTPHeaders(cookie ? { Cookie: cookie } : {});
      await this.screenshotPage.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.system.browser?.timeoutMs ?? 10_000,
      });
      const buffer = await this.screenshotPage.screenshot({ fullPage: true });
      return await writeEvidenceScreenshot({
        evidenceRoot: this.evidenceRoot,
        side: this.side,
        scenarioId: this.scenarioId,
        actionIndex: input.actionIndex,
        stepIndex: input.stepIndex,
        action: input.action,
        buffer,
      });
    } catch {
      // Screenshot collection is supplementary evidence. A missing browser or
      // an unroutable page must never change the HTTP verification result.
      return null;
    }
  }

  private async ensureLoggedIn(actor: string): Promise<void> {
    if (!this.system.login) return;
    const cfg: RuntimeLoginConfig = this.system.login;
    const url = this.buildUrl(cfg.path);

    // Resolve credentials: if actorMap has an entry, use it; otherwise use
    // the default fields as-is. For each entry, the key is the env var name
    // and the value is the HTML form field name.
    const loginFields: Array<{ envVar: string; selector: string }> = [];
    const actorEntry = cfg.actorMap?.[actor];
    if (actorEntry) {
      loginFields.push({ envVar: actorEntry.username, selector: 'username' });
      loginFields.push({ envVar: actorEntry.password, selector: 'password' });
    } else {
      for (const [envVar, selector] of Object.entries(cfg.fields)) {
        loginFields.push({ envVar, selector });
      }
    }

    const body = new URLSearchParams();
    for (const { envVar, selector } of loginFields) {
      const value = process.env[envVar];
      if (value === undefined) {
        throw new Error(`login: env var ${envVar} is not set for actor ${actor}`);
      }
      body.set(selector, value);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json, text/html',
    };
    const cookie = this.cookieJar.headerFor(actor);
    if (cookie) headers.Cookie = cookie;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
    });
    this.cookieJar.storeFromResponse(actor, response);
    if (response.status !== 200 && response.status !== 302) {
      throw new Error(`login failed for actor=${actor} status=${response.status}`);
    }
  }

  /**
   * Resolve a named endpoint (or fall back to inline method+path). Returns the
   * concrete URL and a default set of headers.
   */
  private resolveEndpoint(input: { endpoint?: string; method?: string; path?: string; url?: string }): {
    method: string;
    url: string;
    contentType: string;
    json: boolean;
  } {
    let method = input.method ?? 'GET';
    let urlPath = input.path ?? input.url ?? '';
    let contentType = 'application/json';
    let json = true;

    if (input.endpoint && this.system.endpoints?.[input.endpoint]) {
      const ep: RuntimeEndpointConfig = this.system.endpoints[input.endpoint]!;
      // For path/url, prefer the caller-supplied value (already substituted
      // by the DSL interpreter) over the endpoint template. This lets slots
      // like ${createResponse.id} be expanded at interpretation time. When
      // no caller path is supplied, fall back to the endpoint template but
      // still apply a slot-aware substitution so {id}-style placeholders in
      // endpoint definitions resolve correctly.
      if (!urlPath) {
        const tmpl = ep.url ?? ep.path ?? urlPath;
        // Endpoint path templates use {id}, {slug}, etc.; resolve them
        // from runtime slots. Object-valued slots (e.g. createResponse)
        // have their keys flattened for lookup, so {createResponse.id}
        // and {id} both work when only `createResponse` is set.
        urlPath = tmpl.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\}/g, (_, path) => {
          const parts = path.split('.');
          const root = parts[0];
          if (parts.length === 1) {
            const v = this.slotStore.get(root);
            if (v === undefined || v === null) {
              // Fall back: maybe `id` refers to the root id of an object slot.
              for (const val of this.slotStore.values()) {
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                  const inner = (val as Record<string, unknown>)[root];
                  if (inner !== undefined) return String(inner);
                }
              }
              return '';
            }
            if (typeof v === 'object') return JSON.stringify(v);
            return String(v);
          }
          let cur: unknown = this.slotStore.get(root);
          for (let i = 1; i < parts.length; i++) {
            if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[parts[i]!];
            else return '';
          }
          if (cur === undefined || cur === null) return '';
          if (typeof cur === 'object') return JSON.stringify(cur);
          return String(cur);
        });
      }
      // Prefer caller-supplied method (from DSL) over the endpoint default.
      method = input.method ?? ep.method ?? method;
      contentType = ep.contentType ?? contentType;
      json = ep.json ?? (contentType.includes('json'));
      if (process.env.FT_DEBUG_SLOTS) {
        console.error(`[FT_DEBUG_SLOTS] endpoint=${input.endpoint} urlPath(after)=${urlPath}`);
      }
    }

    if (!urlPath) {
      throw new Error(`endpoint requires path, url, or a known endpoint key (${input.endpoint ?? '<none>'})`);
    }
    return { method, url: this.buildUrl(urlPath), contentType, json };
  }

  /**
   * Execute a named HTTP request and capture the redacted evidence frame.
   * Returns the structured response body and status for downstream DSL steps.
   */
  async request(input: {
    endpoint?: string;
    method?: string;
    path?: string;
    url?: string;
    body?: unknown;
    query?: Record<string, string>;
    actor?: string;
    action: string;
    actionIndex: number;
    stepIndex?: number;
    captureAs?: string;
  }): Promise<{ status: number; body: unknown; evidencePath?: string; screenshotPath?: string }> {
    if (!this.scenarioId) throw new Error('setScenario() must be called before request()');

    if (input.actor) {
      await this.ensureLoggedIn(input.actor);
    }

    const resolved = this.resolveEndpoint({
      endpoint: input.endpoint,
      method: input.method,
      path: input.path,
      url: input.url,
    });

    let url = resolved.url;
    let bodyFromQuery: string | null = null;
    if (input.query && Object.keys(input.query).length > 0) {
      const qs = new URLSearchParams(input.query).toString();
      // For form-urlencoded requests, send the params as body instead of
      // query string. For JSON requests, append to URL as expected.
      if (resolved.contentType.includes('application/x-www-form-urlencoded')) {
        bodyFromQuery = qs;
      } else {
        url += (url.includes('?') ? '&' : '?') + qs;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': resolved.contentType,
      Accept: 'application/json, text/html',
    };
    const actor = input.actor;
    if (actor) {
      const cookie = this.cookieJar.headerFor(actor);
      if (cookie) headers.Cookie = cookie;
    }

    const init: RequestInit = { method: resolved.method, headers, redirect: 'manual' };
    if (bodyFromQuery !== null) {
      init.body = bodyFromQuery;
    } else if (input.body !== undefined && input.body !== null) {
      if (resolved.json) init.body = JSON.stringify(input.body);
      else init.body = input.body as any;
    }

    const response = await fetch(url, init);
    if (actor) this.cookieJar.storeFromResponse(actor, response);

    const responseBody = await this.captureResponseBody(response);
    const responseHeaders: Record<string, unknown> = {};
    response.headers.forEach((v, k) => { responseHeaders[k] = v; });

    const evidencePath = await writeEvidenceFrame({
      evidenceRoot: this.evidenceRoot ?? '',
      side: this.side,
      scenarioId: this.scenarioId,
      actionIndex: input.actionIndex,
      stepIndex: input.stepIndex,
      action: input.action,
      actor,
      request: {
        method: resolved.method,
        url,
        headers: { ...headers },
        body: input.body,
      },
      response: { status: response.status, headers: responseHeaders, body: responseBody },
      stateBefore: this.lastStateBefore,
      stateAfter: null,
      semanticPath: this.semanticPath,
      redactor: this.redactor,
    });

    if (input.captureAs) this.slotStore.set(input.captureAs, responseBody);

    const screenshotPath = await this.captureScreenshot({
      actor,
      action: input.action,
      actionIndex: input.actionIndex,
      stepIndex: input.stepIndex,
    });

    return { status: response.status, body: responseBody, evidencePath: evidencePath ?? undefined, screenshotPath: screenshotPath ?? undefined };
  }

  /**
   * Observe a state field via an HTTP query. The default selector path looks
   * up `systems.<id>.selectors.state` and parses its text content via a
   * user-supplied extractor (regex or jsonpath placeholder, kept simple here:
   * the response body is stored in slot `state`).
   */
  async observe(input: {
    endpoint?: string;
    method?: string;
    path?: string;
    url?: string;
    actor?: string;
    action: string;
    actionIndex: number;
    stepIndex?: number;
    captureAs?: string;
  }): Promise<{ status: number; body: unknown; state: string | null; evidencePath?: string; screenshotPath?: string }> {
    const out = await this.request(input);
    let state: string | null = null;
    if (out.body && typeof out.body === 'object') {
      const bodyObj = out.body as Record<string, unknown>;
      const candidate = bodyObj.state ?? bodyObj.status;
      if (typeof candidate === 'string') state = candidate;
      else if (typeof candidate === 'number') state = String(candidate);
    }
    const slotName = input.captureAs ?? 'state';
    this.slotStore.set(slotName, state ?? out.body);
    return { status: out.status, body: out.body, state, evidencePath: out.evidencePath, screenshotPath: out.screenshotPath };
  }

  /**
   * Record an action result for the caller. Mutates the action observation
   * shape produced by the interpreter.
   */
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

  /**
   * Mark a successful legal transition. Updates the semantic path with the
   * new state (without duplicates).
   */
  pushSemanticState(state: string | null): void {
    if (!state) return;
    const last = this.semanticPath[this.semanticPath.length - 1];
    if (last !== state) this.semanticPath.push(state);
    this.lastStateBefore = state;
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
