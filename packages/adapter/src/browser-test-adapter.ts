/**
 * Browser Test Adapter Interface
 * 
 * 定义浏览器测试适配器接口，用于执行登录测试
 */

export interface LoginInput {
  /** 用户名引用（环境变量名）或实际用户名 */
  usernameRef: string;
  /** 密码引用（环境变量名）或实际密码 */
  passwordRef: string;
  /** 可选的域名/租户标识 */
  domain?: string;
  /** 可选的记住登录状态 */
  rememberMe?: boolean;
}

export interface LoginObservation {
  /** 最终状态 */
  finalState: 'AUTHENTICATED' | 'LOGIN_FAILED';
  /** 语义路径 */
  semanticPath: string[];
  /** 执行后的页面 URL */
  currentUrl: string;
  /** 页面标题 */
  pageTitle?: string;
  /** 错误码（如果登录失败） */
  errorCode?: string;
  /** 错误消息（如果登录失败） */
  errorMessage?: string;
  /** 错误提示文本（页面可见的） */
  errorHint?: string;
  /** 证据引用列表 */
  evidence: EvidenceRef[];
  /** 额外的业务数据 */
  businessData?: Record<string, unknown>;
  /** 原始错误（如有） */
  rawError?: string;
}

export interface EvidenceRef {
  /** 证据类型 */
  type: 'screenshot' | 'trace' | 'console_log' | 'network_request' | 'result_json';
  /** 证据文件路径 */
  path: string;
  /** 证据生成时间 */
  timestamp: string;
  /** 证据描述 */
  description?: string;
}

export interface BrowserTestAdapterConfig {
  /** 适配器名称 */
  name: string;
  /** 适配器类型 */
  type: 'legacy' | 'current';
  /** 基础 URL */
  baseUrl: string;
  /** 登录页面 URL */
  loginUrl?: string;
  /** 用户名输入框选择器 */
  usernameSelector: string;
  /** 密码输入框选择器 */
  passwordSelector: string;
  /** 登录按钮选择器 */
  submitSelector: string;
  /** 登录成功后的 URL 模式（用于验证成功） */
  successUrlPattern?: string;
  /** 登录成功后的页面标题模式 */
  successTitlePattern?: string;
  /** 错误提示选择器 */
  errorSelector?: string;
  /** 错误提示文本模式 */
  errorTextPatterns?: string[];
  /** 页面加载超时（毫秒） */
  navigationTimeout?: number;
  /** 登录操作超时（毫秒） */
  actionTimeout?: number;
  /** 截图策略 */
  screenshotStrategy?: 'always' | 'on-failure' | 'never';
  /** 是否启用 trace 录制 */
  traceEnabled?: boolean;
  /** 额外的等待选择器（登录后） */
  postLoginWaitSelector?: string;
  /** 是否启用验证码处理 */
  captchaEnabled?: boolean;
  /** 验证码图片选择器 */
  captchaSelector?: string;
  /** 验证码输入框选择器 */
  captchaInputSelector?: string;
  /** 验证码处理策略 */
  captchaStrategy?: 'paddleocr' | 'test-mode' | 'disabled';
  /** 测试验证码值（仅 test 模式使用，从配置读取） */
  captchaTestValue?: string;
  /** 浏览器渠道；chrome 表示使用本机 Chrome，避免下载 Playwright Chromium */
  browserChannel?: 'chrome' | 'msedge';
  /** 验证码最大重试次数 */
  maxCaptchaRetries?: number;
}

export interface BrowserTestAdapter {
  readonly name: string;
  readonly type: 'legacy' | 'current';
  readonly config: BrowserTestAdapterConfig;

  /** 初始化浏览器 */
  initialize(): Promise<void>;

  /** 重置浏览器状态 */
  reset(): Promise<void>;

  /** 执行登录 */
  login(actor: string, input: LoginInput): Promise<LoginObservation>;

  /** 清理资源 */
  cleanup(): Promise<void>;

  /** 获取当前页面 URL */
  getCurrentUrl(): Promise<string>;

  /** 截图 */
  takeScreenshot(name: string): Promise<string>;

  /** 开始录制 trace */
  startTrace(name: string): Promise<void>;

  /** 停止并保存 trace */
  stopTrace(): Promise<string>;
}

export interface LoginSelectors {
  username: string;
  password: string;
  submit: string;
  error?: string;
  success?: string;
}

export const DEFAULT_SELECTORS: LoginSelectors = {
  username: 'input[name="username"], input[id="username"], input[type="text"]',
  password: 'input[name="password"], input[id="password"], input[type="password"]',
  submit: 'button[type="submit"], button:has-text("登录"), button:has-text("Login"), button:has-text("Sign In")',
  error: '.error-message, .alert-error, [data-testid="error"], .form-error, [role="alert"]'
};
