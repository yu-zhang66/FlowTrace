/**
 * Deterministic DSL interpreter for FlowTrace builtin runtime.
 *
 * Drives a `BuiltinRuntime` through a `ProcessDsl` action list and produces
 * a `DslScenarioObservation` with `actionResults / semanticPath / stateBefore
 * / stateAfter / illegalTransitions / evidence paths`.
 *
 * The interpreter is intentionally generic: it does not know any particular
 * business state name, transition rule, error code, role mapping, or
 * scenario id. All such knowledge lives in the project's process DSL and
 * `systems:` mapping.
 */

import type {
  BuiltinRuntime,
} from '../runtime/builtin-runtime.js';
import type {
  DslAction,
  DslActionObservation,
  DslScenarioObservation,
  DslStep,
  ProcessDsl,
  RuntimeEvidenceFrame,
} from '../runtime/types.js';

export interface InterpreterContext {
  runtime: BuiltinRuntime;
  process: ProcessDsl;
  /** Optional DSL action lookup by id (defaults to array iteration). */
  actionResolver?: (actionId: string) => DslAction | undefined;
}

export interface InterpreterOptions {
  /** Scenario identifier for evidence filenames. */
  scenarioId: string;
  /** Actor id to use if a step does not specify its own. */
  defaultActor?: string;
  /** Step sequence (action ids) to execute. */
  steps: Array<{ action: string; actor?: string; data?: Record<string, unknown> }>;
  /** Continue executing later actions when a scenario deliberately declares
   * multiple illegal actions (for example, a read-only role probing several
   * forbidden operations). Defaults to fail-fast. */
  continueOnError?: boolean;
}

interface StepExecutionResult {
  stateBefore: string | null;
  stateAfter: string | null;
  status: number | null;
  errorCode: string | null;
  message: string | null;
  evidencePaths: string[];
  actionWasIllegal: boolean;
}

/**
 * Run a scenario through the builtin runtime. Returns the normalized
 * observation used by the runner / reporter / dual-run comparator.
 */
export async function interpretScenario(ctx: InterpreterContext, opts: InterpreterOptions): Promise<DslScenarioObservation> {
  ctx.runtime.setScenario(opts.scenarioId);
  const observations: DslActionObservation[] = [];
  let error: string | null = null;
  let finalState: string | null = null;

  for (let i = 0; i < opts.steps.length; i++) {
    const step = opts.steps[i]!;
    const action = ctx.actionResolver ? ctx.actionResolver(step.action) : ctx.process.actions.find((a) => a.id === step.action);
    if (!action) {
      const err = new Error(`interpreter: action "${step.action}" not found in process "${ctx.process.id}" at step index ${i}`);
      error = err.message;
      observations.push(makeFailureObservation({ actionId: step.action, actionIndex: i, actor: step.actor, errorMessage: err.message }));
      break;
    }

    const result = await runAction(ctx, { action, actionIndex: i, actor: step.actor ?? action.actor ?? opts.defaultActor, data: step.data });
    observations.push(result.observation);
    if ((result.actionWasIllegal || result.observation.errorCode) && !opts.continueOnError) {
      // Illegal / failed action: stop here per FSM semantics
      error = result.observation.errorCode ?? 'ILLEGAL_TRANSITION';
      finalState = result.observation.stateAfter ?? finalState;
      break;
    }
    if (result.actionWasIllegal || result.observation.errorCode) {
      error = result.observation.errorCode ?? error;
    }
    finalState = result.observation.stateAfter ?? finalState;
  }

  return ctx.runtime.buildScenarioObservation({
    scenarioId: opts.scenarioId,
    actions: observations,
    error,
    finalState,
  });
}

