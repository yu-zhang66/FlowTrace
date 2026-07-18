import chalk from 'chalk';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import {
  type CommandResult,
  type ProcessCandidate,
  loadTargetProjectConfig,
  resolveProcess,
  listProcessCandidates,
  createConfirmedState,
  writeRecordingState,
} from '@flowtrace/core';

/**
 * Options for the record-confirm command.
 */
export interface RecordConfirmOptions {
  /** Project root path (defaults to cwd) */
  project?: string;
  /** Process ID or natural-language query */
  process?: string;
  /** Path or URI for the recording artifact */
  artifact?: string;
  /** Name of the person/system confirming the recording */
  by?: string;
}

/** Set by recordConfirmCommand; available for programmatic callers after the command runs. */
export let lastRecordConfirmResult: CommandResult | undefined;

/**
 * Run the record-confirm command.
 *
 * Marks a process recording as confirmed by writing a CONFIRMED state to
 * recording-state.json. This is a test utility for confirming a recording
 * artifact before downstream collection and execution stages.
 *
 * Exit codes:
 *   0 — success
 *   2 — gate failure (NOT_INITIALIZED, AMBIGUOUS_PROCESS, PROCESS_NOT_FOUND)
 */
export async function recordConfirmCommand(options: RecordConfirmOptions): Promise<void> {
  const projectRoot = options.project ? resolve(process.cwd(), options.project) : resolve(process.cwd());
  const flowtraceRoot = join(projectRoot, '.flowtrace');

  // --- Not initialized path ---
  if (!existsSync(flowtraceRoot)) {
    lastRecordConfirmResult = {
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
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    console.error(chalk.red(`\nError: .flowtrace directory not found in ${projectRoot}`));
    console.log(chalk.gray(`   Run: flowtrace init --project ${projectRoot}\n`));
    process.exit(2);
    return;
  }

  let targetConfig;
  try {
    targetConfig = loadTargetProjectConfig(projectRoot);
  } catch (err) {
    lastRecordConfirmResult = {
      ok: false,
      code: 'CONFIG_INCOMPLETE',
      project: { id: '', name: '', root: projectRoot },
      process: { id: null, name: null, resolvedBy: null, candidates: [] },
      runId: null,
      artifacts: [],
      releaseGate: { allowed: false, blockedBy: ['CONFIG_INCOMPLETE'] },
      warnings: [],
      missing: [`${projectRoot}/.flowtrace/flowtrace.yaml`],
      remediation: [`flowtrace init --project ${projectRoot}`],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : String(err)}`));
    console.log(chalk.gray(`   Run: flowtrace init --project ${projectRoot}\n`));
    process.exit(2);
    return;
  }

  // --- Resolve process ---
  const resolvedId = resolveProcessId(projectRoot, options.process ?? null);

  if (resolvedId.__error) {
    lastRecordConfirmResult = {
      ok: false,
      code: resolvedId.code,
      project: { id: targetConfig.project.id, name: targetConfig.project.name, root: projectRoot },
      process: {
        id: null,
        name: options.process ?? null,
        resolvedBy: null,
        candidates: resolvedId.candidates,
      },
      runId: null,
      artifacts: [],
      releaseGate: { allowed: false, blockedBy: [resolvedId.code] },
      warnings: [],
      missing: [],
      remediation: buildRemediation(resolvedId),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    if (resolvedId.code === 'AMBIGUOUS_PROCESS') {
      console.error(chalk.red(`\nAmbiguous process: "${options.process}"`));
      console.log(chalk.yellow(`\nCandidates:`));
      for (const c of resolvedId.candidates) {
        console.log(chalk.gray(`  - ${c.name} (id: ${c.id})`));
      }
    } else {
      console.error(chalk.red(`\nProcess not found: "${options.process}"`));
    }
    console.log();
    process.exit(2);
    return;
  }

  const processId = resolvedId.id;
  const confirmedBy = options.by ?? process.env.USER ?? 'manual';
  const artifact = options.artifact ?? 'page-recording://pending';

  // --- Write CONFIRMED state ---
  const state = createConfirmedState({ processId, artifact, confirmedBy });
  writeRecordingState(flowtraceRoot, state);

  lastRecordConfirmResult = {
    ok: true,
    code: 'OK',
    project: { id: targetConfig.project.id, name: targetConfig.project.name, root: projectRoot },
    process: {
      id: processId,
      name: null,
      resolvedBy: resolvedId.resolvedBy,
      candidates: [],
    },
    runId: null,
    artifacts: [
      {
        label: 'Recording State',
        path: 'recording-state.json',
        absolutePath: join(flowtraceRoot, 'recording-state.json'),
        type: 'recording',
      },
    ],
    releaseGate: { allowed: true, blockedBy: [] },
    warnings: [],
    missing: [],
    remediation: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };

  console.log(chalk.green(`\n✓ Recording confirmed for process: ${chalk.cyan(processId)}`));
  console.log(chalk.gray(`  Project   : ${targetConfig.project.name}`));
  console.log(chalk.gray(`  Confirmed : ${confirmedBy}`));
  console.log(chalk.gray(`  Artifact  : ${artifact}`));
  console.log();

  process.exit(0);
}

type ResolvedProcess =
  | { __error: false; id: string; resolvedBy: 'explicit-id' | 'name' | 'alias' | 'natural-language' | 'default' }
  | { __error: true; code: 'PROCESS_NOT_FOUND' | 'AMBIGUOUS_PROCESS'; candidates: ProcessCandidate[] };

function resolveProcessId(projectRoot: string, query: string | null): ResolvedProcess {
  if (query) {
    const resolution = resolveProcess(projectRoot, query, null);
    if (resolution.code !== 'OK') {
      return {
        __error: true,
        code: resolution.code,
        candidates: resolution.candidates,
      };
    }
    return { __error: false, id: resolution.process!.id, resolvedBy: 'natural-language' };
  }

  // No query: use the project-local inventory only when it is unambiguous.
  const candidates = listProcessCandidates(projectRoot);
  if (candidates.length > 1) {
    return {
      __error: true,
      code: 'AMBIGUOUS_PROCESS',
      candidates,
    };
  }
  if (candidates.length === 0) {
    return {
      __error: true,
      code: 'PROCESS_NOT_FOUND',
      candidates: [],
    };
  }
  return { __error: false, id: candidates[0].id, resolvedBy: 'default' };
}

function buildRemediation(error: { __error: true; code: string; candidates: ProcessCandidate[] }): string[] {
  const remediation: string[] = [];
  if (error.candidates.length > 0) {
    remediation.push(`Did you mean one of these?`);
    for (const c of error.candidates) {
      remediation.push(`  - ${c.name} (id: ${c.id})`);
    }
  }
  return remediation;
}
