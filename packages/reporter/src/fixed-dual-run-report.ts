import { existsSync, readFileSync } from 'node:fs';

export interface FixedReportAction {
  actionId: string;
  index: number;
  actor?: string;
  status?: number | null;
  errorCode?: string | null;
  stateBefore?: string | null;
  stateAfter?: string | null;
  evidencePaths?: string[];
  illegalTransition?: { actionIndex: number; errorCode: string } | null;
}

export interface FixedReportObservation {
  finalState?: string | null;
  semanticPath?: string[];
  actions?: FixedReportAction[];
}

export interface FixedReportScenarioDefinition {
  id: string;
  name?: string;
  severity?: string;
  category?: string;
  tags?: string[];
  expected?: {
    finalState?: string | null;
    semanticPath?: string[];
    illegalActions?: Array<{ actionIndex: number; errorCode: string }>;
  };
}

export interface FixedReportExecutionDetail {
  scenarioId: string;
  processId?: string;
  passed: boolean;
  observations: Record<string, FixedReportObservation>;
  differences?: unknown[];
  startedAt?: string;
}

export interface FixedDualRunReport {
  runId: string;
  projectId?: string;
  projectName?: string;
  projectPath?: string;
  processId?: string;
  runtimeAdapter?: string;
  systems: string[];
  totalScenarios: number;
  totalPassed: number;
  totalFailed: number;
  generatedAt: string;
  timestamp?: string;
  releaseGate: { allowed: boolean; blockedBy?: string[] } | 'PASS' | 'BLOCKED';
  executionDetails: Record<string, FixedReportExecutionDetail> | FixedReportExecutionDetail[];
}

const FIXED_REPORT_CSS = `body{font-family:-apple-system,system-ui,"Helvetica Neue",Arial,sans-serif;background:#fafafa;color:#222;margin:0;padding:24px}main{max-width:1500px;margin:0 auto}h1{margin-top:0}.summary{display:flex;gap:16px;flex-wrap:wrap}.card{background:#fff;border:1px solid #e1e1e1;border-radius:6px;padding:16px 20px;min-width:140px}.label{color:#888;font-size:12px;text-transform:uppercase}.value{font-size:24px;font-weight:600;margin-top:4px}.gate-pass{background:#e6f7ec;color:#0f7b3a}.gate-fail{background:#fdecea;color:#b71c1c}.section,.case{background:#fff;border:1px solid #e1e1e1;border-radius:6px;padding:18px 20px;margin-top:18px}.case.pass{border-left:4px solid #0f7b3a}.case.fail{border-left:4px solid #b71c1c}.case h2 span{font-weight:400;color:#555;font-size:16px}.pills{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.pill{display:inline-block;padding:2px 8px;border-radius:10px;background:#eee;font-size:12px}.pill.P0{background:#fdecea;color:#b71c1c}.pill.P1{background:#fff4e5;color:#b65a00}.pill.P2{background:#e7f3ff;color:#1565c0}.ok{color:#0f7b3a;font-weight:600}.bad{color:#b71c1c;font-weight:600}.muted{color:#999}table{width:100%;border-collapse:collapse;margin-top:12px;background:#fff}th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;font-size:13px;vertical-align:top}th{background:#f3f3f3}.case-systems{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:14px 0}.system{background:#fafafa;border:1px solid #e5e7eb;border-radius:6px;padding:14px;min-width:0}.system h4{margin:0 0 8px;text-transform:uppercase;font-size:13px}.steps{overflow-x:auto}.action-pill{display:inline-block;padding:2px 6px;border-radius:4px;background:#eef2ff;color:#3730a3;font-size:11px}.shots-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:12px 0}.shot{margin:0}.shot img{display:block;width:100%;max-height:220px;object-fit:contain;object-position:top;margin-top:6px;border:1px solid #d1d5db;border-radius:4px;background:#fff}.evidence-screenshot{display:block;width:180px;height:120px;object-fit:contain;object-position:top;border:1px solid #d1d5db;border-radius:4px;background:#f8fafc;margin-top:4px}code{background:#f5f5f5;padding:2px 4px;border-radius:3px;font-size:12px}a{color:#2563eb;word-break:break-all}@media(max-width:820px){.case-systems{grid-template-columns:1fr}}footer{text-align:center;color:#888;margin:30px}@media print{.case{break-inside:avoid}}`;

