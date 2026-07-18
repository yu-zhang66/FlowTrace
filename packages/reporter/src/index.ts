import type {
  Difference,
  DifferenceSeverity,
  DualExecutionResult,
  VerificationRun,
  VerificationSummary,
  ReleaseGate
} from '@flowtrace/core';
import { generateId } from '@flowtrace/core';

export * from './scenario-renderer.js';
export * from './business-report.js';
export * from './test-case-markdown-renderer.js';
export * from './verification-report-html-renderer.js';

export interface ReporterConfig {
  includeDetails: boolean;
  includeEvidence: boolean;
  theme: 'light' | 'dark';
}

export class DifferenceClassifier {
  private static readonly BLOCKING_SEVERITIES: string[] = ['P0', 'P1'];

  static classify(difference: { category: string }): string {
    const category = difference.category;

    if (category === 'final_state' || category === 'permission') {
      return 'P0';
    }

    if (category === 'semantic_path' || category === 'business_data') {
      return 'P1';
    }

    if (category === 'database' || category === 'external_call') {
      return 'P1';
    }

    if (category === 'notification' || category === 'audit') {
      return 'P2';
    }

    return 'P2';
  }

  static isBlocking(severity: string): boolean {
    return this.BLOCKING_SEVERITIES.includes(severity);
  }

  static sortBySeverity(a: string, b: string): number {
    const order: Record<string, number> = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3 };
    return (order[a] ?? 999) - (order[b] ?? 999);
  }

  static groupBySeverity(differences: Array<{ severity: string }>): Record<string, Array<{ severity: string }>> {
    const grouped: Record<string, Array<{ severity: string }>> = {
      P0: [],
      P1: [],
      P2: [],
      P3: []
    };

    for (const diff of differences) {
      if (grouped[diff.severity]) {
        grouped[diff.severity].push(diff);
      }
    }

    return grouped;
  }
}

export class ReportGenerator {
  private config: ReporterConfig;

  constructor(config: Partial<ReporterConfig> = {}) {
    this.config = {
      includeDetails: true,
      includeEvidence: true,
      theme: 'light',
      ...config
    };
  }

  generateVerificationRun(
    projectId: string,
    results: DualExecutionResult[],
    failOn: string[] = ['P0', 'P1']
  ): VerificationRun {
    const differencesBySeverity: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
    const scenarioResults = results.map(result => {
      for (const diff of result.differences) {
        differencesBySeverity[diff.severity] = (differencesBySeverity[diff.severity] || 0) + 1;
      }

      return {
        scenarioId: result.scenarioId,
        legacyResult: result.legacyResult,
        currentResult: result.currentResult,
        differences: result.differences,
        passed: result.passed,
        error: result.error
      };
    });

    const passed = scenarioResults.filter(r => r.passed).length;
    const failed = scenarioResults.filter(r => !r.passed).length;

    const blockedBy: string[] = [];
    for (const severity of failOn) {
      const count = differencesBySeverity[severity] || 0;
      if (count > 0) {
        blockedBy.push(`${severity}: ${count} difference(s)`);
      }
    }

    const summary: VerificationSummary = {
      total: results.length,
      passed,
      failed,
      differencesBySeverity
    };

    const releaseGate: ReleaseGate = {
      allowed: blockedBy.length === 0,
      blockedBy,
      requiresHumanApproval: differencesBySeverity['P1'] > 0
    };

    return {
      id: generateId('run'),
      projectId,
      timestamp: new Date().toISOString(),
      scenarios: scenarioResults,
      summary,
      releaseGate
    };
  }

