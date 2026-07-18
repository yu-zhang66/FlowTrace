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

interface BuiltinVerifyOptions {
  project?: string;
  output?: string;
}

const REQUIRED_PER_SIDE = 2;

export async function verifyBuiltinCommand(options: BuiltinVerifyOptions): Promise<void> {
  const projectPath = options.project
    ? path.resolve(process.cwd(), options.project)
    : path.resolve(process.cwd());

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

  const processesDir = path.join(flowtraceRoot, 'processes');
  const processes = await loadAllProcessDsls(processesDir);
  if (processes.length === 0) {
    console.error(chalk.red(`No process DSL found in ${processesDir}. Add processes/<id>.yaml before running verify.`));
    process.exit(1);
  }

  const scenariosDir = path.join(flowtraceRoot, 'scenarios');
  const allScenarios = await loadAllScenarios(scenariosDir);
  const scenarios = allScenarios.filter((s) => s.enabled !== false);
  if (scenarios.length === 0) {
    console.error(chalk.red('No scenarios found to verify.'));
    process.exit(1);
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

  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomId()}`;
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

  const systemIds = Object.keys(adapterSet.runtimes);
  if (systemIds.length < REQUIRED_PER_SIDE) {
    console.error(chalk.red(`Dual-run verify requires at least 2 systems; got ${systemIds.length}.`));
    process.exit(1);
  }

  const allDifferences: any[] = [];
  const scenarioResults: any[] = [];
  let totalScenarios = 0;
  let totalPassed = 0;

  for (const proc of processes) {
    const procScoped = byProcess[proc.process.id] ?? [];
    if (procScoped.length === 0) continue;
    const dsl = proc.process;
    console.log(chalk.blue(`\n[process] ${dsl.id} — ${procScoped.length} scenario(s)`));

    for (const scn of procScoped) {
      totalScenarios += 1;
      const observations: Record<string, DslScenarioObservation> = {};

      for (const side of systemIds) {
        const runtime = adapterSet.runtimes[side]!;
        runtime.setScenario(scn.id);
        const obs = await interpretScenario({ runtime, process: dsl }, {
          scenarioId: scn.id,
          defaultActor: scn.actions[0]?.actor,
          steps: scn.actions.map((a) => ({ action: a.action, actor: a.actor, data: a.data })),
          continueOnError: Array.isArray((scn as any).expected?.illegalActions)
            && (scn as any).expected.illegalActions.length > 1,
        });
        observations[side] = obs;
      }

      const differences = compareObservations(observations, scn, systemIds);
      allDifferences.push(...differences.map((d) => ({ ...d, scenarioId: scn.id, processId: dsl.id })));

      const passed = differences.filter((d) => d.severity === 'P0' || d.severity === 'P1').length === 0;
      if (passed) totalPassed += 1;
      scenarioResults.push({ scenarioId: scn.id, differences, passed, observations });

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
    }
  }

  // Build reports
  const releaseGate = allDifferences.filter((d) => d.severity === 'P0' || d.severity === 'P1').length === 0 && totalPassed === totalScenarios ? 'PASS' : 'BLOCKED';

  const jsonReport = {
    id: runId,
    projectId: String((rawConfig.project as any)?.id ?? path.basename(projectPath)),
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

  const html = renderHtmlReport(jsonReport, scenarios);
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
}

async function exists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 8);
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
  lines.push(`# FlowTrace Dual-Run Inspection Report — ${report.runId}`);
  lines.push('');
  lines.push('## Summary'); lines.push('');
  lines.push('| Metric | Value |'); lines.push('| --- | --- |');
  lines.push(`| Run ID | \`${report.runId}\` |`);
  lines.push(`| Project | \`${report.projectPath}\` |`);
  lines.push(`| Runtime | \`${report.runtimeAdapter}\` |`);
  lines.push(`| Systems | ${report.systems.map((s: string) => `\`${s}\``).join(', ')} |`);
  lines.push(`| Total Scenarios | ${report.totalScenarios} |`);
  lines.push(`| Passed | ${report.totalPassed} |`);
  lines.push(`| Failed | ${report.totalFailed} |`);
  lines.push(`| Release Gate | **${report.releaseGate.allowed ? 'PASS' : 'BLOCKED'}** |`);
  lines.push('');
  lines.push('## Final state comparison'); lines.push('');
  lines.push('| Scenario | Legacy | Current | Result |'); lines.push('| --- | --- | --- | --- |');
  for (const result of report.scenarios) {
    const observations = result.observations ?? {};
    const sides = report.systems.map((side: string) => observations[side]);
    lines.push(`| ${result.scenarioId} | ${formatVal(sides[0]?.finalState)} | ${formatVal(sides[1]?.finalState)} | ${result.passed ? '✅' : '❌'} |`);
  }
  lines.push('');
  lines.push('## Semantic path comparison'); lines.push('');
  lines.push('| Scenario | Legacy path | Current path |'); lines.push('| --- | --- | --- |');
  for (const result of report.scenarios) {
    const observations = result.observations ?? {};
    lines.push(`| ${result.scenarioId} | ${formatVal(observations[report.systems[0]]?.semanticPath)} | ${formatVal(observations[report.systems[1]]?.semanticPath)} |`);
  }
  lines.push('');
  lines.push('## Illegal transition comparison (per declared action)'); lines.push('');
  lines.push('| Scenario | Expected | Legacy | Current |'); lines.push('| --- | --- | --- | --- |');
  for (const result of report.scenarios) {
    const expected = scenarios.find((s) => s.id === result.scenarioId)?.expected as any;
    const observations = result.observations ?? {};
    lines.push(`| ${result.scenarioId} | ${formatVal(expected?.illegalActions ?? [])} | ${formatVal(observations[report.systems[0]]?.actions?.filter((a: any) => a.illegalTransition).map((a: any) => a.illegalTransition))} | ${formatVal(observations[report.systems[1]]?.actions?.filter((a: any) => a.illegalTransition).map((a: any) => a.illegalTransition))} |`);
  }
  lines.push('');
  lines.push('## Scenario evidence and inspection details'); lines.push('');
  for (const result of report.scenarios) {
    const scenario = scenarios.find((s) => s.id === result.scenarioId);
    lines.push(`### ${result.passed ? '✅' : '❌'} ${result.scenarioId}${scenario?.name ? ` — ${scenario.name}` : ''}`); lines.push('');
    lines.push(`- Result: **${result.passed ? 'PASSED' : 'FAILED'}**`);
    if (result.error) lines.push(`- Error: \`${result.error}\``);
    lines.push(`- Evidence index: [${result.scenarioId}.json](../scenarios/${result.scenarioId}.json)`); lines.push('');
  }
  if (report.differences.length > 0) {
    lines.push(`## Differences (${report.differences.length})`);
    lines.push('');
    lines.push('| Scenario | Process | Severity | Kind | Base | Other |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const d of report.differences) {
      lines.push(`| ${d.scenarioId} | ${d.processId} | ${d.severity} | ${d.kind} | ${formatVal(d.baseValue ?? d.baseSide)} | ${formatVal(d.otherValue ?? d.otherSide)} |`);
    }
  }
  lines.push('## Execution summary'); lines.push('');
  lines.push(`Scenarios: **${report.totalPassed}/${report.totalScenarios} passed**`); lines.push('');
  lines.push('## Release Gate'); lines.push('');
  lines.push(`**Status:** ${report.releaseGate.allowed ? '✅ ALLOWED' : '❌ BLOCKED'}`);
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
