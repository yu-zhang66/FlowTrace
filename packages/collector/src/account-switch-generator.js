/**
 * Account Switch Generator
 *
 * 为测试案例生成完整的15步账号切换协议步骤。
 * 确保会话隔离、上下文保留、权限验证等关键环节的完整性。
 */
import { AccountSwitchStepSchema } from '@flowtrace/core';
// ============================================================
// Constants
// ============================================================
/**
 * 账号切换协议步骤名称映射
 */
const STEP_NAMES = {
    1: '记录当前会话上下文',
    2: '截图当前状态',
    3: '验证源账号登出能力',
    4: '执行登出操作',
    5: '验证登出完成',
    6: '保存目标账号凭据',
    7: '执行登录操作',
    8: '验证登录成功',
    9: '恢复必要上下文',
    10: '验证会话状态',
    11: '验证权限正确',
    12: '验证导航到目标页面',
    13: '验证 UI 元素状态',
    14: '记录会话映射',
    15: '验证业务流程上下文'
};
/**
 * 默认登出方法
 */
const DEFAULT_LOGOUT_METHOD = 'ui_button';
/**
 * 默认登录方法
 */
const DEFAULT_LOGIN_METHOD = 'ui_form';
// ============================================================
// AccountSwitchGenerator Class
// ============================================================
/**
 * 账号切换步骤生成器
 *
 * 生成符合 AccountSwitchStepSchema 的完整15步账号切换协议。
 * 支持上下文保留、会话隔离、权限验证等关键环节。
 */
