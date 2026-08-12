/**
 * Config-driven verify command.
 *
 * Reads flowtrace.yaml's runtime block (with adapter: builtin), drives the
 * project's processes/<id>.yaml files through the builtin HTTP/Browser
 * runtime via the DSL interpreter, executes the hand-written scenarios
 * under scenarios/<id>.yaml files, and produces the standard dual-run
 * JSON, Markdown and HTML reports.
 *
 * Scenarios marked AUTO_EXTRACTED or REVIEW_REQUIRED (i.e. imported: true)
 * are refused by flowtrace verify until a human promotes them to
 * CONFIRMED (via flowtrace record-confirm or by editing the scenario
 * file status field). Hand-written scenarios are treated as already
 * CONFIRMED.
 *
 * This command is intentionally generic: it MUST NOT contain any
 * business identifier (URL, selector, account, scenario id, business
 * state name).
 */

import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import {
  loadAllScenarios,
  loadAllProcessDsls,
  loadAdapterSet,
  interpretScenario,
  type AdapterSet,
  type BuiltinRuntime,
  type RuntimeConfig,
  type LoadedScenario,
  type ProcessDsl,
  type DslScenarioObservation,
} from '@flowtrace/adapter';
import { cleanupBuiltinRuntime } from '@flowtrace/adapter';
import { renderFixedDualRunHtml } from '@flowtrace/reporter';

interface BuiltinVerifyOptions {
  project?: string;
  output?: string;
  /** Restrict verification to the given system id(s). When absent, all systems run. */
  system?: string[];
  /** Restrict verification to the given process id(s). When absent, all processes run. */
  process?: string[];
  /** Stop execution immediately when any scenario fails. Default: false. */
  stopOnFailure?: boolean;
}

const REQUIRED_PER_SIDE = 2;

