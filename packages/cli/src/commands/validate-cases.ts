import chalk from 'chalk';
import { resolve, join } from 'path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import { loadTargetProjectConfig, getScenariosDir, runGate, gateForCommand, type CommandResult } from '@flowtrace/core';
import { Scenario, validateScenario } from '@flowtrace/core';

interface ValidateCasesOptions {
  project?: string;
  scenarios?: string;
  output?: string;
  human?: boolean;
}

interface ValidationResult {
  scenarioId: string;
  name: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateCasesCommand(options: ValidateCasesOptions): Promise<void> {
  const projectPath = options.project
    ? resolve(process.cwd(), options.project)
    : resolve(process.cwd());

  // --- Gate check ---
  const requirements = gateForCommand('validate-cases');
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

  console.log(chalk.blue(`\n🔍 FlowTrace Case Validation`));
  console.log(chalk.gray(`Project: ${projectPath}\n`));

  if (!existsSync(projectPath)) {
    console.error(chalk.red(`Project path does not exist: ${projectPath}`));
    process.exit(1);
  }

  // 加载目标项目配置
  let targetConfig;
  try {
    targetConfig = loadTargetProjectConfig(projectPath);
    console.log(chalk.green(`✓ Loaded project: ${targetConfig.project.name}`));
  } catch (error) {
    console.error(chalk.red(`Failed to load project config: ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.gray(`   Run: flowtrace init --project ${projectPath}\n`));
    process.exit(1);
  }

  const scenariosDir = options.scenarios
    ? resolve(projectPath, options.scenarios)
    : getScenariosDir(targetConfig);

  if (!existsSync(scenariosDir)) {
    console.error(chalk.red(`Scenarios directory not found: ${scenariosDir}`));
    process.exit(1);
  }

  console.log(chalk.blue(`\n📂 Validating scenarios in: ${scenariosDir}\n`));

  // 加载场景
  const scenarios = loadScenarios(scenariosDir);

  if (scenarios.length === 0) {
    console.error(chalk.yellow('No scenarios found to validate.'));
    process.exit(1);
  }

  const results: ValidationResult[] = [];
  let passedCount = 0;
  let failedCount = 0;
  let warningCount = 0;

  for (const scenario of scenarios) {
    const result = validateScenario(scenario);
    const validationResult: ValidationResult = {
      scenarioId: (scenario as any).id || 'unknown',
      name: (scenario as any).name || 'Unknown',
      valid: result.valid,
      errors: result.errors || [],
      warnings: []
    };

    // 额外校验
    if (result.valid) {
      const extraWarnings = validateScenarioBusiness(scenario as Scenario);
      validationResult.warnings = extraWarnings;
      warningCount += extraWarnings.length;
    }

    results.push(validationResult);

    if (result.valid) {
      passedCount++;
      if (validationResult.warnings.length > 0) {
        console.log(chalk.yellow(`  ⚠ ${validationResult.scenarioId}`));
      } else {
        console.log(chalk.green(`  ✓ ${validationResult.scenarioId}`));
      }
    } else {
      failedCount++;
      console.log(chalk.red(`  ✗ ${validationResult.scenarioId}`));
      for (const error of validationResult.errors) {
        console.log(chalk.gray(`      - ${error}`));
      }
    }
  }

  console.log(chalk.blue(`\n📊 Validation Results:`));
  console.log(chalk.green(`  Passed: ${passedCount}`));
  console.log(chalk.red(`  Failed: ${failedCount}`));
  if (warningCount > 0) {
    console.log(chalk.yellow(`  Warnings: ${warningCount}`));
  }
  console.log(chalk.gray(`  Total:  ${passedCount + failedCount}\n`));

  // 按 ID 排序显示
  console.log(chalk.blue(`\n📋 Detailed Results:\n`));
  console.log(`| ID | Name | Status | Errors | Warnings |`);
  console.log(`|----|------|--------|--------|----------|`);

  for (const r of results.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))) {
    const status = r.valid ? (r.warnings.length > 0 ? '⚠️' : '✓') : '✗';
    const errorCount = r.errors.length;
    const warnCount = r.warnings.length;
    const shortName = r.name.length > 30 ? r.name.substring(0, 27) + '...' : r.name;
    console.log(`| ${r.scenarioId} | ${shortName} | ${status} | ${errorCount} | ${warnCount} |`);
  }

  console.log('');

  if (failedCount > 0) {
    console.log(chalk.red(`\n✗ ${failedCount} scenario(s) failed validation.`));
    console.log(chalk.gray(`   Please fix the errors above before running verify.\n`));
    process.exit(1);
  }

  if (warningCount > 0) {
    console.log(chalk.yellow(`⚠️  ${warningCount} warning(s) detected. Consider reviewing these scenarios.`));
  }

  console.log(chalk.green(`\n✓ All scenarios passed validation!`));
  console.log(chalk.gray(`   Run 'flowtrace verify --project ${projectPath}' to execute tests.\n`));

  // 生成 Markdown 报告
  await generateValidationMarkdownReport(projectPath, scenariosDir, results, passedCount, failedCount, warningCount);
}

interface ValidationReport {
  timestamp: string;
  project: string;
  scenariosDir: string;
  results: ValidationResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

async function generateValidationMarkdownReport(
  projectPath: string,
  scenariosDir: string,
  results: ValidationResult[],
  passedCount: number,
  failedCount: number,
  warningCount: number
): Promise<void> {
  const timestamp = new Date().toISOString();
  const report: ValidationReport = {
    timestamp,
    project: projectPath,
    scenariosDir,
    results,
    summary: {
      total: results.length,
      passed: passedCount,
      failed: failedCount,
      warnings: warningCount
    }
  };

  const outputFile = resolve(scenariosDir, 'validation.json');
  writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf-8');

  // 生成 Markdown 报告
  let md = `# 测试案例校验报告

## 基本信息

| 项目 | 值 |
|------|---|
| 项目路径 | ${projectPath} |
| 校验时间 | ${new Date(timestamp).toLocaleString('zh-CN')} |
| 场景目录 | ${scenariosDir} |

## 校验统计

| 指标 | 值 |
|------|---|
| 总场景数 | ${results.length} |
| 通过 | ${passedCount} |
| 失败 | ${failedCount} |
| 警告 | ${warningCount} |
| 通过率 | ${results.length > 0 ? ((passedCount / results.length) * 100).toFixed(1) : 0}% |

`;

  if (failedCount > 0) {
    md += `::: danger
❌ **校验失败**: ${failedCount} 个场景存在错误，必须修复后才能执行验证。
:::
`;
  }

  if (warningCount > 0) {
    md += `::: warning
⚠️ **警告**: ${warningCount} 个场景存在警告，建议检查。
:::
`;
  }

  md += `
## 场景列表

| ID | 名称 | 状态 | 错误数 | 警告数 |
|----|------|------|--------|--------|
`;

  for (const r of results.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))) {
    const status = r.valid ? (r.warnings.length > 0 ? '⚠️' : '✅') : '❌';
    md += `| ${r.scenarioId} | ${r.name.substring(0, 40)}${r.name.length > 40 ? '...' : ''} | ${status} | ${r.errors.length} | ${r.warnings.length} |\n`;
  }

  md += `
## 错误详情

`;
  const failedResults = results.filter(r => !r.valid);
  if (failedResults.length === 0) {
    md += `*无错误*\n`;
  } else {
    for (const r of failedResults) {
      md += `### ${r.scenarioId}: ${r.name}\n\n`;
      for (const error of r.errors) {
        md += `- ❌ ${error}\n`;
      }
      md += `\n`;
    }
  }

  md += `
## 警告详情

`;
  const warnedResults = results.filter(r => r.warnings.length > 0);
  if (warnedResults.length === 0) {
    md += `*无警告*\n`;
  } else {
    for (const r of warnedResults) {
      md += `### ${r.scenarioId}: ${r.name}\n\n`;
      for (const warning of r.warnings) {
        md += `- ⚠️ ${warning}\n`;
      }
      md += `\n`;
    }
  }

  md += `
---

*此报告由 FlowTrace 自动生成*
*生成时间: ${new Date().toLocaleString('zh-CN')}*
`;

  const mdFile = resolve(scenariosDir, 'validation.md');
  writeFileSync(mdFile, md, 'utf-8');
  console.log(chalk.green(`✓ Validation report saved: ${mdFile}`));
}

/**
 * 加载场景文件
 */
function loadScenarios(scenariosDir: string): any[] {
  const scenarios: any[] = [];

  // 加载 scenarios.json
  const scenariosFile = resolve(scenariosDir, 'scenarios.json');
  if (existsSync(scenariosFile)) {
    try {
      const content = readFileSync(scenariosFile, 'utf-8');
      const data = JSON.parse(content);
      if (data.scenarios && Array.isArray(data.scenarios)) {
        scenarios.push(...data.scenarios);
      }
    } catch (error) {
      console.warn(chalk.yellow(`Warning: Failed to parse ${scenariosFile}`));
    }
  }

  // 加载单独的 YAML 文件
  try {
    const files = readdirSync(scenariosDir);
    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const filePath = resolve(scenariosDir, file);
        if (filePath !== scenariosFile) {
          try {
            const content = readFileSync(filePath, 'utf-8');
            const scenario = yaml.load(content) as any;
            if (scenario && typeof scenario === 'object' && scenario.id) {
              scenarios.push(scenario);
            }
          } catch {
            // Skip invalid files
          }
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return scenarios;
}

/**
 * 业务规则校验
 */
function validateScenarioBusiness(scenario: Scenario): string[] {
  const warnings: string[] = [];

  // 检查是否有预期结果
  if (!scenario.expected) {
    warnings.push('Missing expected results');
  } else {
    const hasExpectedIllegalAction = Boolean(
      (scenario.expected as any).illegalActionErrorCode ||
      (scenario.expected as any).illegalActions?.length
    );
    if (!scenario.expected.finalState && !hasExpectedIllegalAction) {
      warnings.push('Missing expected.finalState');
    }
  }

  // 检查动作是否为空
  if (!scenario.actions || scenario.actions.length === 0) {
    warnings.push('No actions defined');
  }

  // 检查启用状态
  if (scenario.enabled === false) {
    warnings.push('Scenario is disabled');
  }

  // 检查严重性
  const validSeverities = ['P0', 'P1', 'P2', 'P3'];
  if (scenario.severity && !validSeverities.includes(scenario.severity)) {
    warnings.push(`Invalid severity: ${scenario.severity}`);
  }

  // 检查动作类型合法性
  const validActionTypes = ['LOGIN', 'SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'WITHDRAW', 'TRANSFER', 'COUNTERSIGN', 'COUNTERSIGN_COMPLETE'];
  if (scenario.actions) {
    for (const action of scenario.actions) {
      if (!validActionTypes.includes(action.type)) {
        warnings.push(`Invalid action type: ${action.type}`);
      }
      if (!action.actor) {
        warnings.push('Action missing actor');
      }
    }
  }

  return warnings;
}
