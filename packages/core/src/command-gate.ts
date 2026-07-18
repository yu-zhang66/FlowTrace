import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  CommandResult,
  ProcessCandidate,
  ProcessResolution,
  ReleaseGate,
  StatusSnapshot
} from './models/command-result.js';
import { loadTargetProjectConfig, type TargetProjectConfig } from './target-config.js';
import { resolveProcess } from './process-resolver.js';
import { computeStatus, statusFromError } from './project-status.js';

export type GateRequirement =
  | 'init'
  | 'config'
  | 'process'
  | 'recording'
  | 'recording-confirmed'
  | 'cases'
  | 'cases-valid'
  | 'captcha-config'
  | 'captcha-key'
  | 'origin';

export function runGate(opts: {
  projectRoot: string;
  flowtraceRoot: string;
  configPath?: string;
  config?: TargetProjectConfig;
  processId?: string | null;
  explicitProcessId?: string | null;
  query?: string | null;
  requirements: GateRequirement[];
}): CommandResult {
  const startedAt = new Date().toISOString();
  const projectRoot = resolve(opts.projectRoot);
  let config = opts.config;
  let flowtraceRoot = resolve(opts.flowtraceRoot);
  let configPath = opts.configPath ?? join(flowtraceRoot, 'flowtrace.yaml');

  if (!config) {
    try {
      config = loadTargetProjectConfig(projectRoot);
      flowtraceRoot = config.flowtraceRoot;
      configPath = opts.configPath ?? config.configPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const snapshot = statusFromError(projectRoot, 'NOT_INITIALIZED', message);
      return buildResult({
        startedAt,
        snapshot,
        processResolution: null,
        code: 'NOT_INITIALIZED',
        missing: ['.flowtrace/flowtrace.yaml'],
        remediation: [`flowtrace init --project ${projectRoot}`]
      });
    }
  }

  let processResolution: ProcessResolution | null = null;
  let snapshot = computeStatus({
    projectRoot,
    flowtraceRoot,
    configPath,
    config,
    processId: opts.processId ?? null
  });

  const needsProcess = opts.requirements.includes('process');
  if (needsProcess) {
    const processQuery = opts.query?.trim() || opts.explicitProcessId || opts.processId || config.processId;
    processResolution = resolveProcess(projectRoot, processQuery, opts.explicitProcessId ?? opts.processId ?? null);
    if (!processResolution.ok || !processResolution.process) {
      const code = processResolution.code;
      return buildResult({
        startedAt,
        snapshot,
        processResolution,
        code,
        missing: code === 'AMBIGUOUS_PROCESS' ? ['process query is ambiguous'] : ['process'],
        remediation: code === 'AMBIGUOUS_PROCESS'
          ? ['Specify an exact process ID or a more specific process description']
          : [`Specify a valid process ID or name for ${projectRoot}`]
      });
    }
    snapshot = computeStatus({
      projectRoot,
      flowtraceRoot,
      configPath,
      config,
      processId: processResolution.process.id
    });
  }

  for (const requirement of opts.requirements) {
    const failure = evaluateRequirement(requirement, snapshot, processResolution, projectRoot);
    if (failure) {
      return buildResult({
        startedAt,
        snapshot,
        processResolution,
        code: failure.code,
        missing: failure.missing,
        remediation: failure.remediation
      });
    }
  }

  return buildResult({
    startedAt,
    snapshot,
    processResolution,
    code: 'OK',
    missing: [],
    remediation: []
  });
}

export function gateForCommand(
  command: 'collect' | 'generate-cases' | 'validate-cases' | 'test' | 'report' | 'pipeline'
): GateRequirement[] {
  switch (command) {
    case 'collect':
      return ['init', 'config'];
    case 'generate-cases':
      return ['init', 'config', 'process', 'recording-confirmed'];
    case 'validate-cases':
      return ['init', 'config', 'process', 'cases'];
    case 'test':
      return ['init', 'config', 'process', 'recording-confirmed', 'cases-valid', 'captcha-key'];
    case 'report':
      return ['init', 'config'];
    case 'pipeline':
      return ['init', 'config', 'process'];
  }
}

interface GateFailure {
  code: CommandResult['code'];
  missing: string[];
  remediation: string[];
}

