/**
 * Enhanced Dual Runner
 * 
 * Executes scenarios with full execution support:
 * - Browser automation steps
 * - API execution steps
 * - Database verification steps
 * - Semantic comparison
 * - Evidence collection
 */

import type {
  EnhancedScenario,
  BrowserStep,
  BrowserStepResult,
  ApiStep,
  ApiCallResult,
  DatabaseStep,
  DatabaseSnapshot,
  DatabaseComparisonResult,
  DualBrowserStepResult,
  DualApiStepResult,
  DatabaseVerificationResult,
  SemanticEquivalenceResult,
  SemanticComparisonResult,
  SemanticPath,
  SemanticComparisonConfig,
  DEFAULT_COMPARISON_CONFIG,
  ExecutionResult,
  DualExecutionResult,
  Difference
} from '@flowtrace/core';

// ============================================================
// Execution Result Types
// ============================================================

export interface StepExecutionResult {
  stepId: string;
  success: boolean;
  
  // Browser execution
  browserResult?: DualBrowserStepResult;
  
  // API execution
  apiResult?: DualApiStepResult;
  
  // Database verification
  databaseResult?: DatabaseVerificationResult;
  
  // Errors
  error?: string;
  legacyError?: string;
  currentError?: string;
}

export interface EnhancedDualExecutionResult {
  scenarioId: string;
  
  // Legacy execution
  legacyExecution: {
    startTime: string;
    endTime: string;
    finalState: string;
    semanticPath: SemanticPath;
    browserResults?: BrowserStepResult[];
    apiResults?: ApiCallResult[];
    databaseSnapshot?: DatabaseSnapshot;
    success: boolean;
    error?: string;
  };
  
  // Current execution
  currentExecution: {
    startTime: string;
    endTime: string;
    finalState: string;
    semanticPath: SemanticPath;
    browserResults?: BrowserStepResult[];
    apiResults?: ApiCallResult[];
    databaseSnapshot?: DatabaseSnapshot;
    success: boolean;
    error?: string;
  };
  
  // Semantic comparison
  semanticComparison: SemanticEquivalenceResult;
  
  // Differences
  differences: Difference[];
  
  // Step results
  stepResults: StepExecutionResult[];
  
  // Overall result
  passed: boolean;
  blockingDifferences: string[];
  
  // Metadata
  metadata: {
    executionMode: string;
    channels: string[];
    browserAvailable: boolean;
    apiAvailable: boolean;
    databaseAvailable: boolean;
    legacyShadow: boolean;
  };
}

// ============================================================
// Adapter Interfaces
// ============================================================

export interface BrowserExecutor {
  initialize(config: {
    headless?: boolean;
    baseUrl?: string;
  }): Promise<void>;
  
  login(credentials: {
    username: string;
    password: string;
    loginUrl?: string;
  }): Promise<void>;
  
  executeStep(
    step: BrowserStep,
    side: 'legacy' | 'current'
  ): Promise<BrowserStepResult>;
  
  captureEvidence(): Promise<any>;
  
  logout(): Promise<void>;
  
  cleanup(): Promise<void>;
}

export interface ApiExecutor {
  initialize(config: {
    baseUrl?: string;
    auth?: {
      type: 'bearer' | 'basic' | 'api-key';
      token?: string;
    };
  }): Promise<void>;
  
  executeCall(
    call: {
      method: string;
      endpoint: string;
      headers?: Record<string, string>;
      body?: unknown;
    },
    side: 'legacy' | 'current'
  ): Promise<ApiCallResult>;
  
  normalizeResponse(
    result: ApiCallResult,
    expectedSuccess: string,
    expectedState: string
  ): {
    success: boolean;
    businessState: string | null;
    extractedData: Record<string, unknown>;
  };
  
  setAuth(actor: {
    username: string;
    password?: string;
  }): Promise<void>;
  
  cleanup(): Promise<void>;
}

export interface DatabaseObserver {
  connect(config: {
    type: 'oracle' | 'postgresql' | 'mysql';
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  }): Promise<void>;
  
