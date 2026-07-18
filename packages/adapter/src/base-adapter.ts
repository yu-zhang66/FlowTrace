import type { FlowAdapter, FlowAdapterContext, DataAdapter } from './interfaces.js';
import type { Scenario, ScenarioAction, ExecutionResult, ExternalCall } from '@flowtrace/core';
import { generateId } from '@flowtrace/core';

export abstract class BaseFlowAdapter implements FlowAdapter {
  abstract readonly name: string;
  abstract readonly type: 'legacy' | 'current';
  abstract readonly context: FlowAdapterContext;

  protected externalCalls: ExternalCall[] = [];

  async initialize(): Promise<void> {
    // Default implementation - override in subclasses
  }

  async cleanup(): Promise<void> {
    this.externalCalls = [];
  }

  abstract executeAction(action: ScenarioAction): Promise<ExecutionResult>;

  async executeScenario(scenario: Scenario): Promise<ExecutionResult> {
    const startTime = new Date().toISOString();
    const semanticPath: string[] = [];
    const executedActions: ScenarioAction[] = [];
    let finalState = 'DRAFT';
    let error: string | undefined;
    let actionError: string | undefined;
    let businessData: Record<string, unknown> = {};

    for (const action of scenario.actions) {
      try {
        const result = await this.executeAction(action);
        executedActions.push(action);
        semanticPath.push(result.finalState);
        finalState = result.finalState;
        businessData = result.businessData || {};

        // Check if the action resulted in an error
        if (result.error) {
          actionError = `Action ${action.type} by ${action.actor} failed: ${result.error}`;
          error = actionError;
          // Record the error and stop executing further actions
          break;
        }
      } catch (err) {
        // Action execution threw an exception
        actionError = `Action ${action.type} by ${action.actor} threw exception: ${err instanceof Error ? err.message : String(err)}`;
        error = actionError;
        executedActions.push(action);
        // Stop executing further actions
        break;
      }
    }

    const endTime = new Date().toISOString();

    return {
      scenarioId: scenario.id,
      adapter: this.type,
      actions: executedActions,
      startTime,
      endTime,
      finalState: error ? `ERROR: ${finalState}` : finalState,
      semanticPath,
      businessData,
      databaseChanges: scenario.expected.database,
      externalCalls: this.externalCalls,
      error,
      metadata: {
        adapterName: this.name,
        context: this.context,
        actionError
      }
    };
  }

  async captureExternalCalls(): Promise<ExternalCall[]> {
    return [...this.externalCalls];
  }

  async resetTestData(): Promise<void> {
    // Default implementation - override in subclasses
  }

  getSemanticPath(): string[] {
    return this.externalCalls.map(call => call.endpoint);
  }

  protected createExecutionResult(
    scenarioId: string,
    actions: ScenarioAction[],
    finalState: string,
    semanticPath: string[],
    businessData: Record<string, unknown>,
    error?: string
  ): ExecutionResult {
    return {
      scenarioId,
      adapter: this.type,
      actions,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      finalState,
      semanticPath,
      businessData,
      externalCalls: this.externalCalls,
      error,
      metadata: {
        adapterName: this.name
      }
    };
  }
}

export abstract class BaseDataAdapter implements DataAdapter {
  abstract readonly name: string;
  protected connected: boolean = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  abstract read(query: string, params?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  abstract snapshot(): Promise<Record<string, unknown>>;
  abstract restore(snapshot: Record<string, unknown>): Promise<void>;
}
