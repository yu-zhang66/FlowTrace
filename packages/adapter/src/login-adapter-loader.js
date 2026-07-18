/**
 * Login Adapter Configuration Loader
 *
 * 从目标项目配置加载 legacy 和 current 登录适配器
 */
import { existsSync, mkdirSync, readFileSync } from 'fs';
/**
 * 从 YAML/JSON 加载登录适配器配置
 */
export function loadLoginAdapterConfig(configPath) {
    if (!existsSync(configPath)) {
        throw new Error(`Login adapter config not found: ${configPath}`);
    }
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    if (!config.legacy || !config.current) {
        throw new Error('Login adapter config must have legacy and current sections');
    }
    return config;
}
/**
 * 从环境变量获取凭据
 */
export function getCredentialsFromEnv(usernameRef, passwordRef) {
    const username = process.env[usernameRef];
    const password = process.env[passwordRef];
    if (!username) {
        throw new Error(`Username environment variable not found: ${usernameRef}`);
    }
    if (!password) {
        throw new Error(`Password environment variable not found: ${passwordRef}`);
    }
    return { username, password };
}
/**
 * 验证凭据引用
 */
export function validateCredentialRefs(input) {
    const errors = [];
    if (!input.usernameRef) {
        errors.push('usernameRef is required');
    }
    if (!input.passwordRef) {
        errors.push('passwordRef is required');
    }
    // 检查环境变量是否存在
    if (input.usernameRef && !process.env[input.usernameRef]) {
        errors.push(`Environment variable not found: ${input.usernameRef}`);
    }
    if (input.passwordRef && !process.env[input.passwordRef]) {
        errors.push(`Environment variable not found: ${input.passwordRef}`);
    }
    return errors;
}
/**
 * 登录适配器加载器
 */
export class LoginAdapterLoader {
    legacyAdapter = null;
    currentAdapter = null;
    legacyShadow = false;
    evidenceDir = '.flowtrace/evidence';
    /**
     * 初始化加载器
     */
    async initialize(config, legacyShadow = false) {
        this.legacyShadow = legacyShadow;
        this.evidenceDir = config.evidence?.dir || '.flowtrace/evidence';
        // 确保证据目录存在
        if (!existsSync(this.evidenceDir)) {
            mkdirSync(this.evidenceDir, { recursive: true });
        }
        // 创建 Legacy 适配器
        const legacyConfig = {
            name: 'legacy-login-adapter',
            type: 'legacy',
            baseUrl: config.legacyBaseUrl,
            loginUrl: config.legacyBaseUrl + '/user/login',
            usernameSelector: config.selectors?.username || 'input[placeholder="用户名"]',
            passwordSelector: config.selectors?.password || 'input[placeholder="密码"]',
            submitSelector: config.selectors?.submit || 'button:has-text("登录")',
            errorSelector: config.selectors?.error || '.error-message, [role="alert"]',
            successUrlPattern: config.successValidation?.urlPattern || '/(dashboard|home|welcome|index)/i',
            successTitlePattern: config.successValidation?.titlePattern || '/(Dashboard|Home|Welcome|首页)/i',
            navigationTimeout: config.timeouts?.navigation || 30000,
            actionTimeout: config.timeouts?.action || 10000,
            screenshotStrategy: config.evidence?.screenshot || 'on-failure',
            traceEnabled: config.evidence?.trace || false,
            // 验证码配置
            captchaEnabled: config.captcha?.enabled ?? true,
            captchaSelector: config.captcha?.selector || 'img.wfull.h40.cpt',
            captchaInputSelector: config.captcha?.inputSelector || 'input[placeholder="请输入验证码"]',
            captchaStrategy: config.captcha?.mode === 'disabled' ? 'disabled' : config.captcha?.mode === 'real' ? 'paddleocr' : 'test-mode',
            captchaTestValue: config.captcha?.testValue,
            browserChannel: config.browserChannel || 'chrome',
            maxCaptchaRetries: config.captcha?.maxRetries || 3
        };
        // 动态导入 Playwright 适配器
        const { createPlaywrightBrowserAdapter } = await import('./playwright-browser-adapter.js');
        this.legacyAdapter = createPlaywrightBrowserAdapter(legacyConfig, this.evidenceDir);
        // 创建 Current 适配器（如果不在 legacy-shadow 模式）
        if (!legacyShadow) {
            const currentConfig = {
                ...legacyConfig,
                name: 'current-login-adapter',
                type: 'current',
                baseUrl: config.currentBaseUrl,
                loginUrl: config.currentBaseUrl + '/user/login'
            };
            this.currentAdapter = createPlaywrightBrowserAdapter(currentConfig, this.evidenceDir);
        }
        else {
            // Legacy-shadow 模式：current 复用 legacy
            this.currentAdapter = this.legacyAdapter;
            console.log('[LoginAdapterLoader] Using legacy-shadow mode: current reuses legacy');
        }
    }
    /**
     * 获取 Legacy 适配器
     */
    getLegacyAdapter() {
        return this.legacyAdapter;
    }
    /**
     * 获取 Current 适配器
     */
    getCurrentAdapter() {
        return this.currentAdapter;
    }
    /**
     * 获取加载结果
     */
    getLoadedAdapters() {
        const errors = [];
        if (!this.legacyAdapter) {
            errors.push('Legacy adapter not loaded');
        }
        if (!this.currentAdapter) {
            errors.push('Current adapter not loaded');
        }
        return {
            legacy: this.legacyAdapter,
            current: this.currentAdapter,
            errors,
            usingLegacyShadow: this.legacyShadow
        };
    }
    /**
     * 清理所有适配器
     */
    async cleanup() {
        const toCleanup = new Set();
        if (this.legacyAdapter)
            toCleanup.add(this.legacyAdapter);
        if (this.currentAdapter && this.currentAdapter !== this.legacyAdapter) {
            toCleanup.add(this.currentAdapter);
        }
        for (const adapter of toCleanup) {
            try {
                await adapter.cleanup();
            }
            catch (error) {
                console.error(`[LoginAdapterLoader] Failed to cleanup adapter:`, error);
            }
        }
        this.legacyAdapter = null;
        this.currentAdapter = null;
    }
}
/**
 * 创建登录适配器加载器
 */
export function createLoginAdapterLoader() {
    return new LoginAdapterLoader();
}
//# sourceMappingURL=login-adapter-loader.js.map