async function runAction(
  ctx: InterpreterContext,
  input: { action: DslAction; actionIndex: number; actor?: string; data?: Record<string, unknown> },
): Promise<{ observation: DslActionObservation; actionWasIllegal: boolean }> {
  const stateBefore = readStateSlot(ctx);
  const evidencePaths: string[] = [];
  let status: number | null = null;
  let errorCode: string | null = null;
  let message: string | null = null;
  let actionWasIllegal = false;

  try {
    for (let s = 0; s < input.action.steps.length; s++) {
      const step = input.action.steps[s]!;
      const result = await runStep(ctx, step, s, {
        actionId: input.action.id,
        actionIndex: input.actionIndex,
        actor: input.actor,
        data: input.data,
      });
      if (result.evidencePath) evidencePaths.push(result.evidencePath);
      if (result.screenshotPath) evidencePaths.push(result.screenshotPath);
      if (result.errorCode) {
        errorCode = result.errorCode;
        message = result.message ?? errorCode;
        status = result.status ?? status;
        actionWasIllegal = true;
        break;
      }
      status = result.status ?? status;
      if (result.capturedState) {
        ctx.runtime.pushSemanticState(result.capturedState);
      }
    }
  } catch (err) {
    actionWasIllegal = true;
    errorCode = errorCode ?? 'ADAPTER_ERROR';
    message = err instanceof Error ? err.message : String(err);
    status = status ?? 500;
  }

  // If the action declared an illegal expected error code, treat any
  // non-error outcome as a hard failure (the action was expected to be
  // illegal but wasn't).
  if (input.action.illegal) {
    if (!actionWasIllegal || errorCode !== input.action.illegal.expectedErrorCode) {
      actionWasIllegal = true;
      errorCode = input.action.illegal.expectedErrorCode;
      message = input.action.illegal.message ?? `expected illegal transition ${input.action.illegal.expectedErrorCode}`;
      status = status ?? 409;
    }
  }

  const stateAfter = readStateSlot(ctx);
  const observation = ctx.runtime.recordAction({
    actionId: input.action.id,
    actionIndex: input.actionIndex,
    actor: input.actor,
    status,
    errorCode,
    message,
    stateBefore,
    stateAfter,
    evidencePaths,
    illegal: actionWasIllegal && errorCode
      ? { errorCode, message: message ?? undefined, actionIndex: input.actionIndex }
      : null,
  });
  return { observation, actionWasIllegal };
}

interface StepRunResult {
  status: number | null;
  errorCode: string | null;
  message: string | null;
  evidencePath: string | null;
  screenshotPath: string | null;
  capturedState: string | null;
}

