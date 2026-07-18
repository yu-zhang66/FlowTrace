/**
 * FlowTrace AI Case Generator
 * 
 * 使用 AI 自动生成测试案例
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import type { AIProvider } from './provider.js';
import { ScenarioSchema, validateScenario } from './provider.js';
import type { Scenario } from '@flowtrace/core';

export interface AIGenerationOptions {
  /** 生成案例数量 */
  count?: number;
  /** 严重性过滤 */
  severity?: ('P0' | 'P1' | 'P2' | 'P3')[];
  /** 包含的场景类型 */
  includeTypes?: ('happy-path' | 'edge-case' | 'error' | 'parallel' | 'boundary')[];
  /** 是否包含边界测试 */
  includeBoundary?: boolean;
}

export interface GenerationResult {
  success: boolean;
  scenarios: Scenario[];
  errors: string[];
  warnings: string[];
  mode: 'ai-assisted' | 'deterministic-fallback';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * AI 案例生成器
 */
export class AICaseGenerator {
  private provider: AIProvider;
  private processDefinition: any;
  private facts: any[] = [];
  private semanticKeywords: any = {};

  constructor(provider: AIProvider) {
    this.provider = provider;
  }

  /**
   * 加载流程定义
   */
  loadProcessDefinition(configPath: string): void {
    if (!existsSync(configPath)) {
      throw new Error(`Process definition not found: ${configPath}`);
    }

    const content = readFileSync(configPath, 'utf-8');
    this.processDefinition = yaml.load(content);
  }

  /**
   * 加载基线事实
   */
  loadBaseline(baselinePath: string): void {
    if (!existsSync(baselinePath)) {
      throw new Error(`Baseline not found: ${baselinePath}`);
    }

    const content = readFileSync(baselinePath, 'utf-8');
    const baseline = JSON.parse(content);
    this.facts = baseline.facts || [];
  }

  /**
   * 加载语义关键词
   */
  loadSemanticKeywords(keywordsPath: string): void {
    if (!existsSync(keywordsPath)) {
      return; // 可选
    }

    const content = readFileSync(keywordsPath, 'utf-8');
    this.semanticKeywords = JSON.parse(content);
  }

  /**
   * 直接设置流程定义（对象形式）
   */
  setProcessDefinition(definition: any): void {
    this.processDefinition = definition;
  }

  /**
   * 直接设置事实列表
   */
  setFacts(facts: any[]): void {
    this.facts = facts;
  }

  /**
   * 直接设置语义关键词
   */
  setSemanticKeywords(keywords: any): void {
    this.semanticKeywords = keywords;
  }

  /**
   * 生成案例
   */
  async generate(options: AIGenerationOptions = {}): Promise<GenerationResult> {
    const result: GenerationResult = {
      success: true,
      scenarios: [],
      errors: [],
      warnings: [],
      mode: 'ai-assisted'
    };

    const count = options.count || 10;

    try {
      // 构建提示词
      const prompt = this.buildGenerationPrompt(options);

      // 调用 AI
      const response = await this.provider.completeJSON<{ scenarios: Scenario[] }>({
        prompt,
        system: this.buildSystemPrompt(),
        temperature: 0.7
      });

      // 验证并处理生成的案例
      if (response.scenarios && Array.isArray(response.scenarios)) {
        for (const scenario of response.scenarios) {
          const validation = validateScenario(scenario);
          
          if (validation.valid) {
            // 确保 ID 唯一
            scenario.id = this.ensureUniqueId(scenario.id, result.scenarios);
            result.scenarios.push(scenario);
          } else {
            result.warnings.push(`Scenario "${scenario.name}" failed validation: ${validation.errors?.map(e => e.message).join(', ')}`);
          }
        }
        
        // If AI returned no valid scenarios, fall back to deterministic
        if (result.scenarios.length === 0) {
          result.mode = 'deterministic-fallback';
          result.warnings.push('AI returned no valid scenarios, falling back to deterministic generation');
        }
      } else {
        result.mode = 'deterministic-fallback';
      }

      // 补充必要的场景
      const additionalScenarios = this.generateEssentialScenarios(options);
      result.scenarios.push(...additionalScenarios);

      // 去重
      result.scenarios = this.deduplicateScenarios(result.scenarios);

    } catch (error) {
      result.success = false;
      result.mode = 'deterministic-fallback';
      result.errors.push(`AI generation failed: ${error instanceof Error ? error.message : String(error)}`);
      
      // 降级：返回基本场景
      result.scenarios = this.generateEssentialScenarios(options);
      result.warnings.push('Falling back to essential scenarios due to AI generation failure');
    }

    return result;
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    return `You are a test case generator for business process verification.

Your task is to generate comprehensive test scenarios based on the process definition and facts provided.

Output MUST be valid JSON with this structure:
{
  "scenarios": [
    {
      "id": "unique-scenario-id",
      "name": "Scenario name in Chinese",
      "process": "process-id",
      "severity": "P0|P1|P2|P3",
      "source": ["source reference"],
      "input": {},
      "actions": [
        {
          "type": "SUBMIT|APPROVE|REJECT|RETURN|WITHDRAW|TRANSFER|COUNTERSIGN|COUNTERSIGN_COMPLETE",
          "actor": "role-id",
          "data": {}
        }
      ],
      "expected": {
        "finalState": "STATE",
        "semanticPath": ["path"],
        "database": {}
      },
      "tags": ["tag1", "tag2"],
      "enabled": true
    }
  ]
}

Rules:
1. P0 = Critical path (happy path)
2. P1 = Important edge cases
3. P2 = Normal edge cases
4. P3 = Rare edge cases
5. Always include at least 1 P0 scenario
6. Use real actor roles from the process definition
7. Actions must be valid for the current process state`;
  }

