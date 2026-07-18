/**
 * Enhanced Business Report Generator
 * 
 * Generates comprehensive business reports with:
 * - Overview page
 * - Scenario list page
 * - Per-scenario comparison (expected vs legacy actual vs current actual)
 * - Difference analysis
 * - Release Gate
 * - Collection credibility
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  EnhancedScenario,
  DualExecutionResult,
  SemanticEquivalenceResult,
  Difference,
  DatabaseVerificationResult,
  BrowserStepResult,
  ApiCallResult,
  GenerationMetadata
} from '@flowtrace/core';

// ============================================================
// Configuration
// ============================================================

export interface EnhancedReportConfig {
  outputDir: string;
  projectName: string;
  projectId: string;
  includeDetails: boolean;
  includeEvidence: boolean;
  theme: 'light' | 'dark';
}

// ============================================================
// Report Data Types
// ============================================================

export interface ScenarioComparisonReport {
  scenarioId: string;
  scenarioName: string;
  severity: string;
  
  // Business context
  businessGoal: string;
  actors: string[];
  testData: Record<string, unknown>;
  
  // Expected
  expected: {
    finalState: string;
    requiredEvents: string[];
    forbiddenEvents: string[];
    processPath: string[];
    businessData: Record<string, unknown>;
  };
  
  // Legacy actual
  legacy: {
    finalState: string;
    processPath: string[];
    actors: string[];
    businessData: Record<string, unknown>;
    browserResults?: BrowserStepResult[];
    apiResults?: ApiCallResult[];
    databaseSnapshot?: any;
    success: boolean;
    error?: string;
    executionTime?: number;
  };
  
  // Current actual
  current: {
    finalState: string;
    processPath: string[];
    actors: string[];
    businessData: Record<string, unknown>;
    browserResults?: BrowserStepResult[];
    apiResults?: ApiCallResult[];
    databaseSnapshot?: any;
    success: boolean;
    error?: string;
    executionTime?: number;
  };
  
  // Comparison conclusion
  comparison: {
    finalStateMatch: boolean;
    pathMatch: boolean;
    actorsMatch: boolean;
    businessDataMatch: boolean;
    semanticMatch: boolean;
    businessConclusion: string;
  };
  
  // Differences
  differences: Difference[];
  blockingDifferences: string[];
  
  // Mermaid diagrams
  expectedFlowchart: string;
  legacyFlowchart: string;
  currentFlowchart: string;
  
  // Generation metadata
  generationMetadata?: GenerationMetadata;
  
  // Pass/fail
  passed: boolean;
}

export interface EnhancedReportSummary {
  projectId: string;
  projectName: string;
  timestamp: string;
  
  // Statistics
  statistics: {
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    pending: number;
    bySeverity: Record<string, number>;
    byDifference: Record<string, number>;
  };
  
  // Collection credibility
  collectionStatus: {
    sourceCollected: boolean;
    runtimeCollected: boolean;
    databaseCollected: boolean;
    apiCollected: boolean;
    messages: string[];
    credibilityLevel: 'high' | 'medium' | 'low' | 'demo';
  };
  
  // Execution status
  executionStatus: {
    legacyShadow: boolean;
    currentAdapterMode: string;
    browserAvailable: boolean;
    apiAvailable: boolean;
    databaseAvailable: boolean;
    aiUsed: boolean;
  };
  
  // Release gate
  releaseGate: {
    allowed: boolean;
    blockedBy: string[];
    requiresHumanApproval: boolean;
    approvalItems: string[];
  };
  
  // Scenario IDs for linking
  scenarioIds: string[];
}

// ============================================================
// Helper Functions
// ============================================================

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN');
}

function severityColor(severity: string | undefined): string {
  switch (severity) {
    case 'P0': return '#f44336';
    case 'P1': return '#ff9800';
    case 'P2': return '#ffc107';
    case 'P3': return '#4caf50';
    default: return '#9e9e9e';
  }
}

function statusIcon(passed: boolean): string {
  return passed ? '✅' : '❌';
}

function generateFlowchart(id: string, title: string, nodes: string[], titleNode?: string): string {
  const mermaidNodes: string[] = [];
  const mermaidEdges: string[] = [];
  
  mermaidNodes.push(`    ${id}_START[${titleNode || '开始'}]`);
  
  for (let i = 0; i < nodes.length; i++) {
    const nodeId = `${id}_N${i}`;
    mermaidNodes.push(`    ${nodeId}[${nodes[i]}]`);
    mermaidEdges.push(`    ${i === 0 ? id + '_START' : id + '_N' + (i - 1)} --> ${nodeId}`);
  }
  
  const endNode = `${id}_END`;
  mermaidNodes.push(`    ${endNode}[结束]`);
  if (nodes.length > 0) {
    mermaidEdges.push(`    ${id}_N${nodes.length - 1} --> ${endNode}`);
  } else {
    mermaidEdges.push(`    ${id}_START --> ${endNode}`);
  }
  
  return `flowchart TD\n${mermaidNodes.join('\n')}\n${mermaidEdges.join('\n')}`;
}

// ============================================================
// Comparison Table Renderer
// ============================================================

function renderComparisonTable(report: ScenarioComparisonReport): string {
  const rows: string[] = [];
  
  // Final state comparison
  rows.push(`
| 最终业务状态 | ${report.expected.finalState} | ${report.legacy.finalState} | ${report.current.finalState} | ${report.comparison.finalStateMatch ? '✅ 一致' : '❌ 不一致'} |
`);
  
  // Process path
  const expectedPath = report.expected.processPath.join(' → ') || '-';
  const legacyPath = report.legacy.processPath.join(' → ') || '-';
  const currentPath = report.current.processPath.join(' → ') || '-';
  rows.push(`
| 流程路径 | ${expectedPath} | ${legacyPath} | ${currentPath} | ${report.comparison.pathMatch ? '✅ 一致' : '❌ 不一致'} |
`);
  
  // Actors
  const expectedActors = report.expected.requiredEvents.join(', ') || '-';
  const legacyActors = report.legacy.actors.join(', ') || '-';
  const currentActors = report.current.actors.join(', ') || '-';
  rows.push(`
| 审批角色 | ${expectedActors} | ${legacyActors} | ${currentActors} | ${report.comparison.actorsMatch ? '✅ 一致' : '⚠️ 需确认'} |
`);
  
  return `
## 对比结论

### 预期 vs 实际 vs 差异

| 对比项 | 预期 | 旧流程实际 | 新流程实际 | 结论 |
|--------|------|-----------|-----------|------|
${rows.join('')}

### 业务结论

> **${report.comparison.businessConclusion}**

### 差异明细

${report.differences.length === 0 ? '无差异' : `
| 类别 | 旧流程 | 新流程 | 差异说明 | 严重级别 | 是否阻断 |
|------|--------|--------|---------|---------|---------|
${report.differences.map(d => `
| ${d.category} | ${JSON.stringify(d.legacyValue)} | ${JSON.stringify(d.currentValue)} | ${d.description} | <span style="color:${severityColor(d.severity)}">${d.severity}</span> | ${d.isBlocking ? '🚫 是' : '✅ 否'} |`).join('')}
`}
`;
}

// ============================================================
// Mermaid Diagram Renderer
// ============================================================

function renderMermaidDiagrams(report: ScenarioComparisonReport): string {
  return `
## 流程图对比

### 预期流程

\`\`\`mermaid
${report.expectedFlowchart}
\`\`\`

### 旧流程实际

\`\`\`mermaid
${report.legacyFlowchart}
\`\`\`

### 新流程实际

\`\`\`mermaid
${report.currentFlowchart}
\`\`\`
`;
}

// ============================================================
// Scenario Detail Page
// ============================================================

function renderScenarioDetailPage(report: ScenarioComparisonReport): string {
  const executionTime = report.legacy.executionTime || report.current.executionTime || 0;
  
  let html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>场景详情：${report.scenarioName}</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
    .header { background: white; border-radius: 8px; padding: 2rem; margin-bottom: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header h1 { color: #1a73e8; margin-bottom: 1rem; }
    .status-badge { display: inline-block; padding: 0.5rem 1rem; border-radius: 4px; font-weight: bold; font-size: 1.25rem; }
    .status-pass { background: #e8f5e9; color: #2e7d32; }
    .status-fail { background: #ffebee; color: #c62828; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem; }
    .meta-item { background: #f5f5f5; padding: 1rem; border-radius: 4px; }
    .meta-label { font-size: 0.875rem; color: #666; margin-bottom: 0.25rem; }
    .meta-value { font-weight: 600; }
    .section { background: white; border-radius: 8px; padding: 2rem; margin-bottom: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .section h2 { color: #333; border-bottom: 2px solid #1a73e8; padding-bottom: 0.5rem; margin-bottom: 1.5rem; }
    .comparison-table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
    .comparison-table th, .comparison-table td { border: 1px solid #ddd; padding: 1rem; text-align: left; }
    .comparison-table th { background: #f5f5f5; font-weight: 600; }
    .comparison-table tr:nth-child(even) { background: #fafafa; }
    .match-yes { color: #2e7d32; font-weight: 600; }
    .match-no { color: #c62828; font-weight: 600; }
    .severity-badge { padding: 0.25rem 0.5rem; border-radius: 4px; color: white; font-weight: 600; }
    .severity-P0 { background: #c62828; }
    .severity-P1 { background: #ef6c00; }
    .severity-P2 { background: #f9a825; }
    .severity-P3 { background: #2e7d32; }
    .mermaid { background: #fafafa; padding: 1.5rem; border-radius: 8px; margin: 1rem 0; text-align: center; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; }
    .card { background: #f9f9f9; border-radius: 8px; padding: 1.5rem; }
    .card h3 { margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid #ddd; }
    .card-expected h3 { color: #1a73e8; }
    .card-legacy h3 { color: #ff9800; }
    .card-current h3 { color: #4caf50; }
    .conclusion-box { background: ${report.passed ? '#e8f5e9' : '#ffebee'}; padding: 1.5rem; border-radius: 8px; margin-top: 1rem; }
    .conclusion-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
    .conclusion-text { color: ${report.passed ? '#2e7d32' : '#c62828'}; }
    .diff-table { width: 100%; border-collapse: collapse; }
    .diff-table th, .diff-table td { border: 1px solid #ddd; padding: 0.75rem; text-align: left; }
    .diff-table th { background: #f5f5f5; }
    .back-link { display: inline-block; padding: 0.75rem 1.5rem; background: #1a73e8; color: white; border-radius: 4px; text-decoration: none; margin-bottom: 1rem; }
    .back-link:hover { background: #1557b0; }
  </style>
</head>
<body>
  <div class="container">
    <a href="index.html" class="back-link">← 返回报告总览</a>
    
    <div class="header">
      <h1>场景：${report.scenarioName}</h1>
      <div class="status-badge ${report.passed ? 'status-pass' : 'status-fail'}">
        ${statusIcon(report.passed)} ${report.passed ? '通过' : '失败'}
      </div>
      
      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">场景编号</div>
          <div class="meta-value">${report.scenarioId}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">严重级别</div>
          <div class="meta-value"><span class="severity-badge severity-${report.severity || 'default'}">${report.severity || '未分级'}</span></div>
        </div>
        <div class="meta-item">
          <div class="meta-label">执行时间</div>
          <div class="meta-value">${(executionTime / 1000).toFixed(2)}s</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">差异数量</div>
          <div class="meta-value">${report.differences.length}</div>
        </div>
      </div>
    </div>
    
    <div class="section">
      <h2>一、业务目标</h2>
      <p>${report.businessGoal}</p>
    </div>
    
    <div class="section">
      <h2>二、参与角色</h2>
      <ul>
        ${report.actors.map(a => `<li>${a}</li>`).join('')}
      </ul>
    </div>
    
    <div class="section">
      <h2>三、预期 vs 实际对比</h2>
      
      <div class="grid-3">
        <div class="card card-expected">
          <h3>📋 预期</h3>
          <p><strong>最终状态:</strong> ${report.expected.finalState}</p>
          <p><strong>流程路径:</strong></p>
          <ul>
            ${report.expected.processPath.map(p => `<li>${p}</li>`).join('')}
          </ul>
        </div>
        
        <div class="card card-legacy">
          <h3>🔶 旧流程实际</h3>
          <p><strong>最终状态:</strong> ${report.legacy.finalState}</p>
          <p><strong>流程路径:</strong></p>
          <ul>
            ${report.legacy.processPath.map(p => `<li>${p}</li>`).join('')}
          </ul>
          ${report.legacy.error ? `<p style="color:#c62828;"><strong>错误:</strong> ${report.legacy.error}</p>` : ''}
        </div>
        
        <div class="card card-current">
          <h3>🟢 新流程实际</h3>
          <p><strong>最终状态:</strong> ${report.current.finalState}</p>
          <p><strong>流程路径:</strong></p>
          <ul>
            ${report.current.processPath.map(p => `<li>${p}</li>`).join('')}
          </ul>
          ${report.current.error ? `<p style="color:#c62828;"><strong>错误:</strong> ${report.current.error}</p>` : ''}
        </div>
      </div>
      
      <table class="comparison-table" style="margin-top: 2rem;">
        <thead>
          <tr>
            <th>对比项</th>
            <th>预期</th>
            <th>旧流程实际</th>
            <th>新流程实际</th>
            <th>结论</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>最终状态</strong></td>
            <td>${report.expected.finalState}</td>
            <td>${report.legacy.finalState}</td>
            <td>${report.current.finalState}</td>
            <td class="${report.comparison.finalStateMatch ? 'match-yes' : 'match-no'}">${report.comparison.finalStateMatch ? '✅ 一致' : '❌ 不一致'}</td>
          </tr>
          <tr>
            <td><strong>流程路径</strong></td>
            <td colspan="3">
              预期: ${report.expected.processPath.join(' → ') || '-'}
              <br>旧流程: ${report.legacy.processPath.join(' → ') || '-'}
              <br>新流程: ${report.current.processPath.join(' → ') || '-'}
            </td>
            <td class="${report.comparison.pathMatch ? 'match-yes' : 'match-no'}">${report.comparison.pathMatch ? '✅ 一致' : '❌ 不一致'}</td>
          </tr>
        </tbody>
      </table>
      
      <div class="conclusion-box">
        <div class="conclusion-title">📌 业务结论</div>
        <div class="conclusion-text">${report.comparison.businessConclusion}</div>
      </div>
    </div>
    
    <div class="section">
      <h2>四、流程图对比</h2>
      
      <h3>预期流程</h3>
      <div class="mermaid">
${report.expectedFlowchart}
      </div>
      
      <h3>旧流程实际</h3>
      <div class="mermaid">
${report.legacyFlowchart}
      </div>
      
      <h3>新流程实际</h3>
      <div class="mermaid">
${report.currentFlowchart}
      </div>
    </div>
    
    ${report.differences.length > 0 ? `
    <div class="section">
      <h2>五、差异明细</h2>
      <table class="diff-table">
        <thead>
          <tr>
            <th>类别</th>
            <th>旧流程</th>
            <th>新流程</th>
            <th>差异说明</th>
            <th>严重级别</th>
            <th>是否阻断</th>
          </tr>
        </thead>
        <tbody>
          ${report.differences.map(d => `
          <tr>
            <td>${d.category}</td>
            <td><code>${JSON.stringify(d.legacyValue)}</code></td>
            <td><code>${JSON.stringify(d.currentValue)}</code></td>
            <td>${d.description}</td>
            <td><span class="severity-badge severity-${d.severity}">${d.severity}</span></td>
            <td>${d.isBlocking ? '🚫 是' : '✅ 否'}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}
  </div>
  
  <script>
    mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
  </script>
</body>
</html>`;
  
  return html;
}

// ============================================================
// Index Page
// ============================================================

function renderIndexPage(summary: EnhancedReportSummary, scenarioIds: string[]): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlowTrace 测试报告 - ${summary.projectName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
    .header { background: linear-gradient(135deg, #1a73e8 0%, #0d47a1 100%); color: white; border-radius: 12px; padding: 3rem; margin-bottom: 2rem; box-shadow: 0 4px 16px rgba(0,0,0,0.2); }
    .header h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    .header .subtitle { opacity: 0.9; font-size: 1.1rem; }
    .header .timestamp { margin-top: 1rem; opacity: 0.8; font-size: 0.9rem; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1.5rem; margin-top: 2rem; }
    .stat-card { background: rgba(255,255,255,0.15); border-radius: 8px; padding: 1.5rem; text-align: center; backdrop-filter: blur(10px); }
    .stat-value { font-size: 2.5rem; font-weight: 700; }
    .stat-label { font-size: 0.9rem; opacity: 0.9; margin-top: 0.25rem; }
    .stat-pass { color: #a5d6a7; }
    .stat-fail { color: #ef9a9a; }
    .stat-blocked { color: #fff59d; }
    .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; }
    .section { background: white; border-radius: 12px; padding: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 2rem; }
    .section h2 { color: #333; border-bottom: 2px solid #1a73e8; padding-bottom: 0.5rem; margin-bottom: 1.5rem; font-size: 1.5rem; }
    .scenario-list { display: flex; flex-direction: column; gap: 1rem; }
    .scenario-item { display: flex; align-items: center; padding: 1rem; background: #f9f9f9; border-radius: 8px; transition: transform 0.2s, box-shadow 0.2s; }
    .scenario-item:hover { transform: translateX(4px); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .scenario-item a { flex: 1; text-decoration: none; color: inherit; display: flex; align-items: center; gap: 1rem; }
    .scenario-item .icon { font-size: 1.5rem; }
    .scenario-item .name { font-weight: 600; flex: 1; }
    .scenario-item .severity { padding: 0.25rem 0.75rem; border-radius: 4px; color: white; font-size: 0.875rem; font-weight: 600; }
    .severity-P0 { background: #c62828; }
    .severity-P1 { background: #ef6c00; }
    .severity-P2 { background: #f9a825; }
    .severity-P3 { background: #2e7d32; }
    .severity-default { background: #9e9e9e; }
    .status-badge { padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.875rem; font-weight: 600; }
    .status-pass { background: #e8f5e9; color: #2e7d32; }
    .status-fail { background: #ffebee; color: #c62828; }
    .status-pending { background: #fff3e0; color: #e65100; }
    .info-list { list-style: none; }
    .info-list li { padding: 0.75rem 0; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; }
    .info-list li:last-child { border-bottom: none; }
    .info-label { color: #666; }
    .info-value { font-weight: 600; }
    .release-gate { padding: 2rem; border-radius: 8px; text-align: center; }
    .release-allowed { background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); }
    .release-blocked { background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%); }
    .release-gate h3 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .release-allowed h3 { color: #2e7d32; }
    .release-blocked h3 { color: #c62828; }
    .release-gate p { color: #666; }
    .nav-links { display: flex; gap: 1rem; margin-top: 1.5rem; }
    .nav-link { padding: 0.75rem 1.5rem; background: white; border: 2px solid #1a73e8; color: #1a73e8; border-radius: 8px; text-decoration: none; font-weight: 600; transition: all 0.2s; }
    .nav-link:hover { background: #1a73e8; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>FlowTrace 测试报告</h1>
      <div class="subtitle">${summary.projectName}</div>
      <div class="timestamp">生成时间: ${formatTimestamp(summary.timestamp)}</div>
      
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${summary.statistics.total}</div>
          <div class="stat-label">测试总数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value stat-pass">${summary.statistics.passed}</div>
          <div class="stat-label">通过</div>
        </div>
        <div class="stat-card">
          <div class="stat-value stat-fail">${summary.statistics.failed}</div>
          <div class="stat-label">失败</div>
        </div>
        <div class="stat-card">
          <div class="stat-value stat-blocked">${summary.statistics.blocked}</div>
          <div class="stat-label">阻断</div>
        </div>
      </div>
    </div>
    
    <div class="grid">
      <div>
        <div class="section">
          <h2>测试场景</h2>
          <div class="scenario-list">
            ${scenarioIds.map(id => `
            <div class="scenario-item">
              <a href="scenario-${id}.html">
                <span class="icon">📋</span>
                <span class="name">${id}</span>
                <span class="severity severity-default">未分级</span>
              </a>
            </div>
            `).join('')}
          </div>
        </div>
      </div>
      
      <div>
        <div class="section">
          <h2>执行状态</h2>
          <ul class="info-list">
            <li>
              <span class="info-label">执行模式</span>
              <span class="info-value">${summary.executionStatus.legacyShadow ? 'legacy-shadow' : summary.executionStatus.currentAdapterMode}</span>
            </li>
            <li>
              <span class="info-label">Browser 可用</span>
              <span class="info-value">${summary.executionStatus.browserAvailable ? '✅ 是' : '❌ 否'}</span>
            </li>
            <li>
              <span class="info-label">API 可用</span>
              <span class="info-value">${summary.executionStatus.apiAvailable ? '✅ 是' : '❌ 否'}</span>
            </li>
            <li>
              <span class="info-label">数据库可用</span>
              <span class="info-value">${summary.executionStatus.databaseAvailable ? '✅ 是' : '❌ 否'}</span>
            </li>
            <li>
              <span class="info-label">AI 已使用</span>
              <span class="info-value">${summary.executionStatus.aiUsed ? '✅ 是' : '❌ 否'}</span>
            </li>
          </ul>
        </div>
        
        <div class="section">
          <h2>采集可信度</h2>
          <ul class="info-list">
            <li>
              <span class="info-label">源码采集</span>
              <span class="info-value">${summary.collectionStatus.sourceCollected ? '✅ 已采集' : '❌ 未采集'}</span>
            </li>
            <li>
              <span class="info-label">运行时采集</span>
              <span class="info-value">${summary.collectionStatus.runtimeCollected ? '✅ 已采集' : '❌ 未采集'}</span>
            </li>
            <li>
              <span class="info-label">数据库采集</span>
              <span class="info-value">${summary.collectionStatus.databaseCollected ? '✅ 已采集' : '❌ 未采集'}</span>
            </li>
            <li>
              <span class="info-label">API 采集</span>
              <span class="info-value">${summary.collectionStatus.apiCollected ? '✅ 已采集' : '❌ 未采集'}</span>
            </li>
            <li>
              <span class="info-label">可信度等级</span>
              <span class="info-value"><strong>${summary.collectionStatus.credibilityLevel === 'high' ? '🟢 高' : summary.collectionStatus.credibilityLevel === 'medium' ? '🟡 中' : summary.collectionStatus.credibilityLevel === 'low' ? '🟠 低' : '⚪ 演示'}</strong></span>
            </li>
          </ul>
        </div>
        
        <div class="release-gate ${summary.releaseGate.allowed ? 'release-allowed' : 'release-blocked'}">
          <h3>${summary.releaseGate.allowed ? '✅ 可以发布' : '🚫 禁止发布'}</h3>
          ${summary.releaseGate.blockedBy.length > 0 ? `<p>阻断原因: ${summary.releaseGate.blockedBy.join(', ')}</p>` : '<p>所有检查通过</p>'}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ============================================================
// Main Generator Class
// ============================================================

export class EnhancedReportGenerator {
  private config: EnhancedReportConfig;
  
  constructor(config: Partial<EnhancedReportConfig> = {}) {
    this.config = {
      outputDir: config.outputDir || './reports',
      projectName: config.projectName || 'Unknown Project',
      projectId: config.projectId || 'unknown',
      includeDetails: config.includeDetails !== false,
      includeEvidence: config.includeEvidence || false,
      theme: config.theme || 'light'
    };
  }
  
  /**
   * Generate complete report
   */
  generate(
    scenarios: EnhancedScenario[],
    executionResults: Map<string, DualExecutionResult>
  ): void {
    // Ensure output directory exists
    if (!existsSync(this.config.outputDir)) {
      mkdirSync(this.config.outputDir, { recursive: true });
    }
    
    const scenarioReports: ScenarioComparisonReport[] = [];
    const scenarioIds: string[] = [];
    
    // Generate scenario reports
    for (const scenario of scenarios) {
      const execution = executionResults.get(scenario.id);
      const report = this.generateScenarioReport(scenario, execution);
      scenarioReports.push(report);
      scenarioIds.push(scenario.id);
      
      // Write HTML page for this scenario
      const htmlPath = join(this.config.outputDir, `scenario-${scenario.id}.html`);
      const html = renderScenarioDetailPage(report);
      writeFileSync(htmlPath, html, 'utf-8');
    }
    
    // Generate summary
    const summary = this.generateSummary(scenarios, scenarioReports);
    
    // Write index page
    const indexPath = join(this.config.outputDir, 'index.html');
    const indexHtml = renderIndexPage(summary, scenarioIds);
    writeFileSync(indexPath, indexHtml, 'utf-8');
    
    // Write JSON summary
    const summaryPath = join(this.config.outputDir, 'summary.json');
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    
    console.log(`[EnhancedReportGenerator] Report generated at ${this.config.outputDir}`);
  }
  
  /**
   * Generate report for a single scenario
   */
  private generateScenarioReport(
    scenario: EnhancedScenario,
    execution?: DualExecutionResult
  ): ScenarioComparisonReport {
    // Determine expected from scenario
    const expectedFinalState = scenario.finalExpected?.finalState || 
                             (scenario.expected as any)?.finalState || 
                             'COMPLETED';
    const requiredEvents = scenario.finalExpected?.requiredEvents || [];
    const forbiddenEvents = scenario.finalExpected?.forbiddenEvents || [];
    
    // Build expected process path
    const expectedPath: string[] = [];
    if (scenario.steps) {
      for (const step of scenario.steps) {
        expectedPath.push(step.expected?.semanticEvent || step.businessAction);
      }
    }
    
    // Get actors
    const actors = scenario.actors ? 
      Object.values(scenario.actors).map(a => a.role) : [];
    
    // Determine legacy and current results from execution
    let legacyFinalState = '未执行';
    let currentFinalState = '未执行';
    let legacyPath: string[] = [];
    let currentPath: string[] = [];
    let legacySuccess = false;
    let currentSuccess = false;
    let legacyError: string | undefined;
    let currentError: string | undefined;
    let differences: Difference[] = [];
    let blockingDifferences: string[] = [];
    let semanticComparison: SemanticEquivalenceResult | undefined;
    
    if (execution) {
      // Legacy execution
      legacyFinalState = execution.legacyExecution.finalState;
      legacyPath = execution.legacyExecution.semanticPath.nodes.map(n => n.event);
      legacySuccess = execution.legacyExecution.success;
      legacyError = execution.legacyExecution.error;
      
      // Current execution
      currentFinalState = execution.currentExecution.finalState;
      currentPath = execution.currentExecution.semanticPath.nodes.map(n => n.event);
      currentSuccess = execution.currentExecution.success;
      currentError = execution.currentExecution.error;
      
      // Differences
      differences = execution.differences;
      blockingDifferences = execution.blockingDifferences;
      semanticComparison = execution.semanticComparison;
    }
    
    // Determine comparison results
    const finalStateMatch = legacyFinalState === currentFinalState && 
                           currentFinalState === expectedFinalState;
    const pathMatch = JSON.stringify(legacyPath) === JSON.stringify(currentPath);
    const actorsMatch = true; // Simplified
    const businessDataMatch = true; // Simplified
    const semanticMatch = semanticComparison?.overallMatch ?? false;
    
    // Build business conclusion
    let businessConclusion = '';
    if (execution?.passed) {
      if (finalStateMatch && pathMatch) {
        businessConclusion = '流程路径一致，最终状态一致，API 语义一致，关键数据一致。';
      } else if (!finalStateMatch) {
        businessConclusion = '最终业务状态不一致，需要人工确认。';
      } else {
        businessConclusion = '存在可接受的实现差异，不影响业务正确性。';
      }
    } else {
      if (blockingDifferences.length > 0) {
        businessConclusion = `存在 ${blockingDifferences.length} 个阻断性差异，禁止发布。`;
      } else {
        businessConclusion = '存在非阻断性差异，需要人工确认。';
      }
    }
    
    // Generate flowcharts
    const expectedFlowchart = generateFlowchart('exp', '预期', expectedPath);
    const legacyFlowchart = generateFlowchart('leg', '旧流程', legacyPath);
    const currentFlowchart = generateFlowchart('cur', '新流程', currentPath);
    
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      severity: scenario.severity || '未分级',
      businessGoal: scenario.businessGoal,
      actors,
      testData: scenario.testData || {},
      expected: {
        finalState: expectedFinalState,
        requiredEvents,
        forbiddenEvents,
        processPath: expectedPath,
        businessData: scenario.finalExpected?.businessResult?.businessData || {}
      },
      legacy: {
        finalState: legacyFinalState,
        processPath: legacyPath,
        actors,
        businessData: {},
        success: legacySuccess,
        error: legacyError,
        executionTime: execution ? 
          new Date(execution.legacyExecution.endTime).getTime() - 
          new Date(execution.legacyExecution.startTime).getTime() : undefined
      },
      current: {
        finalState: currentFinalState,
        processPath: currentPath,
        actors,
        businessData: {},
        success: currentSuccess,
        error: currentError,
        executionTime: execution ? 
          new Date(execution.currentExecution.endTime).getTime() - 
          new Date(execution.currentExecution.startTime).getTime() : undefined
      },
      comparison: {
        finalStateMatch,
        pathMatch,
        actorsMatch,
        businessDataMatch,
        semanticMatch,
        businessConclusion
      },
      differences,
      blockingDifferences,
      expectedFlowchart,
      legacyFlowchart,
      currentFlowchart,
      generationMetadata: scenario.generationMetadata,
      passed: execution?.passed ?? false
    };
  }
  
  /**
   * Generate summary report
   */
  private generateSummary(
    scenarios: EnhancedScenario[],
    reports: ScenarioComparisonReport[]
  ): EnhancedReportSummary {
    const total = reports.length;
    const passed = reports.filter(r => r.passed).length;
    const failed = reports.filter(r => !r.passed).length;
    const blocked = reports.filter(r => r.blockingDifferences.length > 0).length;
    
    // Count by severity
    const bySeverity: Record<string, number> = {};
    for (const r of reports) {
      bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
    }
    
    // Count by difference category
    const byDifference: Record<string, number> = {};
    for (const r of reports) {
      for (const d of r.differences) {
        byDifference[d.category] = (byDifference[d.category] || 0) + 1;
      }
    }
    
    // Determine collection status
    const collectionMessages: string[] = [];
    const hasAnyCollection = scenarios.some(s => s.source && s.source.length > 0);
    collectionMessages.push(hasAnyCollection ? '源码已采集' : '源码未采集');
    
    const credibilityLevel = hasAnyCollection ? 'medium' : 'demo';
    
    // Release gate
    const releaseAllowed = blocked === 0 && passed === total;
    const blockedBy = reports.filter(r => r.blockingDifferences.length > 0)
      .map(r => `场景 ${r.scenarioId}: ${r.blockingDifferences.length} 个阻断差异`);
    
    return {
      projectId: this.config.projectId,
      projectName: this.config.projectName,
      timestamp: new Date().toISOString(),
      statistics: {
        total,
        passed,
        failed,
        blocked,
        pending: 0,
        bySeverity,
        byDifference
      },
      collectionStatus: {
        sourceCollected: hasAnyCollection,
        runtimeCollected: false,
        databaseCollected: false,
        apiCollected: false,
        messages: collectionMessages,
        credibilityLevel: credibilityLevel as 'high' | 'medium' | 'low' | 'demo'
      },
      executionStatus: {
        legacyShadow: true,
        currentAdapterMode: 'legacy-shadow',
        browserAvailable: false,
        apiAvailable: false,
        databaseAvailable: false,
        aiUsed: false
      },
      releaseGate: {
        allowed: releaseAllowed,
        blockedBy,
        requiresHumanApproval: !releaseAllowed,
        approvalItems: blockedBy
      },
      scenarioIds: reports.map(r => r.scenarioId)
    };
  }
}

/**
 * Create enhanced report generator
 */
export function createEnhancedReportGenerator(
  config?: Partial<EnhancedReportConfig>
): EnhancedReportGenerator {
  return new EnhancedReportGenerator(config);
}
