/**
 * Generic runtime & DSL type contracts for FlowTrace builtin runtime.
 *
 * These types are intentionally business-agnostic. They MUST NOT contain any
 * target-project URL, selector, account, scenario ID, business state name,
 * transition rule, error code, or role identifier.
 */

export type RuntimeVersion = '1';

export type RuntimeChannel = 'http' | 'browser';

export type RuntimeAdapterKind = 'builtin' | 'external' | 'legacy';

export type RuntimePluginKind = 'flow' | 'data' | 'observation';

export type ScenarioReviewStatus = 'AUTO_EXTRACTED' | 'REVIEW_REQUIRED' | 'CONFIRMED';

/** Per-system connection / auth / redaction configuration. */
export interface RuntimeSystemConfig {
  id: string;
  label?: string;
  baseUrl: string;
  channel: RuntimeChannel;
  /** Login endpoint, optional, used to obtain session cookie. */
  login?: RuntimeLoginConfig;
  /** Named endpoints referenced from DSL `request` steps. */
  endpoints?: Record<string, RuntimeEndpointConfig>;
  /** Named page paths referenced from DSL `goto` steps. */
  pages?: Record<string, RuntimePageConfig>;
  /** CSS / testid selectors referenced from DSL `observe` / `click` / `fill` steps. */
  selectors?: Record<string, string>;
  /** Per-system redaction overrides (in addition to default deny-list). */
  redact?: RuntimeRedactConfig;
  /** Browser-specific options (chromium path, headless, etc.). */
  browser?: RuntimeBrowserOptions;
}

export interface RuntimeLoginConfig {
  /** HTTP path or page path (e.g. `/login`). */
  path: string;
  /** Default field mapping: env var name (resolved at runtime) → selector key.
   * Used when no actor-specific override exists in `actorMap`. */
  fields: Record<string, string>;
  /** Submit selector key or raw selector. */
  submit?: string;
  /** Optional success predicate (URL pattern). */
  successUrlPattern?: string;
  /** Per-actor credential overrides. When an actor is listed here, its
   * env vars take precedence over the default `fields` mapping. */
  actorMap?: Record<string, { username: string; password: string }>;
}

export interface RuntimeEndpointConfig {
  /** HTTP method. */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Path appended to baseUrl (or absolute URL). */
  path?: string;
  url?: string;
  /** Content-Type header. */
  contentType?: string;
  /** Whether the request body is JSON-encoded. */
  json?: boolean;
}

export interface RuntimePageConfig {
  /** Path appended to baseUrl. */
  path: string;
}

export interface RuntimeRedactConfig {
  /** Additional field names (case-insensitive) to redact in evidence. */
  fields?: string[];
  /** Additional header names to redact. */
  headers?: string[];
}

export interface RuntimeBrowserOptions {
  headless?: boolean;
  executablePath?: string;
  args?: string[];
  /** Default timeout in milliseconds for navigation / action. */
  timeoutMs?: number;
  /** Capture a rendered page screenshot after HTTP actions when possible. */
  captureScreenshots?: boolean;
}

/** External plugin declaration under `runtime.adapter: external`. */
export interface RuntimeExternalConfig {
  /** Plugin package name or absolute module path. */
  module: string;
  /** Plugin display name (recorded in run metadata). */
  name: string;
  /** Plugin version (recorded in run metadata). */
  version: string;
  /** Plugin type: flow adapter / data adapter / observation extension. */
  kind: RuntimePluginKind;
}

/** Top-level `runtime:` block of flowtrace.yaml. */
export interface RuntimeConfig {
  /** Schema version for the runtime config. */
  version: RuntimeVersion;
  /** Adapter kind: builtin (default), external, or legacy (migration only). */
  adapter: RuntimeAdapterKind;
  /** Required when adapter === 'external'. */
  external?: RuntimeExternalConfig;
  /** Per-system connection / auth / redaction configuration. */
  systems: Record<string, RuntimeSystemConfig>;
}

