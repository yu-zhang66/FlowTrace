import { z } from 'zod';
import { CredentialRefSchema } from './scenario.js';

/**
 * Test Case Schema - 测试案例成果物 Schema
 * 
 * 用于描述测试案例的完整结构，扩展自 scenario.ts。
 * 包含原子步骤、账号切换、业务状态、预期结果等完整测试案例信息。
 */

// ============================================================
// Constants
// ============================================================

/**
 * 需要确认的项目标记
 */
export const PENDING_CONFIRMATION = 'PENDING_CONFIRMATION';

/**
 * 未确认的项目标记
 */
export const UNCONFIRMED = 'UNCONFIRMED';

// ============================================================
// Case Type Enum
// ============================================================

/**
 * 测试案例类型枚举
 * 描述测试案例要验证的业务场景类型
 */
export const CaseType = z.enum([
  'FULL_PATH_PASS',                    // 全节点通过
  'FIRST_REJECT',                      // 第一个拒绝
  'INTERMEDIATE_REJECT',               // 中间拒绝
  'FINAL_REJECT',                      // 最终拒绝
  'FIRST_RETURN',                      // 第一个退回
  'INTERMEDIATE_RETURN',               // 中间退回
  'FINAL_RETURN',                      // 最终退回
  'RETURN_SUPPLEMENT',                 // 退回后补件
  'TRANSFER',                          // 转交
  'COSIGN_ALL_PASS',                   // 会签全部通过
  'COSIGN_PARTIAL_INCOMPLETE',         // 会签部分未完成
  'COSIGN_ONE_REJECT',                 // 会签一人拒绝
  'UNAUTHORIZED_ATTEMPT',              // 无权限尝试
  'DUPLICATE_APPROVAL_HANDLED',        // 已处理重复审批
  'TIMEOUT_AUTO_COMPLETE',             // 超时自动完成
  'BULK_OPERATION',                    // 批量操作
  'BATCH_APPROVE',                     // 批量审批
  'DELEGATION',                        // 委托
  'ESCALATION'                         // 升级
]);
export type CaseType = z.infer<typeof CaseType>;

// ============================================================
// Account Types
// ============================================================

/**
 * 账号类型枚举
 */
export const AccountType = z.enum([
  'INITIATOR',        // 发起人
  'APPROVER',         // 审批人
  'COUNTER_SIGNER',   // 会签人
  'FINAL_APPROVER',   // 最终审批人
  'ADMIN',           // 管理员
  'VIEWER',          // 查看者
  'AUDITOR'          // 审计员
]);
export type AccountType = z.infer<typeof AccountType>;

// ============================================================
// Evidence Types
// ============================================================

/**
 * 证据类型枚举
 */
export const TestEvidenceType = z.enum([
  'screenshot',
  'api_request',
  'api_response',
  'database_query',
  'database_result',
  'browser_console',
  'network_trace',
  'log_entry',
  'file_upload',
  'file_download',
  'email_notification',
  'sms_notification'
]);
export type TestEvidenceType = z.infer<typeof TestEvidenceType>;

// ============================================================
// Failure Policy
// ============================================================

/**
 * 失败策略枚举
 * 描述步骤失败时的处理策略
 */
export const FailurePolicy = z.enum([
  'STOP',           // 停止执行，后续步骤不再执行
  'SKIP',           // 跳过，继续执行下一步
  'RETRY',          // 重试
  'FALLBACK',      // 使用备用方案
  'ABORT'           // 中止整个测试
]);
export type FailurePolicy = z.infer<typeof FailurePolicy>;

// ============================================================
// Account Switch Step
// ============================================================

/**
 * 账号切换步骤 Schema
 * 描述完整的15步账号切换协议
 */
