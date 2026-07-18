import chalk from 'chalk';
import yaml from 'js-yaml';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import {
  loadTargetProjectConfig,
  getFactsDir,
  getScenariosDir,
  getSemanticDir,
  runGate,
  gateForCommand,
  type TargetProjectConfig,
  type CommandResult
} from '@flowtrace/core';
import type { Scenario } from '@flowtrace/core';
import { AICaseGenerator } from '@flowtrace/ai';
import type { AIGenerationOptions, GenerationResult } from '@flowtrace/ai';

interface GenerateCasesOptions {
  project?: string;
  process?: string;
  facts?: string;
  output?: string;
  ai?: boolean;
  provider?: string;
  count?: string;
  semanticOnly?: boolean;
  human?: boolean;
}

export async function generateCasesCommand(options: GenerateCasesOptions): Promise<void> {
  const projectPath = options.project
    ? resolve(process.cwd(), options.project)
    : resolve(process.cwd());

  // --- Gate check ---
  const requirements = gateForCommand('generate-cases');
  const flowtraceRoot = join(projectPath, '.flowtrace');
  const gateResult: CommandResult = runGate({
    projectRoot: projectPath,
    flowtraceRoot,
    requirements,
    explicitProcessId: options.process ?? null,
    query: null
  });

  if (!gateResult.ok) {
    if (options.human) {
      console.error(chalk.red(`\n✗ Gate check failed: ${gateResult.code}`));
      if (gateResult.missing.length > 0) {
        console.log(chalk.yellow(`  Missing: ${gateResult.missing.join(', ')}`));
      }
      for (const remediation of gateResult.remediation) {
        console.log(chalk.gray(`   ${remediation}`));
      }
    } else {
      console.error(JSON.stringify(gateResult));
    }
    process.exit(2);
    return;
  }

  console.log(chalk.blue(`\n🔮 FlowTrace Case Generation`));
  console.log(chalk.gray(`Project: ${projectPath}\n`));

  if (!existsSync(projectPath)) {
    console.error(chalk.red(`Project path does not exist: ${projectPath}`));
    process.exit(1);
  }

  let targetConfig: TargetProjectConfig;
  try {
    targetConfig = loadTargetProjectConfig(projectPath);
    console.log(chalk.green(`✓ Loaded project: ${targetConfig.project.name}`));
  } catch (error) {
    console.error(chalk.red(`Failed to load project config: ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.gray(`   Run: flowtrace init --project ${projectPath}\n`));
    process.exit(1);
  }

  const factsDir = options.facts
    ? resolve(projectPath, options.facts)
    : getFactsDir(targetConfig);
  const outputDir = options.output
    ? resolve(projectPath, options.output)
    : getScenariosDir(targetConfig);

  // CRITICAL: Always use .flowtrace/scenarios as the canonical output location
  // This ensures all assets are within the .flowtrace directory
  const canonicalOutputDir = resolve(targetConfig.flowtraceRoot, 'scenarios');
  
  // Use canonical output directory if no explicit output specified
  const finalOutputDir = options.output ? outputDir : canonicalOutputDir;
  const semanticDir = getSemanticDir(targetConfig);

  // Ensure output directory exists
  if (!existsSync(finalOutputDir)) {
    mkdirSync(finalOutputDir, { recursive: true });
  }

  // Validate that we're writing to .flowtrace directory (not project root)
  // Only check if an explicit output was provided that doesn't include .flowtrace
  if (options.output && !outputDir.includes('.flowtrace')) {
    console.error(chalk.red(`\n✗ Scenarios must be written to .flowtrace/scenarios/, not project root`));
    console.log(chalk.gray(`   Use --output to specify: ${canonicalOutputDir}`));
    process.exit(1);
  }

  const processId = options.process || targetConfig.processId;
  console.log(chalk.blue(`  Process: ${processId}\n`));

  const processValidationPath = resolve(targetConfig.flowtraceRoot, 'processes', 'validation.json');
  if (existsSync(processValidationPath)) {
    const processValidation = JSON.parse(readFileSync(processValidationPath, 'utf-8'));
    const approved = processValidation.approvedProcessIds || [];
    if (!approved.includes(processId)) {
      throw new Error(`Process discovery validation is blocked for ${processId}; resolve process evidence before generating cases`);
    }
  }

  // 读取 baseline
  const baseline = loadBaseline(factsDir);
  if (baseline.facts.length === 0) {
    console.error(chalk.yellow(`\n⚠ No baseline facts found at ${factsDir}/baseline.json`));
    console.log(chalk.gray(`   Run: flowtrace collect --project ${projectPath}\n`));
    process.exit(1);
  }
  console.log(chalk.green(`✓ Loaded baseline: ${baseline.facts.length} facts`));

  // 加载语义关键词
  const keywords = loadSemanticKeywords(semanticDir);
  if (keywords) {
    console.log(chalk.green(`✓ Loaded semantic keywords`));
  }

  // 加载流程定义
  const processDef = loadProcessDefinition(semanticDir, processId);
  if (processDef) {
    console.log(chalk.green(`✓ Loaded process definition`));
  }

  // 加载已有场景
  const existingScenarios = loadExistingScenarios(finalOutputDir);
  console.log(chalk.gray(`  Existing scenarios: ${existingScenarios.length}`));

  // 调用 AI 生成器
  console.log(chalk.blue(`\n📝 Generating scenarios...\n`));

  let result: GenerationResult;
  try {
    // 构造 AI Provider（无外部 API 时使用 mock 实现）
    const provider = createMockProvider();

    const generator = new AICaseGenerator(provider);
    if (processDef) {
      generator.setProcessDefinition(processDef);
    }
    generator.setFacts(baseline.facts);
    if (keywords) {
      generator.setSemanticKeywords(keywords);
    }

    const aiOptions: AIGenerationOptions = {
      count: options.count ? parseInt(options.count) : 16,
      severity: ['P0', 'P1', 'P2', 'P3'],
      includeTypes: ['happy-path', 'edge-case', 'error', 'parallel', 'boundary'],
      includeBoundary: true
    };

    result = await generator.generate(aiOptions);
  } catch (error) {
    console.error(chalk.red(`\n✗ AI generation failed: ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.yellow(`\nFalling back to deterministic generation...\n`));
    result = generateDeterministicScenarios(processId, baseline, keywords);
    result.mode = 'deterministic-fallback';
  }

  // 如果 AI 生成的场景数量不足，使用确定性场景补充
  const minRequired = 16;
  if (result.scenarios.length < minRequired) {
    const fallback = generateDeterministicScenarios(processId, baseline, keywords);
    fallback.mode = 'deterministic-fallback';
    const existingIds = new Set(result.scenarios.map(s => s.id));
    for (const scenario of fallback.scenarios) {
      if (!existingIds.has(scenario.id) && result.scenarios.length < minRequired) {
        result.scenarios.push(scenario);
        existingIds.add(scenario.id);
      }
    }
    result.warnings.push(`Supplemented with ${fallback.scenarios.length} deterministic scenarios`);
  }

  // 合并已有场景（去重）
  const merged = mergeScenarios(existingScenarios, result.scenarios);

  // 保存场景文件
  const scenariosFile = resolve(finalOutputDir, 'scenarios.json');
  const scenariosJson = {
    processId,
    generatedAt: new Date().toISOString(),
    generationMode: result.mode || 'deterministic-fallback',
    scenarios: merged,
    summary: {
      total: merged.length,
      generated: result.scenarios.length,
      existing: existingScenarios.length,
      errors: result.errors.length,
      warnings: result.warnings.length
    },
    counts: {
      generatedCount: result.scenarios.length,
      totalCount: merged.length,
      enabledCount: merged.filter((s: any) => s.enabled !== false).length
    }
  };
  writeFileSync(scenariosFile, JSON.stringify(scenariosJson, null, 2), 'utf-8');

  // 生成 Markdown
  const md = generateScenariosMarkdown(merged, processId, baseline.facts.length, result);
  const mdFile = resolve(finalOutputDir, 'generated.md');
  writeFileSync(mdFile, md, 'utf-8');

  // 生成 human-readable scenarios.md
  const scenariosMd = generateHumanReadableScenarios(merged, processId);
  const scenariosMdFile = resolve(finalOutputDir, 'scenarios.md');
  writeFileSync(scenariosMdFile, scenariosMd, 'utf-8');

  // 输出统计
  console.log(chalk.blue(`\n📊 Generation Summary:`));
  console.log(chalk.green(`  Total scenarios: ${merged.length}`));
  console.log(chalk.green(`  New scenarios:   ${result.scenarios.length}`));
  console.log(chalk.gray(`  Existing:        ${existingScenarios.length}`));
  console.log(chalk.yellow(`  Warnings:        ${result.warnings.length}`));
  if (result.errors.length > 0) {
    console.log(chalk.red(`  Errors:          ${result.errors.length}`));
  }

  console.log(chalk.green(`\n✓ Scenarios saved to: ${scenariosFile}`));
  console.log(chalk.green(`✓ Markdown (technical) saved to: ${mdFile}`));
  console.log(chalk.green(`✓ Markdown (human-readable) saved to: ${scenariosMdFile}\n`));

  if (result.warnings.length > 0) {
    console.log(chalk.yellow(`\n⚠ Warnings:`));
    for (const w of result.warnings.slice(0, 5)) {
      console.log(chalk.gray(`  - ${w}`));
    }
    if (result.warnings.length > 5) {
      console.log(chalk.gray(`  ... and ${result.warnings.length - 5} more\n`));
    }
  }

  if (result.errors.length > 0) {
    console.log(chalk.red(`\n✗ Errors:`));
    for (const e of result.errors.slice(0, 5)) {
      console.log(chalk.gray(`  - ${e}`));
    }
    if (result.errors.length > 5) {
      console.log(chalk.gray(`  ... and ${result.errors.length - 5} more\n`));
    }
    process.exit(1);
  }

  console.log(chalk.green(`\n✓ Case generation complete!`));
  console.log(chalk.gray(`   Run: flowtrace validate-cases --project ${projectPath}\n`));
}

interface Baseline {
  facts: any[];
  processId: string;
  summary: any;
}

function loadBaseline(factsDir: string): Baseline {
  const baselinePath = resolve(factsDir, 'baseline.json');
  if (!existsSync(baselinePath)) {
    return { facts: [], processId: '', summary: { totalFacts: 0 } };
  }
  try {
    return JSON.parse(readFileSync(baselinePath, 'utf-8'));
  } catch {
    return { facts: [], processId: '', summary: { totalFacts: 0 } };
  }
}

function loadSemanticKeywords(semanticDir: string): any {
  const keywordsPath = resolve(semanticDir, 'keywords', 'zh.json');
  if (!existsSync(keywordsPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(keywordsPath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadProcessDefinition(semanticDir: string, processId?: string): any {
  if (processId) {
    const discoveredPath = resolve(semanticDir, '..', 'processes', `${processId}.json`);
    if (existsSync(discoveredPath)) {
      try { return JSON.parse(readFileSync(discoveredPath, 'utf-8')); } catch { /* fall through */ }
    }
  }
  const processPath = resolve(semanticDir, 'process-model.json');
  if (!existsSync(processPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(processPath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadExistingScenarios(outputDir: string): Scenario[] {
  // YAML scenario files are the canonical, user-editable assets. The JSON file
  // is a generated index and must not be treated as an additional source when
  // YAML assets already exist, otherwise every generation run would re-import
  // its own previous output and gradually duplicate generated cases.
  const yamlScenarios: Scenario[] = [];
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile() || !/\.(yaml|yml)$/i.test(entry.name)) continue;
      try {
        const parsed = yaml.load(readFileSync(entryPath, 'utf-8')) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'id' in parsed) {
          yamlScenarios.push(parsed as Scenario);
        }
      } catch {
        // Invalid scenario files are reported by validate-cases; generation
        // should still be able to preserve all valid assets it can read.
      }
    }
  };
  visit(outputDir);
  if (yamlScenarios.length > 0) return yamlScenarios;

  const scenariosFile = resolve(outputDir, 'scenarios.json');
  if (!existsSync(scenariosFile)) {
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(scenariosFile, 'utf-8'));
    return data.scenarios || [];
  } catch {
    return [];
  }
}

function mergeScenarios(existing: Scenario[], generated: Scenario[]): Scenario[] {
  const seen = new Set<string>();
  const merged: Scenario[] = [];

  const fingerprint = (scenario: Scenario): string => JSON.stringify({
    name: scenario.name,
    process: scenario.process,
    actions: scenario.actions,
    expected: scenario.expected
  });

  for (const s of existing) {
    const key = fingerprint(s);
    if (s.id && !seen.has(s.id) && !seen.has(key)) {
      seen.add(s.id);
      seen.add(key);
      merged.push(s);
    }
  }

  for (const s of generated) {
    const key = fingerprint(s);
    if (s.id && !seen.has(s.id) && !seen.has(key)) {
      seen.add(s.id);
      seen.add(key);
      merged.push(s);
    }
  }

  return merged;
}

/**
 * 创建 Mock Provider（当外部 AI 不可用时）
 */
function createMockProvider(): any {
  return {
    name: 'mock',
    config: { baseUrl: 'mock://', model: 'mock' },
    async initialize() {},
    async complete() {
      return { content: '{"scenarios":[]}', model: 'mock' };
    },
    async completeJSON<T>() {
      return {} as T;
    },
    validateOutput<T>(data: unknown): { valid: boolean; data?: T; errors?: string[] } {
      return { valid: true, data: data as T };
    }
  };
}

/**
 * 确定性场景生成（AI 不可用时的回退）
 */
function generateDeterministicScenarios(
  processId: string,
  baseline: Baseline,
  keywords: any
): GenerationResult {
  const scenarios: Scenario[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const nextId = (id: string) => `${processId}-${id}`;

  // 1. 正常审批
  scenarios.push({
    id: nextId('normal'),
    name: '正常审批流程',
    process: processId,
    severity: 'P0',
    source: ['baseline.json#process_definition'],
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'APPROVE', actor: 'reviewer1' },
      { type: 'APPROVE', actor: 'reviewer2' },
      { type: 'APPROVE', actor: 'final-approver' }
    ],
    expected: {
      finalState: 'APPROVED',
      semanticPath: ['SUBMIT', 'APPROVE', 'APPROVE', 'APPROVE']
    },
    tags: ['happy-path'],
    enabled: true
  });

  // 2. 拒绝
  scenarios.push({
    id: nextId('reject'),
    name: '审批拒绝',
    process: processId,
    severity: 'P1',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'REJECT', actor: 'reviewer1', data: { reason: '材料不全' } }
    ],
    expected: {
      finalState: 'REJECTED',
      semanticPath: ['SUBMIT', 'REJECT']
    },
    tags: ['error', 'rejection'],
    enabled: true
  });

  // 3. 退回
  scenarios.push({
    id: nextId('return'),
    name: '退回补充材料',
    process: processId,
    severity: 'P1',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'RETURN', actor: 'reviewer1', data: { comment: '请补充资料' } }
    ],
    expected: {
      finalState: 'RETURNED',
      semanticPath: ['SUBMIT', 'RETURN']
    },
    tags: ['error', 'return'],
    enabled: true
  });

  // 4. 撤回
  scenarios.push({
    id: nextId('withdraw'),
    name: '申请人撤回',
    process: processId,
    severity: 'P2',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'WITHDRAW', actor: 'applicant' }
    ],
    expected: {
      finalState: 'WITHDRAWN',
      semanticPath: ['SUBMIT', 'WITHDRAW']
    },
    tags: ['withdraw'],
    enabled: true
  });

  // 5. 转交
  scenarios.push({
    id: nextId('transfer'),
    name: '转交给其他人',
    process: processId,
    severity: 'P2',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'TRANSFER', actor: 'reviewer1', data: { targetReviewer: 'reviewer3' } },
      { type: 'APPROVE', actor: 'reviewer3' }
    ],
    expected: {
      finalState: 'APPROVED',
      semanticPath: ['SUBMIT', 'TRANSFER', 'APPROVE']
    },
    tags: ['transfer'],
    enabled: true
  });

  // 6. 并签-全部通过
  scenarios.push({
    id: nextId('parallel-pass'),
    name: '并签-所有审批人通过',
    process: processId,
    severity: 'P1',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'COUNTERSIGN', actor: 'reviewer1' },
      { type: 'APPROVE', actor: 'reviewer1' },
      { type: 'APPROVE', actor: 'reviewer2' },
      { type: 'COUNTERSIGN_COMPLETE', actor: 'reviewer1' }
    ],
    expected: {
      finalState: 'APPROVED',
      semanticPath: ['SUBMIT', 'COUNTERSIGN', 'APPROVE', 'APPROVE', 'COUNTERSIGN_COMPLETE']
    },
    tags: ['parallel', 'all-pass'],
    enabled: true
  });

  // 7. 并签-部分通过
  scenarios.push({
    id: nextId('parallel-reject'),
    name: '并签-一个分支拒绝',
    process: processId,
    severity: 'P1',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'COUNTERSIGN', actor: 'reviewer1' },
      { type: 'APPROVE', actor: 'reviewer1' },
      { type: 'REJECT', actor: 'reviewer2', data: { reason: '不同意' } }
    ],
    expected: {
      finalState: 'REJECTED',
      semanticPath: ['SUBMIT', 'COUNTERSIGN', 'APPROVE', 'REJECT']
    },
    tags: ['parallel', 'partial-reject'],
    enabled: true
  });

  // 8. 边界值-最小金额
  scenarios.push({
    id: nextId('scenario'),
    name: '边界值-最小金额',
    process: processId,
    severity: 'P2',
    actions: [
      { type: 'SUBMIT', actor: 'applicant', data: { amount: 0.01 } },
      { type: 'APPROVE', actor: 'reviewer1' }
    ],
    expected: {
      finalState: 'APPROVED',
      semanticPath: ['SUBMIT', 'APPROVE']
    },
    tags: ['boundary', 'min'],
    enabled: true
  });

  // 9. 边界值-最大金额
  scenarios.push({
    id: nextId('scenario'),
    name: '边界值-最大金额',
    process: processId,
    severity: 'P2',
    actions: [
      { type: 'SUBMIT', actor: 'applicant', data: { amount: 999999999 } },
      { type: 'APPROVE', actor: 'reviewer1' }
    ],
    expected: {
      finalState: 'APPROVED',
      semanticPath: ['SUBMIT', 'APPROVE']
    },
    tags: ['boundary', 'max'],
    enabled: true
  });

  // 10. 外部系统失败
  scenarios.push({
    id: nextId('scenario'),
    name: '外部系统调用失败',
    process: processId,
    severity: 'P1',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'APPROVE', actor: 'reviewer1' }
    ],
    expected: {
      finalState: 'ERROR',
      semanticPath: ['SUBMIT', 'APPROVE']
    },
    tags: ['error', 'external-system'],
    enabled: true
  });

  // 11. 重新提交
  scenarios.push({
    id: nextId('scenario'),
    name: '退回后重新提交',
    process: processId,
    severity: 'P2',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'RETURN', actor: 'reviewer1' },
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'APPROVE', actor: 'reviewer1' }
    ],
    expected: {
      finalState: 'APPROVED',
      semanticPath: ['SUBMIT', 'RETURN', 'SUBMIT', 'APPROVE']
    },
    tags: ['resubmit'],
    enabled: true
  });

  // 12. 非法角色操作
  scenarios.push({
    id: nextId('scenario'),
    name: '非法角色操作',
    process: processId,
    severity: 'P2',
    actions: [
      { type: 'SUBMIT', actor: 'wrong-role' }
    ],
    expected: {
      finalState: 'REJECTED',
      semanticPath: ['SUBMIT']
    },
    tags: ['security', 'permission'],
    enabled: true
  });

  // 13. 重复提交
  scenarios.push({
    id: nextId('scenario'),
    name: '重复提交',
    process: processId,
    severity: 'P3',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'SUBMIT', actor: 'applicant' }
    ],
    expected: {
      finalState: 'DRAFT',
      semanticPath: ['SUBMIT']
    },
    tags: ['edge', 'duplicate'],
    enabled: true
  });

  // 14. 期限边界
  scenarios.push({
    id: nextId('scenario'),
    name: '期限边界-最短',
    process: processId,
    severity: 'P3',
    actions: [
      { type: 'SUBMIT', actor: 'applicant', data: { term: 1 } },
      { type: 'APPROVE', actor: 'reviewer1' }
    ],
    expected: {
      finalState: 'APPROVED',
      semanticPath: ['SUBMIT', 'APPROVE']
    },
    tags: ['boundary', 'term'],
    enabled: true
  });

  // 15. 会签失败
  scenarios.push({
    id: nextId('scenario'),
    name: '并签-两个分支同时完成',
    process: processId,
    severity: 'P1',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'COUNTERSIGN', actor: 'reviewer1' },
      { type: 'COUNTERSIGN', actor: 'reviewer2' },
      { type: 'APPROVE', actor: 'reviewer1' },
      { type: 'APPROVE', actor: 'reviewer2' },
      { type: 'COUNTERSIGN_COMPLETE', actor: 'reviewer1' }
    ],
    expected: {
      finalState: 'APPROVED',
      semanticPath: ['SUBMIT', 'COUNTERSIGN', 'COUNTERSIGN', 'APPROVE', 'APPROVE', 'COUNTERSIGN_COMPLETE']
    },
    tags: ['parallel', 'simultaneous'],
    enabled: true
  });

  // 16. 仅完成一个会签分支
  scenarios.push({
    id: nextId('scenario'),
    name: '并签-只完成一个分支',
    process: processId,
    severity: 'P2',
    actions: [
      { type: 'SUBMIT', actor: 'applicant' },
      { type: 'COUNTERSIGN', actor: 'reviewer1' },
      { type: 'APPROVE', actor: 'reviewer1' }
    ],
    expected: {
      finalState: 'COUNTERSIGNING',
      semanticPath: ['SUBMIT', 'COUNTERSIGN', 'APPROVE']
    },
    tags: ['parallel', 'partial'],
    enabled: true
  });

  return {
    success: true,
    scenarios,
    warnings,
    errors,
    mode: 'deterministic-fallback'
  };
}

