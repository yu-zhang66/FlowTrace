/**
 * Browser Test Adapter Interface
 *
 * 定义浏览器测试适配器接口，用于执行登录测试
 */
export const DEFAULT_SELECTORS = {
    username: 'input[name="username"], input[id="username"], input[type="text"]',
    password: 'input[name="password"], input[id="password"], input[type="password"]',
    submit: 'button[type="submit"], button:has-text("登录"), button:has-text("Login"), button:has-text("Sign In")',
    error: '.error-message, .alert-error, [data-testid="error"], .form-error, [role="alert"]'
};
//# sourceMappingURL=browser-test-adapter.js.map