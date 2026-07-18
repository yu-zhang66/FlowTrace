import type {
  Scenario,
  ExecutionResult,
  DualExecutionResult,
  Difference,
  DifferenceSeverity,
  DifferenceCategory
} from '@flowtrace/core';
import { generateId } from '@flowtrace/core';
import type { FlowAdapter } from '@flowtrace/adapter';

export interface RunnerConfig {
  stopOnFirstFailure?: boolean;
  parallel?: boolean;
  timeout?: number;
}

export class DualRunner {
  private legacyAdapter: FlowAdapter;
  private currentAdapter: FlowAdapter;
  private config: RunnerConfig;

  constructor(
    legacyAdapter: FlowAdapter,
    currentAdapter: FlowAdapter,
    config: RunnerConfig = {}
  ) {
    this.legacyAdapter = legacyAdapter;
    this.currentAdapter = currentAdapter;
    this.config = {
      stopOnFirstFailure: false,
      parallel: false,
      timeout: 30000,
      ...config
    };
  }

  async run(scenarios: Scenario[]): Promise<DualExecutionResult[]> {
    await this.legacyAdapter.initialize();
    await this.currentAdapter.initialize();

    const results: DualExecutionResult[] = [];

    try {
      for (const scenario of scenarios) {
        if (scenario.enabled === false) {
          console.log(`Skipping disabled scenario: ${scenario.id}`);
          continue;
        }

        const result = await this.runScenario(scenario);
        results.push(result);

        if (!result.passed && this.config.stopOnFirstFailure) {
          console.log('Stopping on first failure');
          break;
        }
      }
    } finally {
      await this.legacyAdapter.cleanup();
      await this.currentAdapter.cleanup();
    }

    return results;
  }

  private async runScenario(scenario: Scenario): Promise<DualExecutionResult> {
    console.log(`Running scenario: ${scenario.id}`);

    let legacyResult: ExecutionResult | undefined;
    let currentResult: ExecutionResult | undefined;
    let error: string | undefined;

    try {
      legacyResult = await this.executeWithTimeout(
        this.legacyAdapter.executeScenario(scenario)
      );
    } catch (err) {
      error = `Legacy adapter error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`Error executing legacy adapter: ${error}`);
    }

    try {
      currentResult = await this.executeWithTimeout(
        this.currentAdapter.executeScenario(scenario)
      );
    } catch (err) {
      error = error
        ? `${error}; Current adapter error: ${err instanceof Error ? err.message : String(err)}`
        : `Current adapter error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`Error executing current adapter: ${error}`);
    }

    const differences = this.compareResults(scenario, legacyResult, currentResult);
    const passed = differences.filter(d => d.isBlocking).length === 0 && !error;

    return {
      scenarioId: scenario.id,
      legacyResult,
      currentResult,
      differences,
      passed,
      error
    };
  }

  private compareResults(
    scenario: Scenario,
    legacyResult?: ExecutionResult,
    currentResult?: ExecutionResult
  ): Difference[] {
    const differences: Difference[] = [];

    if (!legacyResult && currentResult) {
      differences.push({
        id: generateId('diff'),
        scenarioId: scenario.id,
        category: 'final_state',
        severity: 'P0',
        description: 'Legacy execution failed, current succeeded',
        legacyValue: null,
        currentValue: currentResult.finalState,
        isBlocking: true
      });
      return differences;
    }

    if (legacyResult && !currentResult) {
      differences.push({
        id: generateId('diff'),
        scenarioId: scenario.id,
        category: 'final_state',
        severity: 'P0',
        description: 'Legacy succeeded, current execution failed',
        legacyValue: legacyResult.finalState,
        currentValue: null,
        isBlocking: true
      });
      return differences;
    }

    if (!legacyResult || !currentResult) {
      return differences;
    }

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

    const legacyDb = JSON.stringify(legacyResult.databaseChanges);
    const currentDb = JSON.stringify(currentResult.databaseChanges);
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

    if (legacyResult.externalCalls && currentResult.externalCalls) {
      const legacyCalls = legacyResult.externalCalls.length;
      const currentCalls = currentResult.externalCalls.length;
      if (legacyCalls !== currentCalls) {
        differences.push({
          id: generateId('diff'),
          scenarioId: scenario.id,
          category: 'external_call',
          severity: 'P1',
          description: `External call count differs: legacy=${legacyCalls}, current=${currentCalls}`,
          legacyValue: legacyCalls,
          currentValue: currentCalls,
          isBlocking: false
        });
      }
    }

    return differences;
  }

  private async executeWithTimeout<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Execution timeout')), this.config.timeout || 30000)
      )
    ]);
  }
}