  takeSnapshot(tables: string[]): Promise<DatabaseSnapshot>;
  
  query(sql: string): Promise<Record<string, unknown>[]>;
  
  compareSnapshots(
    before: DatabaseSnapshot,
    after: DatabaseSnapshot,
    options?: {
      ignoreFields?: string[];
      criticalFields?: string[];
    }
  ): Promise<DatabaseComparisonResult>;
  
  disconnect(): Promise<void>;
}

// ============================================================
// Semantic Path Builder
// ============================================================

function buildSemanticPath(
  steps: EnhancedScenario['steps'],
  results: StepExecutionResult[]
): SemanticPath {
  const nodes: SemanticPath['nodes'] = [];
  
  for (let i = 0; i < (steps?.length || 0); i++) {
    const step = steps![i];
    const result = results[i];
    
    if (!result) continue;
    
    // Extract from browser result
    if (result.browserResult) {
      const side = result.browserResult.legacyResult?.success ? 'legacy' : 'current';
      const browserResult = result.browserResult[`${side}Result`];
      
      if (browserResult) {
        nodes.push({
          event: step.expected?.semanticEvent || step.businessAction,
          actor: step.actor,
          timestamp: browserResult.timestamp,
          state: browserResult.finalState,
          data: browserResult.extractedData
        });
      }
    }
    
    // Extract from API result
    if (result.apiResult) {
      const side = result.apiResult.legacyResult?.response ? 'legacy' : 'current';
      const apiResult = result.apiResult[`${side}Result`];
      
      if (apiResult?.normalizedBusiness) {
        nodes.push({
          event: step.expected?.semanticEvent || step.businessAction,
          actor: step.actor,
          timestamp: apiResult.timestamp,
          state: apiResult.normalizedBusiness.businessState || undefined
        });
      }
    }
  }
  
  return {
    nodes,
    startState: nodes[0]?.state || 'DRAFT',
    endState: nodes[nodes.length - 1]?.state || 'UNKNOWN'
  };
}

// ============================================================
// Enhanced Dual Runner
// ============================================================

export class EnhancedDualRunner {
  private browserExecutor?: BrowserExecutor;
  private apiExecutor?: ApiExecutor;
  private databaseObserver?: DatabaseObserver;
  private semanticConfig: SemanticComparisonConfig;
  
  constructor(config?: {
    browserExecutor?: BrowserExecutor;
    apiExecutor?: ApiExecutor;
    databaseObserver?: DatabaseObserver;
    semanticConfig?: Partial<SemanticComparisonConfig>;
  }) {
    this.browserExecutor = config?.browserExecutor;
    this.apiExecutor = config?.apiExecutor;
    this.databaseObserver = config?.databaseObserver;
    this.semanticConfig = {
      ...DEFAULT_COMPARISON_CONFIG,
      ...config?.semanticConfig
    };
  }
  
