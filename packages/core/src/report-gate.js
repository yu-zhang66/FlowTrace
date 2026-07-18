/**
 * Report Completeness Gate
 *
 * Ensures that all three report formats (JSON, Markdown, HTML) are generated
 * from the verification run. This is a critical gate that fails the command
 * if any format is missing or empty.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Ensures all three report formats exist and are non-empty.
 * Generates any missing formats from the raw verification run JSON.
 *
 * @throws Error if the raw run JSON is missing or cannot be read
 * @throws Error if any report format is empty after generation
 */
export function ensureReportCompleteness(options) {
    const { runId, projectRoot, flowtraceRoot, projectName } = options;
    const reportsDir = getReportsDirFromPath(flowtraceRoot);
    // Ensure reports directory exists
    mkdirSync(reportsDir, { recursive: true });
    // 1. Find and read the raw verification run
    const runPath = findRunFile(reportsDir, runId);
    if (!runPath || !existsSync(runPath)) {
        throw new Error(`Verification run not found: runs/run-${runId}.json`);
    }
    let run;
    try {
        const content = readFileSync(runPath, 'utf-8');
        if (!content.trim()) {
            throw new Error(`Verification run file is empty: ${runPath}`);
        }
        run = JSON.parse(content);
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON in verification run: ${runPath}`);
        }
        throw error;
    }
    // 2. Generate JSON report (or verify it exists and is non-empty)
    const jsonPath = join(reportsDir, `report-${runId}.json`);
    let jsonContent;
    if (existsSync(jsonPath)) {
        jsonContent = readFileSync(jsonPath, 'utf-8');
        if (!jsonContent.trim()) {
            throw new Error(`JSON report is empty: ${jsonPath}`);
        }
    }
    else {
        jsonContent = generateJsonReport(run);
        writeFileSync(jsonPath, jsonContent, 'utf-8');
    }
    // 3. Generate Markdown report
    const markdownPath = join(reportsDir, `report-${runId}.md`);
    let markdownContent;
    if (existsSync(markdownPath)) {
        markdownContent = readFileSync(markdownPath, 'utf-8');
        if (!markdownContent.trim()) {
            throw new Error(`Markdown report is empty: ${markdownPath}`);
        }
    }
    else {
        markdownContent = generateMarkdownReport(run, projectName);
        writeFileSync(markdownPath, markdownContent, 'utf-8');
    }
    // 4. Generate HTML report
    const htmlPath = join(reportsDir, `report-${runId}.html`);
    let htmlContent;
    if (existsSync(htmlPath)) {
        htmlContent = readFileSync(htmlPath, 'utf-8');
        if (!htmlContent.trim()) {
            throw new Error(`HTML report is empty: ${htmlPath}`);
        }
    }
    else {
        htmlContent = generateHtmlReport(run, projectName);
        writeFileSync(htmlPath, htmlContent, 'utf-8');
    }
    return {
        json: jsonPath,
        markdown: markdownPath,
        html: htmlPath,
        runId
    };
}
/**
 * Find the run file for a given runId.
 * Checks multiple naming conventions.
 */
function findRunFile(reportsDir, runId) {
    const candidates = [
        join(reportsDir, `run-${runId}.json`),
        join(reportsDir, `${runId}.json`)
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
/**
 * Get reports directory path from flowtrace root.
 */
function getReportsDirFromPath(flowtraceRoot) {
    return join(flowtraceRoot, 'reports');
}
/**
 * Generate JSON report content from verification run.
 */
function generateJsonReport(run) {
    return JSON.stringify(run, null, 2);
}
/**
 * Generate Markdown report content from verification run.
 */
function generateMarkdownReport(run, projectName) {
    const passRate = run.summary.total > 0
        ? ((run.summary.passed / run.summary.total) * 100).toFixed(1)
        : '0';
    let md = `# FlowTrace Verification Report

## Summary

| Metric | Value |
|--------|-------|
| Project | ${projectName} |
| Run ID | ${run.id} |
| Timestamp | ${new Date(run.timestamp).toLocaleString()} |
| Total Scenarios | ${run.summary.total} |
| Passed | ${run.summary.passed} |
| Failed | ${run.summary.failed} |
| Pass Rate | ${passRate}% |

### Differences by Severity

| Severity | Count | Blocking |
|----------|-------|----------|
`;
    for (const [severity, count] of Object.entries(run.summary.differencesBySeverity)) {
        const isBlocking = severity === 'P0' || severity === 'P1';
        md += `| ${severity} | ${count} | ${isBlocking ? 'Yes' : 'No'} |\n`;
    }
    md += `

## Release Gate

`;
    if (run.releaseGate.allowed) {
        md += `**PASSED** - All P0/P1 differences have been resolved.\n\n`;
    }
    else {
        md += `**BLOCKED** - The following issues must be resolved:\n\n`;
        for (const block of run.releaseGate.blockedBy) {
            md += `- ${block}\n`;
        }
        md += '\n';
    }
    md += `## Scenario Results

`;
    for (const result of run.scenarios) {
        const status = result.passed ? 'PASSED' : 'FAILED';
        md += `### [${status}] ${result.scenarioId}\n\n`;
        if (result.error) {
            md += `**Error:** ${result.error}\n\n`;
        }
        md += renderDualMarkdown(result);
        if (result.differences.length > 0) {
            md += `**Differences:**\n\n`;
            for (const diff of result.differences) {
                md += `- **[${diff.severity}]** ${diff.description}\n`;
                md += `  - Category: ${diff.category}\n`;
                if (diff.legacyValue !== undefined) {
                    md += `  - Legacy: \`${JSON.stringify(diff.legacyValue)}\`\n`;
                }
                if (diff.currentValue !== undefined) {
                    md += `  - Current: \`${JSON.stringify(diff.currentValue)}\`\n`;
                }
            }
            md += '\n';
        }
        else {
            md += '*No differences*\n\n';
        }
    }
    md += `---

*Generated by FlowTrace | ${new Date().toISOString()}*
`;
    return md;
}
/**
 * Generate HTML report content from verification run.
 */
