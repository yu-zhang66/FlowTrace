import chalk from 'chalk';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import {
  type CommandResult,
  type StatusSnapshot,
  loadTargetProjectConfig,
  resolveProcess,
  computeStatus,
  statusFromError,
} from '@flowtrace/core';

/**
 * StatusCommandOptions for the status command.
 */
export interface StatusCommandOptions {
  /** Project root path (defaults to cwd) */
  project?: string;
  /** Natural-language process query */
  query?: string;
  /** Explicit process ID */
  process?: string;
  /** Alias for process (Commander passes through the positional differently) */
  explicitProcessId?: string;
  /** Print human-readable output in addition to structured result */
  human?: boolean;
}

/** Set by statusCommand; available for programmatic callers after the command runs. */
export let lastStatusResult: CommandResult<StatusSnapshot> | undefined;

function printHumanStatus(snapshot: StatusSnapshot): void {
  const statusColor = snapshot.status === 'READY' ? chalk.green : snapshot.status === 'NOT_INITIALIZED' ? chalk.yellow : chalk.red;

  console.log(chalk.blue('\n=== FlowTrace Status ==='));
  console.log(chalk.gray(`Project  : ${snapshot.project.name} (${snapshot.project.id})`));
  console.log(chalk.gray(`Root     : ${snapshot.project.root}`));
  console.log(chalk.cyan(`Status   : ${statusColor(snapshot.status)}`));

  // Config
  if (snapshot.config.exists) {
    console.log(chalk.green(`Config   : ${snapshot.config.path ?? 'inline'}`));
    if (snapshot.config.warnings.length > 0) {
      for (const w of snapshot.config.warnings) {
        console.log(chalk.yellow(`  Warning : ${w}`));
      }
    }
    if (snapshot.config.missing.length > 0) {
      for (const m of snapshot.config.missing) {
        console.log(chalk.red(`  Missing : ${m}`));
      }
    }
  } else {
    console.log(chalk.red(`Config   : not found`));
    for (const m of snapshot.config.missing) {
      console.log(chalk.gray(`  Missing : ${m}`));
    }
  }

  // Recording
  if (snapshot.recording) {
    const recStatusColor =
      snapshot.recording.status === 'CONFIRMED'
        ? chalk.green
        : snapshot.recording.status === 'RECORDED'
          ? chalk.yellow
          : chalk.gray;
    console.log(chalk.gray(`Recording: ${recStatusColor(snapshot.recording.status)}`));
    if (snapshot.recording.processId) console.log(chalk.gray(`  Process : ${snapshot.recording.processId}`));
    if (snapshot.recording.artifact) console.log(chalk.gray(`  Artifact: ${snapshot.recording.artifact}`));
    if (snapshot.recording.confirmedBy) console.log(chalk.gray(`  By      : ${snapshot.recording.confirmedBy}`));
  } else {
    console.log(chalk.gray(`Recording: (none)`));
  }

  // Scenarios
  console.log(chalk.gray(`Scenarios: ${snapshot.scenarios.count} total`));
  if (snapshot.scenarios.invalid > 0) {
    console.log(chalk.red(`  Invalid : ${snapshot.scenarios.invalid}`));
  }

  // Captcha
  const captchaColor = snapshot.captcha.configured ? chalk.green : chalk.yellow;
  console.log(chalk.gray(`Captcha  : ${captchaColor(snapshot.captcha.configured ? 'configured' : 'not configured')}`));
  if (snapshot.captcha.missing.length > 0) {
    for (const m of snapshot.captcha.missing) {
      console.log(chalk.gray(`  Missing : ${m}`));
    }
  }

  // Run
  if (snapshot.run) {
    if (snapshot.run.runId) console.log(chalk.gray(`Run ID   : ${snapshot.run.runId}`));
    if (snapshot.run.currentStage) console.log(chalk.gray(`Stage    : ${snapshot.run.currentStage}`));
  }

  console.log();
}

function buildNotInitializedResult(projectRoot: string): CommandResult<StatusSnapshot> {
  const now = new Date().toISOString();
  const snapshot = statusFromError(projectRoot, 'NOT_INITIALIZED', 'Project not initialized. Run `flowtrace init` first.');
  snapshot.config.warnings.push(`No .flowtrace/flowtrace.yaml found in ${projectRoot}`);
  return {
    ok: false,
    code: 'NOT_INITIALIZED',
    project: { id: '', name: '', root: projectRoot },
    process: { id: null, name: null, resolvedBy: null, candidates: [] },
    runId: null,
    artifacts: [],
    releaseGate: { allowed: false, blockedBy: ['NOT_INITIALIZED'] },
    warnings: [],
    missing: [`${projectRoot}/.flowtrace/flowtrace.yaml`],
    remediation: [`flowtrace init --project ${projectRoot}`],
    data: snapshot,
    startedAt: now,
    finishedAt: now,
  };
}

/**
 * Run the status command.
 *
 * Resolves project root, optionally resolves a process, then calls computeStatus.
 * Stores the fully-populated CommandResult in `lastStatusResult` for programmatic callers.
 *
 * Exit codes:
 *   0 — OK
 *   2 — any other code (gate blocked / not initialized / ambiguous / not found)
 */
