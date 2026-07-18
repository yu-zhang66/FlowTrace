import { z } from 'zod';
import {
  VerificationReport,
  VerificationReportSchema,
  CaseResult,
  CaseResultSchema,
  StepResult,
  StepResultSchema,
  AccountSwitchTimeline,
  AccountSwitchTimelineSchema,
  ConfigCheckResult,
  ConfigCheckResultSchema,
  ReleaseGateStatus,
  ReleaseGateStatusSchema
} from '@flowtrace/core';

/**
 * HTML Renderer Options
 */
export interface HtmlRendererOptions {
  theme?: 'light' | 'dark';
  includeScreenshots?: boolean;
  includeTraces?: boolean;
  language?: 'zh' | 'en';
}

/**
 * Status label translations
 */
const STATUS_LABELS = {
  zh: {
    PASS: '通过',
    FAIL: '失败',
    BLOCKED: '阻断',
    NOT_EXECUTED: '未执行',
    CONFIG_MISSING: '配置缺失',
    SKIPPED: '跳过',
    READY: '就绪',
    BLOCKED_MISSING_CONFIG: '配置缺失',
    WARNING: '警告'
  },
  en: {
    PASS: 'Pass',
    FAIL: 'Fail',
    BLOCKED: 'Blocked',
    NOT_EXECUTED: 'Not Executed',
    CONFIG_MISSING: 'Config Missing',
    SKIPPED: 'Skipped',
    READY: 'Ready',
    BLOCKED_MISSING_CONFIG: 'Missing Config',
    WARNING: 'Warning'
  }
};

/**
 * Verification Report HTML Renderer
 * Generates HTML test reports from VerificationReport objects
 */
export class VerificationReportHtmlRenderer {
  private options: Required<HtmlRendererOptions>;
  private labels: typeof STATUS_LABELS.zh;

  constructor(options: HtmlRendererOptions = {}) {
    this.options = {
      theme: options.theme ?? 'light',
      includeScreenshots: options.includeScreenshots ?? true,
      includeTraces: options.includeTraces ?? true,
      language: options.language ?? 'zh'
    };
    this.labels = STATUS_LABELS[this.options.language];
  }

  /**
   * Get status display label
   */
  private getStatusLabel(status: string): string {
    return this.labels[status as keyof typeof this.labels] ?? status;
  }

  /**
   * Get status CSS class
   */
  private getStatusClass(status: string): string {
    switch (status) {
      case 'PASS':
        return 'ok';
      case 'FAIL':
        return 'bad';
      case 'BLOCKED':
        return 'warn';
      case 'NOT_EXECUTED':
      case 'CONFIG_MISSING':
      case 'SKIPPED':
        return 'muted';
      default:
        return '';
    }
  }