export async function verifyBuiltinCommand(options: BuiltinVerifyOptions): Promise<void> {
  const projectPath = options.project
    ? path.resolve(process.cwd(), options.project)
    : path.resolve(process.cwd());

  if (await delegateToProjectEntrypoint(projectPath)) return;

  console.log(chalk.blue(`\nFlowTrace Verify (config-driven runtime)`));
  console.log(chalk.gray(`Project: ${projectPath}\n`));

  const flowtraceRoot = path.join(projectPath, '.flowtrace');
  if (!(await exists(flowtraceRoot))) {
    console.error(chalk.red(`.flowtrace not found at ${flowtraceRoot}. Run: flowtrace init --project ${projectPath}`));
    process.exit(1);
  }

  const configPath = path.join(flowtraceRoot, 'flowtrace.yaml');
  const rawConfig = yaml.load(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
  const runtimeBlock = (rawConfig.runtime ?? null) as RuntimeConfig | null;
  if (!runtimeBlock) {
    console.error(chalk.red(`flowtrace.yaml has no runtime: block. Run \`flowtrace init\` to generate a fresh config-driven layout.`));
    process.exit(1);
  }

  // Resolve stopOnFailure: CLI option takes precedence over config, default false
  const stopOnFailure = options.stopOnFailure ?? ((rawConfig.execution as any)?.stopOnFailure === true);

  // Fail before creating an execution bundle when login credentials are not
  // available. An adapter-error bundle cannot contain meaningful traces or
  // screenshots and must not be mistaken for a completed dual-run.
  const missingCredentials = findMissingCredentialEnv(runtimeBlock, (options.system ?? []).filter(Boolean));
  if (missingCredentials.length > 0) {
    console.error(chalk.red(`Missing runtime credentials: ${missingCredentials.join(', ')}`));
    console.error(chalk.yellow('Provide them through the project environment (for the mock demo: `npm run test:flowtrace`).'));
    process.exit(1);
  }

  const processesDir = path.join(flowtraceRoot, 'processes');
  let processes = await loadAllProcessDsls(processesDir);
  if (processes.length === 0) {
    console.error(chalk.red(`No process DSL found in ${processesDir}. Add processes/<id>.yaml before running verify.`));
    process.exit(1);
  }

  const scenariosDir = path.join(flowtraceRoot, 'scenarios');
  const allScenarios = await loadAllScenarios(scenariosDir);
  let scenarios = allScenarios.filter((s) => s.enabled !== false);
  const scenarioFilter = process.env.FLOWTRACE_SCENARIO_IDS?.split(',').map((id) => id.trim()).filter(Boolean);
  if (scenarioFilter && scenarioFilter.length > 0) {
    scenarios = scenarios.filter((s) => scenarioFilter.includes(s.id));
    if (scenarios.length === 0) {
      console.error(chalk.red(`No scenarios matched FLOWTRACE_SCENARIO_IDS=${process.env.FLOWTRACE_SCENARIO_IDS}`));
      process.exit(1);
    }
  }
  if (scenarios.length === 0) {
    console.error(chalk.red('No scenarios found to verify.'));
    process.exit(1);
  }

  // --- Standalone (functional) scenarios ---------------------------------
  // A standalone scenario inlines its own DSL steps (`steps:`) and needs no
  // `processes/<id>.yaml`. We synthesize a virtual process per group so the
  // existing interpreter/reporter pipeline runs unchanged. The grouping id
  // comes from the scenario's `process:` field (default `functional`).
  const standaloneScenarios = scenarios.filter((s) => s.standalone);
  const existingProcessIds = new Set(processes.map((p) => p.process.id));
  const vGroups: Record<string, LoadedScenario[]> = {};
  for (const s of standaloneScenarios) {
    let group = s.process || 'functional';
    if (existingProcessIds.has(group)) group = `${group}-functional`;
    s.process = group; // keep grouping consistent with the virtual process
    s.actions = [{ action: s.id, actor: s.actor }];
    (vGroups[group] ||= []).push(s);
  }
  for (const [groupId, group] of Object.entries(vGroups)) {
    processes.push({
      process: {
        id: groupId,
        name: groupId,
        channel: 'browser',
        actions: group.map((s) => ({ id: s.id, name: s.name, steps: (s.inlineSteps ?? []) as any[] })),
      },
      sourceFile: '<inline:standalone-scenarios>',
    });
  }

  const requestedProcesses = (options.process ?? []).filter(Boolean);
  if (requestedProcesses.length > 0) {
    const missing = requestedProcesses.filter((id) => !processes.some((p) => p.process.id === id));
    if (missing.length > 0) {
      console.error(chalk.red(`Requested process(es) not found: ${missing.join(', ')}. Available: ${processes.map((p) => p.process.id).join(', ')}`));
      process.exit(1);
    }
    processes = processes.filter((p) => requestedProcesses.includes(p.process.id));
  }

  // Per-process confirmation check
  const byProcess: Record<string, LoadedScenario[]> = {};
  for (const s of scenarios) (byProcess[s.process] ||= []).push(s);
  for (const proc of processes) {
    const scoped = byProcess[proc.process.id] ?? [];
    const unconfirmed = scoped.filter((s) => s.status !== 'CONFIRMED').map((s) => s.id);
    if (unconfirmed.length > 0) {
      console.error(chalk.red(
        `\nflowtrace verify refused ${unconfirmed.length} unconfirmed scenario(s) for process "${proc.process.id}":\n` +
        unconfirmed.map((id) => '  - ' + id).join('\n') +
        `\nPromote them to CONFIRMED via 'flowtrace record-confirm ${proc.process.id}' or by editing the scenario file's status: field.`,
      ));
      process.exit(1);
    }
  }

  // Run folder / report names include the processes under verification so
  // distinct runs (e.g. a login run vs a switch-account run) are easy to tell
  // apart in `.flowtrace/executions/`.
  const procSlug = processes
    .filter((proc) => (byProcess[proc.process.id] ?? []).length > 0)
    .map((proc) => proc.process.id)
    .join('-') || 'verify';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runId = `run-${ts}-${procSlug}-${randomId()}`;
  const executionRoot = path.join(flowtraceRoot, 'executions', runId);
  const reportDir = options.output ? path.resolve(projectPath, options.output) : path.join(flowtraceRoot, 'reports');
  const runReportDir = path.join(executionRoot, 'reports');
  await fs.mkdir(executionRoot, { recursive: true });
  await fs.mkdir(reportDir, { recursive: true });
  await fs.mkdir(runReportDir, { recursive: true });
  // Scenario indexes are persisted per run. Create the directory explicitly
  // instead of relying on the evidence tree to imply it exists.
  await fs.mkdir(path.join(executionRoot, 'scenarios'), { recursive: true });

  let adapterSet: AdapterSet;
  try {
    // The execution directory is the evidence root. This keeps every artifact
    // from one task under executions/<runId>/ instead of a shared tree.
    const loaded = await loadAdapterSet(runtimeBlock, {
      flowtraceRoot,
      projectRoot: projectPath,
      evidenceRoot: path.join(executionRoot, 'evidence'),
    });
    adapterSet = loaded.set;
    for (const m of loaded.messages) console.log(chalk.yellow(m));
  } catch (err) {
    console.error(chalk.red(`Failed to load runtime: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  if (adapterSet.kind !== 'builtin') {
    console.error(chalk.red(`This verify command requires runtime.adapter: builtin; got \`${adapterSet.kind}\`.`));
    process.exit(1);
  }

  console.log(chalk.green(`✓ Loaded ${processes.length} process(es), ${scenarios.length} scenario(s), ${Object.keys(adapterSet.systems).length} system(s)`));

  // Each system id gets its own evidence dir under executions/<runId>/evidence/<systemId>/...
  for (const sysId of Object.keys(adapterSet.systems)) {
    await fs.mkdir(path.join(executionRoot, 'evidence', sysId), { recursive: true });
  }

  const allRuntimeIds = Object.keys(adapterSet.runtimes);
  const requested = (options.system ?? []).filter(Boolean);
  const systemIds = requested.length > 0
    ? allRuntimeIds.filter((id) => requested.includes(id))
    : allRuntimeIds;

  if (requested.length > 0) {
    const missing = requested.filter((id) => !allRuntimeIds.includes(id));
    if (missing.length > 0) {
      console.error(chalk.red(`Requested system(s) not found: ${missing.join(', ')}. Available: ${allRuntimeIds.join(', ')}`));
      process.exit(1);
    }
  }

  if (systemIds.length < (requested.length > 0 ? 1 : REQUIRED_PER_SIDE)) {
    console.error(chalk.red(`Verify requires at least ${requested.length > 0 ? 1 : REQUIRED_PER_SIDE} system(s); got ${systemIds.length}.`));
    process.exit(1);
  }

  // Initialize every runtime (launch browsers / create contexts) before
  // interpreting any scenario. Without this, browser runtimes throw
  // `initialize() must be called before ensurePage()` on the first action.
  for (const side of systemIds) {
    const runtime = adapterSet.runtimes[side]!;
    if ('initialize' in runtime && typeof runtime.initialize === 'function') {
      await runtime.initialize();
    }
  }

  let cleanupRan = false;
  const cleanup = async () => {
    if (cleanupRan) return;
    cleanupRan = true;
    // Verification may have opened browser instances for screenshot evidence.
    // Always release them so the CLI returns to the shell instead of keeping
    // Node alive on open handles and leaving zombie Chrome processes behind.
    await Promise.all(Object.values(adapterSet?.runtimes ?? {}).map(cleanupBuiltinRuntime));
  };
  const signalHandler = async () => {
    await cleanup();
    process.exit(130);
  };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);

  try {

  const allDifferences: any[] = [];
  const scenarioResults: any[] = [];
  let totalScenarios = 0;
  let totalPassed = 0;

  for (const proc of processes) {
    const procScoped = byProcess[proc.process.id] ?? [];
    if (procScoped.length === 0) continue;
    const dsl = proc.process;
    console.log(chalk.blue(`\n[process] ${dsl.id} — ${procScoped.length} scenario(s)`));

    let previousActor: string | null = null;
    for (const scn of procScoped) {
      totalScenarios += 1;
      const observations: Record<string, DslScenarioObservation> = {};
      const scenarioActor = scn.actions[0]?.actor;

      for (const side of systemIds) {
        const runtime = adapterSet.runtimes[side]!;
        // Isolate scenarios in a fresh BrowserContext only when the actor
        // changes. This avoids repeated logout/login flashing for consecutive
        // scenarios run by the same user while still preventing session/cookie
        // leakage across different actors.
        if (scenarioActor !== previousActor) {
          if ('resetScenario' in runtime && typeof runtime.resetScenario === 'function') {
            await runtime.resetScenario();
          }
        }
        runtime.setScenario(scn.id);
        const obs = await interpretScenario({ runtime, process: dsl }, {
          scenarioId: scn.id,
          defaultActor: scn.actions[0]?.actor,
          steps: scn.actions.map((a) => ({ action: a.action, actor: a.actor, data: a.data })),
          precondition: (scn as any).precondition
            ? {
                loginAs: (scn as any).precondition.loginAs,
                logout: (scn as any).precondition.logout,
                actor: scn.actions[0]?.actor,
              }
            : undefined,
          continueOnError: Array.isArray((scn as any).expected?.illegalActions)
            && (scn as any).expected.illegalActions.length > 1,
        });
        observations[side] = obs;
      }

      const differences: any[] = compareObservations(observations, scn, systemIds);
      for (const side of systemIds) {
        const screenshotPaths = (observations[side]?.actions ?? [])
          .flatMap((action: any) => action.evidencePaths ?? [])
          .filter((evidencePath: string) => evidencePath.toLowerCase().endsWith('.png'));
        const readableScreenshots = (await Promise.all(screenshotPaths.map(async (evidencePath: string) => ({
          evidencePath,
          readable: await isReadablePng(evidencePath),
        })))).filter((entry) => entry.readable);

        if (readableScreenshots.length === 0) {
          differences.push({
            severity: 'P1',
            kind: 'missingScreenshotEvidence',
            side,
            expected: 'at least one readable PNG screenshot',
            actual: screenshotPaths.length === 0 ? 'no PNG screenshot paths' : 'PNG screenshot files are missing or unreadable',
          });
        }
      }
      allDifferences.push(...differences.map((d) => ({ ...d, scenarioId: scn.id, processId: dsl.id })));

      const side = systemIds[0] ?? '';
      const obs = observations[side];
      const hasAdapterError = !!obs?.error || obs?.actions?.some((a: any) => a.illegalTransition);
      const passed = !hasAdapterError && differences.filter((d) => d.severity === 'P0' || d.severity === 'P1').length === 0;
      if (passed) totalPassed += 1;
      scenarioResults.push({ scenarioId: scn.id, processId: dsl.id, differences, passed, observations });
      previousActor = scenarioActor ?? null;

      // Per-scenario evidence index
      await fs.writeFile(
        path.join(executionRoot, 'scenarios', `${scn.id}.json`),
        JSON.stringify({
          scenarioId: scn.id,
          processId: dsl.id,
          observations,
          differences,
          passed,
          startedAt: new Date().toISOString(),
        }, null, 2),
        'utf8',
      );

      console.log(`  [${passed ? chalk.green('PASS') : chalk.red('FAIL')}] ${scn.id}`);

      // Stop execution immediately when a scenario fails, if configured.
      // This prevents cascading failures from a broken initiator flowing
      // into downstream todo scenarios that depend on the previous step.
      if (!passed && stopOnFailure) {
        console.log(chalk.yellow(`\n⛔ Stopping execution: scenario ${scn.id} failed and stopOnFailure is enabled.`));
        console.log(chalk.gray(`   Remaining scenarios in this process will be skipped.`));
        break;
      }
    }

    // If stopOnFailure was triggered, break out of the process loop as well
    if (stopOnFailure) {
      const lastScenario = scenarioResults[scenarioResults.length - 1];
      if (lastScenario && !lastScenario.passed) break;
    }
  }

  // Build reports
  const releaseGate = allDifferences.filter((d) => d.severity === 'P0' || d.severity === 'P1').length === 0 && totalPassed === totalScenarios ? 'PASS' : 'BLOCKED';

  const executionDetails = Object.fromEntries(scenarioResults.map((result: any) => [result.scenarioId, {
    scenarioId: result.scenarioId,
    processId: result.processId,
    observations: result.observations,
    differences: result.differences,
    passed: result.passed,
  }]));

  const jsonReport = {
    id: runId,
    projectId: String((rawConfig.project as any)?.id ?? path.basename(projectPath)),
    projectName: String((rawConfig.project as any)?.name ?? path.basename(projectPath)),
    processId: String((rawConfig as any).processId ?? processes[0]?.process.id ?? '-'),
    timestamp: new Date().toISOString(),
    runId,
    projectPath,
    runtimeAdapter: 'builtin',
    systems: systemIds,
    totalScenarios,
    totalPassed,
    totalFailed: totalScenarios - totalPassed,
    scenarios: scenarioResults.map((result: any) => ({
      scenarioId: result.scenarioId,
      differences: result.differences ?? [],
      passed: result.passed === true,
      error: result.observations?.[systemIds[0] ?? '']?.error ?? undefined,
      // Keep the normalized observations in the report so every renderer and
      // every downstream agent consumes the same deterministic source model.
      observations: result.observations,
    })),
    summary: {
      total: totalScenarios,
      passed: totalPassed,
      failed: totalScenarios - totalPassed,
      differencesBySeverity: allDifferences.reduce((counts: Record<string, number>, d: any) => {
        counts[d.severity] = (counts[d.severity] ?? 0) + 1;
        return counts;
      }, {}),
    },
    differences: allDifferences,
    executionDetails,
    releaseGate: {
      allowed: releaseGate === 'PASS',
      blockedBy: releaseGate === 'PASS' ? [] : allDifferences
        .filter((d) => d.severity === 'P0' || d.severity === 'P1')
        .map((d) => `${d.scenarioId}:${d.kind}`),
    },
    generatedAt: new Date().toISOString(),
  };

  const rawJson = JSON.stringify(jsonReport, null, 2);
  await fs.writeFile(path.join(runReportDir, 'report.json'), rawJson, 'utf8');
  await fs.writeFile(path.join(reportDir, `${runId}.json`), rawJson, 'utf8');

  const md = renderMarkdownReport(jsonReport, scenarios);
  await fs.writeFile(path.join(runReportDir, 'report.md'), md, 'utf8');
  await fs.writeFile(path.join(reportDir, `${runId}.md`), md, 'utf8');

  const html = renderFixedDualRunHtml(jsonReport, scenarios as any);
  await fs.writeFile(path.join(runReportDir, 'report.html'), html, 'utf8');
  await fs.writeFile(path.join(reportDir, `${runId}.html`), html, 'utf8');

  await fs.writeFile(path.join(executionRoot, 'run.json'), JSON.stringify({
    runId,
    projectPath,
    systems: systemIds,
    scenarios: totalScenarios,
    passed: totalPassed,
    releaseGate,
    reports: ['reports/report.json', 'reports/report.md', 'reports/report.html'],
    evidenceRoot: 'evidence',
    scenariosRoot: 'scenarios',
    generatedAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  console.log(chalk.blue(`\nReports written to ${reportDir}`));
  console.log(`Release Gate: ${jsonReport.releaseGate.allowed ? chalk.green('PASS') : chalk.red('BLOCKED')}`);
  console.log(`Passed ${totalPassed}/${totalScenarios}`);

  } finally {
    // Verification may have opened browser instances for screenshot evidence.
    // Always release them after the canonical reports are durable so the CLI
    // returns to the shell instead of keeping Node alive on open handles.
    // Signal handlers also call cleanup to avoid leaving zombie Chrome processes
    // behind when the user interrupts the run.
    await cleanup();
  }
}

async function exists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}

async function delegateToProjectEntrypoint(projectPath: string): Promise<boolean> {
  const packagePath = path.join(projectPath, 'package.json');
  if (!(await exists(packagePath))) return false;

  let packageJson: { scripts?: Record<string, string> };
  try {
    packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8')) as { scripts?: Record<string, string> };
  } catch {
    return false;
  }
  if (!packageJson.scripts?.['test:flowtrace']) return false;

  const delegatedProject = process.env.FLOWTRACE_PROJECT_ENTRYPOINT;
  const insideDeclaredScript = process.env.npm_lifecycle_event === 'test:flowtrace';
  if (delegatedProject === projectPath || insideDeclaredScript) return false;

  console.log(chalk.blue('Project declares `test:flowtrace`; delegating builtin verification to `npm run test:flowtrace`.'));
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn('npm', ['run', 'test:flowtrace'], {
      cwd: projectPath,
      env: { ...process.env, FLOWTRACE_PROJECT_ENTRYPOINT: projectPath },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
  return true;
}

async function isReadablePng(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const signature = Buffer.alloc(8);
      const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
      return bytesRead === signature.length
        && signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function findMissingCredentialEnv(runtime: RuntimeConfig, requestedSystems: string[] = []): string[] {
  const required = new Set<string>();
  for (const [sysId, system] of Object.entries(runtime.systems)) {
    if (requestedSystems.length > 0 && !requestedSystems.includes(sysId)) continue;
    for (const actor of Object.values(system.login?.actorMap ?? {})) {
      required.add(actor.username);
      required.add(actor.password);
    }
  }
  return [...required].filter((name) => !process.env[name]);
}

function compareObservations(observations: Record<string, DslScenarioObservation>, scn: LoadedScenario, systemIds: string[]): any[] {
  const diffs: any[] = [];
  const sides = Object.keys(observations);
  if (sides.length < 2) return diffs;
  const base = observations[sides[0]!]!;
  for (let i = 1; i < sides.length; i++) {
    const other = observations[sides[i]!]!;
    if (base.finalState !== other.finalState) {
      diffs.push({ severity: 'P1', kind: 'finalState', baseSide: sides[0], otherSide: sides[i], baseValue: base.finalState, otherValue: other.finalState });
    }
    const aPath = base.semanticPath.join('|');
    const bPath = other.semanticPath.join('|');
    if (aPath !== bPath) {
      diffs.push({ severity: 'P2', kind: 'semanticPath', baseSide: sides[0], otherSide: sides[i], baseValue: aPath, otherValue: bPath });
    }
    const expectedIllegal = normalizeExpectedIllegal(scn);
    const baseIllegal = normalizeActualIllegal(base);
    const otherIllegal = normalizeActualIllegal(other);
    if (JSON.stringify(baseIllegal) !== JSON.stringify(otherIllegal)) {
      diffs.push({ severity: 'P0', kind: 'errorStatus', baseSide: sides[0], otherSide: sides[i], baseValue: base.error, otherValue: other.error });
    }
    if (baseIllegal.length > 0 && expectedIllegal.length > 0 && JSON.stringify(baseIllegal) !== JSON.stringify(expectedIllegal)) {
      diffs.push({ severity: 'P1', kind: 'declaredIllegalAction', baseSide: sides[0], otherSide: sides[i], expected: expectedIllegal, actual: baseIllegal });
    }
    if (otherIllegal.length > 0 && expectedIllegal.length > 0 && JSON.stringify(otherIllegal) !== JSON.stringify(expectedIllegal)) {
      diffs.push({ severity: 'P1', kind: 'declaredIllegalAction', baseSide: sides[0], otherSide: sides[i], expected: expectedIllegal, actual: otherIllegal });
    }
    if (expectedIllegal.length === 0 && (base.error !== null || other.error !== null)) {
      diffs.push({ severity: 'P1', kind: 'unexpectedActionError', baseSide: sides[0], otherSide: sides[i], baseValue: base.error, otherValue: other.error });
    }
  }
  // Compare against scenario expectations
  if (scn.expected.finalState) {
    for (const side of sides) {
      const obs = observations[side]!;
      if (obs.finalState !== scn.expected.finalState) {
        diffs.push({ severity: 'P1', kind: 'expectedFinalState', side, expected: scn.expected.finalState, actual: obs.finalState });
      }
    }
  }
  const expectedPath = Array.isArray((scn as any).expected?.semanticPath) ? (scn as any).expected.semanticPath : [];
  if (expectedPath.length > 0) {
    for (const side of sides) {
      const actual = observations[side]!.semanticPath;
      if (JSON.stringify(actual) !== JSON.stringify(expectedPath)) {
        diffs.push({ severity: 'P1', kind: 'expectedSemanticPath', side, expected: expectedPath, actual });
      }
    }
  }
  void systemIds;
  return diffs;
}

function normalizeExpectedIllegal(scn: LoadedScenario): Array<{ actionIndex: number; errorCode: string }> {
  const expected = (scn as any).expected ?? {};
  if (Array.isArray(expected.illegalActions)) {
    return expected.illegalActions.map((x: any) => ({ actionIndex: Number(x.actionIndex), errorCode: String(x.errorCode) }));
  }
  if (expected.illegalActionIndex !== undefined && expected.illegalActionErrorCode) {
    return [{ actionIndex: Number(expected.illegalActionIndex), errorCode: String(expected.illegalActionErrorCode) }];
  }
  return [];
}

function normalizeActualIllegal(obs: DslScenarioObservation): Array<{ actionIndex: number; errorCode: string }> {
  return obs.actions
    .filter((a) => a.illegalTransition)
    .map((a) => ({
      actionIndex: Number(a.illegalTransition!.actionIndex),
      errorCode: String(a.illegalTransition!.errorCode),
    }));
}

function renderMarkdownReport(report: any, scenarios: LoadedScenario[]): string {
  const lines: string[] = [];
  lines.push(`# FlowTrace 双跑核查报告 — ${report.runId}`);
  lines.push('');
  lines.push('## 汇总'); lines.push('');
  lines.push('| 指标 | 值 |'); lines.push('| --- | --- |');
  lines.push(`| 运行ID | \`${report.runId}\` |`);
  lines.push(`| 项目 | \`${report.projectPath}\` |`);
  lines.push(`| 运行时 | \`${report.runtimeAdapter}\` |`);
  lines.push(`| 系统 | ${report.systems.map((s: string) => `\`${s}\``).join(', ')} |`);
  lines.push(`| 用例总数 | ${report.totalScenarios} |`);
  lines.push(`| 通过 | ${report.totalPassed} |`);
  lines.push(`| 失败 | ${report.totalFailed} |`);
  lines.push(`| 发布门禁 | **${report.releaseGate.allowed ? '通过' : '阻断'}** |`);
  lines.push('');
  lines.push('## 终态对比'); lines.push('');
  lines.push('| 用例 | 老系统 | 新系统 | 结果 |'); lines.push('| --- | --- | --- | --- |');
  for (const result of report.scenarios) {
    const observations = result.observations ?? {};
    const sides = report.systems.map((side: string) => observations[side]);
    lines.push(`| ${result.scenarioId} | ${formatVal(sides[0]?.finalState)} | ${formatVal(sides[1]?.finalState)} | ${result.passed ? '✅' : '❌'} |`);
  }
  lines.push('');
  lines.push('## 语义路径对比'); lines.push('');
  lines.push('| 用例 | 老系统路径 | 新系统路径 |'); lines.push('| --- | --- | --- |');
  for (const result of report.scenarios) {
    const observations = result.observations ?? {};
    lines.push(`| ${result.scenarioId} | ${formatVal(observations[report.systems[0]]?.semanticPath)} | ${formatVal(observations[report.systems[1]]?.semanticPath)} |`);
  }
  lines.push('');
  lines.push('## 非法转换对比（按声明的动作）'); lines.push('');
  lines.push('| 用例 | 期望 | 老系统 | 新系统 |'); lines.push('| --- | --- | --- | --- |');
  for (const result of report.scenarios) {
    const expected = scenarios.find((s) => s.id === result.scenarioId)?.expected as any;
    const observations = result.observations ?? {};
    lines.push(`| ${result.scenarioId} | ${formatVal(expected?.illegalActions ?? [])} | ${formatVal(observations[report.systems[0]]?.actions?.filter((a: any) => a.illegalTransition).map((a: any) => a.illegalTransition))} | ${formatVal(observations[report.systems[1]]?.actions?.filter((a: any) => a.illegalTransition).map((a: any) => a.illegalTransition))} |`);
  }
  lines.push('');
  lines.push('## 用例证据与核查详情'); lines.push('');
  for (const result of report.scenarios) {
    const scenario = scenarios.find((s) => s.id === result.scenarioId);
    lines.push(`### ${result.passed ? '✅' : '❌'} ${result.scenarioId}${scenario?.name ? ` — ${scenario.name}` : ''}`); lines.push('');
    lines.push(`- 结果：**${result.passed ? '通过' : '失败'}**`);
    if (result.error) lines.push(`- 错误：\`${result.error}\``);
    for (const side of report.systems) {
      const observation = result.observations?.[side];
      lines.push(`#### ${side === report.systems[0] ? '老系统' : '新系统'} 动作轨迹`); lines.push('');
      lines.push('| # | 角色 | 动作 | 状态 | 错误 | 证据 |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      for (const action of observation?.actions ?? []) {
        const evidence = (action.evidencePaths ?? []).map((p: string) => p.endsWith('.png')
          ? `[${p.split('/').pop()}](${p})<br><img src="${p}" alt="FlowTrace screenshot" width="180" height="120">`
          : `[${p.split('/').pop()}](${p})`).join('<br>') || '-';
        lines.push(`| ${action.index} | ${action.actor ?? '-'} | ${action.actionId} | ${action.status ?? '-'} | ${action.errorCode ?? '-'} | ${evidence} |`);
      }
      lines.push('');
    }
    lines.push(`#### 证据文件`); lines.push('');
    for (const side of report.systems) {
      for (const action of result.observations?.[side]?.actions ?? []) {
        for (const p of action.evidencePaths ?? []) lines.push(`- [${side}/${p.split('/').pop()}](${p})`);
      }
    }
    lines.push(`- 证据索引：[${result.scenarioId}.json](../scenarios/${result.scenarioId}.json)`); lines.push('');
  }
  if (report.differences.length > 0) {
    lines.push(`## 差异（${report.differences.length}）`);
    lines.push('');
    lines.push('| 用例 | 流程 | 严重级 | 类型 | 基线 | 对端 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const d of report.differences) {
      lines.push(`| ${d.scenarioId} | ${d.processId} | ${d.severity} | ${d.kind} | ${formatVal(d.baseValue ?? d.baseSide)} | ${formatVal(d.otherValue ?? d.otherSide)} |`);
    }
  }
  lines.push('## 执行汇总'); lines.push('');
  lines.push(`用例：**${report.totalPassed}/${report.totalScenarios} 通过**`); lines.push('');
  lines.push('## 发布门禁'); lines.push('');
  lines.push(`**状态：** ${report.releaseGate.allowed ? '✅ 允许' : '❌ 阻断'}`);
  return lines.join('\n');
}

function renderHtmlReport(report: any, scenarios: LoadedScenario[]): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>FlowTrace Report ' + report.runId + '</title>',
    '<style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:24px;max-width:1080px;}',
    'table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;}',
    '.PASS{color:#16a34a;font-weight:bold;} .BLOCKED{color:#dc2626;font-weight:bold;}',
    '</style></head><body>',
    '<h1>FlowTrace Dual-Run Report</h1>',
    '<p>Run ID: <code>' + report.runId + '</code></p>',
    '<p>Project: <code>' + report.projectPath + '</code></p>',
    '<p>Runtime: <code>' + report.runtimeAdapter + '</code></p>',
    '<p>Systems: ' + report.systems.map((s: string) => '<code>' + s + '</code>').join(', ') + '</p>',
    '<p>Scenarios: ' + report.totalPassed + '/' + report.totalScenarios + ' passed</p>',
    '<p>Release Gate: <span class="' + (report.releaseGate.allowed ? 'PASS' : 'BLOCKED') + '">' + (report.releaseGate.allowed ? 'PASS' : 'BLOCKED') + '</span></p>',
    '<h2>Summary</h2><table><tr><th>Metric</th><th>Value</th></tr><tr><td>Total Scenarios</td><td>' + report.totalScenarios + '</td></tr><tr><td>Passed</td><td>' + report.totalPassed + '</td></tr><tr><td>Failed</td><td>' + report.totalFailed + '</td></tr></table>',
    '<h2>Scenario evidence and inspection details</h2><table><tr><th>Scenario</th><th>Result</th><th>Legacy state</th><th>Current state</th></tr>',
    report.scenarios.map((r: any) => '<tr><td>' + r.scenarioId + '</td><td>' + (r.passed ? 'PASSED' : 'FAILED') + '</td><td>' + formatVal(r.observations?.[report.systems[0]]?.finalState) + '</td><td>' + formatVal(r.observations?.[report.systems[1]]?.finalState) + '</td></tr>').join(''),
    '</table><h2>Differences (' + report.differences.length + ')</h2>',
    report.differences.length > 0
      ? '<table><thead><tr><th>Scenario</th><th>Process</th><th>Severity</th><th>Kind</th><th>Base</th><th>Other</th></tr></thead><tbody>' +
        report.differences.map((d: any) =>
          '<tr><td>' + d.scenarioId + '</td><td>' + d.processId + '</td><td>' + d.severity + '</td><td>' + d.kind + '</td><td>' + formatVal(d.baseValue ?? d.baseSide) + '</td><td>' + formatVal(d.otherValue ?? d.otherSide) + '</td></tr>'
        ).join('') +
        '</tbody></table>'
      : '<p>No differences.</p>',
    '</body></html>',
  ].join('');
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '...' : v;
  return JSON.stringify(v);
}
