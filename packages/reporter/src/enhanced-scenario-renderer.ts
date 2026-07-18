/**
 * Enhanced Scenario Renderer
 * 
 * Generates readable formats from enhanced scenarios:
 * - Markdown with Mermaid flowcharts and step details
 * - HTML with embedded diagrams
 * - JSON (preserved)
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type {
  EnhancedScenario,
  BrowserStep,
  ApiStep,
  DatabaseStep,
  BrowserStepSide,
  ApiStepSide,
  GenerationMetadata,
  ExpectedBusinessResult,
  ExpectedApiResult,
  ExpectedDatabaseResult,
  Precondition,
  ActorRef,
  TestData
} from '@flowtrace/core';

// ============================================================
// Configuration
// ============================================================

export interface ScenarioRendererConfig {
  outputDir: string;
  includeMermaid: boolean;
  includeTimeline: boolean;
  includeNetworkDiagrams: boolean;
  language: 'zh' | 'en';
}

// ============================================================
// Rendered Output
// ============================================================

export interface RenderedScenario {
  scenarioId: string;
  scenarioName: string;
  jsonPath: string;
  markdownPath: string;
  htmlPath?: string;
  mermaidPath?: string;
  timelinePath?: string;
}

// ============================================================
// Helper Functions
// ============================================================

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('zh-CN');
}

function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\|/g, '\\|')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function getLanguageText(zh: string, en: string): string {
  return zh;
}

// ============================================================
// Mermaid Flowchart Generator
// ============================================================

function generateMermaidFlowchart(scenario: EnhancedScenario): string {
  const nodes: string[] = [];
  const transitions: string[] = [];
  
  // Determine flow based on scenario type
  const steps = scenario.steps || [];
  const isRejection = scenario.name.toLowerCase().includes('拒绝') || 
                      scenario.name.toLowerCase().includes('reject');
  const isWithdrawal = scenario.name.toLowerCase().includes('撤回') ||
                       scenario.name.toLowerCase().includes('withdraw');
  const isReturn = scenario.name.toLowerCase().includes('退回') ||
                   scenario.name.toLowerCase().includes('return');
  const isTransfer = scenario.name.toLowerCase().includes('转交') ||
                    scenario.name.toLowerCase().includes('transfer');
  const isCountersign = scenario.name.toLowerCase().includes('并签') ||
                        scenario.name.toLowerCase().includes('串签') ||
                        scenario.name.toLowerCase().includes('countersign');
  
  // Start node
  nodes.push('    A[开始]');
  
  if (steps.length === 0) {
    // Simple flow for legacy scenarios
    const actions = scenario.legacyActions || [];
    let prevNode = 'A';
    let nodeId = 'B';
    
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const node = `    ${nodeId}[${action.type}]`;
      nodes.push(node);
      transitions.push(`    ${prevNode} --> ${nodeId}`);
      prevNode = nodeId;
      nodeId = String.fromCharCode(nodeId.charCodeAt(0) + 1);
    }
    
    // Final node
    const finalState = scenario.finalExpected?.finalState || 
                       scenario.expected?.finalState || 
                       '结束';
    nodes.push(`    ${nodeId}[${finalState}]`);
    transitions.push(`    ${prevNode} --> ${nodeId}`);
  } else {
    // Flow with steps
    let prevNode = 'A';
    let nodeId = 'B';
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const node = `    ${nodeId}[${step.intent || step.id}]`;
      nodes.push(node);
      transitions.push(`    ${prevNode} --> ${nodeId}`);
      
      // Handle branching scenarios
      if (isRejection && (step.businessAction === 'REJECT' || step.businessAction === 'REJECTED')) {
        nodes.push(`    ${nodeId}R[拒绝]`);
        transitions.push(`    ${nodeId} -->|拒绝| ${nodeId}R`);
        nodes.push(`    ${nodeId}E[结束-拒绝]`);
        transitions.push(`    ${nodeId}R --> ${nodeId}E`);
        break;
      } else if (isWithdrawal && step.businessAction === 'WITHDRAW') {
        nodes.push(`    ${nodeId}W[撤回]`);
        transitions.push(`    ${nodeId} -->|撤回| ${nodeId}W`);
        nodes.push(`    ${nodeId}EW[结束-撤回]`);
        transitions.push(`    ${nodeId}W --> ${nodeId}EW`);
        break;
      } else if (isReturn && step.businessAction === 'RETURN') {
        nodes.push(`    ${nodeId}RT[退回]`);
        transitions.push(`    ${nodeId} -->|退回| ${nodeId}RT`);
        nodes.push(`    ${nodeId}ERT[结束-退回]`);
        transitions.push(`    ${nodeId}RT --> ${nodeId}ERT`);
        break;
      }
      
      prevNode = nodeId;
      nodeId = String.fromCharCode(nodeId.charCodeAt(0) + 1);
    }
    
    // Final state
    if (!isRejection && !isWithdrawal && !isReturn) {
      const finalState = scenario.finalExpected?.finalState || 
                        scenario.expected?.finalState || 
                        '结束';
      nodes.push(`    ${nodeId}[${finalState}]`);
      transitions.push(`    ${prevNode} --> ${nodeId}`);
    }
  }
  
  return `flowchart TD\n${nodes.join('\n')}\n${transitions.join('\n')}`;
}

// ============================================================
// Mermaid Sequence Diagram Generator
// ============================================================

function generateMermaidSequenceDiagram(scenario: EnhancedScenario): string {
  const participants: string[] = [];
  const interactions: string[] = [];
  
  // Collect unique actors
  const actorSet = new Set<string>();
  
  if (scenario.steps) {
    for (const step of scenario.steps) {
      if (step.actor && !actorSet.has(step.actor)) {
        actorSet.add(step.actor);
        participants.push(`participant ${step.actor}`);
      }
      // Also add actors from actors map
      if (scenario.actors && scenario.actors[step.actor]) {
        const ref = scenario.actors[step.actor];
        if (!actorSet.has(ref.role)) {
          actorSet.add(ref.role);
          participants.push(`participant ${ref.role}`);
        }
      }
    }
  }
  
  // Generate interactions
  if (scenario.steps) {
    let prevActor: string | null = null;
    
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const actor = scenario.actors?.[step.actor]?.role || step.actor;
      
      const actionText = getActionText(step.businessAction);
      
      if (prevActor && prevActor !== actor) {
        interactions.push(`${prevActor}->>+${actor}: ${actionText}`);
      } else if (!prevActor) {
        interactions.push(`${actor}->>+${actor}: ${actionText}`);
      } else {
        interactions.push(`${prevActor}->>+${actor}: ${actionText}`);
      }
      
      // Add response
      interactions.push(`${actor}-->>-${prevActor || actor}: OK`);
      
      prevActor = actor;
    }
  }
  
  return `sequenceDiagram\n${participants.join('\n')}\n${interactions.join('\n')}`;
}

function getActionText(action: string): string {
  const actionMap: Record<string, string> = {
    'SUBMIT': '提交申请',
    'APPROVE': '审批通过',
    'REJECT': '审批拒绝',
    'RETURN': '退回补充',
    'WITHDRAW': '撤回申请',
    'TRANSFER': '转交办理',
    'COUNTERSIGN': '会签',
    'COUNTERSIGN_COMPLETE': '会签完成'
  };
  return actionMap[action] || action;
}

// ============================================================
// Markdown Renderer
// ============================================================

function renderActors(actors: Record<string, ActorRef> | undefined): string {
  if (!actors || Object.keys(actors).length === 0) return '';
  
  const lines: string[] = [];
  for (const [key, actor] of Object.entries(actors)) {
    lines.push(`| ${key} | ${actor.role} | ${actor.usernameRef} | ${actor.description || '-'} |`);
  }
  
  return `
## 三、参与角色

| 角色标识 | 角色名称 | 测试账号 | 说明 |
|---------|---------|---------|------|
${lines.join('\n')}`;
}

function renderTestData(testData: TestData | undefined): string {
  if (!testData || Object.keys(testData).length === 0) return '';
  
  const lines: string[] = [];
  for (const [key, value] of Object.entries(testData)) {
    const displayValue = typeof value === 'string' && value.length > 50 
      ? value.substring(0, 47) + '...' 
      : String(value);
    lines.push(`| ${key} | ${displayValue} |`);
  }
  
  return `
## 四、测试数据

| 数据项 | 值 |
|-------|-----|
${lines.join('\n')}`;
}

function renderPreconditions(preconditions: Precondition[] | undefined): string {
  if (!preconditions || preconditions.length === 0) return '';
  
  const lines: string[] = [];
  for (const p of preconditions) {
    lines.push(`- [ ] ${p.description} (${p.type})`);
  }
  
  return `
## 五、前置条件

${lines.join('\n')}`;
}

function renderSteps(steps: EnhancedScenario['steps']): string {
  if (!steps || steps.length === 0) return '';
  
  const lines: string[] = [];
  lines.push('## 七、详细步骤');
  lines.push('');
  lines.push('### 7.1 旧系统操作步骤');
  lines.push('');
  lines.push('| 步骤 | 操作人 | 页面 | 操作 | 预期结果 |');
  lines.push('|------|--------|------|------|---------|');
  
  for (const step of steps) {
    const actor = step.actor;
    const page = step.browser?.legacy?.navigation?.url || step.api?.old?.call.endpoint || '-';
    const actions = step.browser?.legacy?.actions?.map(a => a.type).join(', ') || '-';
    const expected = step.expected?.semanticEvent || step.expected?.businessState || '-';
    lines.push(`| ${step.id} | ${actor} | ${page} | ${actions} | ${expected} |`);
  }
  
  lines.push('');
  lines.push('### 7.2 新系统操作步骤');
  lines.push('');
  lines.push('| 步骤 | 操作人 | 页面 | 操作 | 预期结果 |');
  lines.push('|------|--------|------|------|---------|');
  
  for (const step of steps) {
    const actor = step.actor;
    const page = step.browser?.current?.navigation?.url || step.api?.new?.call.endpoint || '-';
    const actions = step.browser?.current?.actions?.map(a => a.type).join(', ') || '-';
    const expected = step.expected?.semanticEvent || step.expected?.businessState || '-';
    lines.push(`| ${step.id} | ${actor} | ${page} | ${actions} | ${expected} |`);
  }
  
  return lines.join('\n');
}

function renderLegacyActions(scenario: EnhancedScenario): string {
  const actions = scenario.legacyActions;
  if (!actions || actions.length === 0) return '';
  
  const lines: string[] = [];
  lines.push('## 七、操作步骤（兼容模式）');
  lines.push('');
  lines.push('| 步骤 | 操作人 | 操作类型 | 业务数据 |');
  lines.push('|------|--------|---------|---------|');
  
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const dataStr = action.data ? JSON.stringify(action.data).substring(0, 50) : '-';
    lines.push(`| ${i + 1} | ${action.actor} | ${action.type} | ${dataStr} |`);
  }
  
  return lines.join('\n');
}

function renderExpectedResults(scenario: EnhancedScenario): string {
  const final = scenario.finalExpected;
  const expected = scenario.expected;
  
  if (!final && !expected) return '';
  
  const sections: string[] = [];
  
  sections.push('## 八、预期结果');
  
  // Final state
  const finalState = final?.finalState || (expected as any)?.finalState || '-';
  sections.push('');
  sections.push(`### 最终业务状态：${finalState}`);
  
  // Required events
  if (final?.requiredEvents && final.requiredEvents.length > 0) {
    sections.push('');
    sections.push('### 必须发生的业务事件');
    for (const event of final.requiredEvents) {
      sections.push(`- [ ] ${event}`);
    }
  }
  
  // Forbidden events
  if (final?.forbiddenEvents && final.forbiddenEvents.length > 0) {
    sections.push('');
    sections.push('### 禁止发生的业务事件');
    for (const event of final.forbiddenEvents) {
      sections.push(`- [x] ${event} (必须不发生)`);
    }
  }
  
  return sections.join('\n');
}

function renderGenerationMetadata(meta: GenerationMetadata | undefined): string {
  if (!meta) return '';
  
  const lines: string[] = [];
  lines.push('## 十三、生成元数据');
  lines.push('');
  
  const provider = meta.provider === 'ai' ? 'AI 生成' :
                  meta.provider === 'deterministic' ? '确定性生成' :
                  '确定性回退';
  
  lines.push(`| 项目 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 生成方式 | ${provider} |`);
  
  if (meta.model) {
    lines.push(`| AI 模型 | ${meta.model} |`);
  }
  
  if (meta.promptVersion) {
    lines.push(`| Prompt 版本 | ${meta.promptVersion} |`);
  }
  
  if (meta.generationTime) {
    lines.push(`| 生成时间 | ${formatTimestamp(meta.generationTime)} |`);
  }
  
  if (meta.fallbackReason) {
    lines.push(`| 回退原因 | ${meta.fallbackReason} |`);
  }
  
  const confirmed = meta.humanConfirmed ? '是' : '否';
  lines.push(`| 人工确认 | ${confirmed} |`);
  
  if (meta.humanConfirmBy) {
    lines.push(`| 确认人 | ${meta.humanConfirmBy} |`);
  }
  
  if (meta.humanConfirmTime) {
    lines.push(`| 确认时间 | ${formatTimestamp(meta.humanConfirmTime)} |`);
  }
  
  return lines.join('\n');
}

function renderMarkdown(scenario: EnhancedScenario, config: ScenarioRendererConfig): string {
  const mermaidFlowchart = generateMermaidFlowchart(scenario);
  const mermaidSequence = generateMermaidSequenceDiagram(scenario);
  
  let markdown = '';
  
  // Header
  markdown += `# 场景：${scenario.name}\n\n`;
  markdown += `> **场景编号**: \`${scenario.id}\`\n`;
  markdown += `> **严重级别**: ${scenario.severity || '未分级'}\n\n`;
  
  // Business goal
  markdown += '## 一、业务目标\n\n';
  markdown += `${scenario.businessGoal || '-'}\n\n`;
  
  // Business background
  if (scenario.businessBackground) {
    markdown += '## 二、业务背景\n\n';
    markdown += `${scenario.businessBackground}\n\n`;
  }
  
  // Actors
  markdown += renderActors(scenario.actors);
  markdown += '\n';
  
  // Test data
  markdown += renderTestData(scenario.testData);
  markdown += '\n';
  
  // Preconditions
  markdown += renderPreconditions(scenario.preconditions);
  markdown += '\n';
  
  // Expected process flowchart
  markdown += '## 六、预期业务流程\n\n';
  if (config.includeMermaid) {
    markdown += '### Mermaid 流程图\n\n';
    markdown += '```mermaid\n' + mermaidFlowchart + '\n```\n\n';
    
    markdown += '### Mermaid 时序图\n\n';
    markdown += '```mermaid\n' + mermaidSequence + '\n```\n\n';
  }
  
  // Steps
  markdown += renderSteps(scenario.steps);
  markdown += '\n';
  
  // Legacy actions (for compatibility)
  markdown += renderLegacyActions(scenario);
  markdown += '\n';
  
  // Expected results
  markdown += renderExpectedResults(scenario);
  markdown += '\n';
  
  // Pass criteria
  markdown += '## 九、通过标准\n\n';
  const passCriteria = [
    '旧系统和新系统最终业务状态一致',
    '关键业务数据一致',
    '必需的业务事件均发生',
    '禁止的业务事件未发生'
  ];
  for (const criterion of passCriteria) {
    markdown += `- [ ] ${criterion}\n`;
  }
  markdown += '\n';
  
  // Risks and sources
  markdown += '## 十、风险与来源\n\n';
  if (scenario.source && scenario.source.length > 0) {
    markdown += '### 来源依据\n';
    for (const src of scenario.source) {
      markdown += `- ${src}\n`;
    }
    markdown += '\n';
  }
  markdown += '### 风险级别\n\n';
  markdown += `**${scenario.severity || '未分级'}**\n\n`;
  
  // Tags
  if (scenario.tags && scenario.tags.length > 0) {
    markdown += '### 标签\n\n';
    for (const tag of scenario.tags) {
      markdown += `\`${tag}\` `;
    }
    markdown += '\n\n';
  }
  
  // Generation metadata
  markdown += renderGenerationMetadata(scenario.generationMetadata);
  
  return markdown;
}

// ============================================================
// HTML Renderer
// ============================================================

function renderHtml(scenario: EnhancedScenario, markdown: string, config: ScenarioRendererConfig): string {
  const mermaidFlowchart = generateMermaidFlowchart(scenario);
  const mermaidSequence = generateMermaidSequenceDiagram(scenario);
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>场景：${scenario.name}</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      background: #f5f5f5;
      color: #333;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 2rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 { color: #1a73e8; border-bottom: 2px solid #1a73e8; padding-bottom: 0.5rem; }
    h2 { color: #333; margin-top: 2rem; border-left: 4px solid #1a73e8; padding-left: 0.75rem; }
    h3 { color: #666; margin-top: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { border: 1px solid #ddd; padding: 0.75rem; text-align: left; }
    th { background: #f8f9fa; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
    .severity { 
      display: inline-block; 
      padding: 0.25rem 0.75rem; 
      border-radius: 4px; 
      font-weight: 600;
    }
    .severity-P0 { background: #f44336; color: white; }
    .severity-P1 { background: #ff9800; color: white; }
    .severity-P2 { background: #ffc107; }
    .severity-P3 { background: #4caf50; color: white; }
    .severity-default { background: #9e9e9e; color: white; }
    .meta { background: #e8f0fe; padding: 1rem; border-radius: 4px; margin-bottom: 1rem; }
    .meta-item { display: inline-block; margin-right: 1.5rem; }
    .meta-label { font-weight: 600; color: #555; }
    .checkbox-list { list-style: none; padding-left: 0; }
    .checkbox-list li { padding: 0.5rem 0; }
    .mermaid { background: #fafafa; padding: 1rem; border-radius: 4px; text-align: center; }
    code { background: #f5f5f5; padding: 0.2rem 0.4rem; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>场景：${scenario.name}</h1>
    
    <div class="meta">
      <div class="meta-item">
        <span class="meta-label">场景编号:</span> <code>${scenario.id}</code>
      </div>
      <div class="meta-item">
        <span class="meta-label">严重级别:</span> 
        <span class="severity severity-${scenario.severity || 'default'}">${scenario.severity || '未分级'}</span>
      </div>
    </div>
    
    <h2>一、业务目标</h2>
    <p>${scenario.businessGoal || '-'}</p>
    
    ${scenario.businessBackground ? `
    <h2>二、业务背景</h2>
    <p>${scenario.businessBackground}</p>
    ` : ''}
    
    ${scenario.actors ? `
    <h2>三、参与角色</h2>
    <table>
      <thead>
        <tr><th>角色标识</th><th>角色名称</th><th>测试账号</th><th>说明</th></tr>
      </thead>
      <tbody>
        ${Object.entries(scenario.actors).map(([key, actor]) => 
          `<tr><td>${key}</td><td>${actor.role}</td><td>${actor.usernameRef}</td><td>${actor.description || '-'}</td></tr>`
        ).join('')}
      </tbody>
    </table>
    ` : ''}
    
    ${scenario.testData ? `
    <h2>四、测试数据</h2>
    <table>
      <thead>
        <tr><th>数据项</th><th>值</th></tr>
      </thead>
      <tbody>
        ${Object.entries(scenario.testData).map(([key, value]) => 
          `<tr><td>${key}</td><td>${String(value)}</td></tr>`
        ).join('')}
      </tbody>
    </table>
    ` : ''}
    
    <h2>六、预期业务流程</h2>
    
    ${config.includeMermaid ? `
    <h3>Mermaid 流程图</h3>
    <div class="mermaid">
${mermaidFlowchart}
    </div>
    
    <h3>Mermaid 时序图</h3>
    <div class="mermaid">
${mermaidSequence}
    </div>
    ` : ''}
    
    <h2>九、通过标准</h2>
    <ul class="checkbox-list">
      <li><input type="checkbox"> 旧系统和新系统最终业务状态一致</li>
      <li><input type="checkbox"> 关键业务数据一致</li>
      <li><input type="checkbox"> 必需的业务事件均发生</li>
      <li><input type="checkbox"> 禁止的业务事件未发生</li>
    </ul>
    
    ${scenario.generationMetadata ? `
    <h2>十三、生成元数据</h2>
    <table>
      <tr><th>项目</th><th>值</th></tr>
      <tr><td>生成方式</td><td>${scenario.generationMetadata.provider === 'ai' ? 'AI 生成' : scenario.generationMetadata.provider === 'deterministic' ? '确定性生成' : '确定性回退'}</td></tr>
      ${scenario.generationMetadata.model ? `<tr><td>AI 模型</td><td>${scenario.generationMetadata.model}</td></tr>` : ''}
      <tr><td>人工确认</td><td>${scenario.generationMetadata.humanConfirmed ? '是' : '否'}</td></tr>
    </table>
    ` : ''}
  </div>
  
  <script>
    mermaid.initialize({ 
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose'
    });
  </script>
</body>
</html>`;
}

// ============================================================
// Main Renderer Class
// ============================================================

export class EnhancedScenarioRenderer {
  private config: ScenarioRendererConfig;
  
  constructor(config: Partial<ScenarioRendererConfig> = {}) {
    this.config = {
      outputDir: config.outputDir || './output',
      includeMermaid: config.includeMermaid !== false,
      includeTimeline: config.includeTimeline !== false,
      includeNetworkDiagrams: config.includeNetworkDiagrams || false,
      language: config.language || 'zh'
    };
  }
  
  /**
   * Render a single scenario to multiple formats
   */
  render(scenario: EnhancedScenario): RenderedScenario {
    const baseName = scenario.id;
    
    // Ensure output directory exists
    if (!existsSync(this.config.outputDir)) {
      mkdirSync(this.config.outputDir, { recursive: true });
    }
    
    // JSON path
    const jsonPath = join(this.config.outputDir, `${baseName}.json`);
    
    // Markdown path
    const markdownPath = join(this.config.outputDir, `${baseName}.md`);
    
    // HTML path
    const htmlPath = join(this.config.outputDir, `${baseName}.html`);
    
    // Mermaid path
    const mermaidPath = join(this.config.outputDir, `${baseName}-diagram.mmd`);
    
    // Timeline path
    const timelinePath = join(this.config.outputDir, `${baseName}-timeline.mmd`);
    
    // Write JSON (preserve original)
    writeFileSync(jsonPath, JSON.stringify(scenario, null, 2), 'utf-8');
    
    // Render Markdown
    const markdown = renderMarkdown(scenario, this.config);
    writeFileSync(markdownPath, markdown, 'utf-8');
    
    // Render HTML
    const html = renderHtml(scenario, markdown, this.config);
    writeFileSync(htmlPath, html, 'utf-8');
    
    // Write Mermaid diagrams
    if (this.config.includeMermaid) {
      const mermaidContent = `%% Flowchart\n${generateMermaidFlowchart(scenario)}\n\n%% Sequence\n${generateMermaidSequenceDiagram(scenario)}`;
      writeFileSync(mermaidPath, mermaidContent, 'utf-8');
    }
    
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      jsonPath,
      markdownPath,
      htmlPath,
      mermaidPath: this.config.includeMermaid ? mermaidPath : undefined,
      timelinePath: this.config.includeTimeline ? timelinePath : undefined
    };
  }
  
  /**
   * Render multiple scenarios
   */
  renderBatch(scenarios: EnhancedScenario[]): RenderedScenario[] {
    return scenarios.map(scenario => this.render(scenario));
  }
}

/**
 * Create a scenario renderer with default configuration
 */
export function createScenarioRenderer(config?: Partial<ScenarioRendererConfig>): EnhancedScenarioRenderer {
  return new EnhancedScenarioRenderer(config);
}
