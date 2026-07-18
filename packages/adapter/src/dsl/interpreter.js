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
/**
 * Run a scenario through the builtin runtime. Returns the normalized
 * observation used by the runner / reporter / dual-run comparator.
 */
export async function interpretScenario(ctx, opts) {
    ctx.runtime.setScenario(opts.scenarioId);
    const observations = [];
    let error = null;
    let finalState = null;
    for (let i = 0; i < opts.steps.length; i++) {
        const step = opts.steps[i];
        const action = ctx.actionResolver ? ctx.actionResolver(step.action) : ctx.process.actions.find((a) => a.id === step.action);
        if (!action) {
            const err = new Error(`interpreter: action "${step.action}" not found in process "${ctx.process.id}" at step index ${i}`);
            error = err.message;
            observations.push(makeFailureObservation({ actionId: step.action, actionIndex: i, actor: step.actor, errorMessage: err.message }));
            break;
        }
        const result = await runAction(ctx, { action, actionIndex: i, actor: step.actor ?? action.actor ?? opts.defaultActor, data: step.data });
        observations.push(result.observation);
        if (result.actionWasIllegal || result.observation.errorCode) {
            // Illegal / failed action: stop here per FSM semantics
            error = result.observation.errorCode ?? 'ILLEGAL_TRANSITION';
            finalState = result.observation.stateAfter ?? finalState;
            break;
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
async function runAction(ctx, input) {
    const stateBefore = readStateSlot(ctx);
    const evidencePaths = [];
    let status = null;
    let errorCode = null;
    let message = null;
    let actionWasIllegal = false;
    try {
        for (let s = 0; s < input.action.steps.length; s++) {
            const step = input.action.steps[s];
            const result = await runStep(ctx, step, {
                actionId: input.action.id,
                actionIndex: input.actionIndex,
                actor: input.actor,
                data: input.data,
            });
            if (result.evidencePath)
                evidencePaths.push(result.evidencePath);
            if (result.screenshotPath)
                evidencePaths.push(result.screenshotPath);
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
    }
    catch (err) {
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
async function runStep(ctx, step, env) {
    const base = { actionIndex: env.actionIndex, action: env.actionId, actor: env.actor };
    switch (step.type) {
        case 'goto': {
            if (ctx.runtime.system.channel !== 'browser') {
                return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'goto step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
            }
            const browser = ctx.runtime;
            const { evidencePath } = await browser.goto({ page: step.page, url: step.url, ...base });
            return { status: 200, errorCode: null, message: null, evidencePath, screenshotPath: null, capturedState: null };
        }
        case 'fill': {
            if (ctx.runtime.system.channel !== 'browser') {
                return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'fill step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
            }
            const browser = ctx.runtime;
            const { evidencePath } = await browser.fill({ selector: step.selector, value: step.value, valueRef: step.valueRef, ...base });
            return { status: 200, errorCode: null, message: null, evidencePath, screenshotPath: null, capturedState: null };
        }
        case 'click': {
            if (ctx.runtime.system.channel !== 'browser') {
                return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'click step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
            }
            const browser = ctx.runtime;
            const { evidencePath, screenshotPath } = await browser.click({ selector: step.selector, ...base });
            return { status: 200, errorCode: null, message: null, evidencePath, screenshotPath, capturedState: null };
        }
        case 'select': {
            if (ctx.runtime.system.channel !== 'browser') {
                return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'select step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
            }
            const page = await ctx.runtime.ensurePage();
            const sel = ctx.runtime.resolveSelector(step.selector);
            const value = step.valueRef ? process.env[step.valueRef] ?? '' : step.value;
            await page.selectOption(sel, value);
            return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
        }
        case 'upload': {
            if (ctx.runtime.system.channel !== 'browser') {
                return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'upload step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
            }
            const page = await ctx.runtime.ensurePage();
            const sel = ctx.runtime.resolveSelector(step.selector);
            await page.setInputFiles(sel, step.file);
            return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
        }
        case 'wait': {
            if (ctx.runtime.system.channel !== 'browser') {
                return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'wait step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
            }
            await ctx.runtime.wait({ for: step.for, timeoutMs: step.timeoutMs, ...base });
            return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
        }
        case 'request': {
            if (ctx.runtime.system.channel !== 'http') {
                return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'request step requires http channel', evidencePath: null, screenshotPath: null, capturedState: null };
            }
            const http = ctx.runtime;
            const out = await http.request({
                endpoint: step.endpoint,
                method: step.method,
                path: step.path,
                url: step.url,
                body: step.body,
                query: step.query,
                captureAs: step.captureAs,
                actor: env.actor,
                action: env.actionId,
                actionIndex: env.actionIndex,
            });
            if (out.status >= 400) {
                const bodyObj = (out.body && typeof out.body === 'object') ? out.body : {};
                return {
                    status: out.status,
                    errorCode: typeof bodyObj.error === 'string' ? bodyObj.error : `HTTP_${out.status}`,
                    message: typeof bodyObj.message === 'string' ? bodyObj.message : `HTTP ${out.status}`,
                    evidencePath: out.evidencePath ?? null,
                    screenshotPath: null,
                    capturedState: null,
                };
            }
            return { status: out.status, errorCode: null, message: null, evidencePath: out.evidencePath ?? null, screenshotPath: null, capturedState: null };
        }
        case 'observe': {
            if (ctx.runtime.system.channel === 'browser') {
                const browser = ctx.runtime;
                const { state, evidencePath } = await browser.observe({ selector: step.selector, field: step.field, captureAs: step.captureAs, ...base });
                if (step.captureAs)
                    ctx.runtime.setSlot(step.captureAs, state);
                return { status: 200, errorCode: null, message: null, evidencePath, screenshotPath: null, capturedState: state };
            }
            // http channel: observe via a request step
            const http = ctx.runtime;
            const out = await http.observe({
                endpoint: undefined,
                method: 'GET',
                path: step.path,
                url: undefined,
                actor: env.actor,
                action: env.actionId,
                actionIndex: env.actionIndex,
                captureAs: step.captureAs,
            });
            return { status: out.status, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: out.state };
        }
        case 'extract': {
            if (ctx.runtime.system.channel !== 'browser') {
                return { status: null, errorCode: 'CHANNEL_MISMATCH', message: 'extract step requires browser channel', evidencePath: null, screenshotPath: null, capturedState: null };
            }
            const browser = ctx.runtime;
            const page = await browser.ensurePage();
            const sel = browser.resolveSelector(step.selector);
            const value = step.attribute ? await page.getAttribute(sel, step.attribute) : (await page.textContent(sel))?.trim() ?? null;
            browser.setSlot(step.captureAs, value);
            return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: typeof value === 'string' ? value : null };
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
            const browser = ctx.runtime;
            const { path } = await browser.screenshot({ name: step.name, ...base });
            return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: path, capturedState: null };
        }
        case 'conditional': {
            const cond = evalAssertion(ctx, step.when);
            const branch = cond.ok ? step.then : (step.else ?? []);
            for (const sub of branch) {
                const r = await runStep(ctx, sub, env);
                if (r.errorCode)
                    return r;
            }
            return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
        }
        case 'repeat': {
            for (let r = 0; r < step.times; r++) {
                for (const sub of step.steps) {
                    const out = await runStep(ctx, sub, env);
                    if (out.errorCode)
                        return out;
                }
            }
            return { status: 200, errorCode: null, message: null, evidencePath: null, screenshotPath: null, capturedState: null };
        }
        default: {
            const exhaustive = step;
            void exhaustive;
            return { status: null, errorCode: 'UNKNOWN_STEP', message: 'unknown step type', evidencePath: null, screenshotPath: null, capturedState: null };
        }
    }
}
function readStateSlot(ctx) {
    const slot = ctx.runtime.getSlot?.('state');
    if (typeof slot === 'string')
        return slot;
    return null;
}
function evalAssertion(ctx, assert) {
    const runtime = ctx.runtime;
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
function makeFailureObservation(input) {
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
//# sourceMappingURL=interpreter.js.map