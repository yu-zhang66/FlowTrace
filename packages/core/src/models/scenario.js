import { z } from 'zod';
// ============================================================
// Business Action Types
// ============================================================
export const BusinessActionType = z.enum([
    'CREATE',
    'SUBMIT',
    'APPROVE',
    'REJECT',
    'RETURN',
    'WITHDRAW',
    'TRANSFER',
    'COUNTERSIGN',
    'COUNTERSIGN_COMPLETE',
    'LOGIN'
]);
// ============================================================
// Login Credential Reference
// ============================================================
/**
 * 登录凭据引用 - 用于引用环境变量或密钥管理中的凭据
 * 禁止在 scenario 中直接写入明文密码
 */
export const CredentialRefSchema = z.object({
    /** 环境变量名或密钥 ID */
    ref: z.string().min(1).describe('环境变量名或密钥引用'),
    /** 可选的描述信息 */
    description: z.string().optional()
});
// ============================================================
// Login Input Schema
// ============================================================
/**
 * 登录输入 - 支持引用方式提供凭据
 */
export const LoginInputSchema = z.object({
    /** 用户名引用（环境变量名） */
    usernameRef: z.string().min(1).describe('用户名环境变量名'),
    /** 密码引用（环境变量名） */
    passwordRef: z.string().min(1).describe('密码环境变量名'),
    /** 可选的域名/租户标识 */
    domain: z.string().optional(),
    /** 可选的记住登录状态 */
    rememberMe: z.boolean().optional()
});
// ============================================================
// Login Final State
// ============================================================
export const LoginFinalState = z.enum(['AUTHENTICATED', 'LOGIN_FAILED']);
export const ScenarioActionSchema = z.object({
    type: BusinessActionType,
    actor: z.string(),
    data: z.record(z.unknown()).optional(),
    timestamp: z.string().datetime().optional()
});
export const ExpectedResultSchema = z.object({
    finalState: z.string(),
    expectError: z.boolean().optional(),
    semanticPath: z.array(z.string()).optional(),
    database: z.record(z.unknown()).optional(),
    externalCalls: z.array(z.record(z.unknown())).optional(),
    notifications: z.array(z.record(z.unknown())).optional(),
    auditRecords: z.array(z.record(z.unknown())).optional()
});
export const ScenarioReviewStatus = z.enum(['NEEDS_REVIEW', 'CONFIRMED']);
export const ScenarioReviewSchema = z.object({
    status: ScenarioReviewStatus.optional(),
    unmappedSteps: z.array(z.string()).default([]),
    reason: z.string().optional(),
    warnings: z.array(z.string()).default([])
});
export const ScenarioSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    process: z.string().min(1),
    severity: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
    source: z.array(z.string()).optional(),
    precondition: z.record(z.unknown()).optional(),
    input: z.record(z.unknown()).optional(),
    actions: z.array(ScenarioActionSchema).min(1),
    expected: ExpectedResultSchema,
    tags: z.array(z.string()).optional(),
    status: ScenarioReviewStatus.optional(),
    review: ScenarioReviewSchema.optional(),
    enabled: z.boolean().default(true)
});
/**
 * Sensitive field patterns that should not appear in plaintext in scenarios
 */
const SENSITIVE_FIELD_PATTERNS = [
    'password',
    'passwd',
    'pwd',
    'secret',
    'token',
    'apikey',
    'api_key',
    'auth',
    'credential',
    'private_key',
    'access_key'
];
/**
 * Check if a field name is sensitive
 */
function isSensitiveField(fieldName) {
    const lower = fieldName.toLowerCase();
    return SENSITIVE_FIELD_PATTERNS.some(pattern => lower.includes(pattern));
}
/**
 * Validate a LOGIN action's data for security compliance
 */