export const AccountSwitchStepSchema = z.object({
  /** 切换类型 */
  type: z.literal('ACCOUNT_SWITCH'),
  /** 切换步骤 ID */
  stepId: z.string().min(1),
  /** 切换步骤名称 */
  name: z.string().min(1),
  /** 源账号引用 */
  fromAccount: z.string().min(1),
  /** 目标账号引用 */
  toAccount: z.string().min(1),
  /** 切换原因 */
  reason: z.string().optional(),
  /** 步骤序列：1. 记录当前会话上下文 */
  step1_recordContext: z.object({
    sessionState: z.record(z.unknown()),
    currentUrl: z.string().optional(),
    localStorage: z.record(z.unknown()).optional(),
    sessionStorage: z.record(z.unknown()).optional(),
    cookies: z.record(z.unknown()).optional()
  }),
  /** 步骤序列：2. 截图当前状态 */
  step2_captureCurrentState: z.object({
    screenshot: z.string().optional(),
    pageSource: z.string().optional(),
    consoleLogs: z.array(z.string()).optional()
  }),
  /** 步骤序列：3. 验证源账号登出能力 */
  step3_verifyLogoutAbility: z.boolean(),
  /** 步骤序列：4. 执行登出操作 */
  step4_executeLogout: z.object({
    method: z.enum(['ui_button', 'api_call', 'clear_session', 'force_expire']),
    endpoint: z.string().optional(),
    success: z.boolean()
  }),
  /** 步骤序列：5. 验证登出完成 */
  step5_verifyLogoutComplete: z.object({
    sessionCleared: z.boolean(),
    cookiesCleared: z.boolean(),
    redirectedToLogin: z.boolean().optional()
  }),
  /** 步骤序列：6. 保存目标账号凭据 */
  step6_saveTargetCredentials: z.object({
    credentialRef: CredentialRefSchema,
    credentialsValid: z.boolean()
  }),
  /** 步骤序列：7. 执行登录操作 */
  step7_executeLogin: z.object({
    method: z.enum(['ui_form', 'api_call', 'sso', 'oauth']),
    endpoint: z.string().optional(),
    success: z.boolean()
  }),
  /** 步骤序列：8. 验证登录成功 */
  step8_verifyLoginSuccess: z.object({
    authenticated: z.boolean(),
    redirectUrl: z.string().optional(),
    sessionId: z.string().optional()
  }),
  /** 步骤序列：9. 恢复必要上下文 */
  step9_restoreContext: z.object({
    restoredLocalStorage: z.record(z.unknown()).optional(),
    restoredSessionStorage: z.record(z.unknown()).optional(),
    restoredCookies: z.record(z.unknown()).optional(),
    navigationState: z.string().optional()
  }),
  /** 步骤序列：10. 验证会话状态 */
  step10_verifySessionState: z.object({
    newSessionId: z.string(),
    userInfo: z.object({
      userId: z.string(),
      username: z.string(),
      roles: z.array(z.string())
    }),
    permissions: z.array(z.string())
  }),
  /** 步骤序列：11. 验证权限正确 */
  step11_verifyPermissions: z.object({
    canView: z.boolean(),
    canEdit: z.boolean(),
    canApprove: z.boolean(),
    allowedResources: z.array(z.string()).optional(),
    deniedResources: z.array(z.string()).optional()
  }),
  /** 步骤序列：12. 验证导航到目标页面 */
  step12_verifyNavigation: z.object({
    currentUrl: z.string(),
    expectedUrlPattern: z.string(),
    matched: z.boolean()
  }),
  /** 步骤序列：13. 验证 UI 元素状态 */
  step13_verifyUIElements: z.object({
    elements: z.array(z.object({
      selector: z.string(),
      visible: z.boolean(),
      enabled: z.boolean(),
      value: z.unknown().optional()
    }))
  }),
  /** 步骤序列：14. 记录会话映射 */
  step14_recordSessionMapping: z.object({
    originalSessionId: z.string().optional(),
    newSessionId: z.string(),
    switchTimestamp: z.string().datetime(),
    contextPreserved: z.boolean()
  }),
  /** 步骤序列：15. 验证业务流程上下文 */
  step15_verifyBusinessContext: z.object({
    businessEntity: z.string().optional(),
    currentState: z.string().optional(),
    availableActions: z.array(z.string()),
    canProceed: z.boolean()
  })
});
export type AccountSwitchStep = z.infer<typeof AccountSwitchStepSchema>;

// ============================================================
// Test Case Step
// ============================================================

/**
 * 测试案例步骤 Schema
 * 描述测试案例中的原子步骤
 */