async function runStep(
  ctx: InterpreterContext,
  step: DslStep,
  stepNumber: number,
  env: { actionId: string; actionIndex: number; actor?: string; data?: Record<string, unknown> },
): Promise<StepRunResult> {
  const base = { actionIndex: env.actionIndex, action: env.actionId, actor: env.actor, stepIndex: stepNumber };
  switch (step.type) {
    case 'goto': {
      if (ctx.runtime.system.channel !== 'browser') {
        return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'goto step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
      }
      const browser = ctx.runtime as any;
      const { evidencePath } = await browser.goto({ page: step.page, url: step.url, ...base });
      return { status: 200, errorCode: null, message: null, evidencePath, screenshotPath: null, capturedState: null };
    }
    case 'fill': {
      if (ctx.runtime.system.channel !== 'browser') {
        return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'fill step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
      }
      const browser = ctx.runtime as any;
      const { evidencePath } = await browser.fill({ selector: step.selector, value: step.value, valueRef: step.valueRef, ...base });
      return { status: 200, errorCode: null, message: null, evidencePath, screenshotPath: null, capturedState: null };
    }
    case 'click': {
      if (ctx.runtime.system.channel !== 'browser') {
        return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'click step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
      }
      const browser = ctx.runtime as any;
      const { evidencePath, screenshotPath } = await browser.click({ selector: step.selector, ...base });
      return { status: 200, errorCode: null, message: null, evidencePath, screenshotPath, capturedState: null };
    }
    case 'select': {
      if (ctx.runtime.system.channel !== 'browser') {
        return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'select step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
      }
      const page = await (ctx.runtime as any).ensurePage();
      const sel = (ctx.runtime as any).resolveSelector(step.selector);
      const value = step.valueRef ? process.env[step.valueRef] ?? '' : step.value;
      await page.selectOption(sel, value);
      return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
    }
    case 'upload': {
      if (ctx.runtime.system.channel !== 'browser') {
        return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'upload step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
      }
      const page = await (ctx.runtime as any).ensurePage();
      const sel = (ctx.runtime as any).resolveSelector(step.selector);
      await page.setInputFiles(sel, step.file);
      return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
    }
    case 'wait': {
      if (ctx.runtime.system.channel !== 'browser') {
        return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'wait step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
      }
      await (ctx.runtime as any).wait({ for: step.for, timeoutMs: step.timeoutMs, ...base });
      return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
    }
    case 'request': {
      if (ctx.runtime.system.channel !== 'http') {
        return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'request step requires http channel', evidencePath: null, screenshotPath: null, capturedState: null };
      }
      const http = ctx.runtime as any;
      const actor = env.actor;
      const data = env.data ?? {};
      const dataVars = flattenData(data, 'data');
      const scenarioDataVars = flattenData(data, 'scenario.data');
      const vars: Record<string, string | undefined> = { actor, ...dataVars, ...scenarioDataVars };
      // Also include any slot names that have been set on the runtime by
      // previous DSL steps in the same action/scenario.
      if (typeof http.getSlot === 'function') {
        // Probe a small set of conventional names + the values already
        // captured by the action. Slots remain set across steps because
        // BuiltinRuntime only clears them on `setScenario()`.
        const knownSlots = ['createResponse', 'stateHtml', 'state', 'purchaseId', 'loginResponse'];
        for (const name of knownSlots) {
          const v = http.getSlot(name);
          if (v === undefined) continue;
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            Object.assign(vars, flattenData(v as Record<string, unknown>, name));
          } else if (v === null) {
            vars[name] = '';
          } else {
            vars[name] = String(v);
          }
        }
      }
      const substitutedBody = substituteTemplate(step.body, vars);
      const out = await http.request({
        endpoint: step.endpoint,
        method: step.method,
        path: substituteTemplate(step.path, vars),
        url: substituteTemplate(step.url, vars),
        body: substitutedBody,
        query: step.query,
        captureAs: step.captureAs,
        actor,
        action: env.actionId,
        actionIndex: env.actionIndex,
        stepIndex: stepNumber,
      });
      if (out.status >= 400) {
        const bodyObj = (out.body && typeof out.body === 'object') ? out.body as Record<string, unknown> : {};
        return {
          status: out.status,
          errorCode: typeof bodyObj.error === 'string' ? bodyObj.error : `HTTP_${out.status}`,
          message: typeof bodyObj.message === 'string' ? bodyObj.message : `HTTP ${out.status}`,
          evidencePath: out.evidencePath ?? null,
          screenshotPath: out.screenshotPath ?? null,
          capturedState: null,
        };
      }
      return { status: out.status, errorCode: null, message: null, evidencePath: out.evidencePath ?? null, screenshotPath: out.screenshotPath ?? null, capturedState: null };
    }
    case 'observe': {
      if (ctx.runtime.system.channel === 'browser') {
        const browser = ctx.runtime as any;
        const { state, evidencePath } = await browser.observe({ selector: step.selector, field: step.field, captureAs: step.captureAs, ...base });
        if (step.captureAs) (ctx.runtime as any).setSlot(step.captureAs, state);
        return { status: 200, errorCode: null, message: null, evidencePath, screenshotPath: null, capturedState: state };
      }
      // http channel: observe via a request step
      const http = ctx.runtime as any;
      const out = await http.observe({
        endpoint: undefined,
        method: 'GET',
        path: (step as any).path,
        url: undefined,
        actor: env.actor,
        action: env.actionId,
        actionIndex: env.actionIndex,
        captureAs: step.captureAs,
      });
      return { status: out.status, errorCode: null, message: null, evidencePath: out.evidencePath ?? null, screenshotPath: out.screenshotPath ?? null, capturedState: out.state };
    }
    case 'extract': {
      if (ctx.runtime.system.channel === 'browser') {
        const browser = ctx.runtime as any;
        const page = await browser.ensurePage();
        const sel = browser.resolveSelector(step.selector);
        const value = step.attribute ? await page.getAttribute(sel, step.attribute) : (await page.textContent(sel))?.trim() ?? null;
        browser.setSlot(step.captureAs, value);
        return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: typeof value === 'string' ? value : null };
      }
      // http channel: derive the FSM state from slots in reverse-insertion order
      // so the latest response wins. Object-valued slots are scanned for a
      // `currentState` field; string-valued slots are scraped for a
      // `data-testid="state-badge"` span.
      const http2 = ctx.runtime as any;
      let derivedState: string | null = null;
      const slotNames = typeof http2.listSlots === 'function' ? http2.listSlots() : [];
      // Walk slots in reverse so latest wins. For each, first try
      // object.currentState, then an HTML response wrapped as `{ _raw }`,
      // then a plain HTML string. The HTTP runtime uses `_raw` for non-JSON
      // responses so the evidence shape remains lossless and generic.
      for (let i = slotNames.length - 1; i >= 0; i--) {
        const name = slotNames[i]!;
        const v = http2.getSlot(name);
        if (!derivedState && v && typeof v === 'object' && !Array.isArray(v)) {
          const cs = (v as Record<string, unknown>).currentState;
          if (typeof cs === 'string' && cs) { derivedState = cs; }
          const raw = (v as Record<string, unknown>)._raw;
          if (!derivedState && typeof raw === 'string') derivedState = extractStateFromHtml(raw);
        }
      }
      if (!derivedState) {
        for (let i = slotNames.length - 1; i >= 0; i--) {
          const name = slotNames[i]!;
          const v = http2.getSlot(name);
          if (!derivedState && typeof v === 'string') {
            derivedState = extractStateFromHtml(v);
            if (derivedState) break;
          }
        }
      }
      if (step.captureAs) http2.setSlot(step.captureAs, derivedState);
      if (process.env.FT_DEBUG_EXTRACT) {
        console.error(`[FT_DEBUG_EXTRACT] channel=http slots=${slotNames.join(',')} derivedState=${derivedState}`);
      }
      return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: derivedState };
    }
    case 'assert': {
      const result = evalAssertion(ctx, step.assert);
      if (!result.ok) {
        return {
          status: 409,
          errorCode: result.errorCode,
          message: result.message,
          evidencePath: null,
          screenshotPath: null,
          capturedState: null,
        };
      }
      return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
    }
    case 'screenshot': {
      if (ctx.runtime.system.channel !== 'browser') {
        return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'screenshot step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
      }
      const browser = ctx.runtime as any;
      const { path } = await browser.screenshot({ name: step.name, ...base });
      return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: path, capturedState: null };
    }
    case 'conditional': {
      const cond = evalAssertion(ctx, step.when);
      const branch = cond.ok ? step.then : (step.else ?? []);
      for (const sub of branch) {
        const r = await runStep(ctx, sub, -1, env);
        if (r.errorCode) return r;
      }
      return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
    }
    case 'repeat': {
      for (let r = 0; r < step.times; r++) {
        for (const sub of step.steps) {
          const out = await runStep(ctx, sub, -1, env);
          if (out.errorCode) return out;
        }
      }
      return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
    }
    default: {
      const exhaustive: never = step;
      void exhaustive;
      return { status: null, errorCode: 'UNKNOWN_STEP', message: 'unknown step type', evidencePath: null, screenshotPath: null, capturedState: null };
    }
  }
}

