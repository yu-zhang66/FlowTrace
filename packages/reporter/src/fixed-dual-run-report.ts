import { existsSync, readFileSync } from 'node:fs';

export interface FixedReportAction {
  actionId: string;
  index: number;
  actor?: string;
  status?: number | null;
  errorCode?: string | null;
  message?: string | null;
  stateBefore?: string | null;
  stateAfter?: string | null;
  evidencePaths?: string[];
  illegalTransition?: { actionIndex: number; errorCode: string } | null;
}

export interface FixedReportObservation {
  finalState?: string | null;
  semanticPath?: string[];
  actions?: FixedReportAction[];
  captures?: Record<string, unknown>;
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

const FIXED_REPORT_CSS = `
body{font-family:-apple-system,system-ui,"Helvetica Neue",Arial,sans-serif;background:#f5f5f7;color:#1d1d1f;margin:0;padding:24px}
main{max-width:1500px;margin:0 auto}h1{margin-top:0;font-size:26px}.summary{display:flex;gap:14px;flex-wrap:wrap;margin-top:16px}
.card{background:#fff;border:1px solid #d1d1d6;border-radius:10px;padding:14px 18px;min-width:120px;box-shadow:0 1px 2px rgba(0,0,0,.04)}.label{color:#6e6e73;font-size:11px;text-transform:uppercase;letter-spacing:.3px}.value{font-size:22px;font-weight:600;margin-top:4px}.gate-pass{background:#e8f5e9;color:#1b5e20;border-color:#a5d6a7}.gate-fail{background:#ffebee;color:#b71c1c;border-color:#ef9a9a}
.section,.case{background:#fff;border:1px solid #d1d1d6;border-radius:10px;padding:18px 20px;margin-top:18px;box-shadow:0 1px 2px rgba(0,0,0,.04)}.case.pass{border-left:4px solid #2e7d32}.case.fail{border-left:4px solid #c62828}.case h2 span{font-weight:400;color:#555;font-size:16px}.pills{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:10px 0}.pill{display:inline-block;padding:2px 8px;border-radius:10px;background:#f0f0f5;font-size:12px}.pill.P0{background:#ffebee;color:#b71c1c}.pill.P1{background:#fff3e0;color:#b65a00}.pill.P2{background:#e3f2fd;color:#1565c0}.ok{color:#2e7d32;font-weight:600}.bad{color:#c62828;font-weight:600}.muted{color:#6e6e73}
table{width:100%;border-collapse:collapse;margin-top:12px;background:#fff;border-radius:8px;overflow:hidden}th,td{padding:8px 10px;border-bottom:1px solid #e5e5ea;text-align:left;font-size:13px;vertical-align:top}th{background:#f7f7f9;font-weight:600}
.case-systems{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:14px 0}.case-systems.single{grid-template-columns:1fr}.system{background:#fafafa;border:1px solid #e5e7eb;border-radius:8px;padding:14px;min-width:0}.system h4{margin:0 0 8px;text-transform:uppercase;font-size:13px;color:#333}.steps{overflow-x:auto}.action-pill{display:inline-block;padding:2px 6px;border-radius:4px;background:#eef2ff;color:#3730a3;font-size:11px}
.shots-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:12px 0}.shot{margin:0;cursor:pointer;border-radius:6px;overflow:hidden;border:1px solid #d1d1d6;background:#fff;transition:transform .15s,box-shadow .15s}.shot:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.1)}.shot img{display:block;width:100%;height:150px;object-fit:cover;object-position:top}.shot figcaption{padding:6px 8px;font-size:11px;color:#555;background:#f7f7f9;border-top:1px solid #e5e5ea;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.evidence-screenshot{display:block;width:180px;height:120px;object-fit:cover;object-position:top;border:1px solid #d1d1d6;border-radius:6px;background:#f8fafc;margin-top:4px;cursor:pointer;transition:transform .15s}.evidence-screenshot:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.1)}
code{background:#f4f4f6;padding:2px 5px;border-radius:4px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}a{color:#2563eb;word-break:break-all}
.evidence-item{display:flex;align-items:center;gap:6px;margin:3px 0}.evidence-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;background:#f4f4f6;font-size:11px;color:#333;cursor:pointer;border:1px solid #e5e5ea}.evidence-badge:hover{background:#e8e8ed}.evidence-badge.json{color:#1565c0;background:#e3f2fd;border-color:#bbdefb}.evidence-badge img{display:none}
.json-panel{display:none;background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;margin-top:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;max-height:400px;overflow:auto}.json-panel.open{display:block}
footer{text-align:center;color:#888;margin:30px;font-size:13px}
@media(max-width:820px){.case-systems{grid-template-columns:1fr}}
@media print{.case{break-inside:avoid}}

/* Lightbox */
#ft-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:99999;display:none;flex-direction:column}.ft-lightbox-toolbar{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;color:#fff}.ft-lightbox-title{font-size:14px;opacity:.9}.ft-lightbox-btns{display:flex;gap:8px}.ft-lightbox-btns button{background:rgba(255,255,255,.15);border:none;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px}.ft-lightbox-btns button:hover{background:rgba(255,255,255,.25)}.ft-lightbox-main{flex:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}.ft-lightbox-img{max-width:92vw;max-height:82vh;object-fit:contain;border-radius:4px;box-shadow:0 8px 40px rgba(0,0,0,.4)}.ft-lightbox-nav{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.12);border:none;color:#fff;width:44px;height:80px;border-radius:8px;cursor:pointer;font-size:22px;display:flex;align-items:center;justify-content:center}.ft-lightbox-nav:hover{background:rgba(255,255,255,.25)}.ft-lightbox-prev{left:16px}.ft-lightbox-next{right:16px}.ft-lightbox-counter{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,.5);padding:4px 12px;border-radius:12px;font-size:12px}
`;

const LIGHTBOX_JS = `
(function(){
  const box=document.getElementById('ft-lightbox');
  const img=box.querySelector('.ft-lightbox-img');
  const title=box.querySelector('.ft-lightbox-title');
  const counter=box.querySelector('.ft-lightbox-counter');
  let list=[], idx=0;
  function update(){ img.src=list[idx].src; title.textContent=list[idx].title; counter.textContent=(idx+1)+' / '+list.length; }
  function show(){ box.style.display='flex'; document.body.style.overflow='hidden'; }
  function hide(){ box.style.display='none'; document.body.style.overflow=''; }
  document.querySelectorAll('[data-lightbox]').forEach(el=>{
    el.addEventListener('click',e=>{
      const all=Array.from(document.querySelectorAll('[data-lightbox]'));
      list=all.map(a=>({src:a.getAttribute('data-lightbox'),title:a.getAttribute('data-lightbox-title')||''}));
      idx=all.indexOf(el); update(); show();
    });
  });
  box.querySelector('.ft-lightbox-close').addEventListener('click',hide);
  box.querySelector('.ft-lightbox-prev').addEventListener('click',()=>{ idx=(idx-1+list.length)%list.length; update(); });
  box.querySelector('.ft-lightbox-next').addEventListener('click',()=>{ idx=(idx+1)%list.length; update(); });
  document.addEventListener('keydown',e=>{
    if(box.style.display==='none')return;
    if(e.key==='Escape')hide();
    if(e.key==='ArrowLeft'){ idx=(idx-1+list.length)%list.length; update(); }
    if(e.key==='ArrowRight'){ idx=(idx+1)%list.length; update(); }
  });
  box.addEventListener('click',e=>{ if(e.target===box||e.target===box.querySelector('.ft-lightbox-main'))hide(); });
})();
(function(){
  document.querySelectorAll('.evidence-toggle').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const panel=document.getElementById(btn.getAttribute('data-target'));
      const open=!panel.classList.contains('open');
      panel.classList.toggle('open',open);
      btn.textContent=open?'收起 JSON':'查看 JSON';
    });
  });
})();
`;

export function renderFixedDualRunHtml(report: FixedDualRunReport, definitions: FixedReportScenarioDefinition[] = []): string {
  const details = Array.isArray(report.executionDetails)
    ? report.executionDetails
    : Object.values(report.executionDetails);
  const systems = report.systems.slice(0, 2);
  const isSingleSystem = systems.length === 1;
  const legacyId = systems[0] ?? 'legacy';
  const currentId = systems[1] ?? 'current';
  const gateAllowed = typeof report.releaseGate === 'string'
    ? report.releaseGate === 'PASS'
    : report.releaseGate.allowed;
  const passRate = report.totalScenarios > 0 ? ((report.totalPassed / report.totalScenarios) * 100).toFixed(1) : '0.0';
  const startedAt = report.timestamp ?? details.map(item => item.startedAt).find(Boolean) ?? report.generatedAt;
  const reportTitle = isSingleSystem ? 'FlowTrace 单边核查报告' : 'FlowTrace 双跑核查报告';

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
    if (isSingleSystem) {
      const obs = observation(detail, systems[0]!);
      return `<tr><td>${escapeHtml(detail.scenarioId)}${definition?.name ? ` (${escapeHtml(definition.name)})` : ''}</td><td>${escapeHtml(definition?.severity ?? 'P2')}</td><td>${escapeHtml(obs.finalState ?? '-')}</td><td>${ok(detail.passed)}</td></tr>`;
    }
    return `<tr><td>${escapeHtml(detail.scenarioId)}${definition?.name ? ` (${escapeHtml(definition.name)})` : ''}</td><td>${escapeHtml(definition?.severity ?? 'P2')}</td><td>${ok(same(legacy.finalState, current.finalState))}</td><td>${ok(same(legacy.semanticPath ?? [], current.semanticPath ?? []))}</td><td>${illegalMatch}</td><td>${ok(true)}</td><td>${ok(detail.passed)}</td></tr>`;
  }).join('');

  const summaryTableHeader = isSingleSystem
    ? '<thead><tr><th>用例</th><th>严重级</th><th>终态</th><th>通过</th></tr></thead>'
    : '<thead><tr><th>用例</th><th>严重级</th><th>终态一致</th><th>语义一致</th><th>非法转换一致</th><th>未声明一致</th><th>通过</th></tr></thead>';

  const finalRows = isSingleSystem
    ? details.map(detail => {
        const definition = definitionFor(detail.scenarioId);
        const obs = observation(detail, systems[0]!);
        return `<tr><td>${escapeHtml(detail.scenarioId)}</td><td>${escapeHtml(definition?.expected?.finalState ?? '-')}</td><td>${escapeHtml(obs.finalState ?? '-')}</td><td>${ok(obs.finalState === definition?.expected?.finalState)}</td></tr>`;
      }).join('')
    : details.map(detail => {
        const definition = definitionFor(detail.scenarioId);
        const legacy = observation(detail, legacyId);
        const current = observation(detail, currentId);
        return `<tr><td>${escapeHtml(detail.scenarioId)}</td><td>${escapeHtml(definition?.expected?.finalState ?? '-')}</td><td>${escapeHtml(legacy.finalState ?? '-')}</td><td>${escapeHtml(current.finalState ?? '-')}</td><td>${ok(same(legacy.finalState, current.finalState))}</td></tr>`;
      }).join('');

  const finalTableHeader = isSingleSystem
    ? '<thead><tr><th>用例</th><th>期望终态</th><th>实际终态</th><th>符合</th></tr></thead>'
    : '<thead><tr><th>用例</th><th>期望</th><th>老系统</th><th>新系统</th><th>老 vs 新</th></tr></thead>';

  const semanticRows = isSingleSystem
    ? details.map(detail => {
        const definition = definitionFor(detail.scenarioId);
        const obs = observation(detail, systems[0]!);
        return `<tr><td>${escapeHtml(detail.scenarioId)}</td><td><code>${escapeHtml(JSON.stringify(definition?.expected?.semanticPath ?? []))}</code></td><td><code>${escapeHtml(JSON.stringify(obs.semanticPath ?? []))}</code></td><td>${ok(same(definition?.expected?.semanticPath ?? [], obs.semanticPath ?? []))}</td></tr>`;
      }).join('')
    : details.map(detail => {
        const definition = definitionFor(detail.scenarioId);
        const legacy = observation(detail, legacyId);
        const current = observation(detail, currentId);
        return `<tr><td>${escapeHtml(detail.scenarioId)}</td><td><code>${escapeHtml(JSON.stringify(definition?.expected?.semanticPath ?? []))}</code></td><td><code>${escapeHtml(JSON.stringify(legacy.semanticPath ?? []))}</code></td><td><code>${escapeHtml(JSON.stringify(current.semanticPath ?? []))}</code></td><td>${ok(same(legacy.semanticPath ?? [], current.semanticPath ?? []))}</td></tr>`;
      }).join('');

  const semanticTableHeader = isSingleSystem
    ? '<thead><tr><th>用例</th><th>期望语义路径</th><th>实际语义路径</th><th>符合</th></tr></thead>'
    : '<thead><tr><th>用例</th><th>期望</th><th>老系统</th><th>新系统</th><th>老 vs 新</th></tr></thead>';

  const illegalRows = isSingleSystem
    ? details.map(detail => {
        const definition = definitionFor(detail.scenarioId);
        const declared = expectedIllegal(definition);
        const actual = actualIllegal(observation(detail, systems[0]!));
        return `<tr><td>${escapeHtml(detail.scenarioId)}</td><td>${escapeHtml(illegalText(declared))}</td><td>${escapeHtml(illegalText(actual))}</td><td>${ok(same(declared, actual))}</td></tr>`;
      }).join('')
    : details.map(detail => {
        const definition = definitionFor(detail.scenarioId);
        const declared = expectedIllegal(definition);
        const legacy = actualIllegal(observation(detail, legacyId));
        const current = actualIllegal(observation(detail, currentId));
        const consistent = declared.length === 0 ? dash : ok(same(declared, legacy) && same(declared, current));
        return `<tr><td>${escapeHtml(detail.scenarioId)}</td><td>${escapeHtml(illegalText(declared))}</td><td>${escapeHtml(illegalText(legacy))}</td><td>${escapeHtml(illegalText(current))}</td><td>${consistent}</td></tr>`;
      }).join('');

  const illegalTableHeader = isSingleSystem
    ? '<thead><tr><th>用例</th><th>声明非法转换</th><th>实际非法转换</th><th>符合</th></tr></thead>'
    : '<thead><tr><th>用例</th><th>声明</th><th>老系统</th><th>新系统</th><th>两侧一致</th></tr></thead>';

  const cases = details.map(detail => {
    const definition = definitionFor(detail.scenarioId);
    const legacy = observation(detail, legacyId);
    const current = observation(detail, currentId);
    const pills = [definition?.severity ?? 'P2', definition?.category, ...(definition?.tags ?? [])].filter(Boolean).map(value => `<span class="pill ${escapeHtml(value)}">${escapeHtml(value)}</span>`).join('');
    const systemsHtml = isSingleSystem
      ? renderSystem('执行系统', systems[0]!, observation(detail, systems[0]!))
      : `${renderSystem('老系统', legacyId, legacy)}${renderSystem('新系统', currentId, current)}`;
    const illegalCompareHtml = isSingleSystem
      ? `<table><thead><tr><th>声明</th><th>实际</th><th>符合</th></tr></thead><tbody><tr><td>${escapeHtml(illegalText(expectedIllegal(definition)))}</td><td>${escapeHtml(illegalText(actualIllegal(observation(detail, systems[0]!))))}</td><td>${expectedIllegal(definition).length ? ok(same(expectedIllegal(definition), actualIllegal(observation(detail, systems[0]!)))) : dash}</td></tr></tbody></table>`
      : `<table><thead><tr><th>声明</th><th>老系统</th><th>新系统</th><th>一致</th></tr></thead><tbody><tr><td>${escapeHtml(illegalText(expectedIllegal(definition)))}</td><td>${escapeHtml(illegalText(actualIllegal(legacy)))}</td><td>${escapeHtml(illegalText(actualIllegal(current)))}</td><td>${expectedIllegal(definition).length ? ok(same(expectedIllegal(definition), actualIllegal(legacy)) && same(expectedIllegal(definition), actualIllegal(current))) : dash}</td></tr></tbody></table>`;
    const capturesHtml = renderCaptures(isSingleSystem ? observation(detail, systems[0]!) : undefined, legacy, current);
    return `<section class="case ${detail.passed ? 'pass' : 'fail'}"><h2>${detail.passed ? '✅' : '❌'} ${escapeHtml(detail.scenarioId)} <span>${escapeHtml(definition?.name ?? '')}</span></h2><div class="pills">${pills}<b class="${detail.passed ? 'ok' : 'bad'}">${detail.passed ? '通过' : '失败'}</b></div><p><b>期望终态：</b> ${escapeHtml(definition?.expected?.finalState ?? '-')} &nbsp; <b>期望语义路径：</b> <code>${escapeHtml(JSON.stringify(definition?.expected?.semanticPath ?? []))}</code></p>${capturesHtml}<div class="case-systems ${isSingleSystem ? 'single' : ''}">${systemsHtml}</div><h3>非法转换对比</h3>${illegalCompareHtml}${renderEvidenceList(detail, systems)}</section>`;
  }).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${reportTitle} — ${escapeHtml(report.runId)}</title><style>${FIXED_REPORT_CSS}</style></head><body><main><h1>${reportTitle}</h1><p><code>${escapeHtml(report.runId)}</code> · 开始于 ${escapeHtml(startedAt)} · 结束于 ${escapeHtml(report.generatedAt)}</p><div class="summary"><div class="card"><div class="label">用例总数</div><div class="value">${report.totalScenarios}</div></div><div class="card"><div class="label">通过</div><div class="value ok">${report.totalPassed}</div></div><div class="card"><div class="label">失败</div><div class="value bad">${report.totalFailed}</div></div><div class="card"><div class="label">通过率</div><div class="value">${passRate}%</div></div><div class="card ${gateAllowed ? 'gate-pass' : 'gate-fail'}"><div class="label">发布门禁</div><div class="value">${gateAllowed ? '通过' : '阻断'}</div></div></div><section class="section"><h2>项目信息</h2><table><tr><th>项目</th><td>${escapeHtml(report.projectName ?? report.projectId ?? report.projectPath ?? '-')}</td></tr><tr><th>流程</th><td>${escapeHtml(report.processId ?? details[0]?.processId ?? '-')}</td></tr><tr><th>运行时</th><td>${escapeHtml(report.runtimeAdapter ?? 'builtin')}</td></tr><tr><th>系统</th><td>${escapeHtml(report.systems.join(', '))}</td></tr></table></section><section class="section"><h2>汇总表</h2><table>${summaryTableHeader}<tbody>${summaryRows}</tbody></table></section><section class="section"><h2>终态对比</h2><table>${finalTableHeader}<tbody>${finalRows}</tbody></table></section><section class="section"><h2>语义路径对比</h2><table>${semanticTableHeader}<tbody>${semanticRows}</tbody></table></section><section class="section"><h2>非法转换对比</h2><table>${illegalTableHeader}<tbody>${illegalRows}</tbody></table></section><h2>用例证据与核查详情</h2>${cases}</main><footer>由 FlowTrace 生成 · ${escapeHtml(report.generatedAt)}</footer>