  generateMarkdown(run: VerificationRun, projectName: string): string {
    let md = `# FlowTrace Verification Report\n\n`;
    md += `**Project:** ${projectName}\n`;
    md += `**Run ID:** ${run.id}\n`;
    md += `**Timestamp:** ${new Date(run.timestamp).toLocaleString()}\n\n`;

    md += `## Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Total Scenarios | ${run.summary.total} |\n`;
    md += `| Passed | ${run.summary.passed} |\n`;
    md += `| Failed | ${run.summary.failed} |\n`;
    md += `| Pass Rate | ${((run.summary.passed / run.summary.total) * 100).toFixed(1)}% |\n\n`;

    md += `### Differences by Severity\n\n`;
    md += `| Severity | Count | Blocking |\n`;
    md += `|----------|-------|----------|\n`;
    for (const [severity, count] of Object.entries(run.summary.differencesBySeverity)) {
      const isBlocking = DifferenceClassifier.isBlocking(severity);
      md += `| ${severity} | ${count} | ${isBlocking ? 'Yes' : 'No'} |\n`;
    }
    md += `\n`;

    md += `## Release Gate\n\n`;
    if (run.releaseGate.allowed) {
      md += `✅ **PASSED** - All P0/P1 differences have been resolved.\n\n`;
    } else {
      md += `❌ **BLOCKED** - The following issues must be resolved:\n\n`;
      for (const block of run.releaseGate.blockedBy) {
        md += `- ${block}\n`;
      }
      md += `\n`;
    }

    if (this.config.includeDetails) {
      md += `## Scenario Results\n\n`;
      for (const result of run.scenarios) {
        const status = result.passed ? '✅' : '❌';
        md += `### ${status} ${result.scenarioId}\n\n`;

        if (result.error) {
          md += `**Error:** ${result.error}\n\n`;
        }

        if (result.differences.length > 0) {
          md += `**Differences:**\n\n`;
          for (const diff of result.differences) {
            md += `- **[${diff.severity}]** ${diff.description}\n`;
            md += `  - Category: ${diff.category}\n`;
            md += `  - Legacy: \`${JSON.stringify(diff.legacyValue)}\`\n`;
            md += `  - Current: \`${JSON.stringify(diff.currentValue)}\`\n`;
          }
          md += `\n`;
        } else {
          md += `*No differences*\n\n`;
        }
      }
    }

    return md;
  }

  generateHtml(run: VerificationRun, projectName: string): string {
    const passRate = ((run.summary.passed / run.summary.total) * 100).toFixed(1);
    const html = `<!DOCTYPE html>
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
      background: ${this.config.theme === 'dark' ? '#1a1a2e' : '#f5f5f5'};
      color: ${this.config.theme === 'dark' ? '#eee' : '#333'};
    }
    .header {
      background: #2c3e50;
      color: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .summary {
      background: ${this.config.theme === 'dark' ? '#16213e' : 'white'};
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
      background: ${this.config.theme === 'dark' ? '#1a1a2e' : '#f8f9fa'};
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
      background: ${this.config.theme === 'dark' ? '#16213e' : 'white'};
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 15px;
    }
    .scenario.passed { border-left: 4px solid #28a745; }
    .scenario.failed { border-left: 4px solid #dc3545; }
    .diff {
      background: ${this.config.theme === 'dark' ? '#1a1a2e' : '#f8f9fa'};
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
      <strong>Release Gate:</strong> ${run.releaseGate.allowed ? '✅ PASSED' : '❌ BLOCKED'}
      ${!run.releaseGate.allowed ? `<br><small>${run.releaseGate.blockedBy.join(', ')}</small>` : ''}
    </div>
  </div>

  ${this.config.includeDetails ? `
  <h2>Scenario Results</h2>
  ${run.scenarios.map(result => `
    <div class="scenario ${result.passed ? 'passed' : 'failed'}">
      <h3>${result.passed ? '✅' : '❌'} ${result.scenarioId}</h3>
      ${result.error ? `<p><strong>Error:</strong> ${result.error}</p>` : ''}
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
  ` : ''}

  <div class="footer">
    Generated by FlowTrace | ${new Date().toISOString()}
  </div>
</body>
</html>`;

    return html;
  }

  generateJson(run: VerificationRun): string {
    return JSON.stringify(run, null, 2);
  }
}