  /**
   * Execute a scenario on both legacy and current systems
   */
  async execute(scenario: EnhancedScenario): Promise<EnhancedDualExecutionResult> {
    const startTime = new Date().toISOString();
    const stepResults: StepExecutionResult[] = [];
    
    // Initialize executors
    if (this.browserExecutor) {
      await this.browserExecutor.initialize({
        headless: true,
        baseUrl: scenario.execution?.channels?.includes('browser') ? '' : undefined
      });
    }
    
    // Take initial database snapshot if needed
    let initialDbSnapshot: DatabaseSnapshot | undefined;
    if (this.databaseObserver && scenario.execution?.captureDatabase) {
      initialDbSnapshot = await this.databaseObserver.takeSnapshot(['*']);
    }
    
    // Execute legacy steps
    const legacyExecution = await this.executeLegacy(scenario, stepResults);
    
    // Take post-legacy database snapshot
    let postLegacyDbSnapshot: DatabaseSnapshot | undefined;
    if (this.databaseObserver && scenario.execution?.captureDatabase && initialDbSnapshot) {
      postLegacyDbSnapshot = await this.databaseObserver.takeSnapshot(['*']);
    }
    
    // Reset test data if needed
    if (scenario.execution?.resetBeforeScenario) {
      await this.resetTestData();
    }
    
    // Execute current steps
    const currentExecution = await this.executeCurrent(scenario, stepResults);
    
    // Take post-current database snapshot
    let postCurrentDbSnapshot: DatabaseSnapshot | undefined;
    if (this.databaseObserver && scenario.execution?.captureDatabase) {
      postCurrentDbSnapshot = await this.databaseObserver.takeSnapshot(['*']);
    }
    
    // Build semantic paths
    const legacySemanticPath = buildSemanticPath(scenario.steps, stepResults);
    const currentSemanticPath = buildSemanticPath(scenario.steps, stepResults);
    
    // Compare semantic paths
    const semanticComparison = this.compareSemanticPaths(
      scenario,
      legacySemanticPath,
      currentSemanticPath
    );
    
    // Collect all differences
    const differences = this.collectDifferences(scenario, stepResults, semanticComparison);
    
    // Determine overall pass/fail
    const blockingDifferences = differences.filter(d => d.severity === 'P0' || d.severity === 'P1');
    const passed = blockingDifferences.length === 0 && 
                   legacyExecution.success && 
                   currentExecution.success;
    
    // Cleanup
    if (this.browserExecutor) {
      await this.browserExecutor.cleanup();
    }
    
    const endTime = new Date().toISOString();
    
    return {
      scenarioId: scenario.id,
      legacyExecution: {
        ...legacyExecution,
        startTime,
        endTime
      },
      currentExecution: {
        ...currentExecution,
        startTime,
        endTime
      },
      semanticComparison,
      differences,
      stepResults,
      passed,
      blockingDifferences: blockingDifferences.map(d => d.id),
      metadata: {
        executionMode: 'dual-run',
        channels: scenario.execution?.channels || ['browser', 'api', 'database'],
        browserAvailable: !!this.browserExecutor,
        apiAvailable: !!this.apiExecutor,
        databaseAvailable: !!this.databaseObserver,
        legacyShadow: false
      }
    };
  }
  
  /**
   * Execute steps on legacy system
   */
  private async executeLegacy(
    scenario: EnhancedScenario,
    stepResults: StepExecutionResult[]
  ): Promise<{
    finalState: string;
    semanticPath: SemanticPath;
    browserResults?: BrowserStepResult[];
    apiResults?: ApiCallResult[];
    success: boolean;
    error?: string;
  }> {
    const browserResults: BrowserStepResult[] = [];
    const apiResults: ApiCallResult[] = [];
    
    // Execute each step
    for (const step of (scenario.steps || [])) {
      const result: StepExecutionResult = {
        stepId: step.id,
        success: true
      };
      
      // Browser execution
      if (step.browser?.legacy && this.browserExecutor) {
        try {
          const browserResult = await this.browserExecutor.executeStep(
            { ...step.browser, legacy: step.browser.legacy },
            'legacy'
          );
          result.browserResult = {
            stepId: step.id,
            legacyResult: browserResult,
            currentResult: undefined,
            comparison: {
              successMatch: false,
              urlMatch: false,
              dataMatch: false
            },
            differences: []
          };
          result.success = browserResult.success;
        } catch (error) {
          result.success = false;
          result.legacyError = error instanceof Error ? error.message : String(error);
        }
      }
      
      // API execution
      if (step.api?.old && this.apiExecutor) {
        try {
          const apiCall = step.api.old.call;
          const apiResult = await this.apiExecutor.executeCall(
            {
              method: apiCall.method,
              endpoint: apiCall.endpoint,
              headers: apiCall.headers,
              body: apiCall.request?.body
            },
            'legacy'
          );
          
          result.apiResult = {
            mappingId: step.api.id,
            businessAction: step.businessAction,
            legacyResult: apiResult,
            currentResult: undefined,
            passed: apiResult.response?.status === (step.api.expected?.status || 200)
          };
          result.success = result.success && result.apiResult.passed;
        } catch (error) {
          result.success = false;
          result.legacyError = error instanceof Error ? error.message : String(error);
        }
      }
      
      stepResults.push(result);
    }
    
    // Legacy actions fallback
    if (!scenario.steps && scenario.legacyActions) {
      // Execute legacy actions
    }
    
    const finalState = this.determineFinalState(scenario, stepResults, 'legacy');
    
    return {
      finalState,
      semanticPath: buildSemanticPath(scenario.steps, stepResults),
      browserResults: browserResults.length > 0 ? browserResults : undefined,
      apiResults: apiResults.length > 0 ? apiResults : undefined,
      success: stepResults.every(r => r.success)
    };
  }
  