export const TestCaseStepSchema = z.object({
  /** 步骤 ID */
  stepId: z.string().min(1),
  /** 步骤名称 */
  name: z.string().min(1),
  /** 账号引用 */
  accountRef: z.string().optional(),
  /** 账号类型 */
  accountType: AccountType.optional(),
  /** 是否需要登录 */
  loginRequired: z.boolean().default(false),
  /** 菜单路径 */
  menu: z.array(z.string()).optional(),
  /** 页面或 API 路径 */
  pageOrApi: z.object({
    type: z.enum(['page', 'api']),
    path: z.string(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional()
  }).optional(),
  /** 操作类型 */
  operation: z.enum([
    'view',
    'create',
    'update',
    'delete',
    'submit',
    'approve',
    'reject',
    'return',
    'withdraw',
    'transfer',
    'delegate',
    'upload',
    'download',
    'search',
    'filter',
    'export',
    'import'
  ]),
  /** 输入数据 */
  input: z.record(z.unknown()).optional(),
  /** 输入上下文 */
  contextIn: z.record(z.unknown()).optional(),
  /** 输出上下文 */
  contextOut: z.record(z.unknown()).optional(),
  /** 预期 UI 结果 */
  expectedUiResult: z.object({
    pageLoaded: z.boolean().optional(),
    urlPattern: z.string().optional(),
    elements: z.array(z.object({
      selector: z.string(),
      shouldExist: z.boolean(),
      shouldBeVisible: z.boolean().optional(),
      shouldHaveValue: z.unknown().optional()
    })).optional(),
    messages: z.array(z.object({
      type: z.enum(['success', 'error', 'warning', 'info']),
      contains: z.string()
    })).optional()
  }).optional(),
  /** 预期 API 结果 */
  expectedApiResult: z.object({
    statusCode: z.number(),
    responseContains: z.record(z.unknown()).optional(),
    responseTime: z.object({
      max: z.number(),
      unit: z.enum(['ms', 's'])
    }).optional()
  }).optional(),
  /** 数据库断言 */
  databaseAssertions: z.array(z.object({
    tableName: z.string(),
    query: z.record(z.unknown()),
    assertions: z.array(z.object({
      field: z.string(),
      operator: z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'in', 'contains', 'exists']),
      value: z.unknown()
    }))
  })).optional(),
  /** 证据类型列表 */
  evidence: z.array(TestEvidenceType).optional(),
  /** 失败策略 */
  failurePolicy: FailurePolicy.default('STOP'),
  /** 下一个步骤 ID */
  nextStep: z.string().optional(),
  /** 账号切换信息 */
  accountSwitch: z.object({
    targetAccount: z.string(),
    reason: z.string().optional()
  }).optional()
});
export type TestCaseStep = z.infer<typeof TestCaseStepSchema>;

// ============================================================
// Required Resources
// ============================================================

/**
 * 所需企业账号 Schema
 */
export const RequiredEnterpriseSchema = z.object({
  enterpriseId: z.string(),
  enterpriseName: z.string().optional(),
  accountType: z.enum(['primary', 'secondary']).optional()
});
export type RequiredEnterprise = z.infer<typeof RequiredEnterpriseSchema>;

/**
 * 所需额度 Schema
 */
export const RequiredCreditSchema = z.object({
  creditType: z.enum(['loan', 'credit_line', 'card_credit']),
  amount: z.number().positive(),
  currency: z.string().default('CNY')
});
export type RequiredCredit = z.infer<typeof RequiredCreditSchema>;

// ============================================================
// Expected Results
// ============================================================

/**
 * 预期业务状态
 */
export const ExpectedBusinessStateSchema = z.object({
  stateKey: z.string(),
  stateValue: z.unknown(),
  description: z.string().optional()
});
export type ExpectedBusinessState = z.infer<typeof ExpectedBusinessStateSchema>;

/**
 * 预期流程状态
 */
export const ExpectedFlowStateSchema = z.object({
  nodeId: z.string().optional(),
  nodeName: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'returned', 'withdrawn', 'transferred']),
  timestamp: z.string().datetime().optional()
});
export type ExpectedFlowState = z.infer<typeof ExpectedFlowStateSchema>;

