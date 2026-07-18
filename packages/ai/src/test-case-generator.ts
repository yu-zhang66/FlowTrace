/**
 * Test Case Generator
 * 
 * 将测试案例结构生成为机器可读的 JSON 格式。
 * 基于 FlowchartDocument、WorkflowConfig 和 ConfigCheckResult 生成完整的测试案例。
 */

import {
  type FlowchartDocument,
  type TestCase,
  CaseType,
  TestCaseSchema,
  validateTestCase,
  type AccountSwitchStep,
  type TestCaseStep,
  AccountSwitchStepSchema,
  TestCaseStepSchema,
  type ExpectedBusinessState,
  type ExpectedFlowState,
  type ExpectedApprovalHistory,
  type ExpectedPostFlow,
  type WorkflowNodeStatus,
  PENDING_CONFIRMATION,
  UNCONFIRMED,
  type ConfigCheckResult,
  ConfigCheckStatus
} from '@flowtrace/core';
import {
  type WorkflowConfig,
  type WorkflowStep,
  type ExpandedStep,
  WorkflowNodeExpander,
  createWorkflowNodeExpander,
  AccountSwitchGenerator,
  createAccountSwitchGenerator,
  type AccountSwitchContext as GeneratorAccountSwitchContext
} from '@flowtrace/collector';

// ============================================================
// Interfaces
// ============================================================

/**
 * TestCaseGenerator 配置选项
 */
export interface TestCaseGeneratorOptions {
  /** 流程 ID */
  processId: string;
  /** 流程图文档 */
  flowchartDocument: FlowchartDocument;
  /** 工作流配置（可选，从数据库动态读取） */
  workflowConfig?: WorkflowConfig;
  /** 配置检查结果 */
  configCheckResult: ConfigCheckResult;
}

/**
 * 生成结果
 */
export interface TestCaseGenerationResult {
  /** 是否成功 */
  success: boolean;
  /** 生成的测试案例 */
  testCase?: TestCase;
  /** 错误列表 */
  errors: string[];
  /** 警告列表 */
  warnings: string[];
  /** 是否因配置缺失被阻塞 */
  blocked: boolean;
}

// ============================================================
// TestCaseGenerator Class
// ============================================================

/**
 * 测试案例生成器
 * 
 * 根据流程图、工作流配置和配置检查结果，生成完整的测试案例 JSON。
 */
export class TestCaseGenerator {
  private readonly options: TestCaseGeneratorOptions;
  private readonly nodeExpander: WorkflowNodeExpander | null;
  private readonly accountSwitchGenerator: AccountSwitchGenerator;
  private readonly timestamp: string;
  private caseCounter: number = 0;

  constructor(options: TestCaseGeneratorOptions) {
    this.options = options;
    this.timestamp = new Date().toISOString();
    
    // 如果有工作流配置，创建节点展开器
    this.nodeExpander = options.workflowConfig 
      ? createWorkflowNodeExpander({
          processCode: options.processId,
          databaseConnection: {
            host: '',
            port: 0,
            database: '',
            username: '',
            password: '',
            type: 'oracle'
          }
        })
      : null;
    
    this.accountSwitchGenerator = createAccountSwitchGenerator();
  }

  /**
   * 生成所有标准案例
   */
  generateAllCases(): TestCase[] {
    const cases: TestCase[] = [];
    const steps = this.getWorkflowSteps();

    if (steps.length === 0) {
      return cases;
    }

    // 全路径通过案例
    cases.push(this.generateFullPathPassCase());

    // 拒绝类案例
    if (steps.length >= 1) {
      cases.push(this.generateRejectCase(0)); // 第一个审批节点拒绝
    }
    if (steps.length >= 2) {
      cases.push(this.generateRejectCase(Math.floor(steps.length / 2))); // 中间审批节点拒绝
    }
    if (steps.length >= 2) {
      cases.push(this.generateRejectCase(steps.length - 1)); // 最终审批节点拒绝
    }

    // 退回类案例
    if (steps.length >= 1) {
      cases.push(this.generateReturnCase(0)); // 第一个退回
    }
    if (steps.length >= 2) {
      cases.push(this.generateReturnCase(Math.floor(steps.length / 2))); // 中间退回
    }
    if (steps.length >= 2) {
      cases.push(this.generateReturnCase(steps.length - 1)); // 最终退回
    }

    // 退回后补件
    if (steps.length >= 1) {
      cases.push(this.generateReturnSupplementCase());
    }

    // 转交案例
    cases.push(this.generateTransferCase());

    // 会签案例
    const cosignSteps = steps.filter(s => s.approveType === 'COSIGN');
    if (cosignSteps.length > 0) {
      const cosignIndex = steps.findIndex(s => s.approveType === 'COSIGN');
      cases.push(this.generateCosignCase(cosignIndex));
    } else {
      // 如果没有会签节点，生成模拟会签案例
      if (steps.length >= 1) {
        cases.push(this.generateCosignCase(0));
      }
    }

    // 无权限尝试案例
    cases.push(this.generateUnauthorizedCase());

    // 重复审批案例
    cases.push(this.generateDuplicateApprovalCase());

    return cases;
  }

