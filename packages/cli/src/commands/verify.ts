import chalk from 'chalk';
import { resolve } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { generateId } from '@flowtrace/core';
import {
  loadTargetProjectConfig,
  validateTargetConfig,
  getScenariosDir,
  getReportsDir,
  getSemanticDir,
  validateAgainstSemanticModel,
  createSemanticModelFromProcess,
  type SemanticProcessModel,
  type SemanticPathElement,
  type SemanticComparisonResult
} from '@flowtrace/core';
import { 
  Scenario,
  ExecutionResult,
  DualExecutionResult,
  Difference,
  DifferenceSeverity,
  VerificationRun
} from '@flowtrace/core';
import { createConfigAdapterLoader } from '@flowtrace/adapter';
import type { FlowAdapter, FlowAdapterContext } from '@flowtrace/adapter';
import { readFileSync as fsReadFileSync } from 'fs';
import yaml from 'js-yaml';

interface VerifyOptions {
  project?: string;
  scenarios?: string;
  output?: string;
  system?: string[];
  process?: string[];
}

/** Detect whether the project's flowtrace.yaml uses the config-driven runtime. */
function projectUsesBuiltinRuntime(projectPath: string): boolean {
  const configPath = resolve(projectPath, '.flowtrace', 'flowtrace.yaml');
  if (!existsSync(configPath)) return false;
  try {
    const raw = yaml.load(fsReadFileSync(configPath, 'utf8')) as any;
    return raw?.runtime?.adapter === 'builtin';
  } catch {
    return false;
  }
}