/**
 * 预期审批历史
 */
export const ExpectedApprovalHistorySchema = z.object({
  approver: z.string(),
  action: z.enum(['approved', 'rejected', 'returned', 'transferred', 'delegated']),
  timestamp: z.string().datetime().optional(),
  comments: z.string().optional(),
  nodeId: z.string().optional()
});
export type ExpectedApprovalHistory = z.infer<typeof ExpectedApprovalHistorySchema>;

/**
 * 预期流程后状态
 */
export const ExpectedPostFlowSchema = z.object({
  flowStatus: z.enum(['completed', 'terminated', 'archived']),
  finalState: z.string(),
  downstreamEffects: z.array(z.object({
    effectType: z.string(),
    targetSystem: z.string().optional(),
    details: z.record(z.unknown())
  })).optional()
});
export type ExpectedPostFlow = z.infer<typeof ExpectedPostFlowSchema>;

// ============================================================
// Data Cleanup Strategy
// ============================================================

/**
 * 数据清理策略
 */
export const DataCleanupStrategySchema = z.object({
  enabled: z.boolean().default(true),
  cleanupOrder: z.array(z.enum([
    'database',
    'file_storage',
    'cache',
    'external_systems',
    'audit_logs'
  ])),
  cleanupActions: z.array(z.object({
    target: z.enum(['table', 'file', 'cache_key', 'external_api']),
    identifier: z.string(),
    query: z.record(z.unknown()).optional()
  })),
  verifyCleanup: z.boolean().default(true)
});
export type DataCleanupStrategy = z.infer<typeof DataCleanupStrategySchema>;

// ============================================================
// Workflow Node Status
// ============================================================

/**
 * 工作流节点状态
 */
export const WorkflowNodeStatusSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  status: z.enum(['not_reached', 'in_progress', 'completed', 'skipped', 'failed']),
  enteredAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  assignee: z.string().optional()
});
export type WorkflowNodeStatus = z.infer<typeof WorkflowNodeStatusSchema>;

// ============================================================
// Complete Test Case
// ============================================================

/**
 * 测试案例 Schema
 * 完整的测试案例定义
 */
export const TestCaseSchema = z.object({
  /** 测试案例 ID */
  id: z.string().min(1),
  /** 测试案例名称 */
  name: z.string().min(1),
  /** 测试案例类型 */
  type: CaseType,
  /** 测试目的描述 */
  purpose: z.string(),
  /** 前置条件 */
  precondition: z.record(z.unknown()).optional(),
  /** 所需账号列表 */
  requiredAccounts: z.array(z.object({
    accountRef: z.string(),
    accountType: AccountType,
    description: z.string().optional(),
    permissions: z.array(z.string()).optional()
  })).min(1),
  /** 所需企业账号 */
  requiredEnterprise: RequiredEnterpriseSchema.optional(),
  /** 所需额度 */
  requiredCredit: RequiredCreditSchema.optional(),
  /** 所需合同列表 */
  requiredContracts: z.array(z.object({
    contractId: z.string(),
    contractType: z.string().optional()
  })).optional(),
  /** 所需方案列表 */
  requiredPlans: z.array(z.object({
    planId: z.string(),
    planType: z.string().optional()
  })).optional(),
  /** 所需文档列表 */
  requiredDocuments: z.array(z.object({
    documentId: z.string(),
    documentType: z.string().optional()
  })).optional(),
  /** 所需文件列表 */
  requiredFiles: z.array(z.object({
    fileId: z.string(),
    fileType: z.string().optional(),
    fileSize: z.number().optional()
  })).optional(),
  /** 测试步骤列表 */
  steps: z.array(z.union([TestCaseStepSchema, AccountSwitchStepSchema])),
  /** 预期业务状态 */
  expectedBusinessState: z.array(ExpectedBusinessStateSchema).optional(),
  /** 预期流程状态 */
  expectedFlowState: ExpectedFlowStateSchema.optional(),
  /** 预期审批历史 */
  expectedApprovalHistory: z.array(ExpectedApprovalHistorySchema).optional(),
  /** 预期流程后状态 */
  expectedPostFlow: ExpectedPostFlowSchema.optional(),
  /** 失败时的终止状态 */
  failureTerminalState: z.enum([
    'cancelled',
    'rejected',
    'withdrawn',
    'expired',
    'error'
  ]).optional(),
  /** 数据清理策略 */
  dataCleanupStrategy: DataCleanupStrategySchema.optional(),
  /** 工作流节点状态列表 */
  workflowNodeStatus: z.array(WorkflowNodeStatusSchema).optional(),
  /** 是否可执行 */
  executable: z.boolean().default(true),
  /** 来源状态 */
  sourceStatus: z.enum(['AUTO_GENERATED', 'MANUALLY_CREATED', 'DERIVED', 'PENDING_CONFIRMATION']),
  /** 严重级别 */
  severity: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  /** 标签 */
  tags: z.array(z.string()).optional(),
  /** 来源场景 ID（如果从场景派生） */
  sourceScenarioId: z.string().optional(),
  /** 关联流程 ID */
  flowId: z.string().optional(),
  /** 关联节点 ID 列表 */
  relatedNodeIds: z.array(z.string()).optional()
});
export type TestCase = z.infer<typeof TestCaseSchema>;