  /**
   * 生成单个案例
   */
  generateCase(type: CaseType): TestCase | null {
    switch (type) {
      case 'FULL_PATH_PASS':
        return this.generateFullPathPassCase();
      case 'FIRST_REJECT':
        return this.generateRejectCase(0);
      case 'INTERMEDIATE_REJECT':
        const steps = this.getWorkflowSteps();
        return this.generateRejectCase(Math.floor(steps.length / 2));
      case 'FINAL_REJECT':
        return this.generateRejectCase(this.getWorkflowSteps().length - 1);
      case 'FIRST_RETURN':
        return this.generateReturnCase(0);
      case 'INTERMEDIATE_RETURN':
        const steps2 = this.getWorkflowSteps();
        return this.generateReturnCase(Math.floor(steps2.length / 2));
      case 'FINAL_RETURN':
        return this.generateReturnCase(this.getWorkflowSteps().length - 1);
      case 'RETURN_SUPPLEMENT':
        return this.generateReturnSupplementCase();
      case 'TRANSFER':
        return this.generateTransferCase();
      case 'COSIGN_ALL_PASS':
        return this.generateCosignCase(0);
      case 'COSIGN_PARTIAL_INCOMPLETE':
        return this.generateCosignPartialIncompleteCase();
      case 'COSIGN_ONE_REJECT':
        return this.generateCosignRejectCase();
      case 'UNAUTHORIZED_ATTEMPT':
        return this.generateUnauthorizedCase();
      case 'DUPLICATE_APPROVAL_HANDLED':
        return this.generateDuplicateApprovalCase();
      default:
        return null;
    }
  }

  /**
   * 生成全路径通过案例
   */
  generateFullPathPassCase(): TestCase {
    this.caseCounter++;
    const steps = this.getWorkflowSteps();
    const flowchart = this.flowchart;

    const testCase = this.createBaseTestCase({
      id: `tc-${this.options.processId}-full-path-pass-${this.caseCounter}`,
      name: `${this.getProcessName()} - 全路径审核通过`,
      type: 'FULL_PATH_PASS',
      purpose: '验证所有审批节点正常通过，流程顺利完成',
      tags: ['happy-path', 'critical']
    });

    // 添加发起步骤
    testCase.steps.push(...this.createInitiatorSteps());

    // 添加审批步骤
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isLast = i === steps.length - 1;
      
      testCase.steps.push(...this.createApprovalSteps(step, i, isLast ? 'FINAL_APPROVER' : 'APPROVER'));
      
      // 如果不是最后一步，添加账号切换到下一个审批人
      if (!isLast && i < steps.length - 1) {
        const nextStep = steps[i + 1];
        testCase.steps.push(...this.createAccountSwitchSteps(
          this.getAccountRef(step, i),
          this.getAccountRef(nextStep, i + 1),
          nextStep
        ));
      }
    }

    // 设置预期结果
    this.setFullPathPassExpectations(testCase);