/** DSL step types — declared in a process or scenario action body. */
export type DslStep =
  | DslGotoStep
  | DslFillStep
  | DslClickStep
  | DslSelectStep
  | DslUploadStep
  | DslWaitStep
  | DslRequestStep
  | DslObserveStep
  | DslExtractStep
  | DslAssertStep
  | DslScreenshotStep
  | DslEvaluateStep
  | DslConditionalStep
  | DslRepeatStep
  | DslEnsureLoginStep
  | DslEnsureLogoutStep;

export interface DslBaseStep {
  /** Optional human-readable label, surfaced in evidence. */
  label?: string;
}

export interface DslGotoStep extends DslBaseStep {
  type: 'goto';
  /** Page path key in `systems.<id>.pages` or a raw path starting with `/`. */
  page?: string;
  url?: string;
  /** Optional named system (e.g. `legacy` or `current`); defaults to current system in scope. */
  system?: string;
}

export interface DslFillStep extends DslBaseStep {
  type: 'fill';
  /** Selector key in `systems.<id>.selectors` or raw selector. */
  selector: string;
  /** Literal value or `${ENV_VAR}` reference. */
  value: string;
  /** Resolved env var name (set by DSL compiler; runtime substitutes via env). */
  valueRef?: string;
  system?: string;
}

export interface DslClickStep extends DslBaseStep {
  type: 'click';
  selector: string;
  system?: string;
}

export interface DslSelectStep extends DslBaseStep {
  type: 'select';
  selector: string;
  /** Option value or `${ENV_VAR}` reference. */
  value: string;
  valueRef?: string;
  system?: string;
}

export interface DslUploadStep extends DslBaseStep {
  type: 'upload';
  selector: string;
  /** Local file path. */
  file: string;
  system?: string;
}

export type DslWaitFor =
  | 'network-idle'
  | 'domcontentloaded'
  | 'load'
  | { selector: string; state?: 'visible' | 'hidden' | 'attached' | 'detached' }
  | { urlMatches: string }
  | { ms: number };

export interface DslWaitStep extends DslBaseStep {
  type: 'wait';
  for: DslWaitFor;
  system?: string;
  /** Optional timeout override in milliseconds. */
  timeoutMs?: number;
}

export interface DslRequestStep extends DslBaseStep {
  type: 'request';
  /** Endpoint key in `systems.<id>.endpoints` or `method`+`path`/`url`. */
  endpoint?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path?: string;
  url?: string;
  /** Inline request body (already redacted by author). */
  body?: unknown;
  /** Map of query parameters. */
  query?: Record<string, string>;
  /** Capture the JSON body of the response into the named slot. */
  captureAs?: string;
  system?: string;
}

export interface DslObserveStep extends DslBaseStep {
  type: 'observe';
  selector: string;
  /** Either text content or attribute value to capture. */
  field: 'text' | { attribute: string };
  /** Optional slot to store observation into; defaults to `state`. */
  captureAs?: string;
  system?: string;
}

export interface DslExtractStep extends DslBaseStep {
  type: 'extract';
  selector: string;
  attribute?: string;
  /** Slot name to capture into. */
  captureAs: string;
  system?: string;
}

export type DslAssertion =
  | { equals: { slot?: string; value?: unknown } }
  | { notEquals: { slot?: string; value?: unknown } }
  | { matches: { slot?: string; pattern: string } }
  | { exists: string }
  | { notExists: string };

export interface DslAssertStep extends DslBaseStep {
  type: 'assert';
  assert: DslAssertion;
  /** Optional severity override for the resulting difference. */
  severity?: 'P0' | 'P1' | 'P2' | 'P3';
  system?: string;
}

export interface DslScreenshotStep extends DslBaseStep {
  type: 'screenshot';
  /** Output file basename (resolved under evidence dir). */
  name: string;
  system?: string;
}

/**
 * Execute an arbitrary JavaScript expression in the browser page and capture
 * the result. Useful for reading values that are only available in the
 * frontend state (e.g. Vue/React component data, window globals, or computed
 * DOM queries).
 */