  /**
   * 构建生成提示词
   */
  private buildGenerationPrompt(options: AIGenerationOptions): string {
    const process = this.processDefinition || { processId: 'unknown', name: 'Unknown Process' };
    const count = options.count || 10;

    let prompt = `Generate ${count} test scenarios for process: ${process.name} (${process.processId})

Process Definition:
${this.describeProcess()}

Business Facts:
${this.describeFacts()}

Semantic Keywords:
${this.describeKeywords()}

Requirements:
`;

    if (options.severity) {
      prompt += `- Include scenarios of severity: ${options.severity.join(', ')}\n`;
    }

    if (options.includeTypes) {
      prompt += `- Include scenario types: ${options.includeTypes.join(', ')}\n`;
    }

    prompt += `- Generate exactly ${count} scenarios
- Use Chinese for scenario names
- Ensure actions follow valid process transitions
- Cover both success and failure paths
- Include boundary conditions where applicable

Output the scenarios as JSON.`;

    return prompt;
  }

  /**
   * 描述流程
   */
  private describeProcess(): string {
    if (!this.processDefinition) {
      return 'Process definition not loaded';
    }

    const lines: string[] = [];
    lines.push(`Process: ${this.processDefinition.name || this.processDefinition.processId}`);

    if (this.processDefinition.nodes) {
      lines.push('\nNodes:');
      for (const node of this.processDefinition.nodes) {
        lines.push(`  - ${node.id}: ${node.name} (${node.type})`);
      }
    }

    if (this.processDefinition.transitions) {
      lines.push('\nTransitions:');
      for (const trans of this.processDefinition.transitions) {
        lines.push(`  - ${trans.from} -> ${trans.to} (${trans.event || 'auto'})`);
      }
    }

    if (this.processDefinition.variables) {
      lines.push('\nVariables:');
      for (const v of this.processDefinition.variables) {
        lines.push(`  - ${v.name}: ${v.type} (${v.description})`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 描述事实
   */
  private describeFacts(): string {
    if (this.facts.length === 0) {
      return 'No facts available';
    }

    const lines: string[] = [];
    const byCategory: Record<string, any[]> = {};

    for (const fact of this.facts) {
      const cat = fact.category || 'unknown';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(fact);
    }

    for (const [category, facts] of Object.entries(byCategory)) {
      lines.push(`\n${category}:`);
      for (const fact of facts.slice(0, 5)) {
        lines.push(`  - ${fact.name}: ${fact.description || ''}`);
      }
      if (facts.length > 5) {
        lines.push(`  ... and ${facts.length - 5} more`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 描述关键词
   */
  private describeKeywords(): string {
    if (!this.semanticKeywords || Object.keys(this.semanticKeywords).length === 0) {
      return 'No semantic keywords loaded';
    }

    const lines: string[] = [];

    if (this.semanticKeywords.keywords) {
      lines.push('Actions:');
      for (const [key, kw] of Object.entries(this.semanticKeywords.keywords)) {
        const keyword = kw as any;
        lines.push(`  - ${key}: ${keyword.zh?.join(', ') || ''}`);
      }
    }

    if (this.semanticKeywords.roles) {
      lines.push('\nRoles:');
      for (const [key, role] of Object.entries(this.semanticKeywords.roles)) {
        const r = role as any;
        lines.push(`  - ${key}: ${r.zh?.join(', ') || ''}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 生成必要的基本场景
   */
  private generateEssentialScenarios(options: AIGenerationOptions): Scenario[] {
    const scenarios: Scenario[] = [];
    const processId = this.processDefinition?.processId || 'unknown';

    // 正常流程
    if (!options.severity || options.severity.includes('P0')) {
      scenarios.push({
        id: `essential-normal-${Date.now()}`,
        name: '正常审批流程',
        process: processId,
        severity: 'P0',
        source: ['generated:essential'],
        input: {},
        actions: [
          { type: 'SUBMIT', actor: 'supplier' },
          { type: 'APPROVE', actor: 'core_enterprise' },
          { type: 'APPROVE', actor: 'risk_assessor' },
          { type: 'APPROVE', actor: 'finance' },
          { type: 'TRANSFER', actor: 'system' }
        ],
        expected: {
          finalState: 'TRANSFERRED',
          semanticPath: ['SUBMIT', 'CORE_APPROVAL', 'RISK_ASSESSMENT', 'FINANCE_APPROVAL', 'TRANSFER'],
          database: {}
        },
        tags: ['happy-path', 'essential'],
        enabled: true
      });
    }

    // 拒绝场景
    if (!options.severity || options.severity.includes('P1')) {
      scenarios.push({
        id: `essential-reject-core-${Date.now()}`,
        name: '核心企业拒绝',
        process: processId,
        severity: 'P1',
        source: ['generated:essential'],
        input: {},
        actions: [
          { type: 'SUBMIT', actor: 'supplier' },
          { type: 'REJECT', actor: 'core_enterprise', data: { reason: '资质不符合' } }
        ],
        expected: {
          finalState: 'REJECTED',
          semanticPath: ['SUBMIT', 'REJECTED'],
          database: {}
        },
        tags: ['rejection', 'essential'],
        enabled: true
      });

      scenarios.push({
        id: `essential-reject-risk-${Date.now()}`,
        name: '风险评估拒绝',
        process: processId,
        severity: 'P1',
        source: ['generated:essential'],
        input: {},
        actions: [
          { type: 'SUBMIT', actor: 'supplier' },
          { type: 'APPROVE', actor: 'core_enterprise' },
          { type: 'REJECT', actor: 'risk_assessor', data: { reason: '风险过高' } }
        ],
        expected: {
          finalState: 'REJECTED',
          semanticPath: ['SUBMIT', 'APPROVE', 'REJECTED'],
          database: {}
        },
        tags: ['rejection', 'essential'],
        enabled: true
      });
    }

    // 退回场景
    if (!options.severity || options.severity.includes('P2')) {
      scenarios.push({
        id: `essential-return-${Date.now()}`,
        name: '退回补充材料',
        process: processId,
        severity: 'P2',
        source: ['generated:essential'],
        input: {},
        actions: [
          { type: 'SUBMIT', actor: 'supplier' },
          { type: 'RETURN', actor: 'core_enterprise', data: { reason: '材料不完整' } }
        ],
        expected: {
          finalState: 'RETURNED',
          semanticPath: ['SUBMIT', 'RETURNED'],
          database: {}
        },
        tags: ['return', 'essential'],
        enabled: true
      });
    }

    return scenarios;
  }

  /**
   * 确保 ID 唯一
   */
  private ensureUniqueId(id: string, existing: Scenario[]): string {
    const existingIds = new Set(existing.map(s => s.id));
    
    if (!existingIds.has(id)) {
      return id;
    }

    let counter = 1;
    while (existingIds.has(`${id}-${counter}`)) {
      counter++;
    }
    return `${id}-${counter}`;
  }

  /**
   * 去重场景
   */
  private deduplicateScenarios(scenarios: Scenario[]): Scenario[] {
    const seen = new Set<string>();
    const unique: Scenario[] = [];

    for (const scenario of scenarios) {
      // 创建场景的哈希键
      const key = this.hashScenario(scenario);
      
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(scenario);
      }
    }

    return unique;
  }

  /**
   * 计算场景哈希
   */
  private hashScenario(scenario: Scenario): string {
    const actions = scenario.actions.map(a => `${a.type}@${a.actor}`).join('|');
    return `${scenario.name}|${actions}|${scenario.expected?.finalState}`;
  }
}

/**
 * 创建 AI 案例生成器
 */
export function createAICaseGenerator(provider: AIProvider): AICaseGenerator {
  return new AICaseGenerator(provider);
}