    return this.validateAndReturn(testCase);
  }

  /**
   * 生成拒绝类案例
   */
  generateRejectCase(rejectAtStep: number): TestCase {
    this.caseCounter++;
    const steps = this.getWorkflowSteps();
    
    if (rejectAtStep < 0 || rejectAtStep >= steps.length) {
      rejectAtStep = 0;
    }

    const step = steps[rejectAtStep];
    const isFirst = rejectAtStep === 0;
    const isFinal = rejectAtStep === steps.length - 1;

    let type: CaseType;
    if (isFirst) {
      type = 'FIRST_REJECT';
    } else if (isFinal) {
      type = 'FINAL_REJECT';
    } else {
      type = 'INTERMEDIATE_REJECT';
    }

    const testCase = this.createBaseTestCase({
      id: `tc-${this.options.processId}-reject-at-step-${rejectAtStep + 1}-${this.caseCounter}`,
      name: `${this.getProcessName()} - ${this.getStepTypeLabel(type)}`,
      type,
      purpose: `验证在第 ${rejectAtStep + 1} 个审批节点被拒绝`,
      tags: ['rejection', 'error-handling']
    });

    // 添加发起步骤
    testCase.steps.push(...this.createInitiatorSteps());

    // 添加之前节点的审批通过步骤
    for (let i = 0; i < rejectAtStep; i++) {
      const approvalStep = steps[i];
      testCase.steps.push(...this.createApprovalSteps(approvalStep, i, 'APPROVER'));
      
      if (i < rejectAtStep - 1) {
        const nextStep = steps[i + 1];
        testCase.steps.push(...this.createAccountSwitchSteps(
          this.getAccountRef(approvalStep, i),
          this.getAccountRef(nextStep, i + 1),
          nextStep
        ));
      }
    }

    // 添加拒绝步骤
    testCase.steps.push(...this.createRejectSteps(step, rejectAtStep));

    // 设置预期结果
    testCase.expectedFlowState = {
      nodeId: step.stepId,
      nodeName: step.stepName,
      status: 'rejected'
    };
    testCase.failureTerminalState = 'rejected';

    return this.validateAndReturn(testCase);
  }

  /**
   * 生成退回类案例
   */
  generateReturnCase(returnAtStep: number): TestCase {
    this.caseCounter++;
    const steps = this.getWorkflowSteps();
    
    if (returnAtStep < 0 || returnAtStep >= steps.length) {
      returnAtStep = 0;
    }

    const step = steps[returnAtStep];
    const isFirst = returnAtStep === 0;
    const isFinal = returnAtStep === steps.length - 1;

    let type: CaseType;
    if (isFirst) {
      type = 'FIRST_RETURN';
    } else if (isFinal) {
      type = 'FINAL_RETURN';
    } else {
      type = 'INTERMEDIATE_RETURN';
    }

    const testCase = this.createBaseTestCase({
      id: `tc-${this.options.processId}-return-at-step-${returnAtStep + 1}-${this.caseCounter}`,
      name: `${this.getProcessName()} - ${this.getStepTypeLabel(type)}`,
      type,
      purpose: `验证在第 ${returnAtStep + 1} 个审批节点被退回`,
      tags: ['return', 'error-handling']
    });

    // 添加发起步骤
    testCase.steps.push(...this.createInitiatorSteps());

    // 添加之前节点的审批通过步骤
    for (let i = 0; i < returnAtStep; i++) {
      const approvalStep = steps[i];
      testCase.steps.push(...this.createApprovalSteps(approvalStep, i, 'APPROVER'));
      
      if (i < returnAtStep - 1) {
        const nextStep = steps[i + 1];
        testCase.steps.push(...this.createAccountSwitchSteps(
          this.getAccountRef(approvalStep, i),
          this.getAccountRef(nextStep, i + 1),
          nextStep
        ));
      }
    }

    // 添加退回步骤
    testCase.steps.push(...this.createReturnSteps(step, returnAtStep));

    // 设置预期结果
    testCase.expectedFlowState = {
      nodeId: step.stepId,
      nodeName: step.stepName,
      status: 'returned'
    };
    testCase.failureTerminalState = 'cancelled';

    return this.validateAndReturn(testCase);
  }

  /**
   * 生成退回后补件案例
   */
  generateReturnSupplementCase(): TestCase {
    this.caseCounter++;
    const steps = this.getWorkflowSteps();
    
    const returnStepIndex = 0;
    const returnStep = steps[returnStepIndex];

    const testCase = this.createBaseTestCase({
      id: `tc-${this.options.processId}-return-supplement-${this.caseCounter}`,
      name: `${this.getProcessName()} - 退回后补件重新提交`,
      type: 'RETURN_SUPPLEMENT',
      purpose: '验证退回后申请人补充材料并重新提交',
      tags: ['return', 'supplement', 're-submit']
    });

    // 第一阶段：提交后被退回
    testCase.steps.push(...this.createInitiatorSteps());
    testCase.steps.push(...this.createReturnSteps(returnStep, returnStepIndex));

    // 第二阶段：补充材料
    testCase.steps.push(...this.createSupplementSteps());

    // 第三阶段：重新提交
    testCase.steps.push(...this.createResubmitSteps());

    // 第四阶段：重新审批
    for (let i = 0; i < steps.length; i++) {
      const approvalStep = steps[i];
      const isLast = i === steps.length - 1;
      
      testCase.steps.push(...this.createApprovalSteps(approvalStep, i, isLast ? 'FINAL_APPROVER' : 'APPROVER'));
      
      if (!isLast && i < steps.length - 1) {
        const nextStep = steps[i + 1];
        testCase.steps.push(...this.createAccountSwitchSteps(
          this.getAccountRef(approvalStep, i),
          this.getAccountRef(nextStep, i + 1),
          nextStep
        ));
      }
    }

    // 设置预期结果
    this.setFullPathPassExpectations(testCase);

    return this.validateAndReturn(testCase);
  }

  /**
   * 生成转交案例
   */
  generateTransferCase(): TestCase {
    this.caseCounter++;
    const steps = this.getWorkflowSteps();
    
    const transferStepIndex = Math.min(1, steps.length - 1);
    const step = steps[transferStepIndex];

    const testCase = this.createBaseTestCase({
      id: `tc-${this.options.processId}-transfer-${this.caseCounter}`,
      name: `${this.getProcessName()} - 审批任务转交`,
      type: 'TRANSFER',
      purpose: '验证审批人将任务转交给其他人',
      tags: ['transfer', 'delegation']
    });

    // 添加发起步骤
    testCase.steps.push(...this.createInitiatorSteps());

    // 添加之前节点的审批通过步骤
    for (let i = 0; i < transferStepIndex; i++) {
      const approvalStep = steps[i];
      testCase.steps.push(...this.createApprovalSteps(approvalStep, i, 'APPROVER'));
    }

    // 添加转交步骤
    testCase.steps.push(...this.createTransferSteps(step, transferStepIndex));

    // 设置预期结果
    testCase.expectedFlowState = {
      nodeId: step.stepId,
      nodeName: step.stepName,
      status: 'transferred'
    };

    return this.validateAndReturn(testCase);
  }

  /**
   * 生成会签案例
   */
  generateCosignCase(cosignAtStep: number): TestCase {
    this.caseCounter++;
    const steps = this.getWorkflowSteps();
    
    if (cosignAtStep < 0 || cosignAtStep >= steps.length) {
      cosignAtStep = 0;
    }

    const step = steps[cosignAtStep];
    const cosignCount = step.cosignCount || 3; // 默认3人会签

    const testCase = this.createBaseTestCase({
      id: `tc-${this.options.processId}-cosign-all-pass-${this.caseCounter}`,
      name: `${this.getProcessName()} - 会签全部通过`,
      type: 'COSIGN_ALL_PASS',
      purpose: `验证 ${cosignCount} 人会签全部同意后流程继续`,
      tags: ['cosign', 'parallel-approval']
    });

    // 添加发起步骤
    testCase.steps.push(...this.createInitiatorSteps());

    // 添加之前节点的审批通过步骤
    for (let i = 0; i < cosignAtStep; i++) {
      const approvalStep = steps[i];
      testCase.steps.push(...this.createApprovalSteps(approvalStep, i, 'APPROVER'));
    }

    // 添加会签步骤（所有人都需要审批）
    for (let i = 0; i < cosignCount; i++) {
      testCase.steps.push(...this.createCosignApprovalSteps(step, cosignAtStep, i, cosignCount));
      
      // 会签人之间切换账号
      if (i < cosignCount - 1) {
        const currentSigner = `signer_${i + 1}`;
        const nextSigner = `signer_${i + 2}`;
        testCase.steps.push(...this.createAccountSwitchSteps(
          currentSigner,
          nextSigner,
          step
        ));
      }
    }

    // 设置预期结果
    testCase.expectedFlowState = {
      nodeId: step.stepId,
      nodeName: step.stepName,
      status: 'approved'
    };

    return this.validateAndReturn(testCase);
  }

  /**
   * 生成会签部分未完成案例
   */
  generateCosignPartialIncompleteCase(): TestCase {
    this.caseCounter++;
    const steps = this.getWorkflowSteps();
    
    const cosignStepIndex = 0;
    const step = steps[cosignStepIndex] || {
      stepId: 'STEP_1',
      stepName: '会签审批',
      approveType: 'COSIGN' as const,
      cosignCount: 3
    };
    const cosignCount = step.cosignCount || 3;

    const testCase = this.createBaseTestCase({
      id: `tc-${this.options.processId}-cosign-partial-${this.caseCounter}`,
      name: `${this.getProcessName()} - 会签部分未完成`,
      type: 'COSIGN_PARTIAL_INCOMPLETE',
      purpose: `验证 ${cosignCount} 人会签部分人未完成时流程暂停`,
      tags: ['cosign', 'incomplete']
    });

    testCase.steps.push(...this.createInitiatorSteps());

    // 添加部分会签步骤
    const completedCount = Math.floor(cosignCount / 2);
    for (let i = 0; i < completedCount; i++) {
      testCase.steps.push(...this.createCosignApprovalSteps(step, cosignStepIndex, i, cosignCount));
    }

    // 设置预期结果
    testCase.expectedFlowState = {
      nodeId: step.stepId,
      nodeName: step.stepName,
      status: 'pending'
    };

    return this.validateAndReturn(testCase);
  }

  /**
   * 生成会签一人拒绝案例
   */
  generateCosignRejectCase(): TestCase {
    this.caseCounter++;
    const steps = this.getWorkflowSteps();
    
    const cosignStepIndex = 0;
    const step = steps[cosignStepIndex] || {
      stepId: 'STEP_1',
      stepName: '会签审批',
      approveType: 'COSIGN' as const,
      cosignCount: 3
    };
    const cosignCount = step.cosignCount || 3;

    const testCase = this.createBaseTestCase({
      id: `tc-${this.options.processId}-cosign-reject-${this.caseCounter}`,
      name: `${this.getProcessName()} - 会签一人拒绝`,
      type: 'COSIGN_ONE_REJECT',
      purpose: `验证 ${cosignCount} 人会签中一人拒绝后流程终止`,
      tags: ['cosign', 'rejection']
    });

    testCase.steps.push(...this.createInitiatorSteps());

    // 第一个人同意
    testCase.steps.push(...this.createCosignApprovalSteps(step, cosignStepIndex, 0, cosignCount));

    // 第二个人拒绝
    testCase.steps.push(...this.createCosignRejectSteps(step, cosignStepIndex, 1));

    // 设置预期结果
    testCase.expectedFlowState = {
      nodeId: step.stepId,
      nodeName: step.stepName,
      status: 'rejected'
    };
    testCase.failureTerminalState = 'rejected';

    return this.validateAndReturn(testCase);
  }

  /**
   * 生成无权限尝试案例
   */
  generateUnauthorizedCase(): TestCase {
    this.caseCounter++;

    const testCase = this.createBaseTestCase({
      id: `tc-${this.options.processId}-unauthorized-${this.caseCounter}`,
      name: `${this.getProcessName()} - 无权限账号尝试审批`,
      type: 'UNAUTHORIZED_ATTEMPT',
      purpose: '验证无权限账号无法执行审批操作',
      tags: ['security', 'authorization']
    });

    // 添加发起步骤
    testCase.steps.push(...this.createInitiatorSteps());

    // 切换到无权限账号
    const unauthorizedAccount = 'unauthorized_user';
    const firstApprover = this.getAccountRef(this.getWorkflowSteps()[0], 0);
    
    testCase.steps.push(...this.createAccountSwitchSteps(
      'initiator',
      unauthorizedAccount,
      this.getWorkflowSteps()[0]
    ));

    // 添加无权限尝试步骤
    const unauthorizedStep = this.createUnauthorizedAttemptStep(unauthorizedAccount);
    testCase.steps.push(unauthorizedStep);

    // 设置预期结果
    testCase.expectedFlowState = {
      status: 'pending'
    };

    return this.validateAndReturn(testCase);
  }

  /**
   * 生成重复审批案例
   */
  generateDuplicateApprovalCase(): TestCase {
    this.caseCounter++;
    const steps = this.getWorkflowSteps();
    
    const stepIndex = 0;
    const step = steps[stepIndex];

    const testCase = this.createBaseTestCase({
      id: `tc-${this.options.processId}-duplicate-approval-${this.caseCounter}`,
      name: `${this.getProcessName()} - 已处理节点重复审批`,
      type: 'DUPLICATE_APPROVAL_HANDLED',
      purpose: '验证系统正确处理已审批节点的重复提交',
      tags: ['duplicate', 'idempotency']
    });

    // 添加发起步骤
    testCase.steps.push(...this.createInitiatorSteps());

    // 第一次审批
    testCase.steps.push(...this.createApprovalSteps(step, stepIndex, 'APPROVER'));

    // 模拟重复审批尝试（账号切换回原审批人）
    testCase.steps.push(...this.createAccountSwitchSteps(
      this.getAccountRef(step, stepIndex),
      this.getAccountRef(step, stepIndex),
      step
    ));

    // 添加重复审批步骤
    testCase.steps.push(...this.createDuplicateApprovalSteps(step, stepIndex));

    // 设置预期结果
    testCase.expectedFlowState = {
      nodeId: step.stepId,
      nodeName: step.stepName,
      status: 'approved'
    };

    return this.validateAndReturn(testCase);
  }

  // ============================================================
  // Private Helper Methods
  // ============================================================

  /**
   * 获取流程图文档引用
   */
  private get flowchart(): FlowchartDocument {
    return this.options.flowchartDocument;
  }

  /**
   * 获取工作流步骤列表
   */
  private getWorkflowSteps(): WorkflowStep[] {
    if (this.options.workflowConfig?.steps) {
      return this.options.workflowConfig.steps;
    }

    // 如果没有工作流配置，从流程图中推断
    return this.inferStepsFromFlowchart();
  }

  /**
   * 从流程图中推断步骤
   */
  private inferStepsFromFlowchart(): WorkflowStep[] {
    const steps: WorkflowStep[] = [];
    const nodes = this.flowchart.nodes;

    // 找出所有 APPROVAL 类型的节点
    const approvalNodes = nodes.filter(n => n.type === 'APPROVAL' || n.type === 'TASK');

    for (let i = 0; i < approvalNodes.length; i++) {
      const node = approvalNodes[i];
      const isFirst = i === 0;
      const isLast = i === approvalNodes.length - 1;

      steps.push({
        stepId: node.id,
        stepCode: node.id,
        stepName: node.name || `[步骤 ${i + 1}]`,
        approveType: 'NORMAL',
        sequence: i + 1,
        stepType: node.type,
        configurations: {},
        approvers: this.getApproversForNode(node)
      });
    }

    // 如果没有找到审批节点，添加占位符步骤
    if (steps.length === 0) {
      const defaultSteps = 5;
      for (let i = 0; i < defaultSteps; i++) {
        steps.push({
          stepId: `STEP_${i + 1}`,
          stepCode: `STEP_${i + 1}`,
          stepName: `[节点名称待确认]`,
          approveType: 'NORMAL',
          sequence: i + 1,
          stepType: 'APPROVAL',
          configurations: {
            [PENDING_CONFIRMATION]: true
          },
          approvers: []
        });
      }
    }

    return steps;
  }

  /**
   * 获取节点的审批人
   */
  private getApproversForNode(node: any): WorkflowStep['approvers'] {
    if (node.actors && Array.isArray(node.actors)) {
      return node.actors.map((actor: string, index: number) => ({
        approverId: actor,
        approverCode: actor,
        approverName: actor,
        approverType: 'USER' as const,
        isPrimary: index === 0
      }));
    }
    return [];
  }

  /**
   * 获取流程名称
   */
  private getProcessName(): string {
    return this.flowchart.metadata?.name || this.options.processId;
  }

  /**
   * 创建基础测试案例
   */
  private createBaseTestCase(params: {
    id: string;
    name: string;
    type: CaseType;
    purpose: string;
    tags?: string[];
  }): TestCase {
    const steps = this.getWorkflowSteps();
    const sourceStatus = this.isBlocked() ? 'PENDING_CONFIRMATION' : 'AUTO_GENERATED';

    return {
      id: params.id,
      name: params.name,
      type: params.type,
      purpose: params.purpose,
      requiredAccounts: this.buildRequiredAccounts(steps),
      steps: [],
      sourceStatus,
      severity: this.getSeverityForType(params.type),
      tags: params.tags,
      flowId: this.options.processId,
      executable: !this.isBlocked()
    };
  }

  /**
   * 构建所需账号列表
   */
  private buildRequiredAccounts(steps: WorkflowStep[]): TestCase['requiredAccounts'] {
    const accounts: TestCase['requiredAccounts'] = [
      {
        accountRef: 'initiator',
        accountType: 'INITIATOR',
        description: '申请人/发起人',
        permissions: ['create', 'submit', 'view']
      }
    ];

    // 添加审批人
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isLast = i === steps.length - 1;
      
      if (step.approveType === 'COSIGN') {
        const cosignCount = step.cosignCount || 3;
        for (let j = 0; j < cosignCount; j++) {
          accounts.push({
            accountRef: `signer_${j + 1}`,
            accountType: 'COUNTER_SIGNER',
            description: `会签人 ${j + 1}`,
            permissions: ['approve', 'reject', 'view']
          });
        }
      } else {
        accounts.push({
          accountRef: this.getAccountRef(step, i),
          accountType: isLast ? 'FINAL_APPROVER' : 'APPROVER',
          description: step.stepName,
          permissions: ['approve', 'reject', 'return', 'transfer', 'view']
        });
      }
    }

    // 添加无权限测试账号
    accounts.push({
      accountRef: 'unauthorized_user',
      accountType: 'VIEWER',
      description: '无权限用户（用于安全测试）',
      permissions: ['view']
    });

    return accounts;
  }

  /**
   * 获取步骤的账号引用
   */
  private getAccountRef(step: WorkflowStep, index: number): string {
    if (step.approvers && step.approvers.length > 0) {
      const primary = step.approvers.find(a => a.isPrimary);
      return primary?.approverCode || step.approvers[0].approverCode;
    }
    return `approver_${index + 1}`;
  }

  /**
   * 创建发起人步骤
   */
  private createInitiatorSteps(): TestCaseStep[] {
    const steps: TestCaseStep[] = [
      {
        stepId: 'step-0-login',
        name: '申请人登录系统',
        accountRef: 'initiator',
        accountType: 'INITIATOR',
        loginRequired: true,
        operation: 'view',
        expectedUiResult: {
          pageLoaded: true,
          urlPattern: '/.*',
          elements: []
        },
        expectedApiResult: {
          statusCode: 200
        },
        evidence: ['screenshot', 'api_request', 'api_response'],
        failurePolicy: 'STOP'
      },
      {
        stepId: 'step-0-submit',
        name: '申请人提交表单',
        accountRef: 'initiator',
        accountType: 'INITIATOR',
        loginRequired: true,
        operation: 'submit',
        input: {
          businessData: {
            [PENDING_CONFIRMATION]: '业务数据待填写'
          }
        },
        expectedUiResult: {
          pageLoaded: true,
          messages: [
            { type: 'success', contains: '提交成功' }
          ]
        },
        expectedApiResult: {
          statusCode: 200,
          responseContains: {
            success: true
          }
        },
        evidence: ['screenshot', 'api_request', 'api_response', 'database_result'],
        failurePolicy: 'STOP'
      }
    ];

    return steps.map(step => {
      TestCaseStepSchema.parse(step);
      return step;
    });
  }

  /**
   * 创建审批步骤
   */
  private createApprovalSteps(step: WorkflowStep, index: number, accountType: 'APPROVER' | 'FINAL_APPROVER'): TestCaseStep[] {
    const steps: TestCaseStep[] = [
      {
        stepId: `step-${index + 1}-navigate`,
        name: `导航到${step.stepName}`,
        accountRef: this.getAccountRef(step, index),
        accountType,
        loginRequired: true,
        operation: 'view',
        expectedUiResult: {
          pageLoaded: true,
          elements: [
            {
              selector: '[data-testid="approval-form"]',
              shouldExist: true,
              shouldBeVisible: true
            }
          ]
        },
        evidence: ['screenshot', 'api_request'],
        failurePolicy: 'STOP'
      },
      {
        stepId: `step-${index + 1}-approve`,
        name: `${step.stepName} - 审批通过`,
        accountRef: this.getAccountRef(step, index),
        accountType,
        loginRequired: true,
        operation: 'approve',
        input: {
          comments: '同意',
          decision: 'approve'
        },
        expectedUiResult: {
          pageLoaded: true,
          messages: [
            { type: 'success', contains: '审批成功' }
          ]
        },
        expectedApiResult: {
          statusCode: 200,
          responseContains: {
            success: true
          }
        },
        evidence: ['screenshot', 'api_request', 'api_response', 'database_result'],
        failurePolicy: 'STOP'
      }
    ];

    return steps.map(s => {
      TestCaseStepSchema.parse(s);
      return s;
    });
  }

  /**
   * 创建拒绝步骤
   */
  private createRejectSteps(step: WorkflowStep, index: number): TestCaseStep[] {
    const rejectStep: TestCaseStep = {
      stepId: `step-${index + 1}-reject`,
      name: `${step.stepName} - 审批拒绝`,
      accountRef: this.getAccountRef(step, index),
      accountType: 'APPROVER',
      loginRequired: true,
      operation: 'reject',
      input: {
        comments: '不符合要求，拒绝审批',
        decision: 'reject',
        reason: '资质不符合条件'
      },
      expectedUiResult: {
        pageLoaded: true,
        messages: [
          { type: 'success', contains: '拒绝成功' }
        ]
      },
      expectedApiResult: {
        statusCode: 200,
        responseContains: {
          success: true,
          status: 'rejected'
        }
      },
      evidence: ['screenshot', 'api_request', 'api_response', 'database_result'],
      failurePolicy: 'STOP'
    };

    TestCaseStepSchema.parse(rejectStep);
    return [rejectStep];
  }

  /**
   * 创建退回步骤
   */
  private createReturnSteps(step: WorkflowStep, index: number): TestCaseStep[] {
    const returnStep: TestCaseStep = {
      stepId: `step-${index + 1}-return`,
      name: `${step.stepName} - 退回补充材料`,
      accountRef: this.getAccountRef(step, index),
      accountType: 'APPROVER',
      loginRequired: true,
      operation: 'return',
      input: {
        comments: '请补充必要的材料',
        decision: 'return',
        returnReason: '材料不完整',
        returnToStep: step.returnToStep || 'STEP_1'
      },
      expectedUiResult: {
        pageLoaded: true,
        messages: [
          { type: 'success', contains: '退回成功' }
        ]
      },
      expectedApiResult: {
        statusCode: 200,
        responseContains: {
          success: true,
          status: 'returned'
        }
      },
      evidence: ['screenshot', 'api_request', 'api_response', 'database_result'],
      failurePolicy: 'STOP'
    };

    TestCaseStepSchema.parse(returnStep);
    return [returnStep];
  }

  /**
   * 创建补件步骤
   */
  private createSupplementSteps(): TestCaseStep[] {
    const supplementStep: TestCaseStep = {
      stepId: 'step-supplement-upload',
      name: '补充上传必要材料',
      accountRef: 'initiator',
      accountType: 'INITIATOR',
      loginRequired: true,
      operation: 'upload',
      input: {
        files: {
          [PENDING_CONFIRMATION]: '待上传的文件列表'
        }
      },
      expectedUiResult: {
        pageLoaded: true,
        messages: [
          { type: 'success', contains: '上传成功' }
        ]
      },
      evidence: ['screenshot', 'file_upload'],
      failurePolicy: 'STOP'
    };

    TestCaseStepSchema.parse(supplementStep);
    return [supplementStep];
  }

  /**
   * 创建重新提交步骤
   */
  private createResubmitSteps(): TestCaseStep[] {
    const resubmitStep: TestCaseStep = {
      stepId: 'step-resubmit',
      name: '重新提交申请',
      accountRef: 'initiator',
      accountType: 'INITIATOR',
      loginRequired: true,
      operation: 'submit',
      input: {
        reason: '补充材料后重新提交',
        supplementCompleted: true
      },
      expectedUiResult: {
        pageLoaded: true,
        messages: [
          { type: 'success', contains: '重新提交成功' }
        ]
      },
      evidence: ['screenshot', 'api_request', 'api_response'],
      failurePolicy: 'STOP'
    };

    TestCaseStepSchema.parse(resubmitStep);
    return [resubmitStep];
  }

  /**
   * 创建转交流程
   */
  private createTransferSteps(step: WorkflowStep, index: number): TestCaseStep[] {
    const transferStep: TestCaseStep = {
      stepId: `step-${index + 1}-transfer`,
      name: `${step.stepName} - 转交任务`,
      accountRef: this.getAccountRef(step, index),
      accountType: 'APPROVER',
      loginRequired: true,
      operation: 'transfer',
      input: {
        targetAccount: `${this.getAccountRef(step, index)}_delegate`,
        reason: '因出差无法处理，转交给同事',
        comments: '请代为审批'
      },
      expectedUiResult: {
        pageLoaded: true,
        messages: [
          { type: 'success', contains: '转交成功' }
        ]
      },
      expectedApiResult: {
        statusCode: 200,
        responseContains: {
          success: true,
          status: 'transferred'
        }
      },
      evidence: ['screenshot', 'api_request', 'api_response'],
      failurePolicy: 'STOP'
    };

    TestCaseStepSchema.parse(transferStep);
    return [transferStep];
  }

  /**
   * 创建会签审批步骤
   */
  private createCosignApprovalSteps(
    step: WorkflowStep,
    index: number,
    cosignIndex: number,
    totalCosigners: number
  ): TestCaseStep[] {
    const cosignStep: TestCaseStep = {
      stepId: `step-${index + 1}-cosign-${cosignIndex + 1}`,
      name: `${step.stepName} - 会签人${cosignIndex + 1}/${totalCosigners}审批`,
      accountRef: `signer_${cosignIndex + 1}`,
      accountType: 'COUNTER_SIGNER',
      loginRequired: true,
      operation: 'approve',
      input: {
        comments: '同意',
        decision: 'approve',
        cosignIndex: cosignIndex + 1,
        cosignTotal: totalCosigners
      },
      expectedUiResult: {
        pageLoaded: true,
        messages: [
          { type: 'success', contains: '会签审批成功' }
        ]
      },
      expectedApiResult: {
        statusCode: 200,
        responseContains: {
          success: true,
          cosignCompleted: cosignIndex === totalCosigners - 1
        }
      },
      evidence: ['screenshot', 'api_request', 'api_response', 'database_result'],
      failurePolicy: 'STOP'
    };

    TestCaseStepSchema.parse(cosignStep);
    return [cosignStep];
  }

  /**
   * 创建会签拒绝步骤
   */
  private createCosignRejectSteps(
    step: WorkflowStep,
    index: number,
    cosignIndex: number
  ): TestCaseStep[] {
    const cosignRejectStep: TestCaseStep = {
      stepId: `step-${index + 1}-cosign-${cosignIndex + 1}-reject`,
      name: `${step.stepName} - 会签人${cosignIndex + 1}拒绝`,
      accountRef: `signer_${cosignIndex + 1}`,
      accountType: 'COUNTER_SIGNER',
      loginRequired: true,
      operation: 'reject',
      input: {
        comments: '不同意此申请',
        decision: 'reject',
        reason: '条件不符合'
      },
      expectedUiResult: {
        pageLoaded: true,
        messages: [
          { type: 'success', contains: '拒绝成功' }
        ]
      },
      expectedApiResult: {
        statusCode: 200,
        responseContains: {
          success: true,
          status: 'rejected'
        }
      },
      evidence: ['screenshot', 'api_request', 'api_response', 'database_result'],
      failurePolicy: 'STOP'
    };

    TestCaseStepSchema.parse(cosignRejectStep);
    return [cosignRejectStep];
  }

  /**
   * 创建无权限尝试步骤
   */
  private createUnauthorizedAttemptStep(accountRef: string): TestCaseStep {
    const unauthorizedStep: TestCaseStep = {
      stepId: 'step-unauthorized-attempt',
      name: '无权限用户尝试审批',
      accountRef,
      accountType: 'VIEWER',
      loginRequired: true,
      operation: 'approve',
      input: {
        comments: '不应该成功的操作'
      },
      expectedUiResult: {
        pageLoaded: true,
        messages: [
          { type: 'error', contains: '无权' }
        ]
      },
      expectedApiResult: {
        statusCode: 403
      },
      evidence: ['screenshot', 'api_request', 'api_response'],
      failurePolicy: 'STOP'
    };

    TestCaseStepSchema.parse(unauthorizedStep);
    return unauthorizedStep;
  }

  /**
   * 创建重复审批步骤
   */
  private createDuplicateApprovalSteps(step: WorkflowStep, index: number): TestCaseStep[] {
    const duplicateStep: TestCaseStep = {
      stepId: `step-${index + 1}-duplicate-approve`,
      name: `${step.stepName} - 重复审批尝试`,
      accountRef: this.getAccountRef(step, index),
      accountType: 'APPROVER',
      loginRequired: true,
      operation: 'approve',
      input: {
        comments: '重复提交',
        decision: 'approve'
      },
      expectedUiResult: {
        pageLoaded: true,
        messages: [
          { type: 'warning', contains: '已处理' }
        ]
      },
      expectedApiResult: {
        statusCode: 200,
        responseContains: {
          success: true,
          alreadyProcessed: true
        }
      },
      evidence: ['screenshot', 'api_request', 'api_response'],
      failurePolicy: 'SKIP'
    };

    TestCaseStepSchema.parse(duplicateStep);
    return [duplicateStep];
  }

  /**
   * 创建账号切换步骤
   */
  private createAccountSwitchSteps(
    fromAccount: string,
    toAccount: string,
    targetStep: WorkflowStep
  ): AccountSwitchStep[] {
    const context: GeneratorAccountSwitchContext = {
      financingCode: PENDING_CONFIRMATION,
      stepInstCode: targetStep.stepId,
      currentStepId: targetStep.stepId,
      businessEntity: this.options.processId,
      currentState: 'pending_approval',
      targetPageUrl: `/approval/${targetStep.stepId}`,
      requiredPermissions: ['approve', 'view']
    };

    const switchStep = this.accountSwitchGenerator.generateSingleSwitchStep(
      fromAccount,
      toAccount,
      context,
      {
        reason: `从 ${fromAccount} 切换到 ${toAccount} 进行审批`,
        logoutMethod: 'ui_button',
        loginMethod: 'ui_form'
      }
    );

    AccountSwitchStepSchema.parse(switchStep);
    return [switchStep];
  }

  /**
   * 设置全路径通过的预期结果
   */
  private setFullPathPassExpectations(testCase: TestCase): void {
    const steps = this.getWorkflowSteps();
    const lastStep = steps[steps.length - 1];

    testCase.expectedFlowState = {
      nodeId: lastStep.stepId,
      nodeName: lastStep.stepName,
      status: 'approved'
    };

    testCase.expectedPostFlow = {
      flowStatus: 'completed',
      finalState: 'TRANSFERRED',
      downstreamEffects: [
        {
          effectType: 'notification',
          targetSystem: 'message',
          details: {
            type: 'approval_complete',
            message: '流程已全部审批完成'
          }
        }
      ]
    };

    testCase.expectedApprovalHistory = steps.map((step, index) => ({
      approver: this.getAccountRef(step, index),
      action: 'approved',
      nodeId: step.stepId
    }));

    testCase.workflowNodeStatus = steps.map(step => ({
      nodeId: step.stepId,
      nodeName: step.stepName,
      status: 'completed' as const,
      completedAt: this.timestamp
    }));
  }

  /**
   * 根据案例类型获取严重级别
   */
  private getSeverityForType(type: CaseType): 'P0' | 'P1' | 'P2' | 'P3' {
    switch (type) {
      case 'FULL_PATH_PASS':
        return 'P0';
      case 'FIRST_REJECT':
      case 'FIRST_RETURN':
      case 'UNAUTHORIZED_ATTEMPT':
        return 'P1';
      case 'INTERMEDIATE_REJECT':
      case 'FINAL_REJECT':
      case 'INTERMEDIATE_RETURN':
      case 'FINAL_RETURN':
      case 'COSIGN_ALL_PASS':
      case 'COSIGN_ONE_REJECT':
        return 'P2';
      default:
        return 'P3';
    }
  }

  /**
   * 获取案例类型标签
   */
  private getStepTypeLabel(type: CaseType): string {
    const labels: Record<CaseType, string> = {
      'FULL_PATH_PASS': '全路径通过',
      'FIRST_REJECT': '第一节点拒绝',
      'INTERMEDIATE_REJECT': '中间节点拒绝',
      'FINAL_REJECT': '最终节点拒绝',
      'FIRST_RETURN': '第一节点退回',
      'INTERMEDIATE_RETURN': '中间节点退回',
      'FINAL_RETURN': '最终节点退回',
      'RETURN_SUPPLEMENT': '退回后补件',
      'TRANSFER': '任务转交',
      'COSIGN_ALL_PASS': '会签全部通过',
      'COSIGN_PARTIAL_INCOMPLETE': '会签部分未完成',
      'COSIGN_ONE_REJECT': '会签一人拒绝',
      'UNAUTHORIZED_ATTEMPT': '无权限尝试',
      'DUPLICATE_APPROVAL_HANDLED': '重复审批处理',
      'TIMEOUT_AUTO_COMPLETE': '超时自动完成',
      'BULK_OPERATION': '批量操作',
      'BATCH_APPROVE': '批量审批',
      'DELEGATION': '委托',
      'ESCALATION': '升级'
    };
    return labels[type] || type;
  }

  /**
   * 检查是否被配置缺失阻塞
   */
  private isBlocked(): boolean {
    return this.options.configCheckResult.status === ConfigCheckStatus.enum.BLOCKED_MISSING_CONFIG;
  }

  /**
   * 验证并返回测试案例
   */
  private validateAndReturn(testCase: TestCase): TestCase {
    // 如果被阻塞，标记为不可执行
    if (this.isBlocked()) {
      testCase.executable = false;
      testCase.sourceStatus = 'PENDING_CONFIRMATION';
    }

    // 验证测试案例完整性
    const validation = validateTestCase(testCase);
    if (!validation.valid) {
      console.warn(`[TestCaseGenerator] Test case validation warnings: ${validation.errors?.join(', ')}`);
    }

    return testCase;
  }
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * 创建测试案例生成器
 */
export function createTestCaseGenerator(options: TestCaseGeneratorOptions): TestCaseGenerator {
  return new TestCaseGenerator(options);
}

/**
 * 快速生成标准测试案例集合
 */
export function generateStandardTestCases(
  processId: string,
  flowchartDocument: FlowchartDocument,
  configCheckResult: ConfigCheckResult,
  workflowConfig?: WorkflowConfig
): TestCase[] {
  const generator = new TestCaseGenerator({
    processId,
    flowchartDocument,
    workflowConfig,
    configCheckResult
  });

  return generator.generateAllCases();
}
