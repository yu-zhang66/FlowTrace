/**
 * Supply Chain Legacy Flow Adapter
 * 
 * 融资申请审批流程适配器
 * 
 * 本适配器用于连接真实的 supply_chain 旧系统
 */

import type { FlowAdapterContext, FlowAdapter, ActionResult, NormalizedResult } from '@flowtrace/adapter';

/**
 * 适配器配置
 */
interface SupplyChainLegacyConfig {
  /** API 基础 URL */
  apiBaseUrl?: string;
  /** 测试账号 */
  testUsername?: string;
  /** 测试密码 */
  testPassword?: string;
  /** 数据库连接字符串 */
  dbConnection?: string;
}

/**
 * 流程节点定义
 */
const PROCESS_NODES = {
  START: 'start',
  SUBMIT_APPLICATION: 'submit_application',
  dept_approve: 'dept_approve',
  risk_approve: 'risk_approve', 
  core_approve: 'core_approve',
  FINAL_APPROVE: 'final_approve',
  END: 'end'
};

/**
 * 业务动作定义
 */
const ACTIONS = {
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  RETURN: 'RETURN',
  WITHDRAW: 'WITHDRAW',
  TRANSFER: 'TRANSFER'
};

export function createLegacyAdapter(
  context: FlowAdapterContext,
  config: SupplyChainLegacyConfig = {}
): FlowAdapter {
  return new SupplyChainLegacyAdapter(context, config);
}

class SupplyChainLegacyAdapter implements FlowAdapter {
  private context: FlowAdapterContext;
  private config: SupplyChainLegacyConfig;
  private initialized = false;
  private currentState = PROCESS_NODES.START;
  private applicationId: string | null = null;
  private approvals: Array<{ node: string; actor: string; result: string; timestamp: string }> = [];

  constructor(context: FlowAdapterContext, config: SupplyChainLegacyConfig) {
    this.context = context;
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log(`[SupplyChain Legacy] Initializing for project: ${this.context.projectId}`);
    
    // TODO: 连接旧系统 API 或数据库
    // const apiUrl = this.config.apiBaseUrl || process.env.SUPPLY_CHAIN_API_URL;
    // const dbConn = this.config.dbConnection || process.env.SUPPLY_CHAIN_DB;
    
    this.initialized = true;
    console.log(`[SupplyChain Legacy] Initialized successfully`);
  }

  async reset(scenario: any): Promise<void> {
    console.log(`[SupplyChain Legacy] Resetting for scenario: ${scenario?.id || 'unknown'}`);
    
    // TODO: 重置测试数据
    // 1. 清理测试申请
    // 2. 恢复测试数据快照
    // 3. 重置流程状态
    
    this.currentState = PROCESS_NODES.START;
    this.applicationId = null;
    this.approvals = [];
  }

  async executeAction(action: any): Promise<ActionResult> {
    console.log(`[SupplyChain Legacy] Executing action: ${action.type} by ${action.actor}`);
    
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }

    const timestamp = new Date().toISOString();
    let result: ActionResult;

    switch (action.type) {
      case ACTIONS.SUBMIT:
        result = await this.executeSubmit(action, timestamp);
        break;
      case ACTIONS.APPROVE:
        result = await this.executeApprove(action, timestamp);
        break;
      case ACTIONS.REJECT:
        result = await this.executeReject(action, timestamp);
        break;
      case ACTIONS.RETURN:
        result = await this.executeReturn(action, timestamp);
        break;
      case ACTIONS.WITHDRAW:
        result = await this.executeWithdraw(action, timestamp);
        break;
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }

