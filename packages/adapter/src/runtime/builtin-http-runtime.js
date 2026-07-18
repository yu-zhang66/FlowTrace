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
import { writeEvidenceFrame } from './evidence-writer.js';
const DEFAULT_MAX_BODY = 1024 * 1024;
class MemoryCookieJar {
    byActor = new Map();
    headerFor(actor) {
        if (!actor)
            return '';
        return this.byActor.get(actor) || '';
    }
    storeFromResponse(actor, response) {
        const raw = response.headers.get('set-cookie');
        if (!raw)
            return;
        const pair = raw.split(';')[0];
        const existing = this.byActor.get(actor);
        this.byActor.set(actor, existing ? `${existing}; ${pair}` : pair);
    }
    clear() {
        this.byActor.clear();
    }
}
export class BuiltinHttpRuntime {
    system;
    side;
    evidenceRoot;
    redactor;
    cookieJar = new MemoryCookieJar();
    maxBody;
    slotStore = new Map();
    semanticPath = [];
    purchaseStateSlot = null;
    lastStateBefore = null;
    scenarioId = null;
    constructor(options) {
        this.system = options.system;
        this.side = options.side;
        this.evidenceRoot = options.evidenceRoot;
        this.maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
        this.redactor = createRedactor({
            fields: options.system.redact?.fields ?? [],
            headers: options.system.redact?.headers ?? [],
        });
    }
    setScenario(scenarioId) {
        this.scenarioId = scenarioId;
        this.slotStore.clear();
        this.semanticPath = [];
        this.lastStateBefore = null;
        this.purchaseStateSlot = null;
        this.cookieJar.clear();
    }
    getCookieJar() { return this.cookieJar; }
    getSlot(name) { return this.slotStore.get(name); }
    setSlot(name, value) { this.slotStore.set(name, value); }
    getSemanticPath() { return [...this.semanticPath]; }
    getLastState() { return this.lastStateBefore; }
    nowIso() { return new Date().toISOString(); }
    buildUrl(pathOrUrl) {
        if (/^https?:\/\//i.test(pathOrUrl))
            return pathOrUrl;
        const base = this.system.baseUrl.replace(/\/$/, '');
        return pathOrUrl.startsWith('/') ? `${base}${pathOrUrl}` : `${base}/${pathOrUrl}`;
    }
    async captureResponseBody(response) {
        const lengthHeader = response.headers.get('content-length');
        if (lengthHeader && Number(lengthHeader) > this.maxBody) {
            return { _truncated: true, bytes: Number(lengthHeader) };
        }
        try {
            const text = await response.text();
            if (!text)
                return null;
            if (text.length > this.maxBody) {
                return { _truncated: true, length: text.length, preview: text.slice(0, 1024) };
            }
            try {
                return JSON.parse(text);
            }
            catch {
                return { _raw: text };
            }
        }
        catch (err) {
            return { _readError: err instanceof Error ? err.message : String(err) };
        }
    }
    async ensureLoggedIn(actor) {
        if (!this.system.login)
            return;
        const cfg = this.system.login;
        const url = this.buildUrl(cfg.path);
        const body = new URLSearchParams();
        for (const [envName, selectorKey] of Object.entries(cfg.fields)) {
            const value = process.env[envName];
            if (value === undefined) {
                throw new Error(`login requires env var ${envName} for actor ${actor}`);
            }
            body.set(selectorKey, value);
        }
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json, text/html',
        };
        const cookie = this.cookieJar.headerFor(actor);
        if (cookie)
            headers.Cookie = cookie;
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
    resolveEndpoint(input) {
        let method = input.method ?? 'GET';
        let urlPath = input.path ?? input.url ?? '';
        let contentType = 'application/json';
        let json = true;
        if (input.endpoint && this.system.endpoints?.[input.endpoint]) {
            const ep = this.system.endpoints[input.endpoint];
            method = ep.method;
            urlPath = ep.url ?? ep.path ?? urlPath;
            contentType = ep.contentType ?? contentType;
            json = ep.json ?? (contentType.includes('json'));
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
    async request(input) {
        if (!this.scenarioId)
            throw new Error('setScenario() must be called before request()');
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
        if (input.query && Object.keys(input.query).length > 0) {
            const qs = new URLSearchParams(input.query).toString();
            url += (url.includes('?') ? '&' : '?') + qs;
        }
        const headers = {
            'Content-Type': resolved.contentType,
            Accept: 'application/json, text/html',
        };
        const actor = input.actor;
        if (actor) {
            const cookie = this.cookieJar.headerFor(actor);
            if (cookie)
                headers.Cookie = cookie;
        }
        const init = { method: resolved.method, headers, redirect: 'manual' };
        if (input.body !== undefined && input.body !== null) {
            if (resolved.json)
                init.body = JSON.stringify(input.body);
            else
                init.body = input.body;
        }
        const response = await fetch(url, init);
        if (actor)
            this.cookieJar.storeFromResponse(actor, response);
        const responseBody = await this.captureResponseBody(response);
        const responseHeaders = {};
        response.headers.forEach((v, k) => { responseHeaders[k] = v; });
        const evidencePath = await writeEvidenceFrame({
            evidenceRoot: this.evidenceRoot ?? '',
            side: this.side,
            scenarioId: this.scenarioId,
            actionIndex: input.actionIndex,
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
        if (input.captureAs)
            this.slotStore.set(input.captureAs, responseBody);
        return { status: response.status, body: responseBody, evidencePath: evidencePath ?? undefined };
    }
    /**
     * Observe a state field via an HTTP query. The default selector path looks
     * up `systems.<id>.selectors.state` and parses its text content via a
     * user-supplied extractor (regex or jsonpath placeholder, kept simple here:
     * the response body is stored in slot `state`).
     */
    async observe(input) {
        const out = await this.request(input);
        let state = null;
        if (out.body && typeof out.body === 'object') {
            const bodyObj = out.body;
            const candidate = bodyObj.state ?? bodyObj.status;
            if (typeof candidate === 'string')
                state = candidate;
            else if (typeof candidate === 'number')
                state = String(candidate);
        }
        const slotName = input.captureAs ?? 'state';
        this.slotStore.set(slotName, state ?? out.body);
        return { status: out.status, body: out.body, state };
    }
    /**
     * Record an action result for the caller. Mutates the action observation
     * shape produced by the interpreter.
     */
    recordAction(actionInput) {
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
    pushSemanticState(state) {
        if (!state)
            return;
        const last = this.semanticPath[this.semanticPath.length - 1];
        if (last !== state)
            this.semanticPath.push(state);
        this.lastStateBefore = state;
    }
    buildScenarioObservation(input) {
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
//# sourceMappingURL=builtin-http-runtime.js.map