  /**
   * Get case status CSS class
   */
  private getCaseStatusClass(status: string): string {
    switch (status) {
      case 'PASS':
        return 'case-pass';
      case 'FAIL':
        return 'case-fail';
      case 'BLOCKED':
        return 'case-blocked';
      case 'NOT_EXECUTED':
      case 'CONFIG_MISSING':
        return 'case-pending';
      default:
        return '';
    }
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: unknown): string {
    if (text === null || text === undefined) return '';
    const str = String(text);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Format datetime for display
   */
  private formatDatetime(isoString: string): string {
    try {
      return new Date(isoString).toLocaleString(this.options.language === 'zh' ? 'zh-CN' : 'en-US');
    } catch {
      return isoString;
    }
  }

  /**
   * Format duration in milliseconds
   */
  private formatDuration(ms?: number): string {
    if (ms === undefined || ms === null) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}min`;
  }

  /**
   * Get severity display text
   */
  private getSeverityText(severity: string): string {
    switch (severity) {
      case 'P0':
        return this.options.language === 'zh' ? 'P0 (阻断)' : 'P0 (blocking)';
      case 'P1':
        return this.options.language === 'zh' ? 'P1 (高)' : 'P1 (high)';
      case 'P2':
        return this.options.language === 'zh' ? 'P2 (中)' : 'P2 (medium)';
      case 'P3':
        return this.options.language === 'zh' ? 'P3 (低)' : 'P3 (low)';
      default:
        return severity;
    }
  }

  /**
   * Render configuration check result
   */
  renderConfigCheck(result: unknown): string {
    const parsed = ConfigCheckResultSchema.safeParse(result);
    if (!parsed.success) {
      return `<div class="err">Invalid ConfigCheckResult: ${this.escapeHtml(parsed.error.message)}</div>`;
    }

    const config = parsed.data;
    const isReady = config.status === 'READY';

    let html = `
      <div class="config-check ${isReady ? 'config-ready' : 'config-blocked'}">
        <h3>${this.options.language === 'zh' ? '配置检查' : 'Configuration Check'}</h3>
        <table>
          <tr>
            <th>${this.options.language === 'zh' ? '状态' : 'Status'}</th>
            <td class="${this.getStatusClass(config.status)}">${this.getStatusLabel(config.status)}</td>
          </tr>
          <tr>
            <th>${this.options.language === 'zh' ? '检查时间' : 'Checked At'}</th>
            <td>${this.formatDatetime(config.checkedAt)}</td>
          </tr>
    `;

    if (config.project) {
      html += `
          <tr>
            <th>${this.options.language === 'zh' ? '项目' : 'Project'}</th>
            <td>${this.escapeHtml(config.project.projectName ?? config.project.projectId)}</td>
          </tr>
      `;
    }

    html += '</table>';

    if (config.missing && config.missing.length > 0) {
      html += `
        <h4>${this.options.language === 'zh' ? '缺失配置' : 'Missing Configuration'}</h4>
        <table>
          <tr>
            <th>${this.options.language === 'zh' ? '键' : 'Key'}</th>
            <th>${this.options.language === 'zh' ? '类型' : 'Type'}</th>
            <th>${this.options.language === 'zh' ? '描述' : 'Description'}</th>
          </tr>
      `;

      for (const item of config.missing) {
        html += `
          <tr>
            <td><code>${this.escapeHtml(item.key)}</code></td>
            <td>${this.escapeHtml(item.type)}</td>
            <td>${this.escapeHtml(item.description)}</td>
          </tr>
        `;
      }

      html += '</table>';
    }

    if (config.warnings && config.warnings.length > 0) {
      html += `
        <h4>${this.options.language === 'zh' ? '警告' : 'Warnings'}</h4>
        <ul class="warnings">
      `;

      for (const warning of config.warnings) {
        html += `
          <li><strong>${this.escapeHtml(warning.key)}</strong>: ${this.escapeHtml(warning.message)}</li>
        `;
      }

      html += '</ul>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Render account switch timeline
   */
  renderAccountSwitchTimeline(timeline: AccountSwitchTimeline[]): string {
    const parsedArray = z.array(AccountSwitchTimelineSchema).safeParse(timeline);
    if (!parsedArray.success) {
      return `<div class="err">Invalid AccountSwitchTimeline: ${this.escapeHtml(parsedArray.error.message)}</div>`;
    }

    if (parsedArray.data.length === 0) {
      return '';
    }

    let html = `
      <h4>${this.options.language === 'zh' ? '账号切换时间线' : 'Account Switch Timeline'}</h4>
      <div class="timeline">
    `;

    for (const item of parsedArray.data) {
      const resultClass = item.result === 'success' ? 'timeline-success' :
                          item.result === 'failed' ? 'timeline-failed' : 'timeline-partial';

      html += `
        <div class="timeline-item ${resultClass}">
          <div class="timeline-sequence">${item.sequence}</div>
          <div class="timeline-content">
            <div class="timeline-header">
              <span class="timeline-accounts">
                ${this.escapeHtml(item.fromAccount)} → ${this.escapeHtml(item.toAccount)}
              </span>
              <span class="timeline-time">${this.formatDatetime(item.timestamp)}</span>
            </div>
            <div class="timeline-details">
              <span class="timeline-result ${item.result === 'success' ? 'ok' : item.result === 'failed' ? 'bad' : 'warn'}">
                ${item.result === 'success' ? (this.options.language === 'zh' ? '成功' : 'Success') :
                  item.result === 'failed' ? (this.options.language === 'zh' ? '失败' : 'Failed') :
                  (this.options.language === 'zh' ? '部分成功' : 'Partial')}
              </span>
              ${item.contextPreserved ? `<span class="timeline-context-preserved">${this.options.language === 'zh' ? '上下文已保留' : 'Context Preserved'}</span>` : ''}
              ${item.reason ? `<span class="timeline-reason">${this.escapeHtml(item.reason)}</span>` : ''}
              ${item.duration ? `<span class="timeline-duration">${this.formatDuration(item.duration)}</span>` : ''}
            </div>
            ${item.error ? `<div class="err">${this.escapeHtml(item.error)}</div>` : ''}
          </div>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  /**
   * Render step result
   */
  renderStepResult(result: StepResult): string {
    const parsed = StepResultSchema.safeParse(result);
    if (!parsed.success) {
      return `<div class="err">Invalid StepResult: ${this.escapeHtml(parsed.error.message)}</div>`;
    }

    const step = parsed.data;
    const statusClass = this.getStatusClass(step.status);

    let html = `
      <div class="step-result ${statusClass}">
        <div class="step-header">
          <span class="step-name">${this.escapeHtml(step.name)}</span>
          <span class="step-status ${statusClass}">${this.getStatusLabel(step.status)}</span>
          ${step.duration !== undefined ? `<span class="step-duration">${this.formatDuration(step.duration)}</span>` : ''}
        </div>
    `;

    if (step.startedAt) {
      html += `<div class="step-time">${this.formatDatetime(step.startedAt)}</div>`;
    }

    if (step.executedBy) {
      html += `<div class="step-executor">${this.options.language === 'zh' ? '执行账号' : 'Executed by'}: ${this.escapeHtml(step.executedBy)}</div>`;
    }

    if (step.error) {
      html += `
        <div class="step-error">
          <strong>${this.options.language === 'zh' ? '错误' : 'Error'}:</strong>
          ${step.error.code ? `<code>${this.escapeHtml(step.error.code)}</code> ` : ''}
          ${this.escapeHtml(step.error.message)}
          ${step.error.stack ? `<pre class="error-stack">${this.escapeHtml(step.error.stack)}</pre>` : ''}
        </div>
      `;
    }

    if (step.assertions && step.assertions.length > 0) {
      html += `
        <div class="step-assertions">
          <strong>${this.options.language === 'zh' ? '断言' : 'Assertions'}:</strong>
          <ul>
      `;

      for (const assertion of step.assertions) {
        const assertClass = assertion.passed ? 'ok' : 'bad';
        html += `
          <li class="${assertClass}">
            ${assertion.passed ? '✓' : '✗'} ${this.escapeHtml(assertion.description)}
            ${assertion.expected !== undefined && assertion.actual !== undefined ?
              `<br><span class="muted">Expected: ${this.escapeHtml(JSON.stringify(assertion.expected))}, Actual: ${this.escapeHtml(JSON.stringify(assertion.actual))}</span>` : ''}
          </li>
        `;
      }

      html += '</ul></div>';
    }

    if (step.screenshot && this.options.includeScreenshots) {
      html += `
        <div class="step-screenshot">
          <a href="${this.escapeHtml(step.screenshot)}" target="_blank">
            <img src="${this.escapeHtml(step.screenshot)}" alt="Step screenshot" style="max-width: 200px;" />
          </a>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  /**
   * Render case result
   */
  renderCaseResult(result: CaseResult): string {
    const parsed = CaseResultSchema.safeParse(result);
    if (!parsed.success) {
      return `<div class="err">Invalid CaseResult: ${this.escapeHtml(parsed.error.message)}</div>`;
    }

    const caseResult = parsed.data;
    const statusClass = this.getCaseStatusClass(caseResult.status);
    const statusLabelClass = this.getStatusClass(caseResult.status);

    let html = `
      <div class="case-block ${statusClass}">
        <div class="case-header">
          <div>
            <h3>${this.escapeHtml(caseResult.caseName)}</h3>
            ${caseResult.startedAt ? `
              <div class="meta">
                ${this.formatDatetime(caseResult.startedAt)}
                ${caseResult.duration !== undefined ? ` · ${this.formatDuration(caseResult.duration)}` : ''}
              </div>
            ` : ''}
          </div>
          <div class="case-status">
            <span class="${statusLabelClass}">${this.getStatusLabel(caseResult.status)}</span>
          </div>
        </div>
    `;

    if (caseResult.missingConfigDetails && caseResult.missingConfigDetails.length > 0) {
      html += `
        <div class="case-missing-config">
          <h4>${this.options.language === 'zh' ? '缺失配置' : 'Missing Configuration'}</h4>
          <ul>
      `;

      for (const config of caseResult.missingConfigDetails) {
        html += `
          <li>
            <code>${this.escapeHtml(config.key)}</code> (${this.escapeHtml(config.type)}): ${this.escapeHtml(config.description)}
          </li>
        `;
      }

      html += '</ul></div>';
    }

    if (caseResult.errorDetails) {
      html += `
        <div class="err">
          <strong>${caseResult.errorDetails.code ? `${this.escapeHtml(caseResult.errorDetails.code)}: ` : ''}${this.escapeHtml(caseResult.errorDetails.message)}</strong>
          ${caseResult.errorDetails.failingStepId ? `<div class="muted">${this.options.language === 'zh' ? '失败步骤' : 'Failing Step'}: ${this.escapeHtml(caseResult.errorDetails.failingStepId)}</div>` : ''}
          ${caseResult.errorDetails.stack ? `<pre class="error-stack">${this.escapeHtml(caseResult.errorDetails.stack)}</pre>` : ''}
        </div>
      `;
    }

    if (caseResult.steps && caseResult.steps.length > 0) {
      html += `
        <div class="case-steps">
          <h4>${this.options.language === 'zh' ? '步骤执行结果' : 'Step Results'}</h4>
      `;

      for (const step of caseResult.steps) {
        html += this.renderStepResult(step);
      }

      html += '</div>';
    }

    if (caseResult.accountSwitchTimeline && caseResult.accountSwitchTimeline.length > 0) {
      html += this.renderAccountSwitchTimeline(caseResult.accountSwitchTimeline);
    }

    if (caseResult.screenshots && caseResult.screenshots.length > 0 && this.options.includeScreenshots) {
      html += `
        <div class="case-screenshots">
          <h4>${this.options.language === 'zh' ? '截图' : 'Screenshots'}</h4>
          <div class="shots-grid">
      `;

      for (const shot of caseResult.screenshots) {
        html += `
          <figure class="shot">
            <figcaption>
              <span class="shot-time">${this.formatDatetime(shot.timestamp)}</span>
              ${shot.type ? `<span class="shot-type">${shot.type}</span>` : ''}
              ${shot.description ? `<span class="shot-desc">${this.escapeHtml(shot.description)}</span>` : ''}
            </figcaption>
            <a href="${this.escapeHtml(shot.path)}" target="_blank">
              <img src="${this.escapeHtml(shot.path)}" alt="${this.escapeHtml(shot.description ?? shot.path)}" />
            </a>
            <div class="shot-name">${this.escapeHtml(shot.path)}</div>
          </figure>
        `;
      }

      html += '</div></div>';
    }

    if (caseResult.browserTraces && caseResult.browserTraces.length > 0 && this.options.includeTraces) {
      html += `
        <div class="case-traces">
          <h4>${this.options.language === 'zh' ? '浏览器 Trace' : 'Browser Traces'}</h4>
          <div class="traces-list">
      `;

      for (const trace of caseResult.browserTraces) {
        html += `
          <div class="trace-item trace-${this.escapeHtml(trace.type)}">
            <div class="trace-header">
              <span class="trace-type">${this.escapeHtml(trace.type)}</span>
              <span class="trace-time">${this.formatDatetime(trace.timestamp)}</span>
            </div>
            <pre class="trace-content">${this.escapeHtml(JSON.stringify(trace.content, null, 2))}</pre>
          </div>
        `;
      }

      html += '</div></div>';
    }

    if (caseResult.apiSummaries && caseResult.apiSummaries.length > 0) {
      html += `
        <div class="case-apis">
          <h4>${this.options.language === 'zh' ? 'API 请求摘要' : 'API Summaries'}</h4>
          <table class="api-table">
            <tr>
              <th>${this.options.language === 'zh' ? '方法' : 'Method'}</th>
              <th>${this.options.language === 'zh' ? '路径' : 'Path'}</th>
              <th>${this.options.language === 'zh' ? '状态' : 'Status'}</th>
              <th>${this.options.language === 'zh' ? '响应时间' : 'Response Time'}</th>
            </tr>
      `;

      for (const api of caseResult.apiSummaries) {
        const apiStatusClass = api.success ? 'ok' : 'bad';
        html += `
          <tr>
            <td><code>${this.escapeHtml(api.method)}</code></td>
            <td><code>${this.escapeHtml(api.path)}</code></td>
            <td class="${apiStatusClass}">${api.statusCode}</td>
            <td>${this.formatDuration(api.responseTime)}</td>
          </tr>
        `;
      }

      html += '</table></div>';
    }

    if (caseResult.dbBeforeAfter && caseResult.dbBeforeAfter.length > 0) {
      html += `
        <div class="case-database">
          <h4>${this.options.language === 'zh' ? '数据库状态变更' : 'Database Changes'}</h4>
      `;

      for (const db of caseResult.dbBeforeAfter) {
        html += `
          <div class="db-item">
            <div class="db-header">
              <code>${this.escapeHtml(db.tableName)}</code>
              <span class="db-operation">${db.operation}</span>
              <span class="db-time">${this.formatDatetime(db.timestamp)}</span>
            </div>
            ${db.before && db.before.length > 0 ? `
              <div class="db-before">
                <strong>${this.options.language === 'zh' ? '执行前' : 'Before'}:</strong>
                <pre>${this.escapeHtml(JSON.stringify(db.before, null, 2))}</pre>
              </div>
            ` : ''}
            ${db.after && db.after.length > 0 ? `
              <div class="db-after">
                <strong>${this.options.language === 'zh' ? '执行后' : 'After'}:</strong>
                <pre>${this.escapeHtml(JSON.stringify(db.after, null, 2))}</pre>
              </div>
            ` : ''}
          </div>
        `;
      }

      html += '</div>';
    }

    if (caseResult.differences && caseResult.differences.length > 0) {
      html += `
        <h4>${this.options.language === 'zh' ? '差异比较' : 'Differences'}</h4>
        <table class="diffs">
          <tr>
            <th>${this.options.language === 'zh' ? '严重级别' : 'Severity'}</th>
            <th>${this.options.language === 'zh' ? '类别' : 'Category'}</th>
            <th>${this.options.language === 'zh' ? '描述' : 'Description'}</th>
          </tr>
      `;

      for (const diff of caseResult.differences) {
        const sevClass = diff.severity === 'P0' || diff.severity === 'P1' ? 'bad' :
                         diff.severity === 'P2' ? 'warn' : '';
        html += `
          <tr>
            <td class="${sevClass}">${this.getSeverityText(diff.severity)}</td>
            <td>${this.escapeHtml(diff.category)}</td>
            <td>${this.escapeHtml(diff.description)}</td>
          </tr>
        `;
      }

      html += '</table>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Render release gate status
   */
  renderReleaseGate(status: ReleaseGateStatus): string {
    const parsed = ReleaseGateStatusSchema.safeParse(status);
    if (!parsed.success) {
      return `<div class="err">Invalid ReleaseGateStatus: ${this.escapeHtml(parsed.error.message)}</div>`;
    }

    const gate = parsed.data;
    const statusClass = this.getStatusClass(gate.status);
    const statusIcon = gate.status === 'PASS' ? '✓' :
                       gate.status === 'FAIL' ? '✗' :
                       gate.status === 'WARNING' ? '⚠' : '○';

    let html = `
      <div class="release-gate gate-${gate.status.toLowerCase()}">
        <h3>${this.options.language === 'zh' ? 'Release Gate 状态' : 'Release Gate Status'}</h3>
        <div class="gate-status ${statusClass}">
          <span class="gate-icon">${statusIcon}</span>
          <span class="gate-label">${this.getStatusLabel(gate.status)}</span>
        </div>
    `;

    if (gate.passRate !== undefined) {
      html += `
        <div class="gate-passrate">
          ${this.options.language === 'zh' ? '通过率' : 'Pass Rate'}: ${(gate.passRate * 100).toFixed(1)}%
        </div>
      `;
    }

    if (gate.message) {
      html += `
        <div class="gate-message">${this.escapeHtml(gate.message)}</div>
      `;
    }

    if (gate.blockingDifferences && gate.blockingDifferences.length > 0) {
      html += `
        <div class="gate-blockers">
          <h4>${this.options.language === 'zh' ? '阻塞性差异' : 'Blocking Differences'}</h4>
          <table class="blockers-table">
            <tr>
              <th>${this.options.language === 'zh' ? '严重级别' : 'Severity'}</th>
              <th>${this.options.language === 'zh' ? '类别' : 'Category'}</th>
              <th>${this.options.language === 'zh' ? '描述' : 'Description'}</th>
            </tr>
      `;

      for (const blocker of gate.blockingDifferences) {
        const sevClass = blocker.severity === 'P0' || blocker.severity === 'P1' ? 'bad' :
                         blocker.severity === 'P2' ? 'warn' : '';
        html += `
          <tr>
            <td class="${sevClass}">${this.getSeverityText(blocker.severity)}</td>
            <td>${this.escapeHtml(blocker.category)}</td>
            <td>${this.escapeHtml(blocker.description)}</td>
          </tr>
        `;
      }

      html += '</table></div>';
    }

    if (gate.recommendations && gate.recommendations.length > 0) {
      html += `
        <div class="gate-recommendations">
          <h4>${this.options.language === 'zh' ? '建议' : 'Recommendations'}</h4>
          <ul>
      `;

      for (const rec of gate.recommendations) {
        html += `<li>${this.escapeHtml(rec)}</li>`;
      }

      html += '</ul></div>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Render complete verification report
   */
  render(report: VerificationReport): string {
    const parsed = VerificationReportSchema.safeParse(report);
    if (!parsed.success) {
      return `<div class="err">Invalid VerificationReport: ${this.escapeHtml(parsed.error.message)}</div>`;
    }

    const r = parsed.data;

    const isDark = this.options.theme === 'dark';
    const bgColor = isDark ? '#1a1a2e' : '#f9fafb';
    const textColor = isDark ? '#eee' : '#1f2937';
    const cardBg = isDark ? '#16213e' : '#fff';
    const borderColor = isDark ? '#374151' : '#e5e7eb';

    const passRate = r.totalCases > 0 ? ((r.passed / r.totalCases) * 100).toFixed(1) : '0';

    let html = `<!DOCTYPE html>
<html lang="${this.options.language === 'zh' ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlowTrace Verification Report - ${this.escapeHtml(r.metadata.projectName)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px;
      color: ${textColor};
      background: ${bgColor};
    }
    h1 { margin-bottom: 24px; }
    h2 { margin: 24px 0 12px; }
    h3 { margin: 0 0 8px; }
    h4 { margin: 16px 0 8px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { border: 1px solid ${borderColor}; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: ${isDark ? '#1f2937' : '#f3f4f6'}; font-weight: 600; }
    .ok { color: #087f5b; font-weight: 600; }
    .bad { color: #c92a2a; font-weight: 600; }
    .warn { color: #b45309; font-weight: 600; }
    .muted { color: #6b7280; font-style: italic; }
    .meta { font-size: 13px; color: #374151; margin: 4px 0; }
    .meta code { background: ${isDark ? '#374151' : '#f3f4f6'}; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
    code { background: ${isDark ? '#374151' : '#f3f4f6'}; padding: 2px 5px; border-radius: 4px; font-size: 12px; }
    .err { background: ${isDark ? '#7f1d1d' : '#fef2f2'}; border-left: 3px solid #ef4444; padding: 8px 12px; margin: 6px 0; border-radius: 4px; font-size: 12px; }
    .err code { background: transparent; padding: 0; color: #991b1b; }
    .case-block, .config-check, .release-gate {
      background: ${cardBg};
      border: 1px solid ${borderColor};
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    }
    .case-block.case-pass { border-left: 4px solid #087f5b; }
    .case-block.case-fail { border-left: 4px solid #c92a2a; }
    .case-block.case-blocked { border-left: 4px solid #b45309; }
    .case-block.case-pending { border-left: 4px solid #6b7280; }
    .case-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid ${borderColor}; }
    .case-status { font-size: 18px; font-weight: 700; padding: 4px 12px; border-radius: 6px; }
    .case-pass .case-status { background: ${isDark ? '#064e3b' : '#d1fae5'}; color: #065f46; }
    .case-fail .case-status { background: ${isDark ? '#7f1d1d' : '#fee2e2'}; color: #991b1b; }
    .case-blocked .case-status { background: ${isDark ? '#78350f' : '#fef3c7'}; color: #92400e; }
    .case-pending .case-status { background: ${isDark ? '#374151' : '#f3f4f6'}; color: #6b7280; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin: 16px 0; }
    .summary-item { background: ${isDark ? '#1f2937' : '#f9fafb'}; border: 1px solid ${borderColor}; border-radius: 8px; padding: 16px; text-align: center; }
    .summary-item .value { font-size: 28px; font-weight: 700; }
    .summary-item .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
    .shots-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 10px; }
    .shot { margin: 0; padding: 8px; border: 1px solid ${borderColor}; border-radius: 6px; background: ${isDark ? '#1f2937' : '#fff'}; }
    .shot img { display: block; width: 100%; height: auto; margin-top: 6px; border-radius: 4px; cursor: zoom-in; }
    .shot figcaption { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; }
    .shot-name { font-family: monospace; font-size: 10px; color: #6b7280; margin-top: 4px; word-break: break-all; }
    .shot-time { color: #9ca3af; font-family: monospace; font-size: 10px; }
    .shot-type { background: #6b7280; color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
    .shot-desc { color: #4b5563; flex: 1; }
    .diffs { font-size: 12px; }
    .timeline { margin: 12px 0; }
    .timeline-item { display: flex; gap: 12px; padding: 12px; margin: 8px 0; border-radius: 6px; background: ${isDark ? '#1f2937' : '#f9fafb'}; }
    .timeline-sequence { width: 28px; height: 28px; border-radius: 50%; background: ${borderColor}; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
    .timeline-content { flex: 1; }
    .timeline-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
    .timeline-accounts { font-weight: 600; }
    .timeline-time { color: #6b7280; font-size: 12px; }
    .timeline-details { display: flex; gap: 12px; font-size: 12px; flex-wrap: wrap; }
    .timeline-duration { color: #6b7280; }
    .timeline-context-preserved { color: #087f5b; }
    .timeline-result { font-weight: 600; }
    .step-result { padding: 12px; margin: 8px 0; border-radius: 6px; background: ${isDark ? '#1f2937' : '#f9fafb'}; }
    .step-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .step-name { font-weight: 600; }
    .step-status { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .step-duration { color: #6b7280; font-size: 12px; }
    .step-assertions ul { margin: 8px 0; padding-left: 20px; }
    .step-assertions li { margin: 4px 0; }
    .error-stack { font-size: 11px; overflow-x: auto; white-space: pre-wrap; color: #991b1b; }
    .trace-item { margin: 8px 0; padding: 8px; border-radius: 4px; background: ${isDark ? '#1f2937' : '#f9fafb'}; }
    .trace-header { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 12px; }
    .trace-type { font-weight: 600; text-transform: uppercase; }
    .trace-content { font-size: 11px; overflow-x: auto; white-space: pre-wrap; max-height: 200px; margin: 4px 0 0; }
    .api-table { font-size: 12px; }
    .db-item { margin: 12px 0; padding: 12px; border: 1px solid ${borderColor}; border-radius: 6px; }
    .db-header { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
    .db-operation { background: ${borderColor}; padding: 2px 6px; border-radius: 3px; font-size: 11px; }
    .db-before, .db-after { margin: 8px 0; }
    .db-before pre, .db-after pre { font-size: 11px; overflow-x: auto; white-space: pre-wrap; max-height: 100px; margin: 4px 0 0; background: ${cardBg}; padding: 8px; border-radius: 4px; }
    .config-ready { border-left: 4px solid #087f5b; }
    .config-blocked { border-left: 4px solid #c92a2a; }
    .warnings { padding-left: 20px; }
    .warnings li { margin: 4px 0; }
    .gate-PASS { border-left: 4px solid #087f5b; }
    .gate-FAIL { border-left: 4px solid #c92a2a; }
    .gate-WARNING { border-left: 4px solid #b45309; }
    .gate-SKIPPED { border-left: 4px solid #6b7280; }
    .gate-status { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; margin: 12px 0; }
    .gate-icon { font-size: 24px; }
    .gate-passrate { font-size: 16px; margin: 8px 0; }
    .gate-message { margin: 8px 0; padding: 12px; background: ${isDark ? '#1f2937' : '#f3f4f6'}; border-radius: 4px; }
    .blockers-table { font-size: 12px; }
    .legacy-warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px 16px; margin: 16px 0; display: flex; align-items: center; gap: 12px; }
    .legacy-warning-icon { font-size: 24px; }
    .legacy-warning-text { flex: 1; }
    .legacy-warning-title { font-weight: 600; color: #92400e; }
    .legacy-warning-desc { font-size: 13px; color: #b45309; margin-top: 4px; }
    .footer { text-align: center; color: #6b7280; margin-top: 32px; font-size: 12px; }
  </style>
</head>
<body>
  <h1>FlowTrace ${this.options.language === 'zh' ? '验证测试报告' : 'Verification Report'}</h1>

  <table class="report-header">
    <tr>
      <th>${this.options.language === 'zh' ? '项目名称' : 'Project'}</th>
      <td>${this.escapeHtml(r.metadata.projectName)}</td>
    </tr>
    ${r.metadata.processName ? `
    <tr>
      <th>${this.options.language === 'zh' ? '流程名称' : 'Process'}</th>
      <td>${this.escapeHtml(r.metadata.processName)}</td>
    </tr>
    ` : ''}
    <tr>
      <th>${this.options.language === 'zh' ? '执行时间' : 'Executed At'}</th>
      <td>${this.formatDatetime(r.metadata.executedAt)}</td>
    </tr>
    <tr>
      <th>${this.options.language === 'zh' ? '执行模式' : 'Execution Mode'}</th>
      <td>${this.escapeHtml(r.metadata.executionMode)}</td>
    </tr>
    ${r.metadata.adapterMode ? `
    <tr>
      <th>${this.options.language === 'zh' ? '适配器模式' : 'Adapter Mode'}</th>
      <td>${this.escapeHtml(r.metadata.adapterMode)}</td>
    </tr>
    ` : ''}
    ${r.metadata.environment ? `
    <tr>
      <th>${this.options.language === 'zh' ? '执行环境' : 'Environment'}</th>
      <td>${this.escapeHtml(r.metadata.environment)}</td>
    </tr>
    ` : ''}
  </table>

  <div class="summary-grid">
    <div class="summary-item">
      <div class="value">${r.totalCases}</div>
      <div class="label">${this.options.language === 'zh' ? '案例总数' : 'Total Cases'}</div>
    </div>
    <div class="summary-item">
      <div class="value ok">${r.passed}</div>
      <div class="label">${this.options.language === 'zh' ? '通过' : 'Passed'}</div>
    </div>
    <div class="summary-item">
      <div class="value bad">${r.failed}</div>
      <div class="label">${this.options.language === 'zh' ? '失败' : 'Failed'}</div>
    </div>
    <div class="summary-item">
      <div class="value warn">${r.blocked}</div>
      <div class="label">${this.options.language === 'zh' ? '阻断' : 'Blocked'}</div>
    </div>
    <div class="summary-item">
      <div class="value muted">${r.notExecuted}</div>
      <div class="label">${this.options.language === 'zh' ? '未执行' : 'Not Executed'}</div>
    </div>
    <div class="summary-item">
      <div class="value">${passRate}%</div>
      <div class="label">${this.options.language === 'zh' ? '通过率' : 'Pass Rate'}</div>
    </div>
  </div>

  ${this.renderConfigCheck(r.configCheck)}
`;

    if (r.legacyShadowWarning) {
      html += `
  <div class="legacy-warning">
    <span class="legacy-warning-icon">⚠</span>
    <div class="legacy-warning-text">
      <div class="legacy-warning-title">${this.options.language === 'zh' ? 'Legacy Shadow 模式警告' : 'Legacy Shadow Mode Warning'}</div>
      <div class="legacy-warning-desc">${this.options.language === 'zh' ? '当前结果不证明新旧流程真实等价' : 'Current results do not prove real equivalence between old and new processes'}</div>
    </div>
  </div>
      `;
    }

    html += `
  <h2>${this.options.language === 'zh' ? '案例结果详情' : 'Case Results'}</h2>
`;

    for (const caseResult of r.caseResults) {
      html += this.renderCaseResult(caseResult);
    }

    html += `
  ${this.renderReleaseGate(r.releaseGate)}

  <div class="footer">
    ${this.options.language === 'zh' ? '由 FlowTrace 生成' : 'Generated by FlowTrace'} | ${new Date().toISOString()}
  </div>
</body>
</html>`;

    return html;
  }
}
