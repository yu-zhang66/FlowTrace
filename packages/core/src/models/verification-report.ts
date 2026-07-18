import { z } from 'zod';
import { 
  ScenarioResultSchema, 
  VerificationSummarySchema, 
  ReleaseGateSchema 
} from './report.js';
import { DifferenceSchema, DifferenceCategory } from './difference.js';
import { DifferenceSeverity } from './execution.js';

/**
 * Verification Report Schema - 测试报告成果物 Schema
 * 
 * 用于描述测试验证报告的完整结构，扩展自 report.ts。
 * 包含配置检查、案例执行结果、账号切换时间线、Release Gate 等信息。
 */

// ============================================================
// Execution Modes
// ============================================================

/**
 * 执行模式枚举
 */
export const ExecutionMode = z.enum([
  'SINGLE_CASE',        // 单案例执行
  'FULL_SUITE',         // 全套执行
  'SELECTED_CASES',     // 选择性执行
  'REGRESSION',         // 回归测试
  'SMOKE_TEST',         // 冒烟测试
  'PARALLEL'           // 并行执行
]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

/**
 * 适配器模式枚举
 */
export const AdapterMode = z.enum([
  'real_adapter',       // 真实适配器
  'mock_adapter',       // Mock 适配器
  'hybrid_adapter'      // 混合模式
]);
export type AdapterMode = z.infer<typeof AdapterMode>;

// ============================================================
// Config Check
// ============================================================

/**
 * 配置检查状态枚举
 */
export const ConfigCheckStatus = z.enum([
  'READY',              // 配置就绪
  'BLOCKED_MISSING_CONFIG'  // 缺少配置
]);
export type ConfigCheckStatus = z.infer<typeof ConfigCheckStatus>;

/**
 * 缺失配置项 Schema
 */
export const MissingConfigItemSchema = z.object({
  /** 配置键 */
  key: z.string(),
  /** 配置类型 */
  type: z.enum(['environment', 'credential', 'feature_flag', 'feature', 'integration', 'database', 'api_key']),
  /** 配置描述 */
  description: z.string(),
  /** 影响的功能模块 */
  affectedModules: z.array(z.string()).optional(),
  /** 影响的案例 ID 列表 */
  affectedCaseIds: z.array(z.string()).optional(),
  /** 严重级别 */
  severity: DifferenceSeverity.optional()
});
export type MissingConfigItem = z.infer<typeof MissingConfigItemSchema>;

/**
 * 配置警告项 Schema
 */
export const ConfigWarningSchema = z.object({
  /** 警告键 */
  key: z.string(),
  /** 警告消息 */
  message: z.string(),
  /** 警告详情 */
  details: z.record(z.unknown()).optional()
});
export type ConfigWarning = z.infer<typeof ConfigWarningSchema>;

/**
 * 配置检查结果 Schema
 */
export const ConfigCheckResultSchema = z.object({
  /** 检查状态 */
  status: ConfigCheckStatus,
  /** 缺失的配置项列表 */
  missing: z.array(MissingConfigItemSchema).optional(),
  /** 警告项列表 */
  warnings: z.array(ConfigWarningSchema).optional(),
  /** 检查时间 */
  checkedAt: z.string().datetime(),
  /** 关联项目 */
  project: z.object({
    projectId: z.string(),
    projectName: z.string().optional(),
    environment: z.string().optional()
  }).optional()
});
export type ConfigCheckResult = z.infer<typeof ConfigCheckResultSchema>;

// ============================================================
// Step Result
// ============================================================

/**
 * 原子步骤结果状态枚举
 */
export const StepResultStatus = z.enum([
  'PASS',
  'FAIL',
  'SKIPPED',
  'BLOCKED',
  'NOT_EXECUTED'
]);
export type StepResultStatus = z.infer<typeof StepResultStatus>;

/**
 * 原子步骤结果 Schema
 * 描述测试案例中单个步骤的执行结果
 */
export const StepResultSchema = z.object({
  /** 步骤 ID */
  stepId: z.string(),
  /** 步骤名称 */
  name: z.string(),
  /** 执行状态 */
  status: StepResultStatus,
  /** 执行时长（毫秒） */
  duration: z.number().optional(),
  /** 截图路径（可选） */
  screenshot: z.string().optional(),
  /** 错误信息（当状态为 FAIL 时） */
  error: z.object({
    code: z.string().optional(),
    message: z.string(),
    stack: z.string().optional(),
    details: z.record(z.unknown()).optional()
  }).optional(),
  /** 实际输出 */
  actualOutput: z.record(z.unknown()).optional(),
  /** 断言结果列表 */
  assertions: z.array(z.object({
    description: z.string(),
    passed: z.boolean(),
    expected: z.unknown().optional(),
    actual: z.unknown().optional()
  })).optional(),
  /** 执行的账号 */
  executedBy: z.string().optional(),
  /** 开始时间 */
  startedAt: z.string().datetime().optional(),
  /** 结束时间 */
  completedAt: z.string().datetime().optional()
});
export type StepResult = z.infer<typeof StepResultSchema>;

// ============================================================
// Account Switch Timeline
// ============================================================

/**
 * 账号切换时间线 Schema
 * 记录测试执行过程中的账号切换事件
 */
export const AccountSwitchTimelineSchema = z.object({
  /** 切换序号 */
  sequence: z.number(),
  /** 源账号 */
  fromAccount: z.string(),
  /** 目标账号 */
  toAccount: z.string(),
  /** 切换时间戳 */
  timestamp: z.string().datetime(),
  /** 上下文是否保留 */
  contextPreserved: z.boolean(),
  /** 切换原因 */
  reason: z.string().optional(),
  /** 切换耗时（毫秒） */
  duration: z.number().optional(),
  /** 切换结果 */
  result: z.enum(['success', 'failed', 'partial']),
  /** 错误信息（当 result 为 failed 时） */
  error: z.string().optional(),
  /** 切换前会话 ID */
  previousSessionId: z.string().optional(),
  /** 切换后会话 ID */
  newSessionId: z.string().optional()
});
export type AccountSwitchTimeline = z.infer<typeof AccountSwitchTimelineSchema>;

// ============================================================
// Screenshots & Traces
// ============================================================

/**
 * 截图元数据 Schema
 */
export const ScreenshotMetadataSchema = z.object({
  /** 截图路径 */
  path: z.string(),
  /** 截图时间 */
  timestamp: z.string().datetime(),
  /** 关联的步骤 ID */
  stepId: z.string().optional(),
  /** 截图类型 */
  type: z.enum(['full_page', 'viewport', 'element', 'error']),
  /** 截图描述 */
  description: z.string().optional()
});
export type ScreenshotMetadata = z.infer<typeof ScreenshotMetadataSchema>;

/**
 * 浏览器追踪 Schema
 */
export const BrowserTraceSchema = z.object({
  /** 追踪类型 */
  type: z.enum(['console', 'network', 'performance', 'error']),
  /** 追踪内容 */
  content: z.record(z.unknown()),
  /** 追踪时间 */
  timestamp: z.string().datetime(),
  /** 关联的步骤 ID */
  stepId: z.string().optional()
});
export type BrowserTrace = z.infer<typeof BrowserTraceSchema>;

// ============================================================
// API Summaries
// ============================================================

/**
 * API 调用摘要 Schema
 */
export const ApiSummarySchema = z.object({
  /** API 路径 */
  path: z.string(),
  /** HTTP 方法 */
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  /** 请求时间 */
  timestamp: z.string().datetime(),
  /** 关联的步骤 ID */
  stepId: z.string().optional(),
  /** 请求头 */
  requestHeaders: z.record(z.string()).optional(),
  /** 请求体（脱敏后） */
  requestBody: z.record(z.unknown()).optional(),
  /** 响应状态码 */
  statusCode: z.number(),
  /** 响应时间（毫秒） */
  responseTime: z.number(),
  /** 响应体大小（字节） */
  responseSize: z.number().optional(),
  /** 响应体摘要 */
  responseSummary: z.record(z.unknown()).optional(),
  /** 是否成功 */
  success: z.boolean()
});
export type ApiSummary = z.infer<typeof ApiSummarySchema>;

// ============================================================
// Database Observations
// ============================================================

/**
 * 数据库前后对比 Schema
 */
export const DatabaseBeforeAfterSchema = z.object({
  /** 表名 */
  tableName: z.string(),
  /** 查询条件 */
  query: z.record(z.unknown()),
  /** 执行时间 */
  timestamp: z.string().datetime(),
  /** 关联的步骤 ID */
  stepId: z.string().optional(),
  /** 操作类型 */
  operation: z.enum(['INSERT', 'UPDATE', 'DELETE', 'SELECT']),
  /** 执行前数据 */
  before: z.array(z.record(z.unknown())).optional(),
  /** 执行后数据 */
  after: z.array(z.record(z.unknown())).optional(),
  /** 受影响行数 */
  affectedRows: z.number().optional()
});
export type DatabaseBeforeAfter = z.infer<typeof DatabaseBeforeAfterSchema>;

// ============================================================
// Case Result
// ============================================================

/**
 * 案例执行结果状态枚举
 */
export const CaseResultStatus = z.enum([
  'PASS',              // 通过
  'FAIL',              // 失败
  'BLOCKED',           // 阻塞
  'NOT_EXECUTED',      // 未执行
  'CONFIG_MISSING'     // 配置缺失
]);
export type CaseResultStatus = z.infer<typeof CaseResultStatus>;

/**
 * 缺失配置详情 Schema
 */
export const MissingConfigDetailsSchema = z.object({
  /** 配置键 */
  key: z.string(),
  /** 配置类型 */
  type: z.string(),
  /** 描述 */
  description: z.string()
});
export type MissingConfigDetails = z.infer<typeof MissingConfigDetailsSchema>;

/**
 * 案例执行结果 Schema
 * 描述单个测试案例的执行结果
 */
export const CaseResultSchema = z.object({
  /** 测试案例 ID */
  caseId: z.string(),
  /** 测试案例名称 */
  caseName: z.string(),
  /** 执行状态 */
  status: CaseResultStatus,
  /** 步骤执行结果列表 */
  steps: z.array(StepResultSchema).optional(),
  /** 账号切换时间线列表 */
  accountSwitchTimeline: z.array(AccountSwitchTimelineSchema).optional(),
  /** 截图元数据列表 */
  screenshots: z.array(ScreenshotMetadataSchema).optional(),
  /** 浏览器追踪列表 */
  browserTraces: z.array(BrowserTraceSchema).optional(),
  /** API 调用摘要列表 */
  apiSummaries: z.array(ApiSummarySchema).optional(),
  /** 数据库前后对比列表 */
  dbBeforeAfter: z.array(DatabaseBeforeAfterSchema).optional(),
  /** 差异列表 */
  differences: z.array(DifferenceSchema).optional(),
  /** 严重级别 */
  severity: DifferenceSeverity.optional(),
  /** 错误详情（当状态为 FAIL 或 BLOCKED 时） */
  errorDetails: z.object({
    code: z.string().optional(),
    message: z.string(),
    stack: z.string().optional(),
    failingStepId: z.string().optional(),
    details: z.record(z.unknown()).optional()
  }).optional(),
  /** 缺失配置详情（当状态为 CONFIG_MISSING 时） */
  missingConfigDetails: z.array(MissingConfigDetailsSchema).optional(),
  /** 执行开始时间 */
  startedAt: z.string().datetime().optional(),
  /** 执行结束时间 */
  completedAt: z.string().datetime().optional(),
  /** 执行时长（毫秒） */
  duration: z.number().optional(),
  /** 执行环境 */
  environment: z.string().optional()
});
export type CaseResult = z.infer<typeof CaseResultSchema>;

// ============================================================
// Release Gate Status
// ============================================================

/**
 * Release Gate 状态 Schema
 * 描述 Release Gate 的最终状态
 */
export const ReleaseGateStatusSchema = z.object({
  /** 通过状态 */
  status: z.enum(['PASS', 'FAIL', 'WARNING', 'SKIPPED']),
  /** 阻塞性差异列表 */
  blockingDifferences: z.array(z.object({
    differenceId: z.string(),
    scenarioId: z.string().optional(),
    caseId: z.string().optional(),
    category: DifferenceCategory,
    severity: DifferenceSeverity,
    description: z.string()
  })).optional(),
  /** 消息 */
  message: z.string().optional(),
  /** 通过率 */
  passRate: z.number().optional(),
  /** 建议 */
  recommendations: z.array(z.string()).optional()
});
export type ReleaseGateStatus = z.infer<typeof ReleaseGateStatusSchema>;

// ============================================================
// Complete Verification Report
// ============================================================

/**
 * 报告元数据 Schema
 */
export const VerificationReportMetadataSchema = z.object({
  /** 项目名称 */
  projectName: z.string(),
  /** 流程名称 */
  processName: z.string().optional(),
  /** 执行时间 */
  executedAt: z.string().datetime(),
  /** 执行模式 */
  executionMode: ExecutionMode,
  /** 适配器模式 */
  adapterMode: AdapterMode.optional(),
  /** 执行环境 */
  environment: z.string().optional(),
  /** 执行者 */
  executor: z.string().optional(),
  /** 测试框架版本 */
  testFrameworkVersion: z.string().optional()
});
export type VerificationReportMetadata = z.infer<typeof VerificationReportMetadataSchema>;

/**
 * 遗留影子警告 Schema
 * 当 Legacy Shadow 模式存在时可能产生警告
 */
export const LegacyShadowWarningSchema = z.object({
  /** 警告类型 */
  type: z.enum([
    'shadow_mode_enabled',
    'legacy_comparison_skipped',
    'missing_baseline',
    'adapter_mismatch'
  ]),
  /** 警告消息 */
  message: z.string(),
  /** 影响范围 */
  affectedCases: z.array(z.string()).optional(),
  /** 建议 */
  recommendation: z.string().optional()
});
export type LegacyShadowWarning = z.infer<typeof LegacyShadowWarningSchema>;

/**
 * 完整验证报告 Schema
 */
export const VerificationReportSchema = z.object({
  /** Schema 版本号 */
  schemaVersion: z.string().default('1.0'),
  /** 报告元数据 */
  metadata: VerificationReportMetadataSchema,
  /** 配置检查结果 */
  configCheck: ConfigCheckResultSchema,
  /** 总案例数 */
  totalCases: z.number(),
  /** 通过数 */
  passed: z.number(),
  /** 失败数 */
  failed: z.number(),
  /** 阻塞数 */
  blocked: z.number(),
  /** 未执行数 */
  notExecuted: z.number(),
  /** 案例执行结果列表 */
  caseResults: z.array(CaseResultSchema),
  /** Release Gate 状态 */
  releaseGate: ReleaseGateStatusSchema,
  /** 遗留影子警告（可选） */
  legacyShadowWarning: LegacyShadowWarningSchema.optional(),
  /** 额外元数据 */
  metadataExtra: z.record(z.unknown()).optional()
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;

// ============================================================
// Validation Functions
// ============================================================

/**
 * 验证报告统计一致性
 */
export function validateReportStatistics(report: VerificationReport): string[] {
  const errors: string[] = [];
  
  const actualTotal = report.caseResults.length;
  if (actualTotal !== report.totalCases) {
    errors.push(`totalCases mismatch: expected ${actualTotal}, got ${report.totalCases}`);
  }
  
  let actualPassed = 0;
  let actualFailed = 0;
  let actualBlocked = 0;
  let actualNotExecuted = 0;
  
  for (const result of report.caseResults) {
    switch (result.status) {
      case 'PASS':
        actualPassed++;
        break;
      case 'FAIL':
        actualFailed++;
        break;
      case 'BLOCKED':
        actualBlocked++;
        break;
      case 'NOT_EXECUTED':
      case 'CONFIG_MISSING':
        actualNotExecuted++;
        break;
    }
  }
  
  if (actualPassed !== report.passed) {
    errors.push(`passed count mismatch: expected ${actualPassed}, got ${report.passed}`);
  }
  if (actualFailed !== report.failed) {
    errors.push(`failed count mismatch: expected ${actualFailed}, got ${report.failed}`);
  }
  if (actualBlocked !== report.blocked) {
    errors.push(`blocked count mismatch: expected ${actualBlocked}, got ${report.blocked}`);
  }
  if (actualNotExecuted !== report.notExecuted) {
    errors.push(`notExecuted count mismatch: expected ${actualNotExecuted}, got ${report.notExecuted}`);
  }
  
  return errors;
}

/**
 * 验证 Release Gate 阻塞项
 */
export function validateReleaseGateBlockers(report: VerificationReport): string[] {
  const errors: string[] = [];
  
  if (report.releaseGate.status === 'PASS' && report.releaseGate.blockingDifferences?.length) {
    errors.push('Release Gate status is PASS but blockingDifferences is not empty');
  }
  
  if (report.releaseGate.status === 'FAIL' && !report.releaseGate.blockingDifferences?.length) {
    errors.push('Release Gate status is FAIL but blockingDifferences is empty');
  }
  
  return errors;
}

/**
 * 验证验证报告完整性
 */
export function validateVerificationReport(data: unknown): {
  valid: boolean;
  errors?: string[];
} {
  const result = VerificationReportSchema.safeParse(data);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    };
  }
  
  const report = result.data;
  const errors: string[] = [];
  
  errors.push(...validateReportStatistics(report));
  errors.push(...validateReleaseGateBlockers(report));
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true };
}
