import type { Scenario, ScenarioAction, ExecutionResult, ExternalCall } from '@flowtrace/core';

export type { Scenario, ScenarioAction, ExecutionResult, ExternalCall };

export interface FlowAdapterContext {
  projectId: string;
  processId: string;
  testDataSnapshot?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface FlowAdapter {
  readonly name: string;
  readonly type: 'legacy' | 'current';
  readonly context: FlowAdapterContext;

  initialize(): Promise<void>;
  cleanup(): Promise<void>;

  executeAction(action: ScenarioAction): Promise<ExecutionResult>;

  executeScenario(scenario: Scenario): Promise<ExecutionResult>;

  captureExternalCalls(): Promise<ExternalCall[]>;

  resetTestData(): Promise<void>;

  getSemanticPath(): string[];
}

export interface DataAdapter {
  readonly name: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  read(query: string, params?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  snapshot(): Promise<Record<string, unknown>>;
  restore(snapshot: Record<string, unknown>): Promise<void>;
}

export interface AdapterFactory {
  createFlowAdapter(type: 'legacy' | 'current', context: FlowAdapterContext): Promise<FlowAdapter>;
  createDataAdapter(context: FlowAdapterContext): Promise<DataAdapter>;
}