function evaluateRequirement(
  requirement: GateRequirement,
  snapshot: StatusSnapshot,
  processResolution: ProcessResolution | null,
  projectRoot: string
): GateFailure | null {
  switch (requirement) {
    case 'init':
      return snapshot.config.exists
        ? null
        : {
            code: 'NOT_INITIALIZED',
            missing: ['.flowtrace/flowtrace.yaml'],
            remediation: [`flowtrace init --project ${projectRoot}`]
          };
    case 'config':
      return snapshot.config.missing.length === 0
        ? null
        : {
            code: 'CONFIG_INCOMPLETE',
            missing: snapshot.config.missing,
            remediation: [`Complete the missing configuration for ${projectRoot}`]
          };
    case 'process':
      return processResolution?.ok
        ? null
        : {
            code: processResolution?.code === 'AMBIGUOUS_PROCESS' ? 'AMBIGUOUS_PROCESS' : 'PROCESS_NOT_FOUND',
            missing: processResolution?.code === 'AMBIGUOUS_PROCESS' ? ['process query is ambiguous'] : ['process'],
            remediation: ['Specify an exact process ID or a more specific process description']
          };
    case 'recording':
      if (!snapshot.recording || snapshot.recording.status === 'NOT_RECORDED') {
        return {
          code: 'RECORDING_NOT_FOUND',
          missing: ['recording'],
          remediation: recordingRemediation(snapshot)
        };
      }
      return null;
    case 'recording-confirmed':
      if (!snapshot.recording || snapshot.recording.status === 'NOT_RECORDED') {
        return {
          code: 'RECORDING_NOT_FOUND',
          missing: ['recording'],
          remediation: recordingRemediation(snapshot)
        };
      }
      if (snapshot.recording.status !== 'CONFIRMED') {
        return {
          code: 'RECORDING_NOT_CONFIRMED',
          missing: ['recording.confirmedAt'],
          remediation: recordingRemediation(snapshot)
        };
      }
      return null;
    case 'cases':
      return snapshot.scenarios.count > 0
        ? null
        : {
            code: 'CASES_INVALID',
            missing: ['scenarios'],
            remediation: casesRemediation(snapshot)
          };
    case 'cases-valid':
      return snapshot.scenarios.count > 0 && snapshot.scenarios.invalid === 0
        ? null
        : {
            code: 'CASES_INVALID',
            missing: snapshot.scenarios.count === 0 ? ['scenarios'] : ['scenarios.valid'],
            remediation: snapshot.scenarios.count === 0
              ? casesRemediation(snapshot)
              : [`flowtrace validate-cases --project ${projectRoot}`]
          };
    case 'captcha-config':
      return snapshot.captcha.configured
        ? null
        : {
            code: 'MISSING_CAPTCHA_CONFIG',
            missing: ['captcha'],
            remediation: [`Add the captcha section to ${snapshot.config.path ?? join(projectRoot, '.flowtrace', 'flowtrace.yaml')}`]
          };
    case 'captcha-key':
      return snapshot.captcha.signingKeyConfigured
        ? null
        : {
            code: 'MISSING_CAPTCHA_CONFIG',
            missing: ['captcha.signingKeyEnv'],
            remediation: ['Configure captcha.signingKeyEnv and set that environment variable before running tests']
          };
    case 'origin':
      return snapshot.captcha.allowedOrigins.length > 0
        ? null
        : {
            code: 'MISSING_CAPTCHA_CONFIG',
            missing: ['captcha.allowedOrigins'],
            remediation: ['Configure at least one allowed captcha origin']
          };
  }
}

function buildResult(opts: {
  startedAt: string;
  snapshot: StatusSnapshot;
  processResolution: ProcessResolution | null;
  code: CommandResult['code'];
  missing: string[];
  remediation: string[];
}): CommandResult {
  const finishedAt = new Date().toISOString();
  const processCandidate = opts.processResolution?.process;
  const candidates = opts.processResolution?.candidates ?? [];
  const resolvedBy = processCandidate ? resolvedByFor(opts.processResolution!, processCandidate) : null;
  const processId = processCandidate?.id ?? opts.snapshot.recording?.processId ?? null;
  const processName = processCandidate?.name ?? null;
  const releaseGate: ReleaseGate = {
    allowed: opts.code === 'OK',
    blockedBy: opts.code === 'OK' ? [] : [opts.code]
  };
  return {
    ok: opts.code === 'OK',
    code: opts.code,
    project: opts.snapshot.project,
    process: {
      id: processId,
      name: processName,
      resolvedBy,
      candidates
    },
    runId: opts.snapshot.run?.runId ?? null,
    artifacts: [],
    releaseGate,
    warnings: [...opts.snapshot.config.warnings, ...opts.snapshot.captcha.missing],
    missing: opts.missing,
    remediation: opts.remediation,
    startedAt: opts.startedAt,
    finishedAt
  };
}

function resolvedByFor(resolution: ProcessResolution, process: ProcessCandidate): NonNullable<CommandResult['process']['resolvedBy']> {
  if (resolution.query === process.id) {
    return 'explicit-id';
  }
  if (normalize(resolution.query) === normalize(process.name)) {
    return 'name';
  }
  if (process.aliases.some(alias => normalize(alias) === normalize(resolution.query))) {
    return 'alias';
  }
  return 'natural-language';
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function recordingRemediation(snapshot: StatusSnapshot): string[] {
  return snapshot.recording?.processId
    ? [`flowtrace record-confirm ${snapshot.recording.processId}`]
    : [`flowtrace record --project ${snapshot.project.root}`];
}

function casesRemediation(snapshot: StatusSnapshot): string[] {
  return snapshot.recording?.processId
    ? [`flowtrace generate-cases --project ${snapshot.project.root} --process ${snapshot.recording.processId}`]
    : [`flowtrace generate-cases --project ${snapshot.project.root}`];
}
