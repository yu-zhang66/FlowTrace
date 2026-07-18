import type { FlowAdapter, FlowAdapterContext, ScenarioAction, ExecutionResult, ExternalCall } from '@flowtrace/adapter';
import type { Scenario } from '@flowtrace/core';
import { generateId } from '@flowtrace/core';

/**
 * Mock Legacy Flow Adapter for testing
 * Simulates legacy system behavior with predictable outcomes
 */
export class MockLegacyFlowAdapter implements FlowAdapter {
  readonly name = 'MockLegacyFlowAdapter';
  readonly type: 'legacy' = 'legacy';
  readonly context: FlowAdapterContext;

  private externalCalls: ExternalCall[] = [];
  private _semanticPath: string[] = [];
  private initialized = false;
  private cleanupCalled = false;

  // Configurable behavior
  private shouldFail = false;
  private failureMessage?: string;
  private customFinalState?: string;
  private customSemanticPath?: string[];
  private actionDelay = 0;

  constructor(context: FlowAdapterContext) {
    this.context = context;
  }

  // Configuration methods
  setShouldFail(shouldFail: boolean, message?: string): void {
    this.shouldFail = shouldFail;
    this.failureMessage = message;
  }

  setFinalState(state: string): void {
    this.customFinalState = state;
  }

  setSemanticPath(path: string[]): void {
    this.customSemanticPath = path;
  }

  setActionDelay(ms: number): void {
    this.actionDelay = ms;
  }

  get initializedStatus(): boolean {
    return this.initialized;
  }

  get cleanupWasCalled(): boolean {
    return this.cleanupCalled;
  }

  get semanticPath(): string[] {
    return this._semanticPath;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
    this.externalCalls = [];
    this._semanticPath = [];
  }

  async cleanup(): Promise<void> {
    this.cleanupCalled = true;
    this.externalCalls = [];
    this._semanticPath = [];
  }

  async executeAction(action: ScenarioAction): Promise<ExecutionResult> {
    if (this.actionDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.actionDelay));
    }

    const stateTransitions: Record<string, string> = {
      'SUBMIT': 'SUBMITTED',
      'APPROVE': 'APPROVED',
      'REJECT': 'REJECTED',
      'RETURN': 'RETURNED',
      'WITHDRAW': 'WITHDRAWN',
      'TRANSFER': 'TRANSFERRED',
      'COUNTERSIGN': 'PENDING_COUNTERSIGN',
      'COUNTERSIGN_COMPLETE': 'COUNTERSIGNED',
      'LOGIN': 'AUTHENTICATED'
    };

    const finalState = this.customFinalState || stateTransitions[action.type] || 'DRAFT';
    this._semanticPath.push(finalState);

    if (this.shouldFail) {
      throw new Error(this.failureMessage || 'Legacy adapter execution failed');
    }

    return {
      scenarioId: 'mock',
      adapter: 'legacy',
      actions: [action],
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      finalState,
      semanticPath: this._semanticPath,
      businessData: { actor: action.actor, type: action.type },
      metadata: { adapterName: this.name }
    };
  }

  async executeScenario(scenario: Scenario): Promise<ExecutionResult> {
    const startTime = new Date().toISOString();
    const executedActions: ScenarioAction[] = [];
    let finalState = 'DRAFT';

    for (const action of scenario.actions) {
      const result = await this.executeAction(action);
      executedActions.push(action);
      finalState = result.finalState;
    }

    return {
      scenarioId: scenario.id,
      adapter: 'legacy',
      actions: executedActions,
      startTime,
      endTime: new Date().toISOString(),
      finalState,
      semanticPath: this.customSemanticPath || this._semanticPath,
      businessData: { processId: scenario.process },
      externalCalls: this.externalCalls
    };
  }

  async captureExternalCalls(): Promise<ExternalCall[]> {
    return [...this.externalCalls];
  }

  async resetTestData(): Promise<void> {
    this.externalCalls = [];
    this._semanticPath = [];
  }

  getSemanticPath(): string[] {
    return this._semanticPath;
  }

  // Helper to add external calls for testing
  addExternalCall(call: ExternalCall): void {
    this.externalCalls.push(call);
  }
}

/**
 * Mock Current Flow Adapter for testing
 * Simulates current system behavior with configurable outcomes
 */
export class MockCurrentFlowAdapter implements FlowAdapter {
  readonly name = 'MockCurrentFlowAdapter';
  readonly type: 'current' = 'current';
  readonly context: FlowAdapterContext;