    return result;
  }

  private async executeSubmit(action: any, timestamp: string): Promise<ActionResult> {
    // TODO: 调用旧系统 API 创建申请
    // const response = await fetch(`${this.config.apiBaseUrl}/api/application`, {
    //   method: 'POST',
    //   body: JSON.stringify(action.data)
    // });
    
    this.applicationId = `APP-${Date.now()}`;
    this.currentState = PROCESS_NODES.dept_approve;
    
    return {
      success: true,
      actionType: ACTIONS.SUBMIT,
      actor: action.actor,
      timestamp,
      data: {
        applicationId: this.applicationId,
        amount: action.data?.amount,
        applicant: action.data?.applicant
      },
      metadata: {
        adapterType: 'supply-chain-legacy',
        processId: 'financing-application-approval',
        nextNode: PROCESS_NODES.dept_approve
      }
    };
  }

  private async executeApprove(action: any, timestamp: string): Promise<ActionResult> {
    if (!this.applicationId) {
      throw new Error('No application to approve');
    }

    // TODO: 调用旧系统 API 审批
    this.approvals.push({
      node: this.currentState,
      actor: action.actor,
      result: 'APPROVED',
      timestamp
    });

    // 状态流转
    if (this.currentState === PROCESS_NODES.dept_approve) {
      this.currentState = PROCESS_NODES.risk_approve;
    } else if (this.currentState === PROCESS_NODES.risk_approve) {
      this.currentState = PROCESS_NODES.core_approve;
    } else if (this.currentState === PROCESS_NODES.core_approve) {
      this.currentState = PROCESS_NODES.FINAL_APPROVE;
    } else if (this.currentState === PROCESS_NODES.FINAL_APPROVE) {
      this.currentState = PROCESS_NODES.END;
    }

    return {
      success: true,
      actionType: ACTIONS.APPROVE,
      actor: action.actor,
      timestamp,
      data: { applicationId: this.applicationId },
      metadata: {
        adapterType: 'supply-chain-legacy',
        previousNode: this.approvals[this.approvals.length - 1]?.node,
        nextNode: this.currentState === PROCESS_NODES.END ? null : this.currentState
      }
    };
  }

  private async executeReject(action: any, timestamp: string): Promise<ActionResult> {
    if (!this.applicationId) {
      throw new Error('No application to reject');
    }

    this.approvals.push({
      node: this.currentState,
      actor: action.actor,
      result: 'REJECTED',
      timestamp
    });

    const finalState = this.currentState; // 记录被拒绝的节点
    this.currentState = PROCESS_NODES.END;

    return {
      success: true,
      actionType: ACTIONS.REJECT,
      actor: action.actor,
      timestamp,
      data: { 
        applicationId: this.applicationId,
        reason: action.data?.reason 
      },
      metadata: {
        adapterType: 'supply-chain-legacy',
        rejectedAtNode: finalState
      }
    };
  }

  private async executeReturn(action: any, timestamp: string): Promise<ActionResult> {
    // TODO: 退回上一级
    return {
      success: true,
      actionType: ACTIONS.RETURN,
      actor: action.actor,
      timestamp,
      data: { applicationId: this.applicationId },
      metadata: {
        adapterType: 'supply-chain-legacy'
      }
    };
  }

  private async executeWithdraw(action: any, timestamp: string): Promise<ActionResult> {
    // TODO: 撤回申请
    this.currentState = PROCESS_NODES.END;
    
    return {
      success: true,
      actionType: ACTIONS.WITHDRAW,
      actor: action.actor,
      timestamp,
      data: { applicationId: this.applicationId },
      metadata: {
        adapterType: 'supply-chain-legacy'
      }
    };
  }

  async queryResult(): Promise<NormalizedResult> {
    console.log(`[SupplyChain Legacy] Querying result, current state: ${this.currentState}`);
    
    // TODO: 从旧系统查询真实状态
    const finalState = this.currentState === PROCESS_NODES.END ? 'FINISHED' : this.currentState;
    
    return {
      finalState,
      semanticPath: this.buildSemanticPath(),
      databaseChanges: {
        applicationStatus: finalState,
        approvalCount: this.approvals.length
      },
      externalCalls: [],
      timestamp: new Date().toISOString(),
      metadata: {
        applicationId: this.applicationId,
        approvals: this.approvals
      }
    };
  }

  private buildSemanticPath(): string[] {
    const path: string[] = [];
    
    // 提交
    if (this.applicationId) {
      path.push('SUBMIT_APPLICATION');
    }
    
    // 审批节点
    for (const approval of this.approvals) {
      if (approval.result === 'REJECTED') {
        path.push('APPLICATION_REJECTED');
        break;
      } else {
        path.push(this.getSemanticName(approval.node));
      }
    }
    
    // 最终状态
    if (this.currentState === PROCESS_NODES.END) {
      const lastApproval = this.approvals[this.approvals.length - 1];
      if (lastApproval?.result === 'REJECTED') {
        path.push('APPLICATION_REJECTED');
      } else if (this.applicationId) {
        path.push('APPLICATION_APPROVED');
      }
    }
    
    return path;
  }

  private getSemanticName(node: string): string {
    const mapping: Record<string, string> = {
      [PROCESS_NODES.dept_approve]: 'DEPT_APPROVE',
      [PROCESS_NODES.risk_approve]: 'RISK_APPROVE',
      [PROCESS_NODES.core_approve]: 'CORE_ENTERPRISE_APPROVE',
      [PROCESS_NODES.FINAL_APPROVE]: 'FINAL_APPROVE'
    };
    return mapping[node] || node.toUpperCase();
  }

  async cleanup(): Promise<void> {
    console.log('[SupplyChain Legacy] Cleaning up');
    
    // TODO: 清理资源、关闭连接
    this.initialized = false;
    this.currentState = PROCESS_NODES.START;
    this.applicationId = null;
    this.approvals = [];
  }
}

export default { createLegacyAdapter };