export async function verifyCommand(options: VerifyOptions): Promise<void> {
  const projectPath = options.project
    ? resolve(process.cwd(), options.project)
    : resolve(process.cwd());

  // Dispatch: if flowtrace.yaml declares runtime.adapter: builtin, hand off
  // to the new config-driven verify command. Otherwise fall through to the
  // legacy adapter loader path used for `runtime.adapter: legacy`.
  if (projectUsesBuiltinRuntime(projectPath)) {
    const { verifyBuiltinCommand } = await import('./verify-builtin.js');
    await verifyBuiltinCommand({ project: projectPath, output: options.output, system: options.system, process: options.process });
    return;
  }

  console.log(chalk.blue(`\n🔄 FlowTrace Dual-Run Verification`));
  console.log(chalk.gray(`Project: ${projectPath}\n`));

  if (!existsSync(projectPath)) {
    console.error(chalk.red(`Project path does not exist: ${projectPath}`));
    process.exit(1);
  }

  // 加载目标项目配置
  let targetConfig;
  try {
    targetConfig = loadTargetProjectConfig(projectPath);
    const errors = validateTargetConfig(targetConfig);
    if (errors.length > 0) {
      console.warn(chalk.yellow(`⚠️  Config validation warnings:`));
        errors.forEach((e: string) => console.log(chalk.gray(`   - ${e}`)));
    }
    console.log(chalk.green(`✓ Loaded project: ${targetConfig.project.name}`));
    console.log(chalk.gray(`  Mode: ${targetConfig.execution.mode}`));
  } catch (error) {
    console.error(chalk.red(`Failed to load project config: ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.gray(`   Run: flowtrace init --project ${projectPath}\n`));
    process.exit(1);
  }

  const scenariosDir = options.scenarios
    ? resolve(projectPath, options.scenarios)
    : getScenariosDir(targetConfig);

  const outputDir = options.output
    ? resolve(projectPath, options.output)
    : getReportsDir(targetConfig);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // 加载场景
  const scenarios = loadScenariosFromDir(scenariosDir).filter((s: Scenario) => s.enabled !== false);

  if (scenarios.length === 0) {
    console.error(chalk.red('No scenarios found to verify.'));
    console.log(chalk.gray(`   Scenarios directory: ${scenariosDir}`));
    console.log(chalk.gray(`   Run: flowtrace generate-cases --project ${projectPath}\n`));
    process.exit(1);
  }

  console.log(chalk.green(`✓ Found ${scenarios.length} scenarios`));

  const isLegacyShadow = targetConfig.execution.mode === 'dual-run' 
    && targetConfig.pilot?.currentAdapterMode === 'legacy-shadow';

  if (isLegacyShadow) {
    console.log(chalk.yellow(`\n⚠️  Legacy-Shadow Mode: current adapter reuses legacy adapter`));
    console.log(chalk.gray(`   Note: This validates the harness only, not real flow equivalence.\n`));
  }

  // 构建适配器上下文
  const legacyContext: FlowAdapterContext = {
    projectId: targetConfig.project.id,
    processId: targetConfig.processId
  };

  const currentContext: FlowAdapterContext = {
    projectId: targetConfig.project.id,
    processId: targetConfig.processId
  };

  // 从配置加载适配器
  const adapterLoader = createConfigAdapterLoader();
  const loadedAdapters = await adapterLoader.loadFromConfig(
    {
      legacy: targetConfig.adapters.legacy,
      current: targetConfig.adapters.current
    },
    legacyContext,
    projectPath,
    resolve(projectPath, '.flowtrace'),
    {
      legacyShadow: isLegacyShadow,
      allowDemo: false  // 禁止 Demo 回退
    }
  );

  if (loadedAdapters.usingDemo) {
    console.warn(chalk.yellow(`⚠️  Using Demo adapter - not a real legacy/current flow`));
  }

  if (loadedAdapters.usingLegacyShadow) {
    console.log(chalk.yellow(`\n⚠️  Legacy-Shadow Mode: current adapter reuses legacy adapter`));
    console.log(chalk.gray(`   This validates the harness only, not real flow equivalence.\n`));
  }

  // 必须有 legacy 适配器
  if (!loadedAdapters.legacy) {
    console.error(chalk.red(`\n✗ Failed to load legacy adapter`));
    loadedAdapters.errors.forEach((e: string) => console.log(chalk.gray(`   - ${e}`)));
    console.log(chalk.gray(`\n   Configure adapters in flowtrace.yaml or use --demo flag`));
    process.exit(1);
  }

  // 必须有 current 适配器
  if (!loadedAdapters.current) {
    console.error(chalk.red(`\n✗ Failed to load current adapter`));
    loadedAdapters.errors.forEach((e: string) => console.log(chalk.gray(`   - ${e}`)));
    process.exit(1);
  }

  const legacyAdapter = loadedAdapters.legacy;
  const currentAdapter = loadedAdapters.current;

  if (!legacyAdapter) {
    console.error(chalk.red('Failed to load legacy adapter'));
    process.exit(1);
  }

  if (!currentAdapter) {
    console.error(chalk.red('Failed to load current adapter'));
    process.exit(1);
  }

  try {
    await legacyAdapter.initialize();
    await currentAdapter.initialize();

    console.log(chalk.blue(`\n📋 Running ${scenarios.length} scenarios...\n`));

    // 加载语义模型
    const semanticDir = getSemanticDir(targetConfig);
    const semanticModel = loadSemanticModel(semanticDir, targetConfig.processId);
    if (semanticModel) {
      console.log(chalk.green(`✓ Loaded semantic model with ${semanticModel.events.length} events\n`));
    } else {
      console.log(chalk.gray(`ℹ No semantic model found, using simple comparison\n`));
    }

    const runId = generateId('run');
    const results: VerificationRun['scenarios'] = [];
    const differencesBySeverity: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };

    for (const scenario of scenarios) {
      console.log(chalk.gray(`  Running: ${scenario.id} (${scenario.name})`));

      // Every scenario must start from an isolated state. Without this reset,
      // a previous scenario can leak its state into the next one and produce
      // a misleading pass/fail result.
      await resetAdapterState(legacyAdapter);
      await resetAdapterState(currentAdapter);

      const dualResult = await executeScenarioWithAdapters(
        scenario,
        legacyAdapter,
        currentAdapter,
        semanticModel
      );

      results.push({
        scenarioId: scenario.id,
        legacyResult: dualResult.legacyResult,
        currentResult: dualResult.currentResult,
        differences: dualResult.differences,
        passed: dualResult.passed,
        error: dualResult.error
      });

      for (const diff of dualResult.differences) {
        differencesBySeverity[diff.severity] = (differencesBySeverity[diff.severity] || 0) + 1;
      }

      if (dualResult.passed) {
        console.log(chalk.green(`    ✓ Passed`));
      } else {
        console.log(chalk.red(`    ✗ Failed (${dualResult.differences.length} differences)`));
      }
    }

    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.filter(r => !r.passed).length;

    const executionFailures = results.filter(r => !!r.error).length;
    const blockedBy = Object.entries(differencesBySeverity)
      .filter(([severity, count]) => count > 0 && targetConfig.execution.failOn.includes(severity as DifferenceSeverity))
      .map(([severity, count]) => `${severity}: ${count} difference(s)`);
    if (executionFailures > 0) blockedBy.push(`EXECUTION: ${executionFailures} scenario(s) failed to execute`);

    const verificationRun: VerificationRun = {
      id: runId,
      projectId: targetConfig.project.id,
      timestamp: new Date().toISOString(),
      scenarios: results,
      summary: {
        total: scenarios.length,
        passed: passedCount,
        failed: failedCount,
        differencesBySeverity
      },
      releaseGate: {
        allowed: blockedBy.length === 0,
        blockedBy
      }
    };

    const outputFile = resolve(outputDir, `run-${runId}.json`);
    writeFileSync(outputFile, JSON.stringify(verificationRun, null, 2), 'utf-8');

    // 生成 executions 目录下的 Markdown 报告
    const executionsDir = resolve(projectPath, '.flowtrace', 'executions');
    if (!existsSync(executionsDir)) {
      mkdirSync(executionsDir, { recursive: true });
    }
    generateExecutionMarkdownReport(executionsDir, verificationRun, targetConfig, isLegacyShadow);

    console.log(chalk.blue(`\n📊 Verification Results:`));
    console.log(chalk.green(`  Passed: ${passedCount}`));
    console.log(chalk.red(`  Failed: ${failedCount}`));
    console.log(chalk.gray(`  Total:  ${scenarios.length}`));
    console.log(chalk.gray(`\n  Differences by severity:`));
    console.log(chalk.gray(`    P0: ${differencesBySeverity.P0}`));
    console.log(chalk.gray(`    P1: ${differencesBySeverity.P1}`));
    console.log(chalk.gray(`    P2: ${differencesBySeverity.P2}`));
    console.log(chalk.gray(`    P3: ${differencesBySeverity.P3}`));

    if (verificationRun.releaseGate.allowed) {
      console.log(chalk.green(`\n✓ Release Gate: PASSED`));
    } else {
      console.log(chalk.red(`\n✗ Release Gate: BLOCKED`));
      console.log(chalk.gray(`  Blocked by: ${blockedBy.join(', ')}`));
    }

    console.log(chalk.green(`\n✓ Report saved to: ${outputFile}\n`));

    if (!verificationRun.releaseGate.allowed) {
      process.exit(1);
    }
  } finally {
    await adapterLoader.cleanup(loadedAdapters);
  }

  return undefined;
}

async function resetAdapterState(adapter: FlowAdapter): Promise<void> {
  if (typeof adapter.resetTestData === 'function') {
    await adapter.resetTestData();
  } else {
    await adapter.cleanup();
    await adapter.initialize();
  }
}

/**
 * 从目录加载场景
 */
function loadScenariosFromDir(scenariosDir: string): Scenario[] {
  const scenarios: Scenario[] = [];

  // 尝试加载 scenarios.json
  const scenariosFile = resolve(scenariosDir, 'scenarios.json');
  if (existsSync(scenariosFile)) {
    try {
      const content = readFileSync(scenariosFile, 'utf-8');
      const data = JSON.parse(content);
      if (data.scenarios) {
        scenarios.push(...data.scenarios);
      }
    } catch (error) {
      console.warn(`Failed to load scenarios from ${scenariosFile}:`, error);
    }
  }

  // 尝试加载单独的 scenario 文件
  try {
    const files = readdirSync(scenariosDir);
    for (const file of files) {
      if (file.endsWith('.json') && file !== 'scenarios.json') {
        try {
          const content = readFileSync(resolve(scenariosDir, file), 'utf-8');
          const scenario = JSON.parse(content);
          if (scenario.id) {
            scenarios.push(scenario);
          }
        } catch {
          // Skip invalid files
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return scenarios;
}

async function executeScenarioWithAdapters(
  scenario: Scenario,
  legacyAdapter: FlowAdapter,
  currentAdapter: FlowAdapter,
  semanticModel: SemanticProcessModel | null
): Promise<DualExecutionResult> {
  let legacyResult: ExecutionResult | undefined;
  let currentResult: ExecutionResult | undefined;
  let error: string | undefined;

  try {
    legacyResult = await executeScenarioCompat(legacyAdapter, scenario);
  } catch (err) {
    error = `Legacy adapter error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(chalk.red(`    Legacy error: ${error}`));
  }

  // In legacy-shadow mode the loader may intentionally share the same
  // adapter instance. Reset it between the two executions so the current
  // side never observes legacy state from the same scenario.
  if (currentAdapter === legacyAdapter) {
    await resetAdapterState(currentAdapter);
  }

  try {
    currentResult = await executeScenarioCompat(currentAdapter, scenario);
  } catch (err) {
    error = error
      ? `${error}; Current adapter error: ${err instanceof Error ? err.message : String(err)}`
      : `Current adapter error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(chalk.red(`    Current error: ${error}`));
  }

  const differences: Difference[] = [];
  const expectedError = scenario.expected?.expectError === true;

  if (legacyResult && currentResult) {
    // 1. 执行是否成功
    const legacyHasError = !!legacyResult.error;
    const currentHasError = !!currentResult.error;
    if (legacyHasError && currentHasError) {
      // Both have errors - only P0 if states differ
      if (legacyResult.finalState !== currentResult.finalState) {
        differences.push({
          id: generateId('diff'),
          scenarioId: scenario.id,
          category: 'audit',
          severity: 'P0',
          description: `Both adapters errored with different states`,
          legacyValue: legacyResult.finalState,
          currentValue: currentResult.finalState,
          isBlocking: true
        });
      } else {
        differences.push({
          id: generateId('diff'),
          scenarioId: scenario.id,
          category: 'audit',
          severity: 'P3',
          description: `Both adapters errored with same state: ${legacyResult.finalState}`,
          legacyValue: legacyResult.error,
          currentValue: currentResult.error,
          isBlocking: false
        });
      }
    } else if (legacyHasError && !currentHasError) {
      differences.push({
        id: generateId('diff'),
        scenarioId: scenario.id,
        category: 'audit',
        severity: 'P1',
        description: `Legacy errored but current succeeded`,
        legacyValue: legacyResult.error,
        currentValue: null,
        isBlocking: false
      });
    } else if (!legacyHasError && currentHasError) {
      differences.push({
        id: generateId('diff'),
        scenarioId: scenario.id,
        category: 'audit',
        severity: 'P1',
        description: `Current errored but legacy succeeded`,
        legacyValue: null,
        currentValue: currentResult.error,
        isBlocking: false
      });
    }

    // 2. 最终状态
    if (legacyResult.finalState !== currentResult.finalState) {
      differences.push({
        id: generateId('diff'),
        scenarioId: scenario.id,
        category: 'final_state',
        severity: 'P0',
        description: `Final state mismatch: legacy=${legacyResult.finalState}, current=${currentResult.finalState}`,
        legacyValue: legacyResult.finalState,
        currentValue: currentResult.finalState,
        isBlocking: true
      });
    }

    // 3. 业务事件集合（语义路径比较）
    // An expected negative case intentionally stops before the normal
    // business path. Do not validate the happy-path semantic obligations
    // (for example SUBMIT) after the adapter has correctly rejected it.
    if (semanticModel && !expectedError) {
      const legacyPathElements = pathToElements(legacyResult.semanticPath);
      const currentPathElements = pathToElements(currentResult.semanticPath);
      const semanticResult = validateAgainstSemanticModel(legacyPathElements, semanticModel);
      // Use legacy path as ground truth - check if current satisfies constraints
      const currentSemanticResult = validateAgainstSemanticModel(currentPathElements, semanticModel);

      // Check missing events
      if (semanticResult.missingEvents.length > 0 || currentSemanticResult.missingEvents.length > 0) {
        const missing = [...new Set([...semanticResult.missingEvents, ...currentSemanticResult.missingEvents])];
        differences.push({
          id: generateId('diff'),
          scenarioId: scenario.id,
          category: 'semantic_path',
          severity: 'P1',
          description: `Missing required events: ${missing.join(', ')}`,
          legacyValue: semanticResult.missingEvents,
          currentValue: currentSemanticResult.missingEvents,
          isBlocking: false
        });
      }

      // Check constraint violations
      const allViolations = [...semanticResult.constraintViolations, ...currentSemanticResult.constraintViolations];
      for (const violation of allViolations) {
        differences.push({
          id: generateId('diff'),
          scenarioId: scenario.id,
          category: 'semantic_path',
          severity: violation.severity as 'P0' | 'P1' | 'P2' | 'P3',
          description: `[${violation.constraintType}] ${violation.description}`,
          legacyValue: violation.constraintType,
          currentValue: null,
          isBlocking: violation.severity === 'P0'
        });
      }
    } else {
      // No semantic model - simple path comparison
      const legacyPath = JSON.stringify(legacyResult.semanticPath);
      const currentPath = JSON.stringify(currentResult.semanticPath);
      if (legacyPath !== currentPath) {
        differences.push({
          id: generateId('diff'),
          scenarioId: scenario.id,
          category: 'semantic_path',
          severity: 'P1',
          description: 'Semantic path differs between legacy and current',
          legacyValue: legacyResult.semanticPath,
          currentValue: currentResult.semanticPath,
          isBlocking: false
        });
      }
    }

    // 4. 业务数据（忽略时间戳字段）
    if (legacyResult.businessData && currentResult.businessData) {
      const excludeKeys = new Set(['submittedAt', 'submittedBy', 'coreEnterpriseApprovedAt', 'coreEnterpriseApprover', 'riskAssessedAt', 'riskAssessor', 'financeApprovedAt', 'financeApprover', 'countersignApprovedAt', 'countersigner', 'rejectedAt', 'rejectedBy', 'returnedAt', 'returnedBy', 'withdrawnAt', 'withdrawnBy', 'transferredAt', 'countersignInitiatedAt', 'countersignInitiatedBy', 'completedAt']);
      const legacyKeys = Object.keys(legacyResult.businessData).filter(k => !excludeKeys.has(k));
      const currentKeys = Object.keys(currentResult.businessData).filter(k => !excludeKeys.has(k));
      const commonKeys = legacyKeys.filter(k => currentKeys.includes(k));
      const diffKeys = commonKeys.filter(k =>
        JSON.stringify(legacyResult!.businessData![k]) !== JSON.stringify(currentResult!.businessData![k])
      );
      if (diffKeys.length > 0) {
        differences.push({
          id: generateId('diff'),
          scenarioId: scenario.id,
          category: 'business_data',
          severity: 'P2',
          description: `Business data differs on fields: ${diffKeys.join(', ')}`,
          legacyValue: legacyResult.businessData,
          currentValue: currentResult.businessData,
          isBlocking: false
        });
      }
    }

    // 5. 数据库变化
    const legacyDb = JSON.stringify(legacyResult.databaseChanges || {});
    const currentDb = JSON.stringify(currentResult.databaseChanges || {});
    if (legacyDb !== currentDb) {
      differences.push({
        id: generateId('diff'),
        scenarioId: scenario.id,
        category: 'database',
        severity: 'P1',
        description: 'Database changes differ between legacy and current',
        legacyValue: legacyResult.databaseChanges,
        currentValue: currentResult.databaseChanges,
        isBlocking: false
      });
    }

    // 6. 外部调用
    const legacyCalls = (legacyResult.externalCalls || []).length;
    const currentCalls = (currentResult.externalCalls || []).length;
    if (legacyCalls !== currentCalls) {
      differences.push({
        id: generateId('diff'),
        scenarioId: scenario.id,
        category: 'external_call',
        severity: 'P2',
        description: `External call count differs: legacy=${legacyCalls}, current=${currentCalls}`,
        legacyValue: legacyCalls,
        currentValue: currentCalls,
        isBlocking: false
      });
    }

    // 7. 角色
    const legacyRoles = new Set<string>();
    const currentRoles = new Set<string>();
    if (legacyResult.actions) {
      for (const a of legacyResult.actions) if (a.actor) legacyRoles.add(a.actor);
    }
    if (currentResult.actions) {
      for (const a of currentResult.actions) if (a.actor) currentRoles.add(a.actor);
    }
    const missingInCurrent = [...legacyRoles].filter(r => !currentRoles.has(r));
    if (missingInCurrent.length > 0) {
      differences.push({
        id: generateId('diff'),
        scenarioId: scenario.id,
        category: 'permission',
        severity: 'P2',
        description: `Roles in current missing: ${missingInCurrent.join(', ')}`,
        legacyValue: [...legacyRoles],
        currentValue: [...currentRoles],
        isBlocking: false
      });
    }

  } else if (legacyResult && !currentResult) {
    differences.push({
      id: generateId('diff'),
      scenarioId: scenario.id,
      category: 'final_state',
      severity: 'P0',
      description: 'Current adapter failed but legacy succeeded',
      legacyValue: legacyResult.finalState,
      currentValue: null,
      isBlocking: true
    });
  } else if (!legacyResult && currentResult) {
    differences.push({
      id: generateId('diff'),
      scenarioId: scenario.id,
      category: 'final_state',
      severity: 'P0',
      description: 'Legacy adapter failed but current succeeded',
      legacyValue: null,
      currentValue: currentResult.finalState,
      isBlocking: true
    });
  }

  // CRITICAL: Any action error in legacy or current makes the scenario failed
  const legacyActionError = legacyResult?.error || (legacyResult?.metadata as any)?.actionError;
  const currentActionError = currentResult?.error || (currentResult?.metadata as any)?.actionError;
  if (legacyActionError && !expectedError) {
    differences.push({
      id: generateId('diff'),
      scenarioId: scenario.id,
      category: 'action_failure',
      severity: 'P0',
      description: `Legacy adapter action failed: ${legacyActionError}`,
      legacyValue: legacyActionError,
      currentValue: null,
      isBlocking: true
    });
  }

  if (currentActionError && !expectedError) {
    differences.push({
      id: generateId('diff'),
      scenarioId: scenario.id,
      category: 'action_failure',
      severity: 'P0',
      description: `Current adapter action failed: ${currentActionError}`,
      legacyValue: null,
      currentValue: currentActionError,
      isBlocking: true
    });
  }

  // Any error (including adapter errors and action failures) blocks the scenario
  const hasBlockingDifferences = differences.filter(d => d.isBlocking).length > 0;
  const expectedErrorSatisfied = expectedError && !!legacyActionError && !!currentActionError;
  const passed = expectedErrorSatisfied || (!hasBlockingDifferences && !error && !legacyActionError && !currentActionError);

  return {
    scenarioId: scenario.id,
    legacyResult,
    currentResult,
    differences,
    passed,
    error: error || legacyActionError || currentActionError || undefined
  };
}

async function executeScenarioCompat(adapter: FlowAdapter, scenario: Scenario): Promise<ExecutionResult> {
  if (typeof adapter.executeScenario === 'function') return adapter.executeScenario(scenario);
  const actions: any[] = [];
  let last: any = {};
  let error: string | undefined;
  for (const action of scenario.actions) {
    try {
      last = await adapter.executeAction(action);
      actions.push(action);
      if (last?.error) { error = String(last.error); break; }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      break;
    }
  }
  const queried = typeof (adapter as any).queryResult === 'function' ? await (adapter as any).queryResult() : {};
  return {
    scenarioId: scenario.id,
    adapter: adapter.type,
    actions,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    finalState: error ? `ERROR: ${last?.finalState || 'UNKNOWN'}` : (queried.finalState || last.finalState || 'UNKNOWN'),
    semanticPath: queried.semanticPath || [],
    businessData: queried.businessData || {},
    databaseChanges: queried.databaseChanges || {},
    externalCalls: queried.externalCalls || [],
    error,
    metadata: { adapterName: adapter.name, compatibilityExecution: true }
  };
}

/**
 * 将语义路径字符串转换为语义路径元素
 */
function pathToElements(path: string[] | undefined): SemanticPathElement[] {
  if (!path) return [];
  return path.map(p => ({
    eventId: normalizeSemanticEvent(p),
    actionType: p.split('@')[0],
    timestamp: ''
  }));
}

function normalizeSemanticEvent(value: string): string {
  if (value === 'SUBMIT' || value.includes('SUBMITTED')) return 'SUBMIT';
  if (value.includes('CORE_APPROVED')) return 'CORE_APPROVAL';
  if (value.includes('RISK_ASSESSED')) return 'RISK_ASSESSMENT';
  if (value.includes('FINANCE_APPROVED')) return 'FINANCE_APPROVAL';
  if (value.includes('COUNTERSIGN')) return 'COUNTERSIGN';
  if (value.includes('TRANSFER')) return 'TRANSFER';
  if (value.includes('REJECT')) return 'REJECT_APPLICATION';
  if (value.includes('RETURN')) return 'RETURN_APPLICATION';
  if (value.includes('WITHDRAW')) return 'WITHDRAW_APPLICATION';
  return value;
}

/**
 * 加载语义模型
 */
function loadSemanticModel(semanticDir: string, processId: string): SemanticProcessModel | null {
  const processModelPath = resolve(semanticDir, 'process-model.json');
  if (!existsSync(processModelPath)) {
    // Try to build from process definition
    return null;
  }

  try {
    const content = readFileSync(processModelPath, 'utf-8');
    const processModel = JSON.parse(content);

    // Convert to semantic model
    const events = [];
    if (Array.isArray(processModel.events)) {
      return {
        processId: processModel.processId || processId,
        name: processModel.name || processId,
        events: processModel.events,
        invariants: processModel.invariants || [],
        roles: processModel.roles || [],
        sequentialSigning: processModel.sequentialSigning,
        parallelSigning: processModel.parallelSigning
      } as SemanticProcessModel;
    }
    if (processModel.nodes) {
      for (const node of processModel.nodes) {
        events.push({
          id: node.id,
          type: 'REQUIRED' as const,
          name: node.name || node.id,
          actionTypes: [node.id],
          nodeIds: [node.id],
          description: node.description || `Node: ${node.name || node.id}`
        });
      }
    }

    return {
      processId,
      name: processModel.name || processId,
      events,
      invariants: [],
      roles: processModel.roles || []
    };
  } catch (e) {
    return null;
  }
}

/**
 * 生成执行过程的 Markdown 报告
 */
function generateExecutionMarkdownReport(
  executionsDir: string,
  run: VerificationRun,
  config: any,
  isLegacyShadow: boolean
): void {
  let md = `# 执行过程报告

## 基本信息

| 项目 | 值 |
|------|---|
| 运行 ID | ${run.id} |
| 项目 ID | ${run.projectId} |
| 执行时间 | ${new Date(run.timestamp).toLocaleString('zh-CN')} |
| 执行模式 | ${isLegacyShadow ? 'legacy-shadow' : 'dual-run'} |
| Legacy-Shadow 模式 | ${isLegacyShadow ? '是' : '否'} |

`;

  if (isLegacyShadow) {
    md += `::: warning
⚠️  **Legacy-Shadow 模式**

当前适配器复用 legacy adapter，结果**不代表新旧流程真实一致**。
仅用于验证测试框架是否正常工作。
:::
`;
  }

  md += `
## 执行统计

| 指标 | 值 |
|------|---|
| 案例总数 | ${run.summary.total} |
| 通过 | ${run.summary.passed} |
| 失败 | ${run.summary.failed} |
| 通过率 | ${run.summary.total > 0 ? ((run.summary.passed / run.summary.total) * 100).toFixed(1) : 0}% |

## 差异统计

| 严重性 | 数量 | 阻塞发布 |
|--------|------|----------|
`;
  for (const [sev, count] of Object.entries(run.summary.differencesBySeverity)) {
    const isBlocking = sev === 'P0' || sev === 'P1';
    md += `| ${sev} | ${count} | ${isBlocking ? '是' : '否'} |\n`;
  }

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

  md += `
## 案例执行详情

`;
  for (const result of run.scenarios) {
    const status = result.passed ? '✅' : '❌';
    const severity = result.passed ? '' : detectExecutionSeverity(result.differences);
    md += `### ${status} ${result.scenarioId} ${severity}\n\n`;

    if (result.error) {
      md += `**错误:** ${result.error}\n\n`;
    }

    // 动作状态
    if (result.legacyResult?.actions && result.legacyResult.actions.length > 0) {
      md += `**Legacy 动作执行:**\n\n`;
      md += `| 序号 | 动作 | 执行者 | 状态 |\n`;
      md += `|------|------|--------|------|\n`;
      result.legacyResult.actions.forEach((action: any, idx: number) => {
        const actionStatus = action.error ? '❌' : '✅';
        md += `| ${idx + 1} | ${action.type} | ${action.actor || '-'} | ${actionStatus} |\n`;
      });
      md += `\n`;
    }

    if (result.currentResult?.actions && result.currentResult.actions.length > 0) {
      md += `**Current 动作执行:**\n\n`;
      md += `| 序号 | 动作 | 执行者 | 状态 |\n`;
      md += `|------|------|--------|------|\n`;
      result.currentResult.actions.forEach((action: any, idx: number) => {
        const actionStatus = action.error ? '❌' : '✅';
        md += `| ${idx + 1} | ${action.type} | ${action.actor || '-'} | ${actionStatus} |\n`;
      });
      md += `\n`;
    }

    // 结果对比
    if (result.legacyResult || result.currentResult) {
      md += `**执行结果:**\n\n`;
      md += `| 适配器 | 最终状态 | 语义路径 |\n`;
      md += `|--------|----------|----------|\n`;
      if (result.legacyResult) {
        md += `| Legacy | ${result.legacyResult.finalState} | ${result.legacyResult.semanticPath?.join(' → ') || '-'} |\n`;
      }
      if (result.currentResult) {
        md += `| Current | ${result.currentResult.finalState} | ${result.currentResult.semanticPath?.join(' → ') || '-'} |\n`;
      }
      md += `\n`;
    }

    // 差异
    if (result.differences.length > 0) {
      md += `**差异:**\n\n`;
      for (const diff of result.differences) {
        md += `- **[${diff.severity}]** ${diff.description}\n`;
        md += `  - 类别: ${diff.category}\n`;
        md += `  - 阻塞: ${diff.isBlocking ? '是' : '否'}\n`;
      }
      md += `\n`;
    }

    md += `---\n\n`;
  }

  md += `
## Legacy-Shadow 模式限制说明

::: info
**当前执行模式**: legacy-shadow

**含义**:
- Current Adapter 复用 Legacy Adapter 执行
- 结果仅验证测试框架正确性
- 不代表新旧流程真实一致

**后续步骤**:
1. 开发真实的新流程 Adapter
2. 替换 legacy-shadow 为真实双跑
3. 验证新旧流程业务等价性
:::

---

*此报告由 FlowTrace 自动生成*
*生成时间: ${new Date().toLocaleString('zh-CN')}*
`;

  const outputFile = resolve(executionsDir, `run-${run.id}.md`);
  writeFileSync(outputFile, md, 'utf-8');
  console.log(chalk.green(`\n✓ Execution report saved: ${outputFile}`));
}

function detectExecutionSeverity(differences: any[]): string {
  if (differences.length === 0) return '';
  const hasP0 = differences.some(d => d.severity === 'P0');
  const hasP1 = differences.some(d => d.severity === 'P1');
  if (hasP0) return '[P0]';
  if (hasP1) return '[P1]';
  return '';
}
