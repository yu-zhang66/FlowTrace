/**
 * Scenario Renderer
 * 
 * 将测试案例渲染为多种格式：
 * - JSON (机器可读)
 * - Markdown (人工可读)
 * - HTML (页面展示)
 * - Mermaid (流程图)
 */

import type { Scenario } from '@flowtrace/core';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';

export interface ScenarioRendererConfig {
  outputDir: string;
  includeMermaid: boolean;
  includeTimeline: boolean;
  language: 'zh' | 'en';
}

const DEFAULT_CONFIG: ScenarioRendererConfig = {
  outputDir: '.flowtrace/scenarios/rendered',
  includeMermaid: true,
  includeTimeline: true,
  language: 'zh'
};

/**
 * 场景渲染器
 */
export class ScenarioRenderer {
  private config: ScenarioRendererConfig;

  constructor(config: Partial<ScenarioRendererConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 渲染单个场景
   */
  renderScenario(scenario: Scenario): RenderedScenario {
    const md = this.renderMarkdown(scenario);
    const html = this.renderHtml(scenario);
    const mermaid = this.renderMermaid(scenario);
    const timeline = this.renderTimeline(scenario);

    return {
      scenario,
      markdown: md,
      html,
      mermaid,
      timeline,
      sequenceDiagram: this.renderSequenceDiagram(scenario)
    };
  }

  /**
   * 渲染所有场景
   */
  renderAll(scenarios: Scenario[]): RenderedScenario[] {
    return scenarios.map(s => this.renderScenario(s));
  }

  /**
   * 保存渲染结果
   */
  saveRenderedScenarios(scenarios: RenderedScenario[]): void {
    const outputDir = this.config.outputDir;
    
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    for (const rendered of scenarios) {
      const baseName = this.sanitizeFileName(rendered.scenario.id);
      
      // 保存 Markdown
      writeFileSync(join(outputDir, `${baseName}.md`), rendered.markdown, 'utf-8');
      
      // 保存 HTML
      writeFileSync(join(outputDir, `${baseName}.html`), rendered.html, 'utf-8');
      
      // 保存 Mermaid
      writeFileSync(join(outputDir, `${baseName}-mermaid.mmd`), rendered.mermaid, 'utf-8');
    }

    // 生成索引
    this.generateIndex(scenarios);
  }

  /**
   * 渲染为 Markdown
   */
  renderMarkdown(scenario: Scenario): string {
    const severity = scenario.severity || 'P2';
    const severityLabel = this.getSeverityLabel(severity);
    
    let md = `# 案例：${scenario.name}\n\n`;
    
    // 元信息
    md += `| 属性 | 值 |\n`;
    md += `|------|-----|\n`;
    md += `| 案例编号 | ${scenario.id} |\n`;
    md += `| 案例名称 | ${scenario.name} |\n`;
    md += `| 测试目标 | ${scenario.tags?.join(', ') || '未分类'} |\n`;
    md += `| 严重级别 | ${severityLabel} |\n`;
    md += `| 来源依据 | ${scenario.source?.join(', ') || '未标注'} |\n`;
    md += `| 是否 AI 生成 | ${scenario.source?.some(s => s.includes('ai')) ? '是' : '否'} |\n`;
    md += `| 是否经过人工确认 | 待确认 |\n\n`;

    // 一、业务目标
    md += `## 一、业务目标\n\n`;
    md += `${this.getBusinessGoal(scenario)}\n\n`;

    // 二、参与角色
    md += `## 二、参与角色\n\n`;
    md += this.renderRoles(scenario) + '\n';

    // 三、前置条件
    md += `## 三、前置条件\n\n`;
    md += this.renderPreconditions(scenario) + '\n';

    // 四、业务流程图
    md += `## 四、业务流程图\n\n`;
    md += this.renderMermaid(scenario) + '\n';

    // 五、详细步骤
    md += `## 五、详细步骤\n\n`;
    md += this.renderSteps(scenario) + '\n';

    // 六、预期业务结果
    md += `## 六、预期业务结果\n\n`;
    md += this.renderExpectedResult(scenario) + '\n';

    // 七、预期数据变化
    md += `## 七、预期数据变化\n\n`;
    md += this.renderExpectedDataChanges(scenario) + '\n';

    // 八、预期 API 调用
    md += `## 八、预期 API 调用\n\n`;
    md += this.renderExpectedApiCalls(scenario) + '\n';

    // 九、通过标准
    md += `## 九、通过标准\n\n`;
    md += this.renderPassCriteria(scenario) + '\n';

    // 十、风险与来源
    md += `## 十、风险与来源\n\n`;
    md += this.renderRiskAndSource(scenario) + '\n';

    return md;
  }

  /**
   * 渲染为 HTML
   */
  renderHtml(scenario: Scenario): string {
    const markdown = this.renderMarkdown(scenario);
    
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${scenario.name} - FlowTrace 测试案例</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
      color: #333;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 20px;
    }
    .header h1 { margin: 0 0 10px 0; }
    .meta {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
      margin-top: 15px;
    }
    .meta-item {
      background: rgba(255,255,255,0.2);
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 14px;
    }
    .severity-${scenario.severity || 'P2'} {
      background: ${this.getSeverityColor(scenario.severity)};
      color: white;
    }
    .section {
      background: white;
      padding: 25px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .section h2 {
      margin-top: 0;
      padding-bottom: 10px;
      border-bottom: 2px solid #667eea;
      color: #333;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th {
      background: #f8f9fa;
      font-weight: 600;
      color: #555;
    }
    .mermaid {
      background: #fafafa;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .timeline {
      position: relative;
      padding-left: 30px;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 10px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #667eea;
    }
    .timeline-item {
      position: relative;
      margin-bottom: 20px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
    }
    .timeline-item::before {
      content: '';
      position: absolute;
      left: -24px;
      top: 18px;
      width: 12px;
      height: 12px;
      background: #667eea;
      border-radius: 50%;
    }
    .timeline-item .step-num {
      font-weight: bold;
      color: #667eea;
    }
    .timeline-item .actor {
      color: #764ba2;
      font-weight: 600;
    }
    .timeline-item .action {
      color: #333;
      margin-top: 5px;
    }
    .result {
      padding: 15px;
      border-radius: 8px;
      margin-top: 10px;
    }
    .result.success { background: #d4edda; border: 1px solid #28a745; }
    .result.error { background: #f8d7da; border: 1px solid #dc3545; }
    .result.pending { background: #fff3cd; border: 1px solid #ffc107; }
    .footer {
      text-align: center;
      color: #888;
      margin-top: 30px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${scenario.name}</h1>
    <p>案例编号: ${scenario.id}</p>
    <div class="meta">
      <span class="meta-item">严重级别: <strong class="severity-${scenario.severity || 'P2'}">${this.getSeverityLabel(scenario.severity || 'P2')}</strong></span>
      <span class="meta-item">目标流程: ${scenario.process}</span>
      <span class="meta-item">来源: ${scenario.source?.join(', ') || '未标注'}</span>
    </div>
  </div>

  <div class="section">
    <h2>一、业务目标</h2>
    <p>${this.getBusinessGoal(scenario)}</p>
  </div>

  <div class="section">
    <h2>二、参与角色</h2>
    ${this.renderRolesHtml(scenario)}
  </div>

  <div class="section">
    <h2>三、前置条件</h2>
    ${this.renderPreconditionsHtml(scenario)}
  </div>

  <div class="section">
    <h2>四、业务流程图</h2>
    <div class="mermaid">
${this.renderMermaid(scenario)}
    </div>
  </div>

  <div class="section">
    <h2>五、详细步骤</h2>
    <div class="timeline">
${this.renderTimelineHtml(scenario)}
    </div>
  </div>

  <div class="section">
    <h2>六、预期业务结果</h2>
    ${this.renderExpectedResultHtml(scenario)}
  </div>

  <div class="section">
    <h2>七、预期数据变化</h2>
    ${this.renderExpectedDataChangesHtml(scenario)}
  </div>

  <div class="section">
    <h2>八、预期 API 调用</h2>
    ${this.renderExpectedApiCallsHtml(scenario)}
  </div>

  <div class="section">
    <h2>九、通过标准</h2>
    ${this.renderPassCriteriaHtml(scenario)}
  </div>

  <div class="footer">
    由 FlowTrace 自动生成 | ${new Date().toLocaleString('zh-CN')}
  </div>

  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      flowchart: { useMaxWidth: true }
    });
  </script>
</body>
</html>`;
  }

  /**
   * 渲染为 Mermaid 流程图
   */
  renderMermaid(scenario: Scenario): string {
    const lines: string[] = ['```mermaid', 'flowchart TD'];
    
    // 添加节点定义
    const nodeIds = new Set<string>();
    
    for (let i = 0; i < scenario.actions.length; i++) {
      const action = scenario.actions[i];
      const nodeId = `N${i}`;
      nodeIds.add(nodeId);
      
      const nodeLabel = this.getActionLabel(action.type);
      const actor = this.getActorName(action.actor);
      
      lines.push(`    ${nodeId}["${nodeLabel}<br/>(${actor})"]`);
      
      // 添加连接线
      if (i > 0) {
        lines.push(`    N${i - 1} --> ${nodeId}`);
      }
    }

    // 添加预期结果
    if (scenario.expected) {
      const resultId = `R${scenario.actions.length}`;
      lines.push(`    ${resultId}["最终状态: ${scenario.expected.finalState}"]`);
      lines.push(`    N${scenario.actions.length - 1} --> ${resultId}`);
    }

    // 渲染分支
    const branchNodes = this.detectBranches(scenario);
    for (const branch of branchNodes) {
      lines.push(`    ${branch.from} -->|${branch.condition}| ${branch.to}`);
    }

    lines.push('```');
    return lines.join('\n');
  }

  /**
   * 渲染为时序图
   */
  renderSequenceDiagram(scenario: Scenario): string {
    const lines: string[] = ['```mermaid', 'sequenceDiagram'];
    
    // 参与者
    const actors = [...new Set(scenario.actions.map(a => this.getActorName(a.actor)))];
    for (const actor of actors) {
      lines.push(`    participant ${actor}`);
    }

    // 时序
    for (const action of scenario.actions) {
      const actor = this.getActorName(action.actor);
      const label = this.getActionLabel(action.type);
      lines.push(`    ${actor}->>+${actor}: ${label}`);
      
      // 判断下一步
      const nextAction = scenario.actions[scenario.actions.indexOf(action) + 1];
      if (nextAction) {
        const nextActor = this.getActorName(nextAction.actor);
        lines.push(`    ${actor}-->>-${nextActor}: 流程继续`);
      }
    }

    lines.push('```');
    return lines.join('\n');
  }

  /**
   * 渲染为时间线
   */
  renderTimeline(scenario: Scenario): string {
    const lines: string[] = [];
    
    for (let i = 0; i < scenario.actions.length; i++) {
      const action = scenario.actions[i];
      const actor = this.getActorName(action.actor);
      const label = this.getActionLabel(action.type);
      const data = action.data ? JSON.stringify(action.data) : '';
      
      lines.push(`### 步骤 ${i + 1}: ${label}`);
      lines.push(`- **操作人**: ${actor}`);
      lines.push(`- **操作**: ${label}`);
      
      if (action.data) {
        lines.push(`- **数据**: ${data}`);
      }
      
      lines.push(`- **前置状态**: ${this.getPreState(scenario, i)}`);
      lines.push(`- **预期后置状态**: ${this.getPostState(scenario, i)}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 生成索引页面
   */
  private generateIndex(scenarios: RenderedScenario[]): void {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>测试案例索引 - FlowTrace</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
    th { background: #667eea; color: white; }
    tr:nth-child(even) { background: #f5f5f5; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>测试案例索引</h1>
  <p>共 ${scenarios.length} 个案例</p>
  <table>
    <thead>
      <tr>
        <th>案例编号</th>
        <th>案例名称</th>
        <th>严重级别</th>
        <th>操作数</th>
        <th>Markdown</th>
        <th>HTML</th>
      </tr>
    </thead>
    <tbody>
${scenarios.map(s => {
  const baseName = this.sanitizeFileName(s.scenario.id);
  return `      <tr>
        <td>${s.scenario.id}</td>
        <td>${s.scenario.name}</td>
        <td>${s.scenario.severity || 'P2'}</td>
        <td>${s.scenario.actions.length}</td>
        <td><a href="${baseName}.md">查看</a></td>
        <td><a href="${baseName}.html">查看</a></td>
      </tr>`;
}).join('\n')}
    </tbody>
  </table>
</body>
</html>`;

    writeFileSync(join(this.config.outputDir, 'index.html'), html, 'utf-8');
  }

  // 辅助方法
  private getSeverityLabel(severity: string): string {
    const labels: Record<string, string> = {
      'P0': 'P0 - 核心业务差异 (阻断)',
      'P1': 'P1 - 业务路径差异 (阻断)',
      'P2': 'P2 - 非核心行为差异',
      'P3': 'P3 - 技术实现差异'
    };
    return labels[severity] || severity;
  }

  private getSeverityColor(severity?: string): string {
    const colors: Record<string, string> = {
      'P0': '#dc3545',
      'P1': '#fd7e14',
      'P2': '#ffc107',
      'P3': '#6c757d'
    };
    return colors[severity || 'P2'] || '#6c757d';
  }

  private getBusinessGoal(scenario: Scenario): string {
    const tags = scenario.tags || [];
    
    if (tags.includes('happy-path')) {
      return '验证融资申请在正常情况下的完整审批流程，确保资金能够顺利发放。';
    }
    if (tags.includes('rejection')) {
      return '验证融资申请在不同阶段被拒绝时的处理逻辑和数据状态变化。';
    }
    if (tags.includes('return')) {
      return '验证融资申请被退回补充材料时的流程和数据状态。';
    }
    if (tags.includes('withdraw')) {
      return '验证申请人主动撤回申请时的处理逻辑。';
    }
    if (tags.includes('transfer')) {
      return '验证审批任务转交给其他人员时的流程。';
    }
    if (tags.includes('parallel')) {
      return '验证并签（多人同时审批）场景下的流程和数据处理。';
    }
    if (tags.includes('boundary')) {
      return '验证边界值（如最小/最大金额）场景下的处理。';
    }
    
    return '验证流程的正常执行和异常处理。';
  }

  private renderRoles(scenario: Scenario): string {
    const actors = [...new Set(scenario.actions.map(a => a.actor))];
    const roleNames: Record<string, string> = {
      'supplier': '供应商（申请人）',
      'applicant': '申请人',
      'core_enterprise': '核心企业审批员',
      'risk_assessor': '风控专员',
      'finance': '财务审批员',
      'reviewer1': '审批员1',
      'reviewer2': '审批员2',
      'final-approver': '最终审批人',
      'system': '系统'
    };

    const lines = ['| 角色 ID | 角色名称 |'];
    lines.push('|---------|----------|');
    
    for (const actor of actors) {
      lines.push(`| ${actor} | ${roleNames[actor] || actor} |`);
    }

    return lines.join('\n');
  }

  private renderRolesHtml(scenario: Scenario): string {
    const actors = [...new Set(scenario.actions.map(a => a.actor))];
    const roleNames: Record<string, string> = {
      'supplier': '供应商（申请人）',
      'applicant': '申请人',
      'core_enterprise': '核心企业审批员',
      'risk_assessor': '风控专员',
      'finance': '财务审批员',
      'reviewer1': '审批员1',
      'reviewer2': '审批员2',
      'final-approver': '最终审批人',
      'system': '系统'
    };

    return `<table>
      <thead><tr><th>角色 ID</th><th>角色名称</th></tr></thead>
      <tbody>
        ${actors.map(a => `<tr><td>${a}</td><td>${roleNames[a] || a}</td></tr>`).join('\n        ')}
      </tbody>
    </table>`;
  }

  private renderPreconditions(scenario: Scenario): string {
    const preconditions = scenario.precondition || {};
    
    if (Object.keys(preconditions).length === 0) {
      return '无特殊前置条件，流程可以从任意状态开始。';
    }

    const lines = ['| 条件 | 值 |'];
    lines.push('|------|---|');
    
    for (const [key, value] of Object.entries(preconditions)) {
      lines.push(`| ${key} | ${value} |`);
    }

    return lines.join('\n');
  }

  private renderPreconditionsHtml(scenario: Scenario): string {
    const preconditions = scenario.precondition || {};
    
    if (Object.keys(preconditions).length === 0) {
      return '<p>无特殊前置条件，流程可以从任意状态开始。</p>';
    }

    return `<table>
      <thead><tr><th>条件</th><th>值</th></tr></thead>
      <tbody>
        ${Object.entries(preconditions).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('\n        ')}
      </tbody>
    </table>`;
  }

  private renderSteps(scenario: Scenario): string {
    const lines = ['| 步骤 | 操作人 | 操作 | 前置状态 | 预期后置状态 | 预期结果 |'];
    lines.push('|------|--------|------|----------|------------|----------|');
    
    for (let i = 0; i < scenario.actions.length; i++) {
      const action = scenario.actions[i];
      const preState = this.getPreState(scenario, i);
      const postState = this.getPostState(scenario, i);
      const result = this.getStepResult(action, scenario);
      
      lines.push(`| ${i + 1} | ${action.actor} | ${this.getActionLabel(action.type)} | ${preState} | ${postState} | ${result} |`);
    }

    return lines.join('\n');
  }

  private renderTimelineHtml(scenario: Scenario): string {
    return scenario.actions.map((action, i) => {
      const preState = this.getPreState(scenario, i);
      const postState = this.getPostState(scenario, i);
      const data = action.data ? JSON.stringify(action.data) : '';
      
      return `<div class="timeline-item">
        <div class="step-num">步骤 ${i + 1}</div>
        <div class="actor">操作人: ${action.actor}</div>
        <div class="action"><strong>${this.getActionLabel(action.type)}</strong></div>
        ${data ? `<div>数据: ${data}</div>` : ''}
        <div>前置状态: ${preState}</div>
        <div>预期后置状态: ${postState}</div>
      </div>`;
    }).join('\n');
  }

  private renderExpectedResult(scenario: Scenario): string {
    const expected = scenario.expected;
    if (!expected) return '未定义预期结果';

    let md = `**最终状态**: ${expected.finalState || '未定义'}\n\n`;
    
    if (expected.semanticPath) {
      md += `**预期流程路径**: ${expected.semanticPath.join(' → ')}\n\n`;
    }

    return md;
  }

  private renderExpectedResultHtml(scenario: Scenario): string {
    const expected = scenario.expected;
    if (!expected) return '<p class="result pending">未定义预期结果</p>';

    let html = `<div class="result success">
      <p><strong>最终状态</strong>: ${expected.finalState || '未定义'}</p>`;
    
    if (expected.semanticPath) {
      html += `<p><strong>预期流程路径</strong>: ${expected.semanticPath.join(' → ')}</p>`;
    }

    html += '</div>';
    return html;
  }

  private renderExpectedDataChanges(scenario: Scenario): string {
    const expected = scenario.expected;
    if (!expected?.database || Object.keys(expected.database).length === 0) {
      return '未定义预期的数据库变化。';
    }

    const lines = ['| 表名 | 操作 | 关键字段 |'];
    lines.push('|------|------|----------|');
    
    for (const [table, changes] of Object.entries(expected.database)) {
      lines.push(`| ${table} | ${changes} | - |`);
    }

    return lines.join('\n');
  }

  private renderExpectedDataChangesHtml(scenario: Scenario): string {
    const expected = scenario.expected;
    if (!expected?.database || Object.keys(expected.database).length === 0) {
      return '<p>未定义预期的数据库变化。</p>';
    }

    return `<table>
      <thead><tr><th>表名</th><th>操作</th></tr></thead>
      <tbody>
        ${Object.entries(expected.database).map(([t, c]) => `<tr><td>${t}</td><td>${c}</td></tr>`).join('\n        ')}
      </tbody>
    </table>`;
  }

  private renderExpectedApiCalls(scenario: Scenario): string {
    const expected = scenario.expected;
    if (!expected?.externalCalls || expected.externalCalls.length === 0) {
      return '未定义预期的外部 API 调用。';
    }

    const lines = ['| API | 方法 | 预期结果 |'];
    lines.push('|-----|------|---------|');
    
    for (const call of expected.externalCalls) {
      lines.push(`| ${call.endpoint || '-'} | ${call.method || '-'} | ${call.expectedStatus || '成功'} |`);
    }

    return lines.join('\n');
  }

  private renderExpectedApiCallsHtml(scenario: Scenario): string {
    const expected = scenario.expected;
    if (!expected?.externalCalls || expected.externalCalls.length === 0) {
      return '<p>未定义预期的外部 API 调用。</p>';
    }

    return `<table>
      <thead><tr><th>API</th><th>方法</th><th>预期结果</th></tr></thead>
      <tbody>
        ${expected.externalCalls.map(c => `<tr><td>${c.endpoint || '-'}</td><td>${c.method || '-'}</td><td>${c.expectedStatus || '成功'}</td></tr>`).join('\n        ')}
      </tbody>
    </table>`;
  }

  private renderPassCriteria(scenario: Scenario): string {
    const severity = scenario.severity || 'P2';
    
    let criteria = `1. 最终业务状态必须为: **${scenario.expected?.finalState || '未定义'}**\n`;
    
    if (severity === 'P0' || severity === 'P1') {
      criteria += '2. 流程路径必须与预期完全一致\n';
      criteria += '3. 所有业务关键字段必须一致\n';
      criteria += '4. 数据库变化必须与预期一致\n';
    } else {
      criteria += '2. 流程路径允许实现差异\n';
      criteria += '3. 非关键字段允许差异\n';
    }
    
    criteria += `5. 允许技术差异: 节点ID、时间戳格式、内部追踪ID\n`;
    
    return criteria;
  }

  private renderPassCriteriaHtml(scenario: Scenario): string {
    return `<ul>
      ${this.renderPassCriteria(scenario).split('\n').filter(l => l).map(l => `<li>${l.replace(/\*\*/g, '')}</li>`).join('\n        ')}
    </ul>`;
  }

  private renderRiskAndSource(scenario: Scenario): string {
    const severity = scenario.severity || 'P2';
    const sources = scenario.source || [];
    
    let risk = severity === 'P0' || severity === 'P1' 
      ? '**高风险** - 此场景必须通过才能发布' 
      : '**中风险** - 此场景建议通过';
    
    risk += '\n\n';
    risk += `| 来源类型 | 来源内容 |\n`;
    risk += `|---------|----------|\n`;
    
    for (const source of sources) {
      risk += `| ${source.includes(':') ? source.split(':')[0] : '未分类'} | ${source} |\n`;
    }
    
    risk += '\n**AI 生成说明**: ';
    risk += sources.some(s => s.includes('ai')) 
      ? '此案例由 AI 生成，需要人工确认' 
      : '此案例为确定性生成';

    return risk;
  }

  private getActionLabel(type: string): string {
    const labels: Record<string, string> = {
      'SUBMIT': '提交融资申请',
      'APPROVE': '审批通过',
      'REJECT': '审批拒绝',
      'RETURN': '退回补充材料',
      'WITHDRAW': '主动撤回',
      'TRANSFER': '转交任务',
      'COUNTERSIGN': '启动并签',
      'COUNTERSIGN_COMPLETE': '并签完成'
    };
    return labels[type] || type;
  }

  private getActorName(actor: string): string {
    const names: Record<string, string> = {
      'supplier': '供应商',
      'applicant': '申请人',
      'core_enterprise': '核心企业',
      'risk_assessor': '风控专员',
      'finance': '财务',
      'reviewer1': '审批员1',
      'reviewer2': '审批员2',
      'final-approver': '最终审批',
      'system': '系统'
    };
    return names[actor] || actor;
  }

  private getPreState(scenario: Scenario, stepIndex: number): string {
    if (stepIndex === 0) return 'DRAFT';
    
    const states: Record<string, string[]> = {
      'SUBMIT': ['DRAFT'],
      'APPROVE': ['SUBMITTED', 'CORE_APPROVED', 'RISK_ASSESSED', 'RETURNED'],
      'REJECT': ['SUBMITTED', 'CORE_APPROVED', 'RISK_ASSESSED'],
      'RETURN': ['SUBMITTED'],
      'WITHDRAW': ['SUBMITTED', 'CORE_APPROVED'],
      'TRANSFER': ['APPROVED', 'SUBMITTED'],
      'COUNTERSIGN': ['FINANCE_APPROVED'],
      'COUNTERSIGN_COMPLETE': ['FINANCE_COUNTERSIGNING']
    };
    
    const action = scenario.actions[stepIndex];
    return states[action.type]?.[0] || 'PROCESSING';
  }

  private getPostState(scenario: Scenario, stepIndex: number): string {
    const action = scenario.actions[stepIndex];
    const expected = scenario.expected;
    
    if (stepIndex === scenario.actions.length - 1) {
      return expected?.finalState || 'COMPLETED';
    }
    
    const nextAction = scenario.actions[stepIndex + 1];
    return this.getPreState(scenario, stepIndex + 1);
  }

  private getStepResult(action: any, scenario: Scenario): string {
    const type = action.type;
    
    if (type === 'REJECT') return '申请被拒绝，流程结束';
    if (type === 'WITHDRAW') return '申请被撤回，流程结束';
    if (type === 'RETURN') return '申请被退回，流程暂停';
    if (type === 'TRANSFER' && scenario.expected?.finalState === 'TRANSFERRED') return '放款完成';
    if (action === scenario.actions[scenario.actions.length - 1]) {
      return `流程到达最终状态: ${scenario.expected?.finalState}`;
    }
    
    return '流程继续';
  }

  private detectBranches(scenario: Scenario): Array<{ from: string; to: string; condition: string }> {
    const branches: Array<{ from: string; to: string; condition: string }> = [];
    
    for (let i = 0; i < scenario.actions.length; i++) {
      const action = scenario.actions[i];
      
      if (action.type === 'REJECT') {
        branches.push({
          from: `N${i}`,
          to: 'REJECT_END',
          condition: '拒绝'
        });
      }
      
      if (action.type === 'RETURN') {
        branches.push({
          from: `N${i}`,
          to: 'RETURN_END',
          condition: '退回'
        });
      }
    }
    
    return branches;
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
  }
}

export interface RenderedScenario {
  scenario: Scenario;
  markdown: string;
  html: string;
  mermaid: string;
  timeline: string;
  sequenceDiagram: string;
}

/**
 * 创建场景渲染器
 */
export function createScenarioRenderer(config?: Partial<ScenarioRendererConfig>): ScenarioRenderer {
  return new ScenarioRenderer(config);
}
