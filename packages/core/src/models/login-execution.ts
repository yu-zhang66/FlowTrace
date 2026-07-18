/**
 * Login Execution Models
 * 
 * 定义登录执行的结果、观察和证据结构
 */

import { z } from 'zod';
import { LoginFinalState } from './scenario.js';

// ============================================================
// Login Evidence Reference
// ============================================================

export const EvidenceRefSchema = z.object({
  /** 证据类型 */
  type: z.enum(['screenshot', 'trace', 'console_log', 'network_request', 'result_json']),
  /** 证据文件路径 */
  path: z.string(),
  /** 证据生成时间 */
  timestamp: z.string().datetime(),
  /** 证据描述 */
  description: z.string().optional()
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

// ============================================================
// Login Error Classification
// ============================================================

export const LoginErrorType = z.enum([
  'INVALID_USERNAME',
  'INVALID_PASSWORD',
  'ACCOUNT_LOCKED',
  'ACCOUNT_DISABLED',
  'NETWORK_ERROR',
  'TIMEOUT',
  'PAGE_NOT_FOUND',
  'ELEMENT_NOT_FOUND',
  'UNKNOWN'
]);
export type LoginErrorType = z.infer<typeof LoginErrorType>;

// ============================================================
// Login Observation
// ============================================================

/**
 * 登录执行观察结果
 */
export const LoginObservationSchema = z.object({
  /** 最终状态 */
  finalState: LoginFinalState,
  /** 语义路径 */
  semanticPath: z.array(z.string()),
  /** 执行后的页面 URL */
  currentUrl: z.string(),
  /** 页面标题 */
  pageTitle: z.string().optional(),
  /** 错误码（如果登录失败） */
  errorCode: LoginErrorType.optional(),
  /** 错误消息（如果登录失败） */
  errorMessage: z.string().optional(),
  /** 错误提示文本（页面可见的） */
  errorHint: z.string().optional(),
  /** 证据引用列表 */
  evidence: z.array(EvidenceRefSchema),
  /** 额外的业务数据 */
  businessData: z.record(z.unknown()).optional(),
  /** 原始错误（如有） */
  rawError: z.string().optional()
});
export type LoginObservation = z.infer<typeof LoginObservationSchema>;

// ============================================================
// Step Execution Result
// ============================================================

/**
 * 单个步骤的执行结果
 */
export const StepExecutionResultSchema = z.object({
  /** 步骤 ID */
  stepId: z.string(),
  /** 业务动作类型 */
  actionType: z.string(),
  /** 执行者 */
  actor: z.string(),
  /** 开始时间 */
  startTime: z.string().datetime(),
  /** 结束时间 */
  endTime: z.string().datetime(),
  /** 执行耗时（毫秒） */
  duration: z.number(),
  /** 是否成功 */
  success: z.boolean(),
  /** 观察结果 */
  observation: LoginObservationSchema.optional(),
  /** 错误消息 */
  error: z.string().optional()
});
export type StepExecutionResult = z.infer<typeof StepExecutionResultSchema>;

// ============================================================
// Login Execution Result
// ============================================================

/**
 * 登录执行结果（单系统执行）
 */
export const LoginExecutionResultSchema = z.object({
  /** 场景 ID */
  scenarioId: z.string(),
  /** 适配器类型 */
  adapter: z.enum(['legacy', 'current']),
  /** 执行模式 */
  mode: z.enum(['single-browser', 'dual-browser']),
  /** 开始时间 */
  startTime: z.string().datetime(),
  /** 结束时间 */
  endTime: z.string().datetime(),
  /** 总耗时（毫秒） */
  totalDuration: z.number(),
  /** 步骤执行结果列表 */
  steps: z.array(StepExecutionResultSchema),
  /** 最终观察结果 */
  finalObservation: LoginObservationSchema,
  /** 是否成功 */
  passed: z.boolean(),
  /** 错误消息 */
  error: z.string().optional()
});
export type LoginExecutionResult = z.infer<typeof LoginExecutionResultSchema>;

// ============================================================
// Login Test Run
// ============================================================

/**
 * 登录测试运行（包含多个场景）
 */
export const LoginTestRunSchema = z.object({
  /** 运行 ID */
  runId: z.string(),
  /** 项目 ID */
  projectId: z.string(),
  /** 流程 ID */
  processId: z.string(),
  /** 执行模式 */
  mode: z.enum(['single-browser', 'dual-browser']),
  /** 是否为 legacy-shadow 模式 */
  isLegacyShadow: z.boolean().default(false),
  /** 开始时间 */
  startTime: z.string().datetime(),
  /** 结束时间 */
  endTime: z.string().datetime(),
  /** 总耗时（毫秒） */
  totalDuration: z.number(),
  /** 场景执行结果 */
  caseResults: z.array(z.object({
    scenarioId: z.string(),
    scenarioName: z.string(),
    legacyResult: LoginExecutionResultSchema.optional(),
    currentResult: LoginExecutionResultSchema.optional(),
    passed: z.boolean(),
    differences: z.array(z.object({
      id: z.string(),
      category: z.string(),
      severity: z.enum(['P0', 'P1', 'P2', 'P3']),
      description: z.string(),
      legacyValue: z.unknown(),
      currentValue: z.unknown(),
      isBlocking: z.boolean()
    })),
    error: z.string().optional()
  })),
  /** 执行摘要 */
  summary: z.object({
    totalCases: z.number(),
    passedCases: z.number(),
    failedCases: z.number(),
    totalSteps: z.number(),
    differencesBySeverity: z.record(z.enum(['P0', 'P1', 'P2', 'P3']), z.number())
  }),
  /** Release Gate 状态 */
  releaseGate: z.object({
    allowed: z.boolean(),
    blockedBy: z.array(z.string())
  }),
  /** 元数据 */
  metadata: z.record(z.unknown()).optional()
});
export type LoginTestRun = z.infer<typeof LoginTestRunSchema>;

// ============================================================
// Login Assertion Functions
// ============================================================

/**
 * 断言结果
 */
export interface LoginAssertionResult {
  passed: boolean;
  expected: string;
  actual: string;
  message: string;
}

/**
 * 断言登录结果与预期匹配
 */
export function assertLoginSuccess(observation: LoginObservation): LoginAssertionResult {
  return {
    passed: observation.finalState === 'AUTHENTICATED',
    expected: 'AUTHENTICATED',
    actual: observation.finalState,
    message: observation.finalState === 'AUTHENTICATED'
      ? 'Login succeeded as expected'
      : `Login failed with: ${observation.errorMessage || observation.errorCode}`
  };
}

/**
 * 断言登录失败与预期匹配
 */
export function assertLoginFailure(
  observation: LoginObservation,
  expectedErrorType?: LoginErrorType
): LoginAssertionResult {
  const isFailed = observation.finalState === 'LOGIN_FAILED';
  const errorTypeMatch = expectedErrorType
    ? observation.errorCode === expectedErrorType
    : true;

  return {
    passed: isFailed && errorTypeMatch,
    expected: expectedErrorType || 'LOGIN_FAILED',
    actual: observation.errorCode || observation.finalState,
    message: isFailed
      ? `Login failed as expected with error: ${observation.errorMessage || observation.errorCode}`
      : `Expected login failure but got: ${observation.finalState}`
  };
}

/**
 * 标准化 semanticPath 用于比较
 */
function normalizeSemanticPath(path: string[]): string {
  return path
    .filter(p => p && p.length > 0)
    .map(p => p.toUpperCase())
    .join(',');
}

/**
 * 断言 semanticPath 匹配
 */
export function assertSemanticPath(
  observation: LoginObservation,
  expectedSemanticPath: string[]
): LoginAssertionResult {
  if (!expectedSemanticPath || expectedSemanticPath.length === 0) {
    return {
      passed: true,
      expected: 'any',
      actual: observation.semanticPath.join(','),
      message: 'No semantic path expectation defined'
    };
  }

  const actualNorm = normalizeSemanticPath(observation.semanticPath);
  const expectedNorm = normalizeSemanticPath(expectedSemanticPath);

  return {
    passed: actualNorm === expectedNorm,
    expected: expectedNorm,
    actual: actualNorm,
    message: actualNorm === expectedNorm
      ? 'Semantic path matches expected'
      : `Semantic path mismatch: expected [${expectedNorm}], got [${actualNorm}]`
  };
}

/**
 * 断言 errorCode 匹配
 */
export function assertErrorCode(
  observation: LoginObservation,
  expectedErrorCode: LoginErrorType | undefined
): LoginAssertionResult {
  if (!expectedErrorCode) {
    return {
      passed: true,
      expected: 'any',
      actual: observation.errorCode || 'undefined',
      message: 'No error code expectation defined'
    };
  }

  return {
    passed: observation.errorCode === expectedErrorCode,
    expected: expectedErrorCode,
    actual: observation.errorCode || 'undefined',
    message: observation.errorCode === expectedErrorCode
      ? `Error code matches: ${expectedErrorCode}`
      : `Error code mismatch: expected ${expectedErrorCode}, got ${observation.errorCode || 'undefined'}`
  };
}

/**
 * 根据 scenario.expected 断言登录结果
 */
export interface ScenarioExpected {
  finalState?: string;
  semanticPath?: string[];
  errorCode?: LoginErrorType;
  errorMessage?: string;
}

export function assertAgainstExpected(
  observation: LoginObservation,
  expected: ScenarioExpected | undefined
): LoginAssertionResult {
  if (!expected) {
    return assertLoginSuccess(observation);
  }

  // 最终状态断言
  if (expected.finalState === 'AUTHENTICATED') {
    const result = assertLoginSuccess(observation);
    if (!result.passed) return result;
  } else if (expected.finalState === 'LOGIN_FAILED') {
    const result = assertLoginFailure(observation, expected.errorCode);
    if (!result.passed) return result;
  } else if (expected.finalState && observation.finalState !== expected.finalState) {
    return {
      passed: false,
      expected: expected.finalState,
      actual: observation.finalState,
      message: `Final state mismatch: expected ${expected.finalState}, got ${observation.finalState}`
    };
  }

  // semanticPath 断言
  if (expected.semanticPath && expected.semanticPath.length > 0) {
    const result = assertSemanticPath(observation, expected.semanticPath);
    if (!result.passed) return result;
  }

  // errorCode 断言
  if (expected.errorCode) {
    const result = assertErrorCode(observation, expected.errorCode);
    if (!result.passed) return result;
  }

  return {
    passed: true,
    expected: JSON.stringify(expected),
    actual: observation.finalState,
    message: 'All expected assertions passed'
  };
}

/**
 * 断言新旧系统登录状态一致性
 */
export function assertAuthStateConsistency(
  legacyObservation: LoginObservation,
  currentObservation: LoginObservation
): LoginAssertionResult {
  const legacyAuth = legacyObservation.finalState === 'AUTHENTICATED';
  const currentAuth = currentObservation.finalState === 'AUTHENTICATED';

  return {
    passed: legacyAuth === currentAuth,
    expected: legacyAuth ? 'Both AUTHENTICATED' : 'Both LOGIN_FAILED',
    actual: `${legacyObservation.finalState} vs ${currentObservation.finalState}`,
    message: legacyAuth === currentAuth
      ? 'Authentication state is consistent between legacy and current'
      : `Authentication state mismatch: legacy=${legacyObservation.finalState}, current=${currentObservation.finalState}`
  };
}

/**
 * 断言错误类型一致性
 */
export function assertErrorConsistency(
  legacyObservation: LoginObservation,
  currentObservation: LoginObservation
): { passed: boolean; errorTypeMatch: boolean; messageMatch: boolean; details: string } {
  const legacyFailed = legacyObservation.finalState === 'LOGIN_FAILED';
  const currentFailed = currentObservation.finalState === 'LOGIN_FAILED';

  if (!legacyFailed || !currentFailed) {
    return {
      passed: true,
      errorTypeMatch: true,
      messageMatch: true,
      details: 'Both succeeded - no error comparison needed'
    };
  }

  const errorTypeMatch = legacyObservation.errorCode === currentObservation.errorCode;

  // Normalize error messages for comparison (ignore dynamic parts like timestamps, IDs)
  const normalizeMessage = (msg: string | undefined): string => {
    if (!msg) return '';
    return msg
      .replace(/\d{10,}/g, '[TIMESTAMP]')
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '[UUID]')
      .replace(/request[_-]?id[:\s]*\w+/gi, '[REQUEST_ID]')
      .trim()
      .toLowerCase();
  };

  const legacyNormMsg = normalizeMessage(legacyObservation.errorMessage);
  const currentNormMsg = normalizeMessage(currentObservation.errorMessage);
  const messageMatch = legacyNormMsg === currentNormMsg;

  return {
    passed: errorTypeMatch && messageMatch,
    errorTypeMatch,
    messageMatch,
    details: errorTypeMatch && messageMatch
      ? 'Error type and message are consistent'
      : `Error mismatch: type=${legacyObservation.errorCode} vs ${currentObservation.errorCode}, message="${legacyNormMsg}" vs "${currentNormMsg}"`
  };
}

/**
 * 从页面文本/错误提示推断错误类型
 */
export function inferErrorType(errorHint: string | undefined, pageTitle: string | undefined): LoginErrorType {
  if (!errorHint && !pageTitle) return 'UNKNOWN';

  const text = `${errorHint || ''} ${pageTitle || ''}`.toLowerCase();

  // 账户锁定/禁用
  if (text.includes('locked') || text.includes('locked out') || text.includes('账户锁定') || text.includes('账号锁定')) {
    return 'ACCOUNT_LOCKED';
  }
  if (text.includes('disabled') || text.includes('账户禁用') || text.includes('账号禁用') || text.includes('account disabled')) {
    return 'ACCOUNT_DISABLED';
  }

  // 用户名错误 (检查更长的模式，避免与 "Invalid" 单独匹配冲突)
  if (
    (text.includes('invalid username')) ||
    (text.includes('invalid') && text.includes('user name')) ||
    (text.includes('user not found')) ||
    (text.includes('unknown user')) ||
    (text.includes('no such user')) ||
    (text.includes('用户名错误')) ||
    (text.includes('用户名不正确')) ||
    (text.includes('用户不存在')) ||
    (text.includes('账号不存在'))
  ) {
    return 'INVALID_USERNAME';
  }

  // 密码错误 (同样检查更长的模式)
  if (
    (text.includes('incorrect password')) ||
    (text.includes('invalid password')) ||
    (text.includes('wrong password')) ||
    (text.includes('password incorrect')) ||
    (text.includes('password mismatch')) ||
    (text.includes('密码错误')) ||
    (text.includes('密码不正确')) ||
    (text.includes('密码不对'))
  ) {
    return 'INVALID_PASSWORD';
  }

  // 通用 "账号或密码错误" - 在没有其他更具体的指示时
  if (text.includes('账号或密码错误') || text.includes('invalid credentials') || text.includes('incorrect credentials')) {
    // 默认归类为密码错误（更常见）
    return 'INVALID_PASSWORD';
  }

  // 超时
  if (text.includes('timeout') || text.includes('超时')) {
    return 'TIMEOUT';
  }

  // 网络错误
  if (text.includes('network') || text.includes('connection') || text.includes('网络') || text.includes('connection refused')) {
    return 'NETWORK_ERROR';
  }

  // 页面不存在
  if (text.includes('not found') || text.includes('404') || text.includes('页面不存在')) {
    return 'PAGE_NOT_FOUND';
  }

  // 元素未找到
  if (text.includes('element') || text.includes('not visible') || text.includes('找不到') || text.includes('selector')) {
    return 'ELEMENT_NOT_FOUND';
  }

  return 'UNKNOWN';
}