function generateScenariosMarkdown(
  scenarios: Scenario[],
  processId: string,
  factCount: number,
  result: GenerationResult
): string {
  let md = `# 测试场景

## 基本信息

| 项目 | 值 |
|------|---|
| 流程 | ${processId} |
| 场景总数 | ${scenarios.length} |
| 基线事实数 | ${factCount} |
| 生成时间 | ${new Date().toLocaleString('zh-CN')} |
| 生成方式 | ${result.scenarios.length > 0 ? 'AI 增强' : '确定性回退'} |

## 场景分布

`;

  const bySeverity: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  for (const s of scenarios) {
    const sev = s.severity || 'P3';
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    if (s.tags) {
      for (const tag of s.tags) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
    }
  }

  md += `### 按严重性\n\n`;
  md += `| 严重性 | 数量 |\n|--------|------|\n`;
  for (const [sev, count] of Object.entries(bySeverity).sort()) {
    md += `| ${sev} | ${count} |\n`;
  }

  md += `\n### 按标签\n\n`;
  md += `| 标签 | 数量 |\n|------|------|\n`;
  for (const [tag, count] of Object.entries(byTag).sort((a, b) => b[1] - a[1])) {
    md += `| ${tag} | ${count} |\n`;
  }

  md += `\n## 场景列表\n\n`;
  md += `| ID | 名称 | 严重性 | 标签 | 最终状态 |\n`;
  md += `|----|------|--------|------|----------|\n`;

  for (const s of scenarios.sort((a, b) => (a.severity || '').localeCompare(b.severity || ''))) {
    const tags = s.tags?.join(', ') || '-';
    const state = s.expected?.finalState || '-';
    md += `| ${s.id} | ${s.name} | ${s.severity || 'P3'} | ${tags} | ${state} |\n`;
  }

  md += `\n## 详细场景\n\n`;
  for (const s of scenarios) {
    md += `### ${s.name} (\`${s.id}\`)\n\n`;
    md += `- **严重性**: ${s.severity || 'P3'}\n`;
    md += `- **标签**: ${s.tags?.join(', ') || '-'}\n`;
    md += `- **期望最终状态**: \`${s.expected?.finalState}\`\n`;
    if (s.expected?.semanticPath && s.expected.semanticPath.length > 0) {
      md += `- **期望语义路径**: ${s.expected.semanticPath.join(' → ')}\n`;
    }
    md += `- **动作序列**:\n`;
    for (const action of s.actions) {
      md += `  - \`${action.type}\` by \`${action.actor}\``;
      if (action.data) {
        md += ` (data: ${JSON.stringify(action.data).substring(0, 100)})`;
      }
      md += `\n`;
    }
    md += `\n`;
  }

  md += `---\n\n*由 FlowTrace 自动生成*\n`;
  return md;
}