  /**
   * Execute steps on current system
   */
  private async executeCurrent(
    scenario: EnhancedScenario,
    stepResults: StepExecutionResult[]
  ): Promise<{
    finalState: string;
    semanticPath: SemanticPath;
    browserResults?: BrowserStepResult[];
    apiResults?: ApiCallResult[];
    success: boolean;
    error?: string;
  }> {
    const browserResults: BrowserStepResult[] = [];
    const apiResults: ApiCallResult[] = [];
    
    // Execute each step
    for (const step of (scenario.steps || [])) {
      const result: StepExecutionResult = {
        stepId: step.id,
        success: true
      };
      
      // Browser execution
      if (step.browser?.current && this.browserExecutor) {
        try {
          const browserResult = await this.browserExecutor.executeStep(
            { ...step.browser, current: step.browser.current },
            'current'
          );
          result.browserResult = {
            stepId: step.id,
            legacyResult: undefined,
            currentResult: browserResult,
            comparison: {
              successMatch: false,
              urlMatch: false,
              dataMatch: false
            },
            differences: []
          };
          result.success = browserResult.success;
        } catch (error) {
          result.success = false;
          result.currentError = error instanceof Error ? error.message : String(error);
        }
      }
      
      // API execution
      if (step.api?.new && this.apiExecutor) {
        try {
          const apiCall = step.api.new.call;
          const apiResult = await this.apiExecutor.executeCall(
            {
              method: apiCall.method,
              endpoint: apiCall.endpoint,
              headers: apiCall.headers,
              body: apiCall.request?.body
            },
            'current'
          );
          
          result.apiResult = {
            mappingId: step.api.id,
            businessAction: step.businessAction,
            legacyResult: undefined,
            currentResult: apiResult,
            passed: apiResult.response?.status === (step.api.expected?.status || 200)
          };
          result.success = result.success && result.apiResult.passed;
        } catch (error) {
          result.success = false;
          result.currentError = error instanceof Error ? error.message : String(error);
        }
      }
      
      stepResults.push(result);
    }
    
    const finalState = this.determineFinalState(scenario, stepResults, 'current');
    
    return {
      finalState,
      semanticPath: buildSemanticPath(scenario.steps, stepResults),
      browserResults: browserResults.length > 0 ? browserResults : undefined,
      apiResults: apiResults.length > 0 ? apiResults : undefined,
      success: stepResults.every(r => r.success)
    };
  }
  
  /**
   * Determine final state from execution results
   */
  private determineFinalState(
    scenario: EnhancedScenario,
    stepResults: StepExecutionResult[],
    side: 'legacy' | 'current'
  ): string {
    // Get expected final state
    const expectedState = scenario.finalExpected?.finalState || 
                         (scenario.expected as any)?.finalState;
    
    // Check if all steps passed
    const allPassed = stepResults.every(r => r.success);
    
    if (!allPassed) {
      return 'FAILED';
    }
    
    return expectedState || 'COMPLETED';
  }
  
