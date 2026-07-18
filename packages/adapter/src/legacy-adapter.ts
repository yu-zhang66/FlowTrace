import { BaseFlowAdapter } from './base-adapter.js';
import type { FlowAdapterContext, ScenarioAction } from './interfaces.js';
import type { ExecutionResult } from '@flowtrace/core';

export class LegacyFlowAdapter extends BaseFlowAdapter {
  readonly name = 'supply-chain-legacy';
  readonly type: 'legacy' | 'current' = 'legacy';
  readonly context: FlowAdapterContext;

  private state: string = 'DRAFT';
  private businessData: Record<string, unknown> = {};

  constructor(context: FlowAdapterContext) {
    super();
    this.context = context;
  }

  async initialize(): Promise<void> {
    console.log(`[Legacy] Initializing adapter for project ${this.context.projectId}`);
    console.log(`[Legacy] Process: ${this.context.processId}`);
    this.state = 'DRAFT';
    this.businessData = {};
  }

  async cleanup(): Promise<void> {
    super.cleanup();
    this.state = 'DRAFT';
    this.businessData = {};
  }

  async executeAction(action: ScenarioAction): Promise<ExecutionResult> {
    const startTime = new Date().toISOString();

    const input = this.context.config as Record<string, unknown> | undefined;
    const actionData = action.data as Record<string, unknown> | undefined;

    switch (action.type) {
      case 'SUBMIT':
        this.state = 'SUBMITTED';
        this.businessData = {
          ...this.businessData,
          submittedAt: startTime,
          submittedBy: action.actor,
          // Generic input fields
          ...(input?.data || {}),
          ...(actionData || {})
        };
        break;

      case 'APPROVE':
        if (this.state !== 'DRAFT' && this.state !== 'REJECTED' && this.state !== 'APPROVED') {
          this.state = this.getNextState('APPROVE');
          this.businessData = {
            ...this.businessData,
            approvedAt: startTime,
            approver: action.actor,
            approvalComment: actionData?.comment
          };
        } else {
          return this.createErrorResult(action, 'INVALID_STATE', `Cannot approve from state: ${this.state}`);
        }
        break;

      case 'REJECT':
        if (this.state !== 'DRAFT' && this.state !== 'REJECTED' && this.state !== 'APPROVED') {
          this.state = 'REJECTED';
          this.businessData = {
            ...this.businessData,
            rejectedAt: startTime,
            rejector: action.actor,
            rejectionReason: actionData?.reason,
            finalStatus: 'REJECTED'
          };
        } else {
          return this.createErrorResult(action, 'INVALID_STATE', `Cannot reject from state: ${this.state}`);
        }
        break;

      case 'RETURN':
        if (this.state !== 'DRAFT' && this.state !== 'REJECTED' && this.state !== 'APPROVED') {
          this.state = 'RETURNED';
          this.businessData = {
            ...this.businessData,
            returnedAt: startTime,
            returnedBy: action.actor,
            returnReason: actionData?.reason
          };
        } else {
          return this.createErrorResult(action, 'INVALID_STATE', `Cannot return from state: ${this.state}`);
        }
        break;

      case 'WITHDRAW':
        if (this.state !== 'APPROVED' && this.state !== 'REJECTED') {
          this.state = 'WITHDRAWN';
          this.businessData = {
            ...this.businessData,
            withdrawnAt: startTime,
            withdrawnBy: action.actor,
            withdrawReason: actionData?.reason,
            finalStatus: 'WITHDRAWN'
          };
        } else {
          return this.createErrorResult(action, 'INVALID_STATE', `Cannot withdraw from state: ${this.state}`);
        }
        break;

      case 'TRANSFER':
        if (this.state === 'APPROVED') {
          this.state = 'TRANSFERRED';
          this.businessData = {
            ...this.businessData,
            transferredAt: startTime,
            transferredBy: action.actor,
            finalStatus: 'TRANSFERRED'
          };
        } else {
          return this.createErrorResult(action, 'INVALID_STATE', `Cannot transfer from state: ${this.state}`);
        }
        break;

      case 'COUNTERSIGN':
        if (this.state !== 'DRAFT' && this.state !== 'REJECTED' && this.state !== 'APPROVED') {
          this.state = 'COUNTERSIGNED';
          this.businessData = {
            ...this.businessData,
            countersignedAt: startTime,
            countersigner: action.actor,
            countersignComment: actionData?.comment
          };
        } else {
          return this.createErrorResult(action, 'INVALID_STATE', `Cannot initiate countersign from state: ${this.state}`);
        }
        break;

      case 'COUNTERSIGN_COMPLETE':
        if (this.state === 'COUNTERSIGNED') {
          this.state = 'COUNTERSIGN_COMPLETED';
          this.businessData = {
            ...this.businessData,
            countersignCompletedAt: startTime,
            countersignCompletedBy: action.actor
          };
        } else {
          return this.createErrorResult(action, 'INVALID_STATE', `Cannot complete countersign from state: ${this.state}`);
        }
        break;

      default:
        return this.createErrorResult(action, 'INVALID_ACTION', `Unknown action type: ${action.type}`);
    }

    const endTime = new Date().toISOString();

    return {
      scenarioId: `legacy-${this.state}`,
      adapter: 'legacy',
      actions: [action],
      startTime,
      endTime,
      finalState: this.state,
      semanticPath: [this.state],
      businessData: { ...this.businessData },
      metadata: {
        adapterName: this.name,
        processId: this.context.processId
      }
    };
  }

  private getNextState(action: string): string {
    const stateTransitions: Record<string, Record<string, string>> = {
      'SUBMITTED': { 'APPROVE': 'APPROVED' },
      'RESUBMITTED': { 'APPROVE': 'APPROVED' },
      'RETURNED': { 'APPROVE': 'APPROVED' },
      'COUNTERSIGN_COMPLETED': { 'APPROVE': 'APPROVED' },
    };
    
    return stateTransitions[this.state]?.[action] || `${this.state}_${action}`;
  }

  private createErrorResult(action: ScenarioAction, errorCode: string, message: string): ExecutionResult {
    return {
      scenarioId: `legacy-error-${errorCode}`,
      adapter: 'legacy',
      actions: [action],
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      finalState: `ERROR: ${this.state}`,
      semanticPath: [`ERROR: ${this.state}`],
      businessData: { ...this.businessData },
      error: `${errorCode}: ${message}`,
      metadata: {
        adapterName: this.name,
        processId: this.context.processId,
        actionError: message
      }
    };
  }

  async resetTestData(): Promise<void> {
    this.state = 'DRAFT';
    this.businessData = {};
  }
}