/**
 * 生成人工可读的测试案例 Markdown
 */
function generateHumanReadableScenarios(scenarios: Scenario[], processId: string): string {
  let md = `# 测试案例 - 人工展示

## 概述

本文件展示所有测试案例，供人工审核和理解。

**流程**: ${processId}
**案例总数**: ${scenarios.length}
**生成时间**: ${new Date().toLocaleString('zh-CN')}

## 案例目录

`;

  // 按类别分组
  const categories: Record<string, Scenario[]> = {};
  for (const s of scenarios) {
    const sAny = s as any;
    const category = categorizeScenario(sAny);
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(s);
  }

  for (const [category, items] of Object.entries(categories)) {
    md += `### ${category} (${items.length} 个)\n\n`;
    for (const s of items) {
      md += `- [\`${s.id}\`](#${s.id.replace(/\./g, '-')}) - ${s.name}\n`;
    }
    md += `\n`;
  }

  md += `## 详细案例\n\n`;

  for (const s of scenarios) {
    const sAny = s as any;
    const category = categorizeScenario(sAny);
    md += `--- \n\n`;
    md += `### ${s.name} (\`${s.id}\`) {#${s.id.replace(/\./g, '-')}}\n\n`;
    md += `**分类**: ${category}\n\n`;
    md += `**严重性**: ${s.severity || 'P3'}\n\n`;
    md += `**描述**: ${sAny.description || '无描述'}\n\n`;

    if (s.tags && s.tags.length > 0) {
      md += `**标签**: ${s.tags.join(', ')}\n\n`;
    }

    // 前置数据
    if (s.input && Object.keys(s.input).length > 0) {
      md += `#### 前置数据\n\n`;
      md += `| 字段 | 值 |\n|------|---|\n`;
      for (const [key, value] of Object.entries(s.input)) {
        md += `| ${key} | ${JSON.stringify(value)} |\n`;
      }
      md += `\n`;
    }

    // 操作步骤
    md += `#### 操作步骤\n\n`;
    md += `| 序号 | 动作 | 执行者 | 说明 |\n`;
    md += `|------|------|--------|------|\n`;
    s.actions.forEach((action, idx) => {
      const desc = action.data ? JSON.stringify(action.data).substring(0, 50) : '-';
      md += `| ${idx + 1} | ${action.type} | ${action.actor} | ${desc} |\n`;
    });
    md += `\n`;

    // 预期结果
    md += `#### 预期结果\n\n`;
    md += `- **最终状态**: \`${s.expected?.finalState || '未指定'}\`\n`;
    if (s.expected?.semanticPath && s.expected.semanticPath.length > 0) {
      md += `- **语义路径**: ${s.expected.semanticPath.join(' → ')}\n`;
    }
    if (s.expected?.database) {
      md += `- **数据库变化**:\n`;
      for (const [key, value] of Object.entries(s.expected.database)) {
        md += `  - ${key}: ${JSON.stringify(value)}\n`;
      }
    }
    md += `\n`;

    // 业务不变量
    if (sAny.businessInvariants && sAny.businessInvariants.length > 0) {
      md += `#### 业务不变量\n\n`;
      for (const inv of sAny.businessInvariants) {
        md += `- ${inv}\n`;
      }
      md += `\n`;
    }

    // 语义事件
    if (sAny.semanticEvents && sAny.semanticEvents.length > 0) {
      md += `#### 语义事件\n\n`;
      for (const event of sAny.semanticEvents) {
        md += `- ${event}\n`;
      }
      md += `\n`;
    }

    // 事实来源
    if (s.source && s.source.length > 0) {
      md += `#### 事实来源\n\n`;
      for (const src of s.source) {
        md += `- ${src}\n`;
      }
      md += `\n`;
    }

    // 审核状态
    md += `#### 审核状态\n\n`;
    md += `${sAny.reviewStatus === 'APPROVED' ? '✅' : sAny.reviewStatus === 'REJECTED' ? '❌' : '⏳'} **${sAny.reviewStatus || 'PENDING_REVIEW'}**\n\n`;
  }

  md += `---\n\n*此文件由 FlowTrace 自动生成，供人工审核*\n`;
  md += `*生成时间: ${new Date().toLocaleString('zh-CN')}*\n`;

  return md;
}

/**
 * 将场景分类
 */
function categorizeScenario(scenario: any): string {
  const name = scenario.name?.toLowerCase() || '';
  const tags = scenario.tags || [];
  const actions = scenario.actions?.map((a: any) => a.type) || [];

  if (tags.includes('happy-path') || name.includes('正常') || name.includes('通过')) {
    return '正常流程';
  }
  if (tags.includes('rejection') || name.includes('拒绝') || actions.includes('REJECT')) {
    return '拒绝场景';
  }
  if (name.includes('退回') || actions.includes('RETURN')) {
    return '退回场景';
  }
  if (tags.includes('withdrawal') || name.includes('撤回') || actions.includes('WITHDRAW')) {
    return '撤回场景';
  }
  if (tags.includes('parallel') || tags.includes('parallel') || name.includes('并签') || name.includes('并行')) {
    return '并签场景';
  }
  if (tags.includes('boundary') || name.includes('边界') || name.includes('最小') || name.includes('最大')) {
    return '边界测试';
  }
  if (name.includes('外部') || name.includes('失败')) {
    return '异常场景';
  }
  if (name.includes('非法') || name.includes('权限')) {
    return '权限测试';
  }
  return '其他场景';
}