function generateHtmlReport(run, projectName) {
    const passRate = run.summary.total > 0
        ? ((run.summary.passed / run.summary.total) * 100).toFixed(1)
        : '0';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlowTrace Report - ${projectName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
      color: #333;
    }
    .header {
      background: #2c3e50;
      color: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .summary {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-top: 15px;
    }
    .summary-item {
      text-align: center;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 6px;
    }
    .summary-item .value {
      font-size: 28px;
      font-weight: bold;
      color: #2c3e50;
    }
    .pass { color: #28a745; }
    .fail { color: #dc3545; }
    .severity { padding: 3px 8px; border-radius: 4px; font-weight: bold; display: inline-block; margin-right: 5px; }
    .severity.P0 { background: #dc3545; color: white; }
    .severity.P1 { background: #fd7e14; color: white; }
    .severity.P2 { background: #ffc107; color: black; }
    .severity.P3 { background: #6c757d; color: white; }
    .gate {
      padding: 15px 20px;
      border-radius: 6px;
      margin-top: 15px;
    }
    .gate.allowed { background: #d4edda; border: 1px solid #28a745; }
    .gate.blocked { background: #f8d7da; border: 1px solid #dc3545; }
    .scenario {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 15px;
    }
    .scenario.passed { border-left: 4px solid #28a745; }
    .scenario.failed { border-left: 4px solid #dc3545; }
    .case-systems { display:grid; grid-template-columns:1fr 1fr; gap:15px; margin:15px 0; }
    .system { background:#f8f9fa; border:1px solid #e1e5e9; border-radius:6px; padding:14px; }
    .system h4 { margin:0 0 10px; }
    .system dl { display:grid; grid-template-columns:90px 1fr; gap:5px 10px; font-size:13px; }
    .system dt { color:#6c757d; font-weight:bold; } .system dd { margin:0; word-break:break-word; }
    .shots { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-top:12px; }
    .shot { margin:0; font-size:11px; color:#6c757d; } .shot img { width:100%; max-height:180px; object-fit:contain; background:white; border:1px solid #ddd; }
    @media(max-width:760px){.case-systems{grid-template-columns:1fr;}}
    .diff {
      background: #f8f9fa;
      padding: 10px;
      margin: 10px 0;
      border-radius: 4px;
      font-family: monospace;
      font-size: 13px;
    }
    .footer {
      text-align: center;
      color: #6c757d;
      margin-top: 30px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>FlowTrace Verification Report</h1>
    <p><strong>Project:</strong> ${projectName} | <strong>Run ID:</strong> ${run.id} | <strong>Date:</strong> ${new Date(run.timestamp).toLocaleString()}</p>
  </div>

  <div class="summary">
    <h2>Summary</h2>
    <div class="summary-grid">
      <div class="summary-item">
        <div class="value">${run.summary.total}</div>
        <div>Total</div>
      </div>
      <div class="summary-item">
        <div class="value pass">${run.summary.passed}</div>
        <div>Passed</div>
      </div>
      <div class="summary-item">
        <div class="value fail">${run.summary.failed}</div>
        <div>Failed</div>
      </div>
      <div class="summary-item">
        <div class="value">${passRate}%</div>
        <div>Pass Rate</div>
      </div>
    </div>

    <h3>Differences by Severity</h3>
    <div class="summary-grid">
      ${Object.entries(run.summary.differencesBySeverity).map(([sev, count]) => `
        <div class="summary-item">
          <div class="value"><span class="severity ${sev}">${sev}</span> ${count}</div>
        </div>
      `).join('')}
    </div>

    <div class="gate ${run.releaseGate.allowed ? 'allowed' : 'blocked'}">
      <strong>Release Gate:</strong> ${run.releaseGate.allowed ? 'PASSED' : 'BLOCKED'}
      ${!run.releaseGate.allowed ? `<br><small>${run.releaseGate.blockedBy.join(', ')}</small>` : ''}
    </div>
  </div>

  <h2>Scenario Results</h2>
  ${run.scenarios.map(result => `
    <div class="scenario ${result.passed ? 'passed' : 'failed'}">
      <h3>${result.passed ? 'PASSED' : 'FAILED'} ${result.scenarioId}</h3>
      ${result.error ? `<p><strong>Error:</strong> ${result.error}</p>` : ''}
      <div class="case-systems">${renderSystemHtml(result.legacyResult, 'Legacy')} ${renderSystemHtml(result.currentResult, 'Current')}</div>
      ${result.differences.length > 0 ? `
        <h4>Differences</h4>
        ${result.differences.map(diff => `
          <div class="diff">
            <span class="severity ${diff.severity}">${diff.severity}</span>
            <strong>${diff.description}</strong><br>
            <small>Category: ${diff.category}</small><br>
            Legacy: <code>${JSON.stringify(diff.legacyValue)}</code><br>
            Current: <code>${JSON.stringify(diff.currentValue)}</code>
          </div>
        `).join('')}
      ` : '<p><em>No differences</em></p>'}
    </div>
  `).join('')}

  <div class="footer">
    Generated by FlowTrace | ${new Date().toISOString()}
  </div>
</body>
</html>`;
}
function screenshotList(result) {
    const metadata = result?.metadata || {};
    const source = [metadata.screenshots, metadata.evidence, result?.screenshots, result?.actions]
        .find(value => Array.isArray(value)) || [];
    return source.flatMap((item) => {
        if (typeof item === 'string')
            return [{ path: item, label: '' }];
        const path = item?.path || item?.screenshotPath || item?.screenshot || item?.evidencePath;
        return path ? [{ path, label: item?.label || item?.name || item?.action || '' }] : [];
    });
}
function renderSystemHtml(result, label) {
    if (!result)
        return `<div class="system"><h4>${label}</h4><p>未执行</p></div>`;
    const shots = screenshotList(result);
    const images = shots.length ? `<div class="shots">${shots.map((shot) => `<figure class="shot"><a href="${shot.path}" target="_blank"><img src="${shot.path}" alt="${label} screenshot"></a><figcaption>${shot.label || shot.path}</figcaption></figure>`).join('')}</div>` : '<p style="margin-top:12px;color:#888">无截图证据</p>';
    return `<div class="system"><h4>${label}</h4><dl><dt>最终状态</dt><dd>${result.finalState || '-'}</dd><dt>语义路径</dt><dd>${result.semanticPath?.join(' → ') || '-'}</dd><dt>错误</dt><dd>${result.error || result.metadata?.actionError || '-'}</dd></dl>${images}</div>`;
}
function renderDualMarkdown(result) {
    const side = (value, label) => {
        if (!value)
            return `### ${label}\n\n未执行。\n\n`;
        const shots = screenshotList(value);
        return `### ${label}\n\n- 最终状态：${value.finalState || '-'}\n- 语义路径：${value.semanticPath?.join(' → ') || '-'}\n- 错误：${value.error || value.metadata?.actionError || '-'}\n\n截图：${shots.length ? shots.map((s) => `- [${s.label || s.path}](${s.path})`).join('\n') : '无'}\n\n`;
    };
    return `#### 双流程对比与证据\n\n| Legacy | Current |\n|---|---|\n| ${result.legacyResult?.finalState || '未执行'} | ${result.currentResult?.finalState || '未执行'} |\n\n${side(result.legacyResult, 'Legacy 流程')}\n${side(result.currentResult, 'Current 流程')}`;
}
/**
 * Create a minimal verification run for error cases when no run exists.
 * This ensures reports can still be generated even on failure.
 */
export function createErrorVerificationRun(opts) {
    return {
        id: opts.runId,
        projectId: opts.projectId,
        timestamp: new Date().toISOString(),
        scenarios: [],
        summary: {
            total: 0,
            passed: 0,
            failed: 0,
            differencesBySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 }
        },
        releaseGate: {
            allowed: false,
            blockedBy: [opts.errorMessage]
        },
        metadata: {
            error: opts.errorMessage,
            type: 'pipeline-error'
        }
    };
}
//# sourceMappingURL=report-gate.js.map