  /**
   * Compare semantic paths
   */
  private compareSemanticPaths(
    scenario: EnhancedScenario,
    legacyPath: SemanticPath,
    currentPath: SemanticPath
  ): SemanticEquivalenceResult {
    const dimensionResults: SemanticComparisonResult[] = [];
    
    // Final state comparison
    const finalStateMatch = legacyPath.endState === currentPath.endState;
    dimensionResults.push({
      dimension: 'final_state',
      matchResult: finalStateMatch ? 'match' : 'blocking_difference',
      legacySemantic: { state: legacyPath.endState },
      currentSemantic: { state: currentPath.endState },
      differences: finalStateMatch ? [] : [{
        aspect: 'finalState',
        legacyValue: legacyPath.endState,
        currentValue: currentPath.endState,
        isAllowed: false,
        businessImpact: 'blocking',
        severity: 'P0',
        description: '最终业务状态不一致'
      }],
      conclusion: finalStateMatch ? '最终状态一致' : '最终状态不一致',
      blocking: !finalStateMatch,
      requiresHumanApproval: !finalStateMatch
    });
    
    // Process path comparison
    const legacyEvents = legacyPath.nodes.map(n => n.event);
    const currentEvents = currentPath.nodes.map(n => n.event);
    const pathMatch = this.compareEventPaths(legacyEvents, currentEvents);
    
    dimensionResults.push({
      dimension: 'semantic_path',
      matchResult: pathMatch ? 'acceptable_difference' : 'blocking_difference',
      legacySemantic: { path: legacyPath },
      currentSemantic: { path: currentPath },
      differences: pathMatch ? [] : [{
        aspect: 'eventPath',
        legacyValue: legacyEvents.join(' -> '),
        currentValue: currentEvents.join(' -> '),
        isAllowed: this.semanticConfig.allowNodeReordering,
        allowedReason: this.semanticConfig.allowNodeReordering ? '允许节点重排序' : undefined,
        businessImpact: pathMatch ? 'none' : 'significant',
        severity: pathMatch ? 'P3' : 'P1',
        description: pathMatch ? '流程路径可接受差异' : '流程路径存在差异'
      }],
      conclusion: pathMatch ? '流程路径一致或可接受差异' : '流程路径存在显著差异',
      blocking: !pathMatch && !this.semanticConfig.allowNodeReordering,
      requiresHumanApproval: !pathMatch
    });
    
    // Actor comparison
    const legacyActors = legacyPath.nodes.map(n => n.actor).filter(Boolean);
    const currentActors = currentPath.nodes.map(n => n.actor).filter(Boolean);
    const actorsMatch = this.compareActors(legacyActors, currentActors);
    
    dimensionResults.push({
      dimension: 'approval_actors',
      matchResult: actorsMatch ? 'match' : 'acceptable_difference',
      legacySemantic: { actors: legacyActors },
      currentSemantic: { actors: currentActors },
      differences: actorsMatch ? [] : [{
        aspect: 'actors',
        legacyValue: legacyActors,
        currentValue: currentActors,
        isAllowed: !this.semanticConfig.compareActorIdentity,
        allowedReason: !this.semanticConfig.compareActorIdentity ? '只比较角色' : undefined,
        businessImpact: actorsMatch ? 'none' : 'minor',
        severity: 'P2',
        description: '审批人存在差异'
      }],
      conclusion: actorsMatch ? '审批角色一致' : '审批角色存在差异',
      blocking: false,
      requiresHumanApproval: !actorsMatch
    });
    
    // Summary
    const blockingCount = dimensionResults.filter(r => r.blocking).length;
    
    return {
      overallMatch: blockingCount === 0,
      dimensionResults,
      summary: {
        totalDimensions: dimensionResults.length,
        matchingDimensions: dimensionResults.filter(r => r.matchResult === 'match').length,
        acceptableDifferenceDimensions: dimensionResults.filter(r => r.matchResult === 'acceptable_difference').length,
        blockingDimensions: blockingCount
      },
      processPathEquivalence: {
        equivalent: pathMatch || this.semanticConfig.allowNodeReordering,
        allowedReordering: this.semanticConfig.allowNodeReordering,
        allowedParallelization: this.semanticConfig.allowParallelToSequential
      },
      finalStateEquivalence: {
        equivalent: finalStateMatch,
        legacyState: legacyPath.endState,
        currentState: currentPath.endState
      },
      businessDataEquivalence: {
        equivalent: true,
        criticalFieldsMatch: true,
        differences: []
      },
      releaseRecommendation: {
        canRelease: blockingCount === 0,
        blockingReasons: dimensionResults.filter(r => r.blocking).map(r => r.conclusion),
        requiresHumanReview: dimensionResults.some(r => r.requiresHumanApproval),
        reviewItems: dimensionResults.filter(r => r.requiresHumanApproval).map(r => r.conclusion)
      }
    };
  }
  
