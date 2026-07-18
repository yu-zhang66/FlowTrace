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
let cachedChromium = null;
let playwrightLoadTried = false;
async function loadChromium() {
    if (cachedChromium)
        return cachedChromium;
    if (playwrightLoadTried)
        return cachedChromium;
    playwrightLoadTried = true;
    try {
        const mod = await import('playwright');
        cachedChromium = mod.chromium?.launch?.bind(mod.chromium) ?? null;
        return cachedChromium;
    }
    catch {
        cachedChromium = null;
        return null;
    }
}
export class BuiltinBrowserRuntime {
    system;
    side;
    evidenceRoot;
    redactor;
    browser = null;
    context = null;
    page = null;
    slotStore = new Map();
    semanticPath = [];
    lastStateBefore = null;
    scenarioId = null;
    constructor(options) {
        this.system = options.system;
        this.side = options.side;
        this.evidenceRoot = options.evidenceRoot;
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
    }
    isChromiumAvailable() { return Boolean(cachedChromium); }
    async initialize() {
        const launch = await loadChromium();
        if (!launch) {
            throw new Error(`[flowtrace] browser runtime requested for system "${this.system.id}" but the optional \`playwright\` dependency is not installed. Install it with \`npm i playwright\` or switch the system to channel: http.`);
        }
        const launchOpts = { headless: this.system.browser?.headless ?? true };
        if (this.system.browser?.args)
            launchOpts.args = this.system.browser.args;
        if (this.system.browser?.executablePath)
            launchOpts.executablePath = this.system.browser.executablePath;
        this.browser = await launch(launchOpts);
        this.context = await this.browser.newContext();
    }
    async ensurePage() {
        if (!this.context)
            throw new Error('initialize() must be called before ensurePage()');
        if (!this.page || this.page.isClosed?.()) {
            this.page = await this.context.newPage();
        }
        return this.page;
    }
    async cleanup() {
        try {
            await this.context?.close?.();
        }
        catch { /* ignore */ }
        try {
            await this.browser?.close?.();
        }
        catch { /* ignore */ }
        this.context = null;
        this.browser = null;
        this.page = null;
    }
    getSlot(name) { return this.slotStore.get(name); }
    setSlot(name, value) { this.slotStore.set(name, value); }
    getSemanticPath() { return [...this.semanticPath]; }
    nowIso() { return new Date().toISOString(); }
    resolveSelector(selectorOrKey) {
        const map = this.system.selectors ?? {};
        return map[selectorOrKey] ?? selectorOrKey;
    }
    resolvePagePath(pageKey) {
        const pages = this.system.pages ?? {};
        if (pages[pageKey]) {
            const p = pages[pageKey];
            const base = this.system.baseUrl.replace(/\/$/, '');
            return `${base}${p.path.startsWith('/') ? '' : '/'}${p.path}`;
        }
        const base = this.system.baseUrl.replace(/\/$/, '');
        return pageKey.startsWith('/') ? `${base}${pageKey}` : `${base}/${pageKey}`;
    }
    async goto(input) {
        const page = await this.ensurePage();
        const target = input.url ?? (input.page ? this.resolvePagePath(input.page) : null);
        if (!target)
            throw new Error('goto step requires `page` or `url`');
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
    async fill(input) {
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
    async click(input) {
        const page = await this.ensurePage();
        const sel = this.resolveSelector(input.selector);
        const timeoutMs = this.system.browser?.timeoutMs;
        let responseStatus = null;
        const listener = (resp) => {
            try {
                if (resp.request().method() === 'POST' && resp.status() >= 400)
                    responseStatus = resp.status();
            }
            catch { /* ignore */ }
        };
        page.on?.('response', listener);
        try {
            await Promise.all([
                page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => undefined),
                page.click(sel, { timeout: timeoutMs }),
            ]);
        }
        finally {
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
    async observe(input) {
        const page = await this.ensurePage();
        const sel = this.resolveSelector(input.selector);
        const timeoutMs = this.system.browser?.timeoutMs;
        let captured = null;
        try {
            if (input.field === 'text') {
                const t = await page.textContent(sel, { timeout: timeoutMs });
                captured = (t ?? '').trim() || null;
            }
            else {
                captured = await page.getAttribute(sel, input.field.attribute, { timeout: timeoutMs });
            }
        }
        catch {
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
    async screenshot(input) {
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
    async wait(input) {
        const page = await this.ensurePage();
        const timeoutMs = input.timeoutMs ?? this.system.browser?.timeoutMs;
        const target = input.for;
        if (target === 'network-idle' || target === 'domcontentloaded' || target === 'load') {
            const mapped = target === 'network-idle' ? 'networkidle' : target;
            await page.waitForLoadState(mapped, { timeout: timeoutMs });
        }
        else if ('ms' in target) {
            await page.waitForTimeout(target.ms);
        }
        else if ('urlMatches' in target) {
            await page.waitForURL(new RegExp(target.urlMatches), { timeout: timeoutMs });
        }
        else if ('selector' in target) {
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
    pushSemanticState(state) {
        if (!state)
            return;
        const last = this.semanticPath[this.semanticPath.length - 1];
        if (last !== state)
            this.semanticPath.push(state);
        this.lastStateBefore = state;
    }
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
//# sourceMappingURL=builtin-browser-runtime.js.map