// ============================================================
// Validation Functions
// ============================================================

/**
 * 验证步骤引用
 */
export function validateStepReferences(testCase: TestCase): string[] {
  const errors: string[] = [];
  const stepIds = new Set(testCase.steps.map(s => s.stepId));
  
  for (const step of testCase.steps) {
    if ('nextStep' in step && step.nextStep && !stepIds.has(step.nextStep)) {
      errors.push(`step "${step.stepId}" references undefined nextStep: ${step.nextStep}`);
    }
  }
  
  return errors;
}

/**
 * 验证账号切换步骤完整性
 */
export function validateAccountSwitchStep(step: AccountSwitchStep): string[] {
  const errors: string[] = [];
  
  if (!step.step1_recordContext) {
    errors.push('account switch step missing step1_recordContext');
  }
  if (!step.step2_captureCurrentState) {
    errors.push('account switch step missing step2_captureCurrentState');
  }
  if (step.step3_verifyLogoutAbility === undefined) {
    errors.push('account switch step missing step3_verifyLogoutAbility');
  }
  if (!step.step4_executeLogout) {
    errors.push('account switch step missing step4_executeLogout');
  }
  if (!step.step5_verifyLogoutComplete) {
    errors.push('account switch step missing step5_verifyLogoutComplete');
  }
  if (!step.step6_saveTargetCredentials) {
    errors.push('account switch step missing step6_saveTargetCredentials');
  }
  if (!step.step7_executeLogin) {
    errors.push('account switch step missing step7_executeLogin');
  }
  if (!step.step8_verifyLoginSuccess) {
    errors.push('account switch step missing step8_verifyLoginSuccess');
  }
  if (!step.step9_restoreContext) {
    errors.push('account switch step missing step9_restoreContext');
  }
  if (!step.step10_verifySessionState) {
    errors.push('account switch step missing step10_verifySessionState');
  }
  if (!step.step11_verifyPermissions) {
    errors.push('account switch step missing step11_verifyPermissions');
  }
  if (!step.step12_verifyNavigation) {
    errors.push('account switch step missing step12_verifyNavigation');
  }
  if (!step.step13_verifyUIElements) {
    errors.push('account switch step missing step13_verifyUIElements');
  }
  if (!step.step14_recordSessionMapping) {
    errors.push('account switch step missing step14_recordSessionMapping');
  }
  if (!step.step15_verifyBusinessContext) {
    errors.push('account switch step missing step15_verifyBusinessContext');
  }
  
  return errors;
}

/**
 * 验证测试案例完整性
 */
export function validateTestCase(data: unknown): {
  valid: boolean;
  errors?: string[];
} {
  const result = TestCaseSchema.safeParse(data);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    };
  }
  
  const testCase = result.data;
  const errors: string[] = [];
  
  errors.push(...validateStepReferences(testCase));
  
  for (const step of testCase.steps) {
    if ('type' in step && step.type === 'ACCOUNT_SWITCH') {
      errors.push(...validateAccountSwitchStep(step));
    }
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true };
}