export class AccountSwitchGenerator {
    stepCounter;
    timestamp;
    constructor() {
        this.stepCounter = 0;
        this.timestamp = new Date().toISOString();
    }
    /**
     * 生成完整的15步账号切换步骤
     *
     * @param fromAccount 源账号引用
     * @param toAccount 目标账号引用
     * @param context 切换上下文
     * @returns 完整的账号切换步骤对象
     */
    generateAccountSwitchSteps(fromAccount, toAccount, context) {
        this.stepCounter++;
        this.timestamp = new Date().toISOString();
        const stepId = `account-switch-${this.stepCounter}-${Date.now()}`;
        // 验证上下文
        const validation = this.validateContext(context);
        if (!validation.valid) {
            throw new Error(`Context validation failed: ${validation.errors.join(', ')}`);
        }
        // 生成15步协议
        return this.createAccountSwitchStep(stepId, fromAccount, toAccount, context);
    }
    /**
     * 生成单个切换步骤（用于增量添加）
     *
     * @param fromAccount 源账号引用
     * @param toAccount 目标账号引用
     * @param context 切换上下文
     * @param options 额外选项
     * @returns 部分账号切换步骤对象
     */
    generateSingleSwitchStep(fromAccount, toAccount, context, options) {
        this.stepCounter++;
        this.timestamp = new Date().toISOString();
        const stepId = `account-switch-${this.stepCounter}-${Date.now()}`;
        // 构建凭据引用 - 优先使用 options 中的配置，否则使用默认生成
        const credentialRef = options?.credentialRef || {
            accountRef: `CREDENTIAL_${toAccount}`,
            description: `Target account credential for ${toAccount}`
        };
        return this.createAccountSwitchStep(stepId, fromAccount, toAccount, context, options?.reason, credentialRef, options?.logoutMethod || DEFAULT_LOGOUT_METHOD, options?.loginMethod || DEFAULT_LOGIN_METHOD);
    }
    /**
     * 验证切换上下文完整性
     *
     * @param context 待验证的上下文
     * @returns 验证结果
     */
    validateContext(context) {
        const errors = [];
        const warnings = [];
        // 至少需要一种业务标识
        const hasBusinessIdentifier = context.financingCode ||
            context.loanId ||
            context.instCode ||
            context.stepInstCode ||
            context.businessEntity;
        if (!hasBusinessIdentifier) {
            warnings.push('Context has no business identifier - session context preservation may be limited');
        }
        // 检查是否至少提供了 from/to 账号相关的信息
        if (!context.currentStepId && !context.navigationPath && !context.targetPageUrl) {
            warnings.push('No navigation context provided - may not restore correct page after switch');
        }
        // 权限检查警告
        if (!context.requiredPermissions || context.requiredPermissions.length === 0) {
            warnings.push('No required permissions specified - permission verification may be incomplete');
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
    /**
     * 创建完整的账号切换步骤
     */
    createAccountSwitchStep(stepId, fromAccount, toAccount, context, reason, credentialRef, logoutMethod = DEFAULT_LOGOUT_METHOD, loginMethod = DEFAULT_LOGIN_METHOD) {
        const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const switchTimestamp = new Date().toISOString();
        // 构建完整的15步协议
        const step = {
            type: 'ACCOUNT_SWITCH',
            stepId,
            name: `账号切换: ${fromAccount} → ${toAccount}`,
            fromAccount,
            toAccount,
            reason: reason || this.generateDefaultReason(context),
            // 步骤1: 记录当前会话上下文
            step1_recordContext: {
                sessionState: this.buildSessionState(context),
                currentUrl: context.targetPageUrl || '',
                localStorage: { preserved: true },
                sessionStorage: { preserved: true },
                cookies: { sessionCookie: 'present' }
            },
            // 步骤2: 截图当前状态
            step2_captureCurrentState: {
                screenshot: `evidence/${stepId}-before-switch.png`,
                pageSource: `evidence/${stepId}-before-source.html`,
                consoleLogs: []
            },
            // 步骤3: 验证源账号登出能力
            step3_verifyLogoutAbility: true,
            // 步骤4: 执行登出操作
            step4_executeLogout: {
                method: logoutMethod,
                endpoint: logoutMethod === 'api_call' ? '/api/auth/logout' : undefined,
                success: true
            },
            // 步骤5: 验证登出完成
            step5_verifyLogoutComplete: {
                sessionCleared: true,
                cookiesCleared: true,
                redirectedToLogin: true
            },
            // 步骤6: 保存目标账号凭据
            step6_saveTargetCredentials: {
                credentialRef: {
                    ref: credentialRef?.accountRef || `CREDENTIAL_${toAccount}`,
                    description: credentialRef?.description || `Target account credential for ${toAccount}`
                },
                credentialsValid: true
            },
            // 步骤7: 执行登录操作
            step7_executeLogin: {
                method: loginMethod,
                endpoint: loginMethod === 'api_call' ? '/api/auth/login' : undefined,
                success: true
            },
            // 步骤8: 验证登录成功
            step8_verifyLoginSuccess: {
                authenticated: true,
                redirectUrl: context.targetPageUrl || '/',
                sessionId: newSessionId
            },
            // 步骤9: 恢复必要上下文
            step9_restoreContext: {
                restoredLocalStorage: {
                    financingCode: context.financingCode,
                    loanId: context.loanId,
                    instCode: context.instCode,
                    stepInstCode: context.stepInstCode
                },
                restoredSessionStorage: {
                    currentStepId: context.currentStepId,
                    businessEntity: context.businessEntity,
                    currentState: context.currentState
                },
                restoredCookies: {},
                navigationState: context.navigationPath?.join(' > ') || context.targetPageUrl || ''
            },
            // 步骤10: 验证会话状态
            step10_verifySessionState: {
                newSessionId,
                userInfo: {
                    userId: toAccount,
                    username: toAccount,
                    roles: this.inferRoles(context)
                },
                permissions: context.requiredPermissions || ['view', 'edit']
            },
            // 步骤11: 验证权限正确
            step11_verifyPermissions: {
                canView: true,
                canEdit: context.requiredPermissions?.includes('edit') || false,
                canApprove: context.requiredPermissions?.includes('approve') || false,
                allowedResources: this.getAllowedResources(context),
                deniedResources: []
            },
            // 步骤12: 验证导航到目标页面
            step12_verifyNavigation: {
                currentUrl: context.targetPageUrl || '/',
                expectedUrlPattern: this.buildUrlPattern(context),
                matched: true
            },
            // 步骤13: 验证 UI 元素状态
            step13_verifyUIElements: {
                elements: [
                    {
                        selector: '[data-testid="user-menu"]',
                        visible: true,
                        enabled: true,
                        value: toAccount
                    },
                    {
                        selector: '[data-testid="page-header"]',
                        visible: true,
                        enabled: true
                    }
                ]
            },
            // 步骤14: 记录会话映射
            step14_recordSessionMapping: {
                originalSessionId: `session_original_${Date.now() - 1000}`,
                newSessionId,
                switchTimestamp,
                contextPreserved: true
            },
            // 步骤15: 验证业务流程上下文
            step15_verifyBusinessContext: {
                businessEntity: context.businessEntity || context.financingCode || context.loanId || undefined,
                currentState: context.currentState || 'in_progress',
                availableActions: this.getAvailableActions(context),
                canProceed: true
            }
        };
        // 使用 Zod 验证输出
        const result = AccountSwitchStepSchema.safeParse(step);
        if (!result.success) {
            throw new Error(`Generated step failed validation: ${result.error.message}`);
        }
        return result.data;
    }
    /**
     * 构建会话状态
     */
    buildSessionState(context) {
        const state = {
            timestamp: this.timestamp,
            context: {
                financingCode: context.financingCode,
                loanId: context.loanId,
                instCode: context.instCode,
                stepInstCode: context.stepInstCode,
                currentStepId: context.currentStepId,
                businessEntity: context.businessEntity,
                currentState: context.currentState
            }
        };
        return state;
    }
    /**
     * 生成默认切换原因
     */
    generateDefaultReason(context) {
        const parts = ['账号切换'];
        if (context.financingCode) {
            parts.push(`融资单: ${context.financingCode}`);
        }
        if (context.loanId) {
            parts.push(`借款单: ${context.loanId}`);
        }
        if (context.instCode) {
            parts.push(`机构: ${context.instCode}`);
        }
        if (context.currentStepId) {
            parts.push(`当前步骤: ${context.currentStepId}`);
        }
        return parts.join(' | ');
    }
    /**
     * 推断角色
     */
    inferRoles(context) {
        const roles = ['user'];
        if (context.requiredPermissions?.includes('approve')) {
            roles.push('approver');
        }
        if (context.requiredPermissions?.includes('admin')) {
            roles.push('admin');
        }
        if (context.requiredPermissions?.includes('audit')) {
            roles.push('auditor');
        }
        return Array.from(new Set(roles));
    }
    /**
     * 获取允许的资源列表
     */
    getAllowedResources(context) {
        const resources = [];
        if (context.financingCode) {
            resources.push(`financing:${context.financingCode}`);
        }
        if (context.loanId) {
            resources.push(`loan:${context.loanId}`);
        }
        if (context.instCode) {
            resources.push(`institution:${context.instCode}`);
        }
        return resources.length > 0 ? resources : ['*'];
    }
    /**
     * 构建 URL 模式
     */
    buildUrlPattern(context) {
        if (context.targetPageUrl) {
            return context.targetPageUrl;
        }
        const parts = [];
        if (context.financingCode) {
            parts.push(`financing/${context.financingCode}`);
        }
        if (context.loanId) {
            parts.push(`loan/${context.loanId}`);
        }
        if (context.instCode) {
            parts.push(`inst/${context.instCode}`);
        }
        return parts.length > 0 ? `/${parts.join('/')}` : '/';
    }
    /**
     * 获取可用操作
     */
    getAvailableActions(context) {
        const actions = ['view'];
        if (context.requiredPermissions?.includes('edit')) {
            actions.push('edit', 'save', 'submit');
        }
        if (context.requiredPermissions?.includes('approve')) {
            actions.push('approve', 'reject', 'return');
        }
        if (context.requiredPermissions?.includes('transfer')) {
            actions.push('transfer', 'delegate');
        }
        return Array.from(new Set(actions));
    }
}
// ============================================================
// Factory Functions
// ============================================================
/**
 * 创建账号切换生成器
 */
export function createAccountSwitchGenerator() {
    return new AccountSwitchGenerator();
}
/**
 * 快速生成账号切换步骤
 */
export function generateAccountSwitch(fromAccount, toAccount, context) {
    const generator = new AccountSwitchGenerator();
    return generator.generateAccountSwitchSteps(fromAccount, toAccount, context);
}
//# sourceMappingURL=account-switch-generator.js.map