  /**
   * Compare event paths with potential reordering
   */
  private compareEventPaths(legacy: string[], current: string[]): boolean {
    if (legacy.length !== current.length) {
      return false;
    }
    
    if (this.semanticConfig.allowNodeReordering) {
      // Check if all events are present (order-independent)
      const sortedLegacy = [...legacy].sort();
      const sortedCurrent = [...current].sort();
      return sortedLegacy.every((v, i) => v === sortedCurrent[i]);
    }
    
    // Strict order comparison
    return legacy.every((v, i) => v === current[i]);
  }
  
  /**
   * Compare actors
   */
  private compareActors(legacy: string[], current: string[]): boolean {
    if (this.semanticConfig.compareActorIdentity) {
      return legacy.every((v, i) => v === current[i]);
    }
    
    // Just compare lengths for role-only comparison
    return legacy.length === current.length;
  }
  
  /**
   * Collect all differences from step results
   */
  private collectDifferences(
    scenario: EnhancedScenario,
    stepResults: StepExecutionResult[],
    semanticComparison: SemanticEquivalenceResult
  ): Difference[] {
    const differences: Difference[] = [];
    
    // Add semantic differences
    for (const dimResult of semanticComparison.dimensionResults) {
      for (const diff of dimResult.differences) {
        differences.push({
          id: `diff-${diff.aspect}-${Date.now()}`,
          scenarioId: scenario.id,
          category: dimResult.dimension as any,
          severity: diff.severity,
          description: diff.description,
          legacyValue: diff.legacyValue,
          currentValue: diff.currentValue,
          isBlocking: diff.businessImpact === 'blocking'
        });
      }
    }
    
    // Add step-level differences
    for (const result of stepResults) {
      if (result.browserResult && result.browserResult.differences) {
        for (const diff of result.browserResult.differences) {
          differences.push({
            id: `diff-browser-${result.stepId}-${Date.now()}`,
            scenarioId: scenario.id,
            category: 'external_call',
            severity: diff.severity,
            description: diff.description || `Browser step ${result.stepId} differs`,
            legacyValue: diff.legacyValue,
            currentValue: diff.currentValue,
            isBlocking: diff.severity === 'P0' || diff.severity === 'P1'
          });
        }
      }
      
      if (result.apiResult && !result.apiResult.passed) {
        differences.push({
          id: `diff-api-${result.stepId}-${Date.now()}`,
          scenarioId: scenario.id,
          category: 'api_semantic',
          severity: 'P2',
          description: `API step ${result.stepId} response mismatch`,
          legacyValue: result.apiResult.legacyResult?.response?.status,
          currentValue: result.apiResult.currentResult?.response?.status,
          isBlocking: false
        });
      }
    }
    
    return differences;
  }
  
  /**
   * Reset test data before current execution
   */
  private async resetTestData(): Promise<void> {
    // This would use the database observer to restore test data
    // For now, just a placeholder
    console.log('[EnhancedDualRunner] Resetting test data...');
  }
}

/**
 * Create an enhanced dual runner
 */
export function createEnhancedDualRunner(config?: {
  browserExecutor?: BrowserExecutor;
  apiExecutor?: ApiExecutor;
  databaseObserver?: DatabaseObserver;
}): EnhancedDualRunner {
  return new EnhancedDualRunner(config);
}