<div id="ft-lightbox"><div class="ft-lightbox-toolbar"><span class="ft-lightbox-title"></span><div class="ft-lightbox-btns"><button class="ft-lightbox-prev">← 上一张</button><button class="ft-lightbox-next">下一张 →</button><button class="ft-lightbox-close">关闭</button></div></div><div class="ft-lightbox-main"><button class="ft-lightbox-nav ft-lightbox-prev">‹</button><img class="ft-lightbox-img" src="" alt=""><button class="ft-lightbox-nav ft-lightbox-next">›</button><span class="ft-lightbox-counter"></span></div></div>
<script>${LIGHTBOX_JS}</script></body></html>`;
}

function renderSystem(label: string, systemId: string, observation: FixedReportObservation): string {
  const actions = observation.actions ?? [];
  const allPngPaths = actions.flatMap(action => (action.evidencePaths ?? []).filter(path => path.endsWith('.png')));
  const shots = actions.flatMap(action => (action.evidencePaths ?? []).filter(path => path.endsWith('.png')).map(path => {
    const title = `${label} #${action.index} ${action.actionId}`;
    return `<figure class="shot" data-lightbox="${imageSource(path)}" data-lightbox-title="${escapeHtml(title)}"><img src="${imageSource(path)}" alt="${escapeHtml(title)}"><figcaption><b>${escapeHtml(title)}</b></figcaption></figure>`;
  })).join('');
  const rows = actions.map(action => `<tr><td>${action.index}</td><td>${escapeHtml(action.actor ?? '-')}</td><td><span class="action-pill">${escapeHtml(action.actionId)}</span></td><td>${escapeHtml(action.stateBefore ?? '-')} → ${escapeHtml(action.stateAfter ?? '-')}</td><td>${escapeHtml(action.status ?? '-')}</td><td>${escapeHtml(action.errorCode ?? '-')}</td><td>${escapeHtml(action.message ?? '-')}</td><td>${renderEvidence(action.evidencePaths ?? [], action.index)}</td></tr>`).join('');
  return `<div class="system"><h4>${escapeHtml(label)} <span class="muted">(${escapeHtml(systemId)})</span></h4><div><b>终态：</b> ${escapeHtml(observation.finalState ?? '-')}</div><div><b>语义路径：</b> <code>${escapeHtml(JSON.stringify(observation.semanticPath ?? []))}</code></div><div class="shots-grid">${shots}</div><div class="steps"><table><thead><tr><th>步骤</th><th>角色</th><th>动作</th><th>状态变化</th><th>HTTP</th><th>错误码</th><th>提示信息</th><th>证据</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

let evidenceCounter = 0;
function renderEvidence(paths: string[], actionIndex: number): string {
  return paths.map(path => {
    if (path.endsWith('.png')) {
      return `<img class="evidence-screenshot" src="${imageSource(path)}" data-lightbox="${imageSource(path)}" data-lightbox-title="步骤 #${actionIndex}" alt="screenshot">`;
    }
    evidenceCounter += 1;
    const id = `ev-json-${evidenceCounter}`;
    const content = readJsonContent(path);
    return `<div class="evidence-item"><button class="evidence-badge json evidence-toggle" data-target="${id}">查看 JSON</button></div><div id="${id}" class="json-panel">${escapeHtml(content)}</div>`;
  }).join('');
}

function readJsonContent(path: string): string {
  if (!existsSync(path)) return '[文件不存在]';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '[读取失败]';
  }
}

function renderEvidenceList(detail: FixedReportExecutionDetail, systems: string[]): string {
  const allPaths: string[] = [];
  for (const side of systems) {
    const obs = detail.observations[side];
    if (!obs) continue;
    for (const action of obs.actions ?? []) {
      for (const p of action.evidencePaths ?? []) {
        if (!allPaths.includes(p)) allPaths.push(p);
      }
    }
  }
  if (allPaths.length === 0) return '';
  const pngPaths = allPaths.filter(p => p.endsWith('.png'));
  const jsonPaths = allPaths.filter(p => !p.endsWith('.png'));
  const pngLinks = pngPaths.map(path => `<span class="evidence-item"><span class="evidence-badge">🖼️ ${escapeHtml(path.split('/').pop() ?? path)}</span></span>`).join('');
  const jsonLinks = jsonPaths.map(path => `<span class="evidence-item"><span class="evidence-badge json">📄 ${escapeHtml(path.split('/').pop() ?? path)}</span></span>`).join('');
  return `<h3>证据清单</h3><div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">${pngLinks}${jsonLinks}</div>`;
}