function validateLoginAction(action) {
    const errors = [];
    // LOGIN action must have an actor
    if (!action.actor || action.actor.trim() === '') {
        errors.push(`LOGIN action requires an actor`);
    }
    // Check data object
    if (action.data) {
        // Must use usernameRef/passwordRef
        if (!action.data.usernameRef && !action.data.username) {
            errors.push(`LOGIN action data must have usernameRef or username`);
        }
        if (!action.data.passwordRef && !action.data.password) {
            errors.push(`LOGIN action data must have passwordRef or password`);
        }
        // Reject plaintext sensitive fields
        const dataKeys = Object.keys(action.data);
        for (const key of dataKeys) {
            if (isSensitiveField(key)) {
                // Check if it's a Ref pattern (safe)
                if (key.endsWith('Ref') || key.endsWith('Path') || key.endsWith('Id')) {
                    continue;
                }
                // Direct password/token without Ref is forbidden
                if (!action.data[key]?.toString().startsWith('$') &&
                    !action.data[key]?.toString().startsWith('env:') &&
                    !action.data[key]?.toString().startsWith('secret:')) {
                    errors.push(`LOGIN action data contains plaintext sensitive field: ${key}`);
                }
            }
        }
    }
    return errors;
}
/**
 * Validate a scenario for correctness and security
 */
export function validateScenario(data) {
    const result = ScenarioSchema.safeParse(data);
    if (!result.success) {
        return {
            valid: false,
            errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
        };
    }
    const scenario = result.data;
    const errors = [];
    // Validate LOGIN actions
    for (let i = 0; i < scenario.actions.length; i++) {
        const action = scenario.actions[i];
        if (action.type === 'LOGIN') {
            const loginErrors = validateLoginAction(action);
            errors.push(...loginErrors.map(e => `actions[${i}]: ${e}`));
        }
    }
    // For LOGIN scenarios, validate expected result
    const hasLoginAction = scenario.actions.some(a => a.type === 'LOGIN');
    if (hasLoginAction) {
        const validFinalStates = ['AUTHENTICATED', 'LOGIN_FAILED', 'PENDING', 'UNKNOWN'];
        if (scenario.expected.finalState && !validFinalStates.includes(scenario.expected.finalState)) {
            errors.push(`Login scenario expected.finalState should be AUTHENTICATED or LOGIN_FAILED`);
        }
        // Validate semanticPath for login
        if (scenario.expected.semanticPath && scenario.expected.semanticPath.length > 0) {
            const path = scenario.expected.semanticPath;
            if (!path.includes('LOGIN') && !path.includes('AUTHENTICATED') && !path.includes('LOGIN_FAILED')) {
                errors.push(`Login scenario expected.semanticPath should include LOGIN, AUTHENTICATED, or LOGIN_FAILED`);
            }
        }
    }
    if (errors.length > 0) {
        return { valid: false, errors };
    }
    return { valid: true };
}
/**
 * Validate that a scenario has no plaintext secrets
 */
export function validateNoPlaintextSecrets(data) {
    const jsonStr = JSON.stringify(data);
    const violations = [];
    // Check for common secret patterns in plain text
    const secretPatterns = [
        { pattern: /password["\s]*:\s*["'][^$][^'"]+['"]/gi, name: 'password' },
        { pattern: /pwd["\s]*:\s*["'][^$][^'"]+['"]/gi, name: 'pwd' },
        { pattern: /token["\s]*:\s*["'][^$][^'"]+['"]/gi, name: 'token' },
        { pattern: /secret["\s]*:\s*["'][^$][^'"]+['"]/gi, name: 'secret' },
        { pattern: /api_key["\s]*:\s*["'][^$][^'"]+['"]/gi, name: 'api_key' }
    ];
    for (const { pattern, name } of secretPatterns) {
        const matches = jsonStr.match(pattern);
        if (matches) {
            violations.push(`Found plaintext ${name} in scenario`);
        }
    }
    if (violations.length > 0) {
        return { valid: false, violations };
    }
    return { valid: true };
}
//# sourceMappingURL=scenario.js.map