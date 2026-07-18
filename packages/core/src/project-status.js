import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { validateScenario } from './models/scenario.js';
import { validateTargetConfig } from './target-config.js';
import { readRecordingState } from './recording-state.js';
const pipelineStages = [
    'collect', 'enhance', 'confirm', 'generate-cases', 'validate-cases', 'execute', 'analyze', 'remediate'
];
const pipelineStatuses = [
    'pending', 'running', 'passed', 'blocked', 'waiting-confirmation', 'failed'
];
export function computeStatus(opts) {
    const projectRoot = resolve(opts.projectRoot);
    const flowtraceRoot = resolve(opts.flowtraceRoot);
    const configMissing = validateTargetConfig(opts.config);
    const recording = opts.processId
        ? recordingSnapshot(flowtraceRoot, opts.processId)
        : null;
    const scenarioDirectory = scenarioRoot(flowtraceRoot, opts.config, opts.processId);
    const scenarioFiles = collectScenarioFiles(scenarioDirectory);
    const scenarios = inspectScenarios(scenarioFiles);
    const captcha = inspectCaptcha(opts.configPath);
    const run = inspectRun(flowtraceRoot);
    const status = overallStatus(configMissing, recording, scenarios, scenarioDirectory);
    return {
        status,
        project: {
            id: opts.config.project.id,
            name: opts.config.project.name,
            root: projectRoot
        },
        config: {
            exists: true,
            path: opts.configPath,
            missing: configMissing,
            warnings: []
        },
        recording,
        scenarios,
        captcha,
        run
    };
}
export function summarizeStatus(snapshot) {
    switch (snapshot.status) {
        case 'READY':
            return { ok: true, code: 'OK', missing: [], remediation: [] };
        case 'NOT_INITIALIZED':
            return {
                ok: false,
                code: 'NOT_INITIALIZED',
                missing: snapshot.config.missing.length > 0 ? snapshot.config.missing : ['.flowtrace/flowtrace.yaml'],
                remediation: [`flowtrace init --project ${snapshot.project.root}`]
            };
        case 'INCOMPLETE_CONFIG':
            return {
                ok: false,
                code: 'CONFIG_INCOMPLETE',
                missing: snapshot.config.missing,
                remediation: [`Complete the missing configuration for ${snapshot.project.root}`]
            };
        case 'PROCESS_NOT_FOUND':
            return {
                ok: false,
                code: 'PROCESS_NOT_FOUND',
                missing: ['process'],
                remediation: [`Specify a process ID or name for ${snapshot.project.root}`]
            };
        case 'RECORDING_PENDING':
            return {
                ok: false,
                code: 'RECORDING_NOT_FOUND',
                missing: ['recording'],
                remediation: recordingRemediation(snapshot)
            };
        case 'RECORDING_NOT_CONFIRMED':
            return {
                ok: false,
                code: 'RECORDING_NOT_CONFIRMED',
                missing: ['recording.confirmedAt'],
                remediation: recordingRemediation(snapshot)
            };
        case 'SCENARIOS_MISSING':
            return {
                ok: false,
                code: 'CASES_INVALID',
                missing: ['scenarios'],
                remediation: casesRemediation(snapshot)
            };
        case 'SCENARIOS_INVALID':
            return {
                ok: false,
                code: 'CASES_INVALID',
                missing: ['scenarios.valid'],
                remediation: [`flowtrace validate-cases --project ${snapshot.project.root}`]
            };
    }
}
export function statusFromError(projectRoot, code, message) {
    const root = resolve(projectRoot);
    const status = code === 'CONFIG_INCOMPLETE' ? 'INCOMPLETE_CONFIG' : 'NOT_INITIALIZED';
    return {
        status,
        project: {
            id: basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: basename(root),
            root
        },
        config: {
            exists: false,
            path: null,
            missing: ['.flowtrace/flowtrace.yaml'],
            warnings: message ? [message] : []
        },
        recording: null,
        scenarios: { count: 0, valid: 0, invalid: 0, lastGenerated: null },
        captcha: {
            configured: false,
            testModeEnabled: false,
            signingKeyConfigured: false,
            allowedOrigins: [],
            missing: ['captcha']
        },
        run: null
    };
}
function recordingSnapshot(flowtraceRoot, processId) {
    const state = readRecordingState(flowtraceRoot);
    if (!state || state.processId !== processId) {
        return {
            processId,
            status: 'NOT_RECORDED',
            artifact: null,
            confirmedBy: null,
            confirmedAt: null
        };
    }
    const status = state.status === 'RECORDED' && state.confirmedAt ? 'CONFIRMED' : state.status;
    return {
        processId: state.processId,
        status,
        artifact: state.artifact,
        confirmedBy: state.confirmedBy,
        confirmedAt: state.confirmedAt
    };
}
function scenarioRoot(flowtraceRoot, config, processId) {
    const configuredRoot = config.paths.scenarios || 'scenarios';
    // Scenario files are currently stored in one project-local directory and
    // carry their process ID in the artifact. Keep status and command gates
    // consistent with validate-cases; process selection filters execution but
    // does not invent a nested directory convention.
    return resolve(flowtraceRoot, configuredRoot);
}
function collectScenarioFiles(directory) {
    if (!existsSync(directory)) {
        return [];
    }
    const files = [];
    const visit = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) {
                visit(path);
            }
            else if (entry.isFile() &&
                !['login-test-config.json', 'validation.json'].includes(entry.name) &&
                ['.yaml', '.yml', '.json'].includes(entry.name.slice(entry.name.lastIndexOf('.')))) {
                try {
                    files.push({ path, mtimeMs: statSync(path).mtimeMs });
                }
                catch {
                    // A file removed during inspection is treated as unavailable.
                }
            }
        }
    };
    visit(directory);
    return files;
}
function inspectScenarios(files) {
    let valid = 0;
    let invalid = 0;
    let lastMtime = 0;
    for (const file of files) {
        lastMtime = Math.max(lastMtime, file.mtimeMs);
        try {
            const raw = readScenario(file.path);
            const scenarios = extractScenarios(raw);
            if (scenarios.length > 0 && scenarios.every(item => validateScenario(item).valid)) {
                valid += 1;
            }
            else {
                invalid += 1;
            }
        }
        catch {
            invalid += 1;
        }
    }
    return {
        count: files.length,
        valid,
        invalid,
        lastGenerated: lastMtime > 0 ? new Date(lastMtime).toISOString() : null
    };
}
function readScenario(path) {
    const content = readFileSync(path, 'utf8');
    return path.endsWith('.json') ? JSON.parse(content) : yaml.load(content);
}
function extractScenarios(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value && typeof value === 'object' && Array.isArray(value.scenarios)) {
        return value.scenarios;
    }
    return value === undefined || value === null ? [] : [value];
}
function inspectCaptcha(configPath) {
    let raw;
    try {
        raw = yaml.load(readFileSync(configPath, 'utf8'));
    }
    catch {
        return {
            configured: false,
            testModeEnabled: false,
            signingKeyConfigured: false,
            allowedOrigins: [],
            missing: ['captcha']
        };
    }
    const captcha = raw && typeof raw === 'object' ? raw.captcha : undefined;
    const configured = !!captcha && typeof captcha === 'object';
    const testModeEnabled = captcha?.testMode === true;
    const signingKeyEnv = typeof captcha?.signingKeyEnv === 'string' ? captcha.signingKeyEnv.trim() : '';
    const signingKeyConfigured = !!captcha?.signingKey || (!!signingKeyEnv && !!process.env[signingKeyEnv]);
    const allowedOrigins = Array.isArray(captcha?.allowedOrigins)
        ? captcha.allowedOrigins.filter((origin) => typeof origin === 'string')
        : [];
    const missing = [];
    if (testModeEnabled && !signingKeyConfigured) {
        missing.push('captcha.signingKeyEnv');
    }
    return { configured, testModeEnabled, signingKeyConfigured, allowedOrigins, missing };
}
function inspectRun(flowtraceRoot) {
    try {
        const state = JSON.parse(readFileSync(join(flowtraceRoot, 'pipeline-state.json'), 'utf8'));
        const stages = Array.isArray(state.stages) ? state.stages.filter(isStageRecord) : [];
        const lastStage = stages[stages.length - 1];
        return {
            runId: typeof state.runId === 'string' ? state.runId : typeof state.taskId === 'string' ? state.taskId : null,
            status: lastStage && pipelineStatuses.includes(lastStage.status) ? lastStage.status : null,
            currentStage: pipelineStages.includes(state.currentStage) ? state.currentStage : null,
            updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null
        };
    }
    catch {
        return null;
    }
}
function isStageRecord(value) {
    return !!value && typeof value === 'object' && pipelineStatuses.includes(value.status);
}
function overallStatus(configMissing, recording, scenarios, scenarioDirectory) {
    if (configMissing.length > 0) {
        return 'INCOMPLETE_CONFIG';
    }
    if (recording?.status === 'NOT_RECORDED') {
        return 'RECORDING_PENDING';
    }
    if (recording && (recording.status === 'RECORDED' || recording.status === 'INVALID')) {
        return 'RECORDING_NOT_CONFIRMED';
    }
    if (!existsSync(scenarioDirectory)) {
        return 'SCENARIOS_MISSING';
    }
    if (scenarios.invalid > 0) {
        return 'SCENARIOS_INVALID';
    }
    return 'READY';
}
function recordingRemediation(snapshot) {
    const processId = snapshot.recording?.processId;
    return processId ? [`flowtrace record-confirm ${processId}`] : [`flowtrace record --project ${snapshot.project.root}`];
}
function casesRemediation(snapshot) {
    const processId = snapshot.recording?.processId;
    return processId
        ? [`flowtrace generate-cases --project ${snapshot.project.root} --process ${processId}`]
        : [`flowtrace generate-cases --project ${snapshot.project.root}`];
}
//# sourceMappingURL=project-status.js.map