function renderCaptures(single?: FixedReportObservation, legacy?: FixedReportObservation, current?: FixedReportObservation): string {
  const entries: string[] = [];
  const flattenCaptures = (caps: Record<string, unknown>): Array<[string, unknown]> => {
    const out: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(caps)) {
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'object' && !Array.isArray(v) && v !== null) {
        for (const [kk, vv] of Object.entries(v)) {
          if (vv === undefined || vv === null || vv === '') continue;
          out.push([`${k}.${kk}`, vv]);
        }
      } else {
        out.push([k, v]);
      }
    }
    return out;
  };
  const renderSide = (label: string, obs?: FixedReportObservation) => {
    const items = flattenCaptures(obs?.captures ?? {});
    if (items.length === 0) return;
    const inner = items.map(([k, v]) => `<span class="evidence-badge" title="${escapeHtml(k)}">${escapeHtml(k)}: <b>${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</b></span>`).join('');
    entries.push(`<div style="margin:6px 0"><b>${escapeHtml(label)}</b> ${inner}</div>`);
  };
  if (single) {
    renderSide('关键捕获', single);
  } else {
    renderSide('老系统', legacy);
    renderSide('新系统', current);
  }
  if (entries.length === 0) return '';
  return `<div class="captures-box" style="margin:10px 0;padding:10px 12px;background:#f7f7f9;border-radius:8px;border:1px solid #e5e5ea"><b>流程标识：</b>${entries.join('')}</div>`;
}

function imageSource(path: string): string {
  if (!existsSync(path)) return escapeHtml(path);
  try {
    return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
  } catch {
    return escapeHtml(path);
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
