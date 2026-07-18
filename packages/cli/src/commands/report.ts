import chalk from 'chalk';
import { resolve, join } from 'path';
import { existsSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import yaml from 'js-yaml';
import {
  loadTargetProjectConfig,
  getReportsDir,
  getFactsDir,
  getScenariosDir,
  generateCoverageReport,
  extractExecutedNodes,
  createExecutionRecord,
  runGate,
  gateForCommand,
  type TargetProjectConfig,
  type ProcessDefinition,
  type ExecutionRecord,
  type CoverageReport,
  type CommandResult
} from '@flowtrace/core';
import type { VerificationRun, Scenario, ExecutionResult, DualExecutionResult } from '@flowtrace/core';

interface ReportOptions {
  project?: string;
  run?: string;
  format?: string;
  output?: string;
  includeCoverage?: boolean;
  human?: boolean;
}

export async function reportCommand(options: ReportOptions): Promise<void> {
  const projectPath = options.project
    ? resolve(process.cwd(), options.project)
    : resolve(process.cwd());

  if (projectUsesBuiltinRuntime(projectPath)) {
    const canonicalReport = findCanonicalBuiltinReport(projectPath, options.run);
    console.log(chalk.yellow('Builtin verification already generates the canonical fixed report; `flowtrace report` will not regenerate or overwrite it.'));
    if (canonicalReport) {
      console.log(chalk.green(`Canonical report: ${canonicalReport}`));
    } else {
      console.log(chalk.gray('Run `flowtrace verify --project <path>` first.'));
    }
    return;
  }

  // --- Gate check ---
  const requirements = gateForCommand('report');
  const flowtraceRoot = join(projectPath, '.flowtrace');
  const gateResult: CommandResult = runGate({
    projectRoot: projectPath,
    flowtraceRoot,
    requirements,
    explicitProcessId: null,
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

  const format = options.format || 'markdown';

  console.log(chalk.blue(`\n📊 FlowTrace Report Generation`));
  console.log(chalk.gray(`Project: ${projectPath}`));
  console.log(chalk.gray(`Format: ${format}\n`));

  if (!existsSync(projectPath)) {
    console.error(chalk.red(`Project path does not exist: ${projectPath}`));
    process.exit(1);
  }

  // 加载目标项目配置
  let targetConfig: TargetProjectConfig;
  try {
    targetConfig = loadTargetProjectConfig(projectPath);
    console.log(chalk.green(`✓ Loaded project: ${targetConfig.project.name}`));
  } catch (error) {
    console.error(chalk.red(`Failed to load project config: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }

  const reportsDir = getReportsDir(targetConfig);
  const factsDir = getFactsDir(targetConfig);
  const scenariosDir = getScenariosDir(targetConfig);
  const processId = targetConfig.processId;
  const projectName = targetConfig.project.name;

  // 查找运行结果
  let reportData: VerificationRun | null = null;

  if (options.run) {
    const requestedRun = options.run.replace(/\.json$/, '');
    const candidateNames = [
      `${requestedRun}.json`,
      `run-${requestedRun}.json`
    ];
    const runName = candidateNames.find((name) => existsSync(resolve(reportsDir, name)));
    const runPath = runName ? resolve(reportsDir, runName) : resolve(reportsDir, candidateNames[0]);
    if (runName) {
      try {
        const runContent = JSON.parse(readFileSync(runPath, 'utf-8')) as VerificationRun;
        reportData = runContent;
        console.log(chalk.green(`✓ Loaded run: ${runContent.id}`));
      } catch (error) {
        console.error(chalk.red(`Failed to read run ${options.run}: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    } else {
      console.error(chalk.red(`Run not found: ${options.run}`));
      console.log(chalk.gray(`Available runs:`));
      listAvailableRuns(reportsDir);
      process.exit(1);
    }
  } else {
    const runFiles = listRunFiles(reportsDir);
    if (runFiles.length > 0) {
      const latestRun = runFiles[0];
      const runPath = resolve(reportsDir, latestRun);
      reportData = JSON.parse(readFileSync(runPath, 'utf-8'));
      console.log(chalk.gray(`Using latest run: ${latestRun}\n`));
    }
  }

  if (!reportData) {
    console.error(chalk.red('No verification run found. Run `flowtrace verify --project <path>` first.'));
    process.exit(1);
  }

  // 加载 baseline 信息
  let baselineInfo: any = null;
  const baselinePath = resolve(factsDir, 'baseline.json');
  if (existsSync(baselinePath)) {
    try {
      baselineInfo = JSON.parse(readFileSync(baselinePath, 'utf-8'));
    } catch {
      // Ignore
    }
  }

  // 加载场景信息
  let scenariosInfo: any = null;
  const scenariosFile = resolve(scenariosDir, 'scenarios.json');
  if (existsSync(scenariosFile)) {
    try {
      scenariosInfo = JSON.parse(readFileSync(scenariosFile, 'utf-8'));
    } catch {
      // Ignore
    }
  }

  // 加载流程定义（用于覆盖率计算）
  const processDef = loadProcessDefinition(scenariosDir, scenariosInfo);

  // 加载场景列表
  const scenarios: Scenario[] = scenariosInfo?.scenarios || [];

  // 计算覆盖率
  let coverageReport: CoverageReport | null = null;
  if (processDef && scenarios.length > 0) {
    const executions: ExecutionRecord[] = [];
    for (const result of reportData.scenarios) {
      if (result.legacyResult) {
        const scenario = scenarios.find(s => s.id === result.scenarioId);
        if (scenario) {
          const record = createExecutionRecord(scenario, result.legacyResult);
          executions.push(record);
        }
      }
    }

    coverageReport = generateCoverageReport(
      targetConfig.processId,
      scenarios,
      executions,
      processDef
    );
  }

  // 检查是否是 legacy-shadow 模式
  const isLegacyShadow = targetConfig.pilot?.currentAdapterMode === 'legacy-shadow';
  
  // 获取案例计数
  const generatedCount = scenariosInfo?.counts?.generatedCount || scenariosInfo?.scenarios?.length || 0;
  const validatedCount = scenariosInfo?.scenarios?.length || 0;
  const executedCount = reportData.scenarios?.length || 0;
  const passedCount = reportData.summary?.passed || 0;
  const failedCount = reportData.summary?.failed || 0;

  // 生成报告
  let reportContent: string;
  const ext = format === 'html' ? '.html' : format === 'json' ? '.json' : '.md';

  if (format === 'json') {
    reportContent = JSON.stringify({
      ...reportData,
      executionMetadata: {
        projectName,
        projectId: targetConfig.project.id,
        processId,
        generatedAt: new Date().toISOString(),
        executionTime: new Date(reportData.timestamp).toLocaleString('zh-CN'),
        executionMode: isLegacyShadow ? 'legacy-shadow' : 'demo-equivalent',
        isLegacyShadow,
        counts: {
          generatedCount,
          validatedCount,
          executedCount,
          passedCount,
          failedCount
        },
        baseline: baselineInfo ? {
          factsCount: baselineInfo.summary?.totalFacts || 0,
          categories: Object.keys(baselineInfo.summary?.byCategory || {}),
          confirmedFacts: baselineInfo.summary?.confirmedFacts || 0,
          pendingFacts: baselineInfo.summary?.pendingFacts || 0
        } : null,
        scenariosInfo: {
          total: scenariosInfo?.scenarios?.length || 0,
          generationMode: scenariosInfo?.generationMode || 'unknown',
          bySeverity: calculateBySeverity(scenariosInfo?.scenarios || [])
        },
        coverage: coverageReport,
        releaseGate: reportData.releaseGate
      }
    }, null, 2);
  } else if (format === 'html') {
    reportContent = generateHtmlReport(reportData, projectName, {
      isLegacyShadow,
      baselineInfo,
      scenariosInfo,
      processId,
      coverageReport,
      counts: { generatedCount, validatedCount, executedCount, passedCount, failedCount },
      executionMode: isLegacyShadow ? 'legacy-shadow' : 'demo-equivalent'
    });
  } else {
    reportContent = generateMarkdownReport(reportData, projectName, {
      isLegacyShadow,
      baselineInfo,
      scenariosInfo,
      processId,
      coverageReport,
      counts: { generatedCount, validatedCount, executedCount, passedCount, failedCount },
      executionMode: isLegacyShadow ? 'legacy-shadow' : 'demo-equivalent'
    });
  }

  // 保存报告
  const reportId = reportData.id;
  const outputFile = options.output
    ? resolve(projectPath, options.output)
    : resolve(reportsDir, `report-${reportId}${ext}`);

  writeFileSync(outputFile, reportContent, 'utf-8');
  console.log(chalk.green(`\n✓ Report saved to: ${outputFile}`));

  // 生成 reports/index.md
  generateReportsIndex(reportsDir, reportData, targetConfig);
}

function projectUsesBuiltinRuntime(projectPath: string): boolean {
  const configPath = resolve(projectPath, '.flowtrace', 'flowtrace.yaml');
  if (!existsSync(configPath)) return false;
  try {
    const raw = yaml.load(readFileSync(configPath, 'utf8')) as any;
    return raw?.runtime?.adapter === 'builtin';
  } catch {
    return false;
  }
}

function findCanonicalBuiltinReport(projectPath: string, requestedRun?: string): string | null {
  const executionsDir = resolve(projectPath, '.flowtrace', 'executions');
  if (!existsSync(executionsDir)) return null;
  const runIds = requestedRun
    ? [requestedRun]
    : readdirSync(executionsDir).filter((name) => name.startsWith('run-')).sort().reverse();
  for (const runId of runIds) {
    const reportPath = resolve(executionsDir, runId, 'reports', 'report.html');
    if (existsSync(reportPath)) return reportPath;
  }
  return null;
}

function generateReportsIndex(reportsDir: string, run: VerificationRun, config: TargetProjectConfig): void {
  const isLegacyShadow = config.pilot?.currentAdapterMode === 'legacy-shadow';
  const passRate = run.summary.total > 0 ? ((run.summary.passed / run.summary.total) * 100).toFixed(1) : '0';

  let md = `# FlowTrace 报告汇总

## 项目信息

| 项目 | 值 |
|------|---|
| 项目名称 | ${config.project.name} |
| 项目 ID | ${config.project.id} |
| 流程 ID | ${config.processId} |
| 执行模式 | ${isLegacyShadow ? 'legacy-shadow' : 'dual-run'} |

## 最新执行

| 指标 | 值 |
|------|---|
| 运行 ID | ${run.id} |
| 执行时间 | ${new Date(run.timestamp).toLocaleString('zh-CN')} |
| 案例总数 | ${run.summary.total} |
| 通过 | ${run.summary.passed} |
| 失败 | ${run.summary.failed} |
| 通过率 | ${passRate}% |
| 发布门禁 | ${run.releaseGate.allowed ? '✅ 通过' : '❌ 阻塞'} |

`;

  if (isLegacyShadow) {
    md += `
::: warning
⚠️ **Legacy-Shadow 模式**: 当前适配器复用 legacy adapter，结果不代表新旧流程真实一致。
:::
`;
  }

  // 差异统计
  md += `
## 差异统计

| 严重性 | 数量 | 说明 |
|--------|------|------|
| P0 | ${run.summary.differencesBySeverity.P0 || 0} | 核心业务差异，阻塞发布 |
| P1 | ${run.summary.differencesBySeverity.P1 || 0} | 业务路径差异，阻塞发布 |
| P2 | ${run.summary.differencesBySeverity.P2 || 0} | 非核心差异，需审核 |
| P3 | ${run.summary.differencesBySeverity.P3 || 0} | 技术差异，可配置放行 |

`;

  // 报告列表
  const runFiles = listRunFiles(reportsDir);
  if (runFiles.length > 0) {
    md += `
## 历史报告

| 运行 ID | 执行时间 | 状态 | 报告 |
|---------|----------|------|------|
`;
    for (const runFile of runFiles.slice(0, 10)) {
      const runIdMatch = runFile.match(/^run-(.+)\.json$/);
      if (runIdMatch) {
        const rid = runIdMatch[1];
        const runPath = resolve(reportsDir, runFile);
        try {
          const runData = JSON.parse(readFileSync(runPath, 'utf-8'));
          const status = runData.releaseGate?.allowed ? '✅ 通过' : '❌ 阻塞';
          md += `| ${rid} | ${new Date(runData.timestamp).toLocaleString('zh-CN')} | ${status} | [Markdown](report-${rid}.md) / [HTML](report-${rid}.html) |\n`;
        } catch {
          md += `| ${rid} | - | - | - |\n`;
        }
      }
    }
  }

  md += `
## 快速链接

- [最新 Markdown 报告](report-${run.id}.md)
- [最新 HTML 报告](report-${run.id}.html)
- [最新执行结果](run-${run.id}.json)
- [manifest.md](../manifest.md) - 完整成果物清单

---

*此报告由 FlowTrace 自动生成*
*生成时间: ${new Date().toLocaleString('zh-CN')}*
`;

  const indexFile = resolve(reportsDir, 'index.md');
  writeFileSync(indexFile, md, 'utf-8');
  console.log(chalk.green(`✓ Reports index saved: ${indexFile}`));
}

function listRunFiles(reportsDir: string): string[] {
  if (!existsSync(reportsDir)) {
    return [];
  }

  try {
    return readdirSync(reportsDir)
      .filter((f) => f.startsWith('run-') && f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function listAvailableRuns(reportsDir: string): void {
  const files = listRunFiles(reportsDir);
  if (files.length === 0) {
    console.log(chalk.gray(`   No runs found in ${reportsDir}`));
  } else {
    for (const file of files.slice(0, 5)) {
      console.log(chalk.gray(`   - ${file}`));
    }
  }
}

interface ReportContext {
  isLegacyShadow: boolean;
  baselineInfo: any;
  scenariosInfo: any;
  processId: string;
  coverageReport: CoverageReport | null;
  counts: {
    generatedCount: number;
    validatedCount: number;
    executedCount: number;
    passedCount: number;
    failedCount: number;
  };
  executionMode: 'legacy-shadow' | 'demo-equivalent' | 'demo-different';
}

function calculateBySeverity(scenarios: Scenario[]): Record<string, number> {
  const bySeverity: Record<string, number> = {};
  for (const s of scenarios) {
    const sev = s.severity || 'P3';
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
  }
  return bySeverity;
}

/**
 * 加载流程定义（从语义目录）
 */
function loadProcessDefinition(scenariosDir: string, scenariosInfo: any): ProcessDefinition | null {
  // 尝试从 process-model.json 加载
  const semanticDir = resolve(scenariosDir, '..', 'semantic');
  const processModelPath = resolve(semanticDir, 'process-model.json');
  if (existsSync(processModelPath)) {
    try {
      const content = readFileSync(processModelPath, 'utf-8');
      const data = JSON.parse(content);
      if (data.nodes) {
        const nodes = data.nodes.map((n: any) => ({
          id: n.id,
          name: n.name || n.id,
          type: n.type || 'task',
          isCritical: n.isCritical || n.type === 'start' || n.type === 'end'
        }));

        return {
          processId: data.id || 'unknown',
          name: data.name || 'Unknown Process',
          nodes,
          branches: [],
          roles: []
        };
      }
    } catch {
      // Ignore
    }
  }

  // 回退：从 scenarios 的 expected.finalState 推断节点
  if (scenariosInfo?.scenarios) {
    const nodes = new Map<string, any>();
    for (const s of scenariosInfo.scenarios) {
      const state = s.expected?.finalState;
      if (state && !nodes.has(state)) {
        nodes.set(state, {
          id: state,
          name: state,
          type: 'task',
          isCritical: false
        });
      }
      // 从动作中提取节点
      if (s.actions) {
        for (const action of s.actions) {
          if (!nodes.has(action.type)) {
            nodes.set(action.type, {
              id: action.type,
              name: action.type,
              type: 'task',
              isCritical: false
            });
          }
        }
      }
    }

    return {
      processId: 'inferred',
      name: 'Inferred Process',
      nodes: Array.from(nodes.values()),
      branches: [],
      roles: []
    };
  }

  return null;
}

function generateMarkdownReport(run: VerificationRun, projectName: string, ctx: ReportContext): string {
  const isLegacyShadow = ctx.isLegacyShadow;
  const executionMode = ctx.executionMode || (isLegacyShadow ? 'legacy-shadow' : 'unknown');

  let md = `# FlowTrace 流程验证报告

## 基本信息

| 项目 | ${projectName} |
|------|----------------|
| 流程 | ${ctx.processId} |
| 运行 ID | ${run.id} |
| 运行时间 | ${new Date(run.timestamp).toLocaleString('zh-CN')} |
| 项目 ID | ${run.projectId} |
| 执行模式 | ${executionMode} |
| 是否为 legacy-shadow | ${isLegacyShadow ? '是' : '否'} |

`;

  // Legacy-Shadow 警告
  if (isLegacyShadow) {
    md += `::: warning
⚠️  **Legacy-Shadow 模式**

此报告使用 legacy-shadow 模式运行。当前适配器复用 legacy adapter，结果**不代表新旧流程真实一致**。
仅用于验证测试链路是否正常工作。

**限制说明：**
- legacy-shadow 仅验证 FlowTrace 工具链正确性
- 不证明未来新流程与旧流程等价
- 真实新流程尚未接入
:::
`;
  }

  // 案例计数
  md += `
## 执行统计

| 指标 | 值 |
|------|---|
| 生成案例数量 | ${ctx.counts.generatedCount} |
| 校验案例数量 | ${ctx.counts.validatedCount} |
| 执行案例数量 | ${ctx.counts.executedCount} |
| 通过数量 | ${ctx.counts.passedCount} |
| 失败数量 | ${ctx.counts.failedCount} |
| 通过率 | ${ctx.counts.executedCount > 0 ? ((ctx.counts.passedCount / ctx.counts.executedCount) * 100).toFixed(1) : 0}% |

`;

  // Baseline 信息
  if (ctx.baselineInfo) {
    md += `
## 基线信息

| 指标 | 值 |
|------|---|
| 采集事实数 | ${ctx.baselineInfo.summary?.totalFacts || 0} |
| 确认事实数 | ${ctx.baselineInfo.summary?.confirmedFacts || 0} |
| 待确认事实数 | ${ctx.baselineInfo.summary?.pendingFacts || 0} |
`;
    if (ctx.baselineInfo.summary?.byCategory) {
      md += `\n**按类别分布：**\n`;
      for (const [cat, count] of Object.entries(ctx.baselineInfo.summary.byCategory)) {
        md += `- ${cat}: ${count}\n`;
      }
    }
    md += `\n`;
  }

  // 场景信息
  if (ctx.scenariosInfo?.scenarios) {
    const scenarios = ctx.scenariosInfo.scenarios;
    const bySeverity: Record<string, number> = {};
    for (const s of scenarios) {
      bySeverity[s.severity] = (bySeverity[s.severity] || 0) + 1;
    }
    md += `
## 测试场景

| 指标 | 值 |
|------|---|
| 总场景数 | ${scenarios.length} |
| 生成方式 | ${ctx.scenariosInfo.generationMode || 'unknown'} |
`;
    for (const [sev, count] of Object.entries(bySeverity).sort()) {
      md += `| ${sev} | ${count} |\n`;
    }
    md += `\n`;
  }

  // 覆盖率
  if (ctx.coverageReport) {
    const cr = ctx.coverageReport;
    md += `
## 覆盖率

| 指标 | 覆盖数 | 总数 | 覆盖率 |
|------|--------|------|--------|
`;
    for (const m of cr.metrics) {
      md += `| ${m.name} | ${m.covered} | ${m.total} | ${m.percentage.toFixed(1)}% |\n`;
    }
    md += `\n**总体覆盖率**: ${cr.overallCoverage.toFixed(1)}% (${cr.grade})\n\n`;
  }

  // 执行摘要
  md += `
## 执行摘要

| 指标 | 值 |
|------|---|
| 总场景数 | ${run.summary.total} |
| 通过 | ${run.summary.passed} |
| 失败 | ${run.summary.failed} |
| 通过率 | ${run.summary.total > 0 ? ((run.summary.passed / run.summary.total) * 100).toFixed(1) : 0}% |

### 按严重性差异

| 严重性 | 差异数 | 阻塞发布 |
|--------|--------|----------|
`;
  for (const [sev, count] of Object.entries(run.summary.differencesBySeverity)) {
    const isBlocking = sev === 'P0' || sev === 'P1';
    md += `| ${sev} | ${count} | ${isBlocking ? '是' : '否'} |\n`;
  }

  // 发布门禁
  md += `
## 发布门禁

`;
  if (run.releaseGate.allowed) {
    md += `✅ **通过** - 所有 P0/P1 差异已解决，可以发布。\n`;
  } else {
    md += `❌ **阻塞** - 必须解决以下问题才能发布：\n\n`;
    for (const block of run.releaseGate.blockedBy) {
      md += `- ${block}\n`;
    }
  }

  // 场景结果
  md += `
## 场景结果

`;
  for (const result of run.scenarios) {
    const status = result.passed ? '✅' : '❌';
    const severity = result.passed ? '' : detectSeverity(result.differences);
    md += `### ${status} ${result.scenarioId} ${severity}\n\n`;

    if (result.error) {
      md += `**错误:** ${result.error}\n\n`;
    }

    if (result.legacyResult) {
      md += `**Legacy 结果:**\n`;
      md += `- 最终状态: \`${result.legacyResult.finalState}\`\n`;
      md += `- 语义路径: \`${result.legacyResult.semanticPath?.join(' → ') || '-'}\`\n`;
      if (result.legacyResult.businessData && Object.keys(result.legacyResult.businessData).length > 0) {
        md += `- 业务数据: ${JSON.stringify(result.legacyResult.businessData).substring(0, 200)}\n`;
      }
      md += `\n`;
    }

    if (result.currentResult) {
      md += `**Current 结果:**\n`;
      md += `- 最终状态: \`${result.currentResult.finalState}\`\n`;
      md += `- 语义路径: \`${result.currentResult.semanticPath?.join(' → ') || '-'}\`\n`;
      if (result.currentResult.businessData && Object.keys(result.currentResult.businessData).length > 0) {
        md += `- 业务数据: ${JSON.stringify(result.currentResult.businessData).substring(0, 200)}\n`;
      }
      md += `\n`;
    }

    if (result.differences.length > 0) {
      md += `**差异:**\n\n`;
      for (const diff of result.differences) {
        md += `- **[${diff.severity}]** ${diff.description}\n`;
        md += `  - 类别: ${diff.category}\n`;
        if (diff.legacyValue !== undefined) {
          md += `  - Legacy: \`${JSON.stringify(diff.legacyValue).substring(0, 100)}\`\n`;
        }
        if (diff.currentValue !== undefined) {
          md += `  - Current: \`${JSON.stringify(diff.currentValue).substring(0, 100)}\`\n`;
        }
      }
      md += `\n`;
    }
  }

  // 页脚
  md += `
---

*此报告由 FlowTrace 自动生成*
*生成时间: ${new Date().toLocaleString('zh-CN')}*
`;
  if (isLegacyShadow) {
    md += `\n*⚠️  Legacy-Shadow 模式: 结果不代表新旧流程真实一致*\n`;
  }

  return md;
}

function detectSeverity(differences: any[]): string {
  if (differences.length === 0) return '';
  const hasP0 = differences.some(d => d.severity === 'P0');
  const hasP1 = differences.some(d => d.severity === 'P1');
  if (hasP0) return '[P0]';
  if (hasP1) return '[P1]';
  return '';
}

function generateHtmlReport(run: VerificationRun, projectName: string, ctx: ReportContext): string {
  const isLegacyShadow = ctx.isLegacyShadow;
  const passRate = run.summary.total > 0 ? ((run.summary.passed / run.summary.total) * 100).toFixed(1) : 0;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlowTrace 报告 - ${projectName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f4f6f9; color: #2c3e50; line-height: 1.6; }
    .container { max-width: 1100px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
    .header h1 { font-size: 28px; margin-bottom: 10px; }
    .header .meta { opacity: 0.9; font-size: 14px; }
    .warning-banner { background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px 20px; margin-bottom: 20px; color: #856404; }
    .warning-banner strong { color: #721c24; }
    .summary { background: white; border-radius: 12px; padding: 25px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .summary h2 { font-size: 18px; color: #2c3e50; margin-bottom: 20px; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .stat-card { background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center; }
    .stat-card .value { font-size: 32px; font-weight: bold; color: #2c3e50; }
    .stat-card .label { font-size: 12px; color: #7f8c8d; text-transform: uppercase; margin-top: 5px; }
    .stat-card.pass .value { color: #27ae60; }
    .stat-card.fail .value { color: #e74c3c; }
    .gate { padding: 20px; border-radius: 8px; margin-top: 20px; }
    .gate.pass { background: #d4edda; border: 1px solid #27ae60; color: #155724; }
    .gate.fail { background: #f8d7da; border: 1px solid #e74c3c; color: #721c24; }
    .gate h3 { margin-bottom: 10px; }
    .severity-grid { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 15px; }
    .severity-badge { padding: 8px 15px; border-radius: 20px; font-weight: bold; font-size: 14px; }
    .severity-P0 { background: #e74c3c; color: white; }
    .severity-P1 { background: #f39c12; color: white; }
    .severity-P2 { background: #3498db; color: white; }
    .severity-P3 { background: #95a5a6; color: white; }
    .scenario { background: white; border-radius: 12px; padding: 20px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .scenario.passed { border-left: 4px solid #27ae60; }
    .scenario.failed { border-left: 4px solid #e74c3c; }
    .scenario h3 { font-size: 16px; margin-bottom: 10px; }
    .scenario h3 span { font-size: 14px; font-weight: normal; color: #7f8c8d; margin-left: 10px; }
    .result-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 15px 0; }
    .result-box { background: #f8f9fa; border-radius: 6px; padding: 12px; font-size: 13px; }
    .result-box h4 { font-size: 12px; color: #7f8c8d; text-transform: uppercase; margin-bottom: 8px; }
    .result-box pre { font-family: 'Monaco', 'Menlo', monospace; font-size: 11px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
    .diff { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 12px; margin: 10px 0; }
    .diff-item { margin-bottom: 8px; }
    .diff-item:last-child { margin-bottom: 0; }
    .diff-severity { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-right: 8px; }
    .diff-desc { font-weight: 500; }
    .diff-detail { font-size: 12px; color: #666; margin-left: 20px; margin-top: 4px; }
    .footer { text-align: center; color: #7f8c8d; font-size: 12px; margin-top: 30px; padding: 20px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    .info-table td { padding: 8px 12px; border-bottom: 1px solid #eee; }
    .info-table td:first-child { font-weight: 500; color: #7f8c8d; width: 120px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>FlowTrace 流程验证报告</h1>
      <div class="meta">
        <div>项目: ${projectName} | 流程: ${ctx.processId}</div>
        <div>运行 ID: ${run.id} | ${new Date(run.timestamp).toLocaleString('zh-CN')}</div>
      </div>
    </div>

    ${isLegacyShadow ? `
    <div class="warning-banner">
      <strong>⚠️  Legacy-Shadow 模式</strong><br>
      此报告使用 legacy-shadow 模式运行。当前适配器复用 legacy adapter，<br>
      结果<b>不代表新旧流程真实一致</b>。仅用于验证测试链路是否正常工作。
    </div>` : ''}

    <div class="summary">
      <h2>执行统计</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="value">${ctx.counts.generatedCount || run.summary.total}</div>
          <div class="label">生成</div>
        </div>
        <div class="stat-card">
          <div class="value">${ctx.counts.validatedCount || run.summary.total}</div>
          <div class="label">校验</div>
        </div>
        <div class="stat-card">
          <div class="value">${run.summary.total}</div>
          <div class="label">执行</div>
        </div>
        <div class="stat-card pass">
          <div class="value">${run.summary.passed}</div>
          <div class="label">通过</div>
        </div>
        <div class="stat-card fail">
          <div class="value">${run.summary.failed}</div>
          <div class="label">失败</div>
        </div>
        <div class="stat-card">
          <div class="value">${passRate}%</div>
          <div class="label">通过率</div>
        </div>
      </div>

      <h3>执行模式</h3>
      <p>${ctx.executionMode || (isLegacyShadow ? 'legacy-shadow' : 'unknown')} ${isLegacyShadow ? '(不代表真实等价)' : ''}</p>

      <h3>按严重性差异</h3>
      <div class="severity-grid">
        ${Object.entries(run.summary.differencesBySeverity).map(([sev, count]) => `
          <span class="severity-badge severity-${sev}">${sev}: ${count}</span>
        `).join('')}
      </div>

      <div class="gate ${run.releaseGate.allowed ? 'pass' : 'fail'}">
        <h3>${run.releaseGate.allowed ? '✅ 发布门禁通过' : '❌ 发布门禁阻塞'}</h3>
        ${!run.releaseGate.allowed ? run.releaseGate.blockedBy.join('<br>') : '所有 P0/P1 差异已解决，可以发布。'}
      </div>
    </div>

    ${ctx.coverageReport ? `
    <div class="summary">
      <h2>覆盖率</h2>
      <div class="stats-grid">
        ${ctx.coverageReport.metrics.map(m => `
          <div class="stat-card">
            <div class="value">${m.percentage.toFixed(1)}%</div>
            <div class="label">${m.name}</div>
            <div class="label">${m.covered}/${m.total}</div>
          </div>
        `).join('')}
      </div>
      <p><strong>总体覆盖率:</strong> ${ctx.coverageReport.overallCoverage.toFixed(1)}% (${ctx.coverageReport.grade})</p>
    </div>` : ''}

    ${ctx.baselineInfo ? `
    <div class="summary">
      <h2>基线信息</h2>
      <table class="info-table">
        <tr><td>采集事实数</td><td>${ctx.baselineInfo.summary?.totalFacts || 0}</td></tr>
        <tr><td>确认事实数</td><td>${ctx.baselineInfo.summary?.confirmedFacts || 0}</td></tr>
        <tr><td>待确认事实数</td><td>${ctx.baselineInfo.summary?.pendingFacts || 0}</td></tr>
      </table>
    </div>` : ''}

    <h2 style="margin: 20px 0 15px; color: #2c3e50;">场景结果</h2>

    ${run.scenarios.map(result => {
      const severity = detectSeverity(result.differences);
      return `
      <div class="scenario ${result.passed ? 'passed' : 'failed'}">
        <h3>
          ${result.passed ? '✅' : '❌'} ${result.scenarioId}
          ${severity ? `<span class="severity-badge severity-${severity.replace(/[\[\]]/g, '')}">${severity}</span>` : ''}
        </h3>

        ${result.error ? `<div class="diff"><strong>错误:</strong> ${result.error}</div>` : ''}

        ${result.legacyResult || result.currentResult ? `
        <div class="result-grid">
          ${result.legacyResult ? `
          <div class="result-box">
            <h4>Legacy 结果</h4>
            <p><strong>状态:</strong> ${result.legacyResult.finalState}</p>
            <p><strong>路径:</strong> ${result.legacyResult.semanticPath?.join(' → ') || '-'}</p>
          </div>` : ''}
          ${result.currentResult ? `
          <div class="result-box">
            <h4>Current 结果</h4>
            <p><strong>状态:</strong> ${result.currentResult.finalState}</p>
            <p><strong>路径:</strong> ${result.currentResult.semanticPath?.join(' → ') || '-'}</p>
          </div>` : ''}
        </div>` : ''}

        ${result.differences.length > 0 ? `
        <div class="diff">
          <strong>差异 (${result.differences.length})</strong>
          ${result.differences.map(diff => `
            <div class="diff-item">
              <span class="diff-severity severity-${diff.severity}">${diff.severity}</span>
              <span class="diff-desc">${diff.description}</span>
              <div class="diff-detail">类别: ${diff.category}</div>
            </div>
          `).join('')}
        </div>` : ''}
      </div>
    `}).join('')}
  </div>

  <div class="footer">
    <p>由 FlowTrace 自动生成 | ${new Date().toLocaleString('zh-CN')}</p>
    ${isLegacyShadow ? '<p style="color:#e74c3c;">⚠️ Legacy-Shadow 模式: 结果不代表新旧流程真实一致</p>' : ''}
  </div>
</body>
</html>`;
}