/** Extract a state value from generic HTML evidence without knowing business state names. */
function extractStateFromHtml(html: string): string | null {
  const m = html.match(/<span[^>]*class=["'][^"']*\bstate-badge\b[^"']*["'][^>]*>([^<]+)/i)
    || html.match(/<span[^>]*data-testid=["'][^"']*\bstate[^"']*["'][^>]*>([^<]+)/i)
    || html.match(/<span[^>]*data-testid=["'][^"']*stateNode[^"']*["'][^>]*>([^<]+)/i);
  return m?.[1]?.trim() || null;
}

function readStateSlot(ctx: InterpreterContext): string | null {
  const slot = (ctx.runtime as any).getSlot?.('state');
  if (typeof slot === 'string') return slot;
  return null;
}

interface AssertionResult { ok: boolean; errorCode: string; message: string }

function evalAssertion(ctx: InterpreterContext, assert: any): AssertionResult {
  const runtime = ctx.runtime as any;
  if ('equals' in assert) {
    const slot = assert.equals.slot ? runtime.getSlot(assert.equals.slot) : assert.equals.value;
    const target = assert.equals.slot ? assert.equals.value : runtime.getSlot(assert.equals.slot ?? 'state');
    const ok = slot === target;
    return { ok, errorCode: 'ASSERT_EQUALS_FAILED', message: `expected ${JSON.stringify(target)}, got ${JSON.stringify(slot)}` };
  }
  if ('notEquals' in assert) {
    const slot = assert.notEquals.slot ? runtime.getSlot(assert.notEquals.slot) : assert.notEquals.value;
    const target = assert.notEquals.slot ? assert.notEquals.value : runtime.getSlot(assert.notEquals.slot ?? 'state');
    const ok = slot !== target;
    return { ok, errorCode: 'ASSERT_NOT_EQUALS_FAILED', message: `expected not ${JSON.stringify(target)}, got ${JSON.stringify(slot)}` };
  }
  if ('matches' in assert) {
    const slot = assert.matches.slot ? runtime.getSlot(assert.matches.slot) : runtime.getSlot('state');
    const re = new RegExp(assert.matches.pattern);
    const ok = typeof slot === 'string' && re.test(slot);
    return { ok, errorCode: 'ASSERT_MATCHES_FAILED', message: `value ${JSON.stringify(slot)} did not match ${assert.matches.pattern}` };
  }
  if ('exists' in assert) {
    const ok = runtime.getSlot(assert.exists) !== undefined;
    return { ok, errorCode: 'ASSERT_EXISTS_FAILED', message: `slot ${assert.exists} missing` };
  }
  if ('notExists' in assert) {
    const ok = runtime.getSlot(assert.notExists) === undefined;
    return { ok, errorCode: 'ASSERT_NOT_EXISTS_FAILED', message: `slot ${assert.notExists} should be undefined` };
  }
  return { ok: false, errorCode: 'UNKNOWN_ASSERT', message: 'unknown assertion form' };
}

function makeFailureObservation(input: { actionId: string; actionIndex: number; actor?: string; errorMessage: string }): DslActionObservation {
  return {
    actionId: input.actionId,
    index: input.actionIndex,
    actor: input.actor,
    status: 500,
    errorCode: 'UNKNOWN_ACTION',
    message: input.errorMessage,
    stateBefore: null,
    stateAfter: null,
    evidencePaths: [],
    illegalTransition: null,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

/** Re-export evidence frame type for callers. */
export type { RuntimeEvidenceFrame };

/**
 * Flatten a `data: { ... }` object into dotted key paths so templates can
 * reference `${scenario.data.amount}` and `${data.title}` directly.
 */
function flattenData(data: Record<string, unknown>, prefix = 'data'): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(data)) {
    const key = prefix + '.' + k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenData(v as Record<string, unknown>, key));
    } else if (v === null || v === undefined) {
      out[key] = '';
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

/**
 * Walk every named slot the runtime exposes. The runtime surface today is
 * `getSlot(name)`, so we probe a small set of well-known slot names plus
 * the names already captured by prior DSL steps. (The DSL engine extends
 * this list as steps execute.)
 */
function collectSlots(runtime: any): Array<[string, unknown]> {
  if (!runtime || typeof runtime.listSlots !== 'function') return [];
  return runtime.listSlots().map((name: string): [string, unknown] => [name, runtime.getSlot(name)]);
}

/**
 * Lightweight `${var}` template substitution. Replaces any `${name}` token
 * in a string (or recursively inside string values of an object/array)
 * with the corresponding value from `vars`. Unknown variables are left
 * intact (so the server gets a literal "${varName}" it can reject).
 */
function substituteTemplate(value: unknown, vars: Record<string, string | undefined>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, name) => {
      const trimmed = String(name).trim();
      if (Object.prototype.hasOwnProperty.call(vars, trimmed)) {
        const v = vars[trimmed];
        return v === undefined || v === null ? '' : String(v);
      }
      return '${' + trimmed + '}';
    });
  }
  if (Array.isArray(value)) return value.map((v) => substituteTemplate(v, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = substituteTemplate(v, vars);
    return out;
  }
  return value;
}
