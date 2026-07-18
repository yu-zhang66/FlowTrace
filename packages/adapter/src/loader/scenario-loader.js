/**
 * Scenario loader for FlowTrace builtin runtime.
 *
 * Reads scenario YAML files from the project's `.flowtrace/scenarios`
 * directory tree, normalises them into a typed shape used by the runner /
 * reporter, and enforces the review-status contract:
 *
 *   - imported scenarios marked AUTO_EXTRACTED or REVIEW_REQUIRED are
 *     NOT allowed to participate in `flowtrace verify`
 *   - hand-written scenarios (no `imported: true`) are treated as already
 *     CONFIRMED
 *   - explicit `status: CONFIRMED` is always honoured
 *
 * This module is intentionally generic: it has no business identifier.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
export async function loadAllScenarios(scenariosDir) {
    const files = [];
    await walk(scenariosDir, files);
    const out = [];
    for (const file of files) {
        const loaded = await loadScenarioFile(file);
        if (loaded)
            out.push(loaded);
    }
    return out;
}
export async function loadScenarioFile(filePath) {
    if (!filePath.endsWith('.yaml') && !filePath.endsWith('.yml'))
        return null;
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object')
        return null;
    if (!parsed.id || !parsed.process)
        return null;
    const imported = parsed.imported === true;
    const explicitStatus = typeof parsed.status === 'string' ? parsed.status : undefined;
    const status = explicitStatus ?? (imported ? 'REVIEW_REQUIRED' : 'CONFIRMED');
    const expected = (parsed.expected ?? {});
    const illegalActions = normaliseIllegal(expected);
    const actionsRaw = Array.isArray(parsed.actions) ? parsed.actions : [];
    const actions = actionsRaw.map((a) => ({
        action: typeof a?.type === 'string' ? a.type : (typeof a?.action === 'string' ? a.action : 'UNKNOWN'),
        actor: typeof a?.actor === 'string' ? a.actor : undefined,
        data: (a?.data && typeof a.data === 'object') ? a.data : undefined,
    }));
    const out = {
        id: String(parsed.id),
        name: typeof parsed.name === 'string' ? parsed.name : String(parsed.id),
        process: String(parsed.process),
        enabled: parsed.enabled !== false,
        severity: parsed.severity ?? 'P2',
        tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t)) : [],
        source: Array.isArray(parsed.source) ? parsed.source.map((s) => String(s)) : [],
        actions,
        expected: {
            finalState: typeof expected.finalState === 'string' ? expected.finalState : null,
            semanticPath: Array.isArray(expected.semanticPath) ? expected.semanticPath.map((s) => String(s)) : [],
            illegalActions,
        },
        imported,
        status,
        sourceFile: filePath,
    };
    return out;
}
function normaliseIllegal(expected) {
    if (Array.isArray(expected.illegalActions) && expected.illegalActions.length > 0) {
        return expected.illegalActions
            .map((x) => ({
            actionIndex: Number(x?.actionIndex),
            errorCode: x?.errorCode ? String(x.errorCode) : '',
        }))
            .filter((x) => Number.isInteger(x.actionIndex) && x.errorCode);
    }
    if (expected.illegalActionErrorCode && expected.illegalActionIndex !== undefined && expected.illegalActionIndex !== null) {
        return [{ actionIndex: Number(expected.illegalActionIndex), errorCode: String(expected.illegalActionErrorCode) }];
    }
    return [];
}
async function walk(dir, acc) {
    let entries = [];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory())
            await walk(full, acc);
        else if (e.isFile())
            acc.push(full);
    }
}
export class ScenarioNotConfirmedError extends Error {
    scenarioIds;
    processId;
    constructor(processId, scenarioIds) {
        const list = scenarioIds.map((id) => '  - ' + id).join('\n');
        super('flowtrace verify refused to run ' +
            scenarioIds.length +
            ' unconfirmed scenario(s) for process "' +
            processId +
            '":\n' +
            list +
            '\nPromote them to CONFIRMED via \'flowtrace record-confirm ' +
            processId +
            '\' or by editing the scenario file\'s status: field.');
        this.name = 'ScenarioNotConfirmedError';
        this.scenarioIds = scenarioIds;
        this.processId = processId;
    }
}
//# sourceMappingURL=scenario-loader.js.map