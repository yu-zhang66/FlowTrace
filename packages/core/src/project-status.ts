import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import yaml from 'js-yaml';
import type { PipelineStage, PipelineStageStatus } from './models/process-evidence.js';
import type { CommandCode, ProjectStatusCode, StatusSnapshot } from './models/command-result.js';
import { validateScenario } from './models/scenario.js';
import type { TargetProjectConfig } from './target-config.js';
import { validateTargetConfig } from './target-config.js';
import { readRecordingState } from './recording-state.js';

interface RawCaptchaConfig {
  testMode?: unknown;
  signingKeyEnv?: unknown;
  signingKey?: unknown;
  allowedOrigins?: unknown;
}

interface RawPipelineState {
  runId?: unknown;
  taskId?: unknown;
  currentStage?: unknown;
  updatedAt?: unknown;
  stages?: unknown;
}

interface ScenarioFile {
  path: string;
  mtimeMs: number;
}

const pipelineStages: PipelineStage[] = [
  'collect', 'enhance', 'confirm', 'generate-cases', 'validate-cases', 'execute', 'analyze', 'remediate'
];
const pipelineStatuses: PipelineStageStatus[] = [
  'pending', 'running', 'passed', 'blocked', 'waiting-confirmation', 'failed'
];

export function computeStatus(opts: {
  projectRoot: string;
  flowtraceRoot: string;
  configPath: string;
  config: TargetProjectConfig;
  processId?: string | null;
}): StatusSnapshot {
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

export function summarizeStatus(snapshot: StatusSnapshot): {
  ok: boolean;
  code: CommandCode;
  missing: string[];
  remediation: string[];
} {
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

export function statusFromError(
  projectRoot: string,
  code: CommandCode,
  message: string
): StatusSnapshot {
  const root = resolve(projectRoot);
  const status: ProjectStatusCode = code === 'CONFIG_INCOMPLETE' ? 'INCOMPLETE_CONFIG' : 'NOT_INITIALIZED';
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

function recordingSnapshot(flowtraceRoot: string, processId: string): NonNullable<StatusSnapshot['recording']> {
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

function scenarioRoot(flowtraceRoot: string, config: TargetProjectConfig, processId?: string | null): string {
  const configuredRoot = config.paths.scenarios || 'scenarios';
  // Scenario files are currently stored in one project-local directory and
  // carry their process ID in the artifact. Keep status and command gates
  // consistent with validate-cases; process selection filters execution but
  // does not invent a nested directory convention.
  return resolve(flowtraceRoot, configuredRoot);
}

function collectScenarioFiles(directory: string): ScenarioFile[] {
  if (!existsSync(directory)) {
    return [];
  }
  const files: ScenarioFile[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (
        entry.isFile() &&
        !['login-test-config.json', 'validation.json'].includes(entry.name) &&
        ['.yaml', '.yml', '.json'].includes(entry.name.slice(entry.name.lastIndexOf('.')))
      ) {
        try {
          files.push({ path, mtimeMs: statSync(path).mtimeMs });
        } catch {
          // A file removed during inspection is treated as unavailable.
        }
      }
    }
  };
  visit(directory);
  return files;
}

function inspectScenarios(files: ScenarioFile[]): StatusSnapshot['scenarios'] {
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
      } else {
        invalid += 1;
      }
    } catch {
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

function readScenario(path: string): unknown {
  const content = readFileSync(path, 'utf8');
  return path.endsWith('.json') ? JSON.parse(content) : yaml.load(content);
}

function extractScenarios(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object' && Array.isArray((value as { scenarios?: unknown }).scenarios)) {
    return (value as { scenarios: unknown[] }).scenarios;
  }
  return value === undefined || value === null ? [] : [value];
}

function inspectCaptcha(configPath: string): StatusSnapshot['captcha'] {
  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(configPath, 'utf8'));
  } catch {
    return {
      configured: false,
      testModeEnabled: false,
      signingKeyConfigured: false,
      allowedOrigins: [],
      missing: ['captcha']
    };
  }

  const captcha = raw && typeof raw === 'object' ? (raw as { captcha?: RawCaptchaConfig }).captcha : undefined;
  const configured = !!captcha && typeof captcha === 'object';
  const testModeEnabled = captcha?.testMode === true;
  const signingKeyEnv = typeof captcha?.signingKeyEnv === 'string' ? captcha.signingKeyEnv.trim() : '';
  const signingKeyConfigured = !!captcha?.signingKey || (!!signingKeyEnv && !!process.env[signingKeyEnv]);
  const allowedOrigins = Array.isArray(captcha?.allowedOrigins)
    ? captcha.allowedOrigins.filter((origin): origin is string => typeof origin === 'string')
    : [];
  const missing: string[] = [];
  if (testModeEnabled && !signingKeyConfigured) {
    missing.push('captcha.signingKeyEnv');
  }
  return { configured, testModeEnabled, signingKeyConfigured, allowedOrigins, missing };
}

function inspectRun(flowtraceRoot: string): StatusSnapshot['run'] {
  try {
    const state = JSON.parse(readFileSync(join(flowtraceRoot, 'pipeline-state.json'), 'utf8')) as RawPipelineState;
    const stages = Array.isArray(state.stages) ? state.stages.filter(isStageRecord) : [];
    const lastStage = stages[stages.length - 1];
    return {
      runId: typeof state.runId === 'string' ? state.runId : typeof state.taskId === 'string' ? state.taskId : null,
      status: lastStage && pipelineStatuses.includes(lastStage.status) ? lastStage.status : null,
      currentStage: pipelineStages.includes(state.currentStage as PipelineStage) ? state.currentStage as PipelineStage : null,
      updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null
    };
  } catch {
    return null;
  }
}

function isStageRecord(value: unknown): value is { status: PipelineStageStatus } {
  return !!value && typeof value === 'object' && pipelineStatuses.includes((value as { status?: unknown }).status as PipelineStageStatus);
}

function overallStatus(
  configMissing: string[],
  recording: StatusSnapshot['recording'],
  scenarios: StatusSnapshot['scenarios'],
  scenarioDirectory: string
): ProjectStatusCode {
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

function recordingRemediation(snapshot: StatusSnapshot): string[] {
  const processId = snapshot.recording?.processId;
  return processId ? [`flowtrace record-confirm ${processId}`] : [`flowtrace record --project ${snapshot.project.root}`];
}

function casesRemediation(snapshot: StatusSnapshot): string[] {
  const processId = snapshot.recording?.processId;
  return processId
    ? [`flowtrace generate-cases --project ${snapshot.project.root} --process ${processId}`]
    : [`flowtrace generate-cases --project ${snapshot.project.root}`];
}