export function renderFixedDualRunHtml(report: FixedDualRunReport, definitions: FixedReportScenarioDefinition[] = []): string {
  const details = Array.isArray(report.executionDetails)
    ? report.executionDetails
    : Object.values(report.executionDetails);
  const systems = report.systems.slice(0, 2);
  const legacyId = systems[0] ?? 'legacy';
  const currentId = systems[1] ?? 'current';
  const gateAllowed = typeof report.releaseGate === 'string'
    ? report.releaseGate === 'PASS'
    : report.releaseGate.allowed;
  const passRate = report.totalScenarios > 0 ? ((report.totalPassed / report.totalScenarios) * 100).toFixed(1) : '0.0';
  const startedAt = report.timestamp ?? details.map(item => item.startedAt).find(Boolean) ?? report.generatedAt;

  const definitionFor = (id: string) => definitions.find(item => item.id === id);
  const observation = (detail: FixedReportExecutionDetail, side: string): FixedReportObservation => detail.observations[side] ?? { actions: [], semanticPath: [] };
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const ok = (value: boolean) => `<span class="${value ? 'ok' : 'bad'}">${value ? '✅' : '❌'}</span>`;
  const dash = '<span class="muted">—</span>';
  const expectedIllegal = (definition?: FixedReportScenarioDefinition) => definition?.expected?.illegalActions ?? [];
  const actualIllegal = (obs: FixedReportObservation) => (obs.actions ?? []).filter(action => action.illegalTransition).map(action => ({ actionIndex: action.index, errorCode: action.errorCode ?? action.illegalTransition?.errorCode ?? '' }));
  const illegalText = (items: Array<{ actionIndex: number; errorCode: string }>) => items.length ? items.map(item => `#${item.actionIndex}/${item.errorCode}`).join(', ') : '—';

  const summaryRows = details.map(detail => {
    const definition = definitionFor(detail.scenarioId);
    const legacy = observation(detail, legacyId);
    const current = observation(detail, currentId);
    const declared = expectedIllegal(definition);
    const illegalMatch = declared.length === 0 ? dash : ok(same(declared, actualIllegal(legacy)) && same(declared, actualIllegal(current)));
    return `<tr><td>${escapeHtml(detail.scenarioId)}${definition?.name ? ` (${escapeHtml(definition.name)})` : ''}</td><td>${escapeHtml(definition?.severity ?? 'P2')}</td><td>${ok(same(legacy.finalState, current.finalState))}</td><td>${ok(same(legacy.semanticPath ?? [], current.semanticPath ?? []))}</td><td>${illegalMatch}</td><td>${ok(true)}</td><td>${ok(detail.passed)}</td></tr>`;
  }).join('');

  const finalRows = details.map(detail => {
    const definition = definitionFor(detail.scenarioId);
    const legacy = observation(detail, legacyId);
    const current = observation(detail, currentId);
    return `<tr><td>${escapeHtml(detail.scenarioId)}</td><td>${escapeHtml(definition?.expected?.finalState ?? '-')}</td><td>${escapeHtml(legacy.finalState ?? '-')}</td><td>${escapeHtml(current.finalState ?? '-')}</td><td>${ok(same(legacy.finalState, current.finalState))}</td></tr>`;
  }).join('');

  const semanticRows = details.map(detail => {
    const definition = definitionFor(detail.scenarioId);
    const legacy = observation(detail, legacyId);
    const current = observation(detail, currentId);
    return `<tr><td>${escapeHtml(detail.scenarioId)}</td><td><code>${escapeHtml(JSON.stringify(definition?.expected?.semanticPath ?? []))}</code></td><td><code>${escapeHtml(JSON.stringify(legacy.semanticPath ?? []))}</code></td><td><code>${escapeHtml(JSON.stringify(current.semanticPath ?? []))}</code></td><td>${ok(same(legacy.semanticPath ?? [], current.semanticPath ?? []))}</td></tr>`;
  }).join('');

  const illegalRows = details.map(detail => {
    const definition = definitionFor(detail.scenarioId);
    const declared = expectedIllegal(definition);
    const legacy = actualIllegal(observation(detail, legacyId));
    const current = actualIllegal(observation(detail, currentId));
    const consistent = declared.length === 0 ? dash : ok(same(declared, legacy) && same(declared, current));
    return `<tr><td>${escapeHtml(detail.scenarioId)}</td><td>${escapeHtml(illegalText(declared))}</td><td>${escapeHtml(illegalText(legacy))}</td><td>${escapeHtml(illegalText(current))}</td><td>${consistent}</td></tr>`;
  }).join('');

  const cases = details.map(detail => {
    const definition = definitionFor(detail.scenarioId);
    const legacy = observation(detail, legacyId);
    const current = observation(detail, currentId);
    const pills = [definition?.severity ?? 'P2', definition?.category, ...(definition?.tags ?? [])].filter(Boolean).map(value => `<span class="pill ${escapeHtml(value)}">${escapeHtml(value)}</span>`).join('');
    return `<section class="case ${detail.passed ? 'pass' : 'fail'}"><h2>${detail.passed ? '✅' : '❌'} ${escapeHtml(detail.scenarioId)} <span>${escapeHtml(definition?.name ?? '')}</span></h2><div class="pills">${pills}<b class="${detail.passed ? 'ok' : 'bad'}">${detail.passed ? 'PASS' : 'FAIL'}</b></div><p><b>Expected finalState:</b> ${escapeHtml(definition?.expected?.finalState ?? '-')} &nbsp; <b>Expected semanticPath:</b> <code>${escapeHtml(JSON.stringify(definition?.expected?.semanticPath ?? []))}</code></p><div class="case-systems">${renderSystem('Legacy', legacy)}${renderSystem('Current', current)}</div><h3>Illegal transition comparison</h3><table><thead><tr><th>Declared</th><th>Legacy</th><th>Current</th><th>Consistent</th></tr></thead><tbody><tr><td>${escapeHtml(illegalText(expectedIllegal(definition)))}</td><td>${escapeHtml(illegalText(actualIllegal(legacy)))}</td><td>${escapeHtml(illegalText(actualIllegal(current)))}</td><td>${expectedIllegal(definition).length ? ok(same(expectedIllegal(definition), actualIllegal(legacy)) && same(expectedIllegal(definition), actualIllegal(current))) : dash}</td></tr></tbody></table>${renderEvidenceList(legacy, current)}</section>`;
  }).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlowTrace Dual-Run Inspection Report — ${escapeHtml(report.runId)}</title><style>${FIXED_REPORT_CSS}</style></head><body><main><h1>FlowTrace Dual-Run Inspection Report</h1><p><code>${escapeHtml(report.runId)}</code> · started at ${escapeHtml(startedAt)} · finished at ${escapeHtml(report.generatedAt)}</p><div class="summary"><div class="card"><div class="label">Total</div><div class="value">${report.totalScenarios}</div></div><div class="card"><div class="label">Passed</div><div class="value ok">${report.totalPassed}</div></div><div class="card"><div class="label">Failed</div><div class="value bad">${report.totalFailed}</div></div><div class="card"><div class="label">Pass rate</div><div class="value">${passRate}%</div></div><div class="card ${gateAllowed ? 'gate-pass' : 'gate-fail'}"><div class="label">Release gate</div><div class="value">${gateAllowed ? 'PASS' : 'BLOCKED'}</div></div></div><section class="section"><h2>Project information</h2><table><tr><th>Project</th><td>${escapeHtml(report.projectName ?? report.projectId ?? report.projectPath ?? '-')}</td></tr><tr><th>Process</th><td>${escapeHtml(report.processId ?? details[0]?.processId ?? '-')}</td></tr><tr><th>Runtime</th><td>${escapeHtml(report.runtimeAdapter ?? 'builtin')}</td></tr><tr><th>Systems</th><td>${escapeHtml(report.systems.join(', '))}</td></tr></table></section><section class="section"><h2>Summary table</h2><table><thead><tr><th>Scenario</th><th>Severity</th><th>final ok</th><th>semantic ok</th><th>illegal ok</th><th>undeclared ok</th><th>Pass</th></tr></thead><tbody>${summaryRows}</tbody></table></section><section class="section"><h2>Final state comparison</h2><table><thead><tr><th>Scenario</th><th>Expected</th><th>Legacy</th><th>Current</th><th>Legacy vs Current</th></tr></thead><tbody>${finalRows}</tbody></table></section><section class="section"><h2>Semantic path comparison</h2><table><thead><tr><th>Scenario</th><th>Expected</th><th>Legacy</th><th>Current</th><th>Legacy vs Current</th></tr></thead><tbody>${semanticRows}</tbody></table></section><section class="section"><h2>Illegal transition comparison</h2><table><thead><tr><th>Scenario</th><th>Declared</th><th>Legacy</th><th>Current</th><th>Both consistent</th></tr></thead><tbody>${illegalRows}</tbody></table></section><h2>Scenario evidence and inspection details</h2>${cases}</main><footer>Generated by FlowTrace · ${escapeHtml(report.generatedAt)}</footer></body></html>`;
}

function renderSystem(label: string, observation: FixedReportObservation): string {
  const actions = observation.actions ?? [];
  const shots = actions.flatMap(action => (action.evidencePaths ?? []).filter(path => path.endsWith('.png')).map(path => `<figure class="shot"><figcaption><b>${escapeHtml(label)} #${action.index} ${escapeHtml(action.actionId)}</b></figcaption><img src="${imageSource(path)}" alt="${escapeHtml(label)} #${action.index} ${escapeHtml(action.actionId)}"></figure>`)).join('');
  const rows = actions.map(action => `<tr><td>${action.index}</td><td>${escapeHtml(action.actor ?? '-')}</td><td><span class="action-pill">${escapeHtml(action.actionId)}</span></td><td>${escapeHtml(action.stateBefore ?? '-')} → ${escapeHtml(action.stateAfter ?? '-')}</td><td>${escapeHtml(action.status ?? '-')}</td><td>${escapeHtml(action.errorCode ?? '-')}</td><td>${renderEvidence(action.evidencePaths ?? [])}</td></tr>`).join('');
  return `<div class="system"><h4>${escapeHtml(label)} system</h4><div><b>Final state:</b> ${escapeHtml(observation.finalState ?? '-')}</div><div><b>Semantic path:</b> <code>${escapeHtml(JSON.stringify(observation.semanticPath ?? []))}</code></div><div class="shots-grid">${shots}</div><div class="steps"><table><thead><tr><th>Step</th><th>Actor</th><th>Action</th><th>State change</th><th>HTTP</th><th>Error</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderEvidence(paths: string[]): string {
  return paths.map(path => path.endsWith('.png')
    ? `<a href="${escapeHtml(path)}" target="_blank"><img class="evidence-screenshot" src="${imageSource(path)}" alt="FlowTrace screenshot"></a>`
    : `<a href="${escapeHtml(path)}" target="_blank"><code>${escapeHtml(path.split('/').pop() ?? path)}</code></a>`).join('<br>');
}

function imageSource(path: string): string {
  if (!existsSync(path)) return escapeHtml(path);
  try {
    return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
  } catch {
    return escapeHtml(path);
  }
}

function renderEvidenceList(...observations: FixedReportObservation[]): string {
  const paths = observations.flatMap(observation => (observation.actions ?? []).flatMap(action => action.evidencePaths ?? []));
  return `<h3>Evidence files</h3><ul>${paths.map(path => `<li><a href="${escapeHtml(path)}" target="_blank">${escapeHtml(path)}</a></li>`).join('')}</ul>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