export interface DslEvaluateStep extends DslBaseStep {
  type: 'evaluate';
  /** JavaScript expression evaluated in the page context (must return a value). */
  script: string;
  /** Optional slot name to store the result into. */
  captureAs?: string;
  /** When true, also append the stringified result to the semantic path. */
  pushToPath?: boolean;
  system?: string;
}

export interface DslConditionalStep extends DslBaseStep {
  type: 'conditional';
  /** Branch selector (slot existence, equals, etc.). */
  when: DslAssertion;
  then: DslStep[];
  else?: DslStep[];
}

export interface DslRepeatStep extends DslBaseStep {
  type: 'repeat';
  times: number;
  steps: DslStep[];
}

/**
 * Ensure the session is logged in as a specific actor before continuing.
 * Runs the standard login sequence (logging out any existing session first).
 * Commonly used as the first step of a scenario so each test starts from a
 * known, correct authentication state.
 */
export interface DslEnsureLoginStep extends DslBaseStep {
  type: 'ensure-login';
  /** Actor whose credentials to use. Defaults to the action/scenario actor. */
  actor?: string;
}

/**
 * Ensure the session is logged out before continuing. Logs out any existing
 * session (no-op when already logged out). Used to prove a test starts from
 * an unauthenticated state.
 */
export interface DslEnsureLogoutStep extends DslBaseStep {
  type: 'ensure-logout';
}

/** Action declaration inside a process DSL or scenario. */
export interface DslAction {
  /** Logical action id (referenced from scenario actions / expected). */
  id: string;
  /** Optional human-readable label. */
  label?: string;
  /** Author / role id; surfaced in evidence. */
  actor?: string;
  /** DSL steps to execute this action. */
  steps: DslStep[];
  /** Optional illegal-transition declaration (for negative scenarios). */
  illegal?: {
    expectedErrorCode: string;
    message?: string;
  };
}

/** Process DSL root. */
export interface ProcessDsl {
  id: string;
  name: string;
  /** Required to bind a process to a builtin runtime interpretation. */
  channel: RuntimeChannel;
  /** Authoritative FSM metadata (states/transitions/roles). */
  fsm?: ProcessFsm;
  /** Action declarations. */
  actions: DslAction[];
  /** Optional terminal states used by reporter. */
  terminalStates?: string[];
  /** Process review status (AUTO_EXTRACTED / REVIEW_REQUIRED / CONFIRMED). */
  status?: ScenarioReviewStatus;
}

export interface ProcessFsm {
  states: Array<{ id: string; terminal?: boolean }>;
  transitions: Array<{ from: string; action: string; to: string; roles?: string[] }>;
  roles?: Array<{ id: string; description?: string }>;
}

/** Runtime observation produced by the DSL interpreter for one action. */
export interface DslActionObservation {
  actionId: string;
  index: number;
  actor?: string;
  status: number | null;
  errorCode: string | null;
  message: string | null;
  stateBefore: string | null;
  stateAfter: string | null;
  evidencePaths: string[];
  illegalTransition: {
    actionIndex: number;
    errorCode: string;
    message?: string;
    stateBefore: string | null;
    stateAfter: string | null;
  } | null;
  /** Captured slot values produced by this action (evaluate/extract/observe). */
  captures?: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
}

/** Runtime observation produced for a whole scenario. */
export interface DslScenarioObservation {
  scenarioId: string;
  systemId: string;
  finalState: string | null;
  semanticPath: string[];
  actions: DslActionObservation[];
  /** Aggregated captures from all actions (keyed by slot name). */
  captures?: Record<string, unknown>;
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

/** Re-export evidence frame schema used by the builtin runtime writers. */
export interface RuntimeEvidenceFrame {
  channel: RuntimeChannel;
  side: string;
  scenarioId: string;
  actionIndex: number;
  action: string;
  actor?: string;
  timestamp: string;
  request: {
    method: string;
    url: string;
    headers?: Record<string, unknown>;
    body?: unknown;
  };
  response: {
    status: number | null;
    headers?: Record<string, unknown>;
    body?: unknown;
  };
  stateBefore: string | null;
  stateAfter: string | null;
  semanticPath: string[];
}