export async function statusCommand(options: StatusCommandOptions): Promise<void> {
  const projectRoot = options.project ? resolve(process.cwd(), options.project) : resolve(process.cwd());
  const flowtraceRoot = join(projectRoot, '.flowtrace');
  const configPath = join(flowtraceRoot, 'flowtrace.yaml');

  // --- Not initialized path ---
  if (!existsSync(flowtraceRoot)) {
    lastStatusResult = buildNotInitializedResult(projectRoot);
    if (options.human) {
      console.error(chalk.red(`\nError: .flowtrace directory not found in ${projectRoot}`));
      console.log(chalk.gray(`   Run: flowtrace init --project ${projectRoot}\n`));
    }
    process.exit(2);
    return;
  }

  let targetConfig;
  try {
    targetConfig = loadTargetProjectConfig(projectRoot);
  } catch (err) {
    const now = new Date().toISOString();
    const snapshot = statusFromError(
      projectRoot,
      'CONFIG_INCOMPLETE',
      err instanceof Error ? err.message : String(err)
    );
    lastStatusResult = {
      ok: false,
      code: 'CONFIG_INCOMPLETE',
      project: { id: snapshot.project.id, name: snapshot.project.name, root: projectRoot },
      process: { id: null, name: null, resolvedBy: null, candidates: [] },
      runId: null,
      artifacts: [],
      releaseGate: { allowed: false, blockedBy: ['CONFIG_INCOMPLETE'] },
      warnings: [],
      missing: [configPath],
      remediation: [`flowtrace init --project ${projectRoot}`],
      data: snapshot,
      startedAt: now,
      finishedAt: now,
    };
    if (options.human) {
      console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : String(err)}`));
      console.log(chalk.gray(`   Run: flowtrace init --project ${projectRoot}\n`));
    }
    process.exit(2);
    return;
  }

  // --- Process resolution ---
  const explicitId = options.explicitProcessId ?? options.process ?? null;
  const query = options.query ?? null;

  if (query || explicitId) {
    const resolutionQuery = query ?? explicitId;
    const resolution = resolveProcess(projectRoot, resolutionQuery, explicitId);

    if (resolution.code !== 'OK') {
      const now = new Date().toISOString();
      const remediation: string[] = [];
      if (resolution.candidates.length > 0) {
        remediation.push(`Did you mean one of these?`);
        for (const c of resolution.candidates) {
          remediation.push(`  - ${c.name} (id: ${c.id})`);
        }
      }
      remediation.push(`flowtrace init --project ${projectRoot}`);

      lastStatusResult = {
        ok: false,
        code: resolution.code,
        project: { id: targetConfig.project.id, name: targetConfig.project.name, root: projectRoot },
        process: {
          id: null,
          name: resolutionQuery,
          resolvedBy: query ? 'natural-language' : 'explicit-id',
          candidates: resolution.candidates,
        },
        runId: null,
        artifacts: [],
        releaseGate: { allowed: false, blockedBy: [resolution.code] },
        warnings: [],
        missing: [],
        remediation,
        data: undefined,
        startedAt: now,
        finishedAt: now,
      };

      if (options.human) {
        const label = resolution.code === 'AMBIGUOUS_PROCESS' ? 'Ambiguous process query' : 'Process not found';
        console.error(chalk.red(`\n${label}: "${resolutionQuery}"`));
        if (resolution.candidates.length > 0) {
          console.log(chalk.yellow(`\nCandidates:`));
          for (const c of resolution.candidates) {
            console.log(chalk.gray(`  - ${c.name} (id: ${c.id})`));
          }
        }
        console.log();
      }
      process.exit(2);
      return;
    }
  }

  // --- Compute status ---
  const resolvedProcessId = query || explicitId
    ? resolveProcess(projectRoot, query ?? explicitId, explicitId).process?.id ?? null
    : null;
  const snapshot = computeStatus({
    projectRoot,
    flowtraceRoot,
    configPath,
    config: targetConfig,
    processId: resolvedProcessId,
  });

  const now = new Date().toISOString();

  lastStatusResult = {
    ok: snapshot.status === 'READY',
    code: snapshotToCommandCode(snapshot.status),
    project: { id: snapshot.project.id, name: snapshot.project.name, root: projectRoot },
    process: {
      id: snapshot.recording?.processId ?? resolvedProcessId,
      name: null,
      resolvedBy: explicitId ? 'explicit-id' : null,
      candidates: [],
    },
    runId: snapshot.run?.runId ?? null,
    artifacts: [],
    releaseGate: {
      allowed: snapshot.status === 'READY',
      blockedBy: snapshot.status === 'READY' ? [] : [snapshot.status],
    },
    warnings: snapshot.config.warnings,
    missing: snapshot.config.missing,
    remediation: [],
    data: snapshot,
    startedAt: now,
    finishedAt: now,
  };

  if (options.human) {
    printHumanStatus(snapshot);
  }

  const exitCode = lastStatusResult.code === 'OK' ? 0 : 2;
  process.exit(exitCode);
}

function snapshotToCommandCode(status: string): CommandResult['code'] {
  switch (status) {
    case 'READY':
      return 'OK';
    case 'NOT_INITIALIZED':
      return 'NOT_INITIALIZED';
    case 'INCOMPLETE_CONFIG':
      return 'CONFIG_INCOMPLETE';
    case 'PROCESS_NOT_FOUND':
      return 'PROCESS_NOT_FOUND';
    case 'RECORDING_PENDING':
    case 'RECORDING_NOT_CONFIRMED':
      return 'RECORDING_NOT_CONFIRMED';
    case 'SCENARIOS_MISSING':
    case 'SCENARIOS_INVALID':
      return 'CASES_INVALID';
    default:
      return 'OK';
  }
}