  private externalCalls: ExternalCall[] = [];
  private _semanticPath: string[] = [];
  private initialized = false;
  private cleanupCalled = false;
  private legacyShadowMode = false;

  // Configurable behavior
  private shouldFail = false;
  private failureMessage?: string;
  private customFinalState?: string;
  private customSemanticPath?: string[];
  private actionDelay = 0;
  private actionResults: Map<string, ExecutionResult> = new Map();

  constructor(context: FlowAdapterContext, legacyShadowMode = false) {
    this.context = context;
    this.legacyShadowMode = legacyShadowMode;
  }

  // Configuration methods
  setShouldFail(shouldFail: boolean, message?: string): void {
    this.shouldFail = shouldFail;
    this.failureMessage = message;
  }

  setFinalState(state: string): void {
    this.customFinalState = state;
  }

  setSemanticPath(path: string[]): void {
    this.customSemanticPath = path;
  }

  setActionDelay(ms: number): void {
    this.actionDelay = ms;
  }

  setLegacyShadowMode(enabled: boolean): void {
    this.legacyShadowMode = enabled;
  }

  get initializedStatus(): boolean {
    return this.initialized;
  }

  get cleanupWasCalled(): boolean {
    return this.cleanupCalled;
  }

  get semanticPath(): string[] {
    return this._semanticPath;
  }

  // Set custom result for a specific action type
  setActionResult(actionType: string, result: Partial<ExecutionResult>): void {
    this.actionResults.set(actionType, result as ExecutionResult);
  }

  async initialize(): Promise<void> {
    this.initialized = true;
    this.externalCalls = [];
    this._semanticPath = [];
  }

  async cleanup(): Promise<void> {
    this.cleanupCalled = true;
    this.externalCalls = [];
    this._semanticPath = [];
  }

  async executeAction(action: ScenarioAction): Promise<ExecutionResult> {
    if (this.actionDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.actionDelay));
    }

    // Check for custom result
    const customResult = this.actionResults.get(action.type);
    if (customResult) {
      return {
        ...customResult,
        adapter: 'current',
        actions: [action]
      };
    }

    const stateTransitions: Record<string, string> = {
      'SUBMIT': 'SUBMITTED',
      'APPROVE': 'APPROVED',
      'REJECT': 'REJECTED',
      'RETURN': 'RETURNED',
      'WITHDRAW': 'WITHDRAWN',
      'TRANSFER': 'TRANSFERRED',
      'COUNTERSIGN': 'PENDING_COUNTERSIGN',
      'COUNTERSIGN_COMPLETE': 'COUNTERSIGNED',
      'LOGIN': 'AUTHENTICATED'
    };

    // In legacy shadow mode, use same transitions as legacy
    const finalState = this.customFinalState || stateTransitions[action.type] || 'DRAFT';
    this._semanticPath.push(finalState);

    if (this.shouldFail) {
      throw new Error(this.failureMessage || 'Current adapter execution failed');
    }

    return {
      scenarioId: 'mock',
      adapter: 'current',
      actions: [action],
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      finalState,
      semanticPath: this._semanticPath,
      businessData: { actor: action.actor, type: action.type },
      metadata: { adapterName: this.name }
    };
  }

  async executeScenario(scenario: Scenario): Promise<ExecutionResult> {
    const startTime = new Date().toISOString();
    const executedActions: ScenarioAction[] = [];
    let finalState = 'DRAFT';

    for (const action of scenario.actions) {
      const result = await this.executeAction(action);
      executedActions.push(action);
      finalState = result.finalState;
    }

    return {
      scenarioId: scenario.id,
      adapter: 'current',
      actions: executedActions,
      startTime,
      endTime: new Date().toISOString(),
      finalState,
      semanticPath: this.customSemanticPath || this._semanticPath,
      businessData: { processId: scenario.process },
      externalCalls: this.externalCalls
    };
  }

  async captureExternalCalls(): Promise<ExternalCall[]> {
    return [...this.externalCalls];
  }

  async resetTestData(): Promise<void> {
    this.externalCalls = [];
    this._semanticPath = [];
  }

  getSemanticPath(): string[] {
    return this._semanticPath;
  }

  // Helper to add external calls for testing
  addExternalCall(call: ExternalCall): void {
    this.externalCalls.push(call);
  }
}
