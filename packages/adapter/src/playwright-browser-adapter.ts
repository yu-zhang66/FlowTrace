/**
 * Playwright Browser Test Adapter
 * 
 * 使用 Playwright 实现 BrowserTestAdapter 接口
 * 支持 OCR 验证码处理、test-mode 测试码、证据采集等
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { mkdirSync } from 'fs';
import type { BrowserTestAdapter, BrowserTestAdapterConfig, LoginInput, LoginObservation, EvidenceRef } from './browser-test-adapter.js';

export class PlaywrightBrowserTestAdapter implements BrowserTestAdapter {
  readonly name: string;
  readonly type: 'legacy' | 'current';
  readonly config: BrowserTestAdapterConfig;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private currentTracePath: string | null = null;
  private retiredContexts = new Set<Promise<void>>();
  private evidenceDir: string;

  constructor(config: BrowserTestAdapterConfig, evidenceDir: string = '.flowtrace/evidence') {
    this.name = config.name;
    this.type = config.type;
    this.config = {
      navigationTimeout: 30000,
      actionTimeout: 10000,
      screenshotStrategy: 'on-failure',
      traceEnabled: false,
      captchaEnabled: true,
      captchaStrategy: 'disabled',
      maxCaptchaRetries: 3,
      ...config
    };
    this.evidenceDir = evidenceDir;
  }

  async initialize(): Promise<void> {
    if (this.browser) {
      return;
    }

    const launchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080', '--start-maximized']
    };
    const launchWithRetry = async (options: Parameters<typeof chromium.launch>[0], label: string) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await chromium.launch(options);
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            console.warn(`[${this.type}] ${label} launch failed (attempt ${attempt}/3); retrying`);
            await new Promise(resolve => setTimeout(resolve, attempt * 500));
          }
        }
      }
      throw lastError;
    };
    try {
      this.browser = await launchWithRetry({
        ...launchOptions,
        ...(this.config.browserChannel ? { channel: this.config.browserChannel } : {})
      }, this.config.browserChannel || 'Playwright Chromium');
    } catch (error) {
      if (!this.config.browserChannel) throw error;
      console.warn(`[${this.type}] Failed to launch ${this.config.browserChannel}; falling back to Playwright Chromium`);
      this.browser = await launchWithRetry(launchOptions, 'Playwright Chromium');
    }

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true
    });

    this.page = await this.context.newPage();
    this.attachPageListeners(this.page);
  }

  async reset(): Promise<void> {
    const previousContext = this.context;

    if (this.browser) {
      // Create the next isolated context before touching the previous one.
      // A page may still have active requests after a login attempt; waiting
      // for its close can otherwise block the next scenario indefinitely.
      const nextContext = await this.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        ignoreHTTPSErrors: true
      });
      const nextPage = await nextContext.newPage();
      this.context = nextContext;
      this.page = nextPage;

      this.attachPageListeners(nextPage);

      // Cleanup is best-effort and must not block the next case.
      if (previousContext) {
        const closeTask = previousContext.close().catch(() => undefined);
        this.retiredContexts.add(closeTask);
        void closeTask.finally(() => this.retiredContexts.delete(closeTask));
      }
    }
  }

  private attachPageListeners(page: Page): void {
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`[${this.type} Console Error] ${msg.text()}`);
    });
    page.on('pageerror', error => console.log(`[${this.type} Page Error] ${error.message}`));
    page.on('requestfailed', request => {
      const failure = request.failure();
      if (failure) console.log(`[${this.type} Network Failed] ${request.url()} - ${failure.errorText}`);
    });
  }

  async login(actor: string, input: LoginInput): Promise<LoginObservation> {
    if (!this.page) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }

    const evidence: EvidenceRef[] = [];
    const semanticPath: string[] = ['LOGIN_PAGE'];
    let currentUrl = '';
    let pageTitle = '';
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    let errorHint: string | undefined;

    try {
      // 1. 导航到登录页面 (优先使用 loginUrl，否则使用 baseUrl + /user/login)
      const loginUrl = this.config.loginUrl || `${this.config.baseUrl}/user/login`;
      await this.page.goto(loginUrl, {
        timeout: this.config.navigationTimeout,
        waitUntil: 'domcontentloaded'
      });

      currentUrl = this.page.url();
      pageTitle = await this.page.title();
      semanticPath.push('LOGIN_PAGE_LOADED');

      // The login page loads sysCode asynchronously. Submitting before that
      // request completes opens the "系统配置未就绪" dialog and makes the
      // result unrelated to the supplied credentials.
      await this.page.waitForTimeout(1500);

      // 2. 填充用户名
      await this.waitAndFill(this.config.usernameSelector, input.usernameRef);
      semanticPath.push('USERNAME_FILLED');

      // 3. 填充密码
      await this.waitAndFill(this.config.passwordSelector, input.passwordRef);
      semanticPath.push('PASSWORD_FILLED');

      // 4. 处理验证码（如果启用）
      if (this.config.captchaEnabled && this.config.captchaStrategy !== 'disabled') {
        try {
          const captchaHandled = await this.handleCaptcha(evidence, semanticPath);
          if (!captchaHandled) {
            errorCode = 'ELEMENT_NOT_FOUND';
            errorMessage = 'Failed to handle captcha after retries';
            semanticPath.push('CAPTCHA_FAILED');
            await this.captureEvidence(evidence, 'captcha-failure-screenshot.png');
            throw new Error(errorMessage);
          }
          semanticPath.push('CAPTCHA_HANDLED');
        } catch (captchaError) {
          if (!errorCode) {
            errorCode = 'ELEMENT_NOT_FOUND';
            errorMessage = captchaError instanceof Error ? captchaError.message : String(captchaError);
          }
          semanticPath.push('CAPTCHA_ERROR');
          await this.captureEvidence(evidence, 'captcha-error-screenshot.png');
          throw captchaError;
        }
      }

      // 5. 点击登录按钮
      await this.page.click(this.config.submitSelector);
      semanticPath.push('LOGIN_SUBMITTED');

      // 6. 等待响应
      try {
        await this.page.waitForNavigation({
          timeout: this.config.navigationTimeout,
          waitUntil: 'networkidle'
        }).catch(() => {
          // 可能没有完整导航，但登录可能已经处理
        });
      } catch (navError) {
        console.log(`[${this.type}] Navigation wait: ${navError instanceof Error ? navError.message : String(navError)}`);
      }

      // 等待一下让页面稳定
      await this.page.waitForTimeout(500);

      currentUrl = this.page.url();
      pageTitle = await this.page.title();
      semanticPath.push('RESPONSE_RECEIVED');

      // 7. 判断登录结果
      const isAuthenticated = await this.checkLoginSuccess();
      const isFailed = await this.checkLoginFailure();

      if (isAuthenticated) {
        semanticPath.push('AUTHENTICATED');
        await this.captureEvidence(evidence, 'success-screenshot.png');
      } else if (isFailed) {
        semanticPath.push('LOGIN_FAILED');
        errorHint = await this.extractErrorHint();
        errorCode = this.inferErrorType(errorHint, pageTitle);
        errorMessage = errorHint || 'Login failed';
        await this.captureEvidence(evidence, 'failure-screenshot.png');
      } else {
        semanticPath.push('UNCERTAIN');
        await this.captureEvidence(evidence, 'uncertain-screenshot.png');
      }

    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      errorMessage = errorText;

      if (!errorCode) {
        if (errorText.includes('timeout')) {
          errorCode = 'TIMEOUT';
        } else if (errorText.includes('navigation') || errorText.includes('net::ERR')) {
          errorCode = 'NETWORK_ERROR';
        } else if (errorText.includes('selector') || errorText.includes('not found') || errorText.includes('captcha')) {
          errorCode = 'ELEMENT_NOT_FOUND';
        } else {
          errorCode = 'UNKNOWN';
        }
      }

      semanticPath.push('ERROR');
      try {
        await this.captureEvidence(evidence, 'error-screenshot.png');
      } catch {
        // Ignore screenshot errors
      }
    }

    const finalState: 'AUTHENTICATED' | 'LOGIN_FAILED' = semanticPath.includes('AUTHENTICATED') ? 'AUTHENTICATED' : 'LOGIN_FAILED';

    return {
      finalState,
      semanticPath,
      currentUrl,
      pageTitle,
      errorCode,
      errorMessage,
      errorHint,
      evidence,
      rawError: errorMessage
    };
  }

  /**
   * 处理验证码
   * 支持 PaddleOCR 和 test-mode 两种策略
   * 
   * @returns true 表示处理成功，false 表示处理失败
   */
  private async handleCaptcha(evidence: EvidenceRef[], semanticPath: string[]): Promise<boolean> {
    if (!this.page) throw new Error('Page not initialized');

    const maxRetries = this.config.maxCaptchaRetries || 3;
    const strategy = this.config.captchaStrategy || 'test-mode';

    // Check if captcha is present - if not, skip handling
    const captchaVisible = await this.isCaptchaVisible();
    if (!captchaVisible) {
      console.log(`[${this.type}] No captcha detected, skipping captcha handling`);
      return true;
    }

    // Disabled mode: skip handling
    if (strategy === 'disabled') {
      console.log(`[${this.type}] WARNING: captchaStrategy=disabled but captcha is visible`);
      return false;
    }

    // Test-mode: use configured test captcha value
    if (strategy === 'test-mode') {
      const testCaptchaValue = this.config.captchaTestValue;
      if (!testCaptchaValue) {
        console.log(`[${this.type}] WARNING: captchaStrategy=test-mode but captchaTestValue is not configured`);
        return false;
      }
      const testModeEnabled = process.env.FLOWTRACE_TEST_MODE === 'true';
      if (!testModeEnabled) {
        console.log(`[${this.type}] WARNING: captchaStrategy=test-mode but FLOWTRACE_TEST_MODE is not set`);
        return false;
      } else {
        console.log(`[${this.type}] TEST-MODE CAPTCHA: Using configured test captcha value. THIS IS FOR LOCAL TESTING ONLY.`);
        await this.waitAndFill(this.config.captchaInputSelector || 'input[placeholder="请输入验证码"]', testCaptchaValue);
        return true;
      }
    }

    // PaddleOCR 需要由项目适配器提供；未配置时明确失败，不调用 Tesseract。
    if (strategy === 'paddleocr') {
      console.log(`[${this.type}] PaddleOCR is not configured in this adapter`);
      return false;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 1. 读取验证码图片
        const captchaBase64 = await this.readCaptchaImage();
        if (!captchaBase64) {
          console.log(`[${this.type}] Captcha image not found (attempt ${attempt}/${maxRetries})`);
          // 刷新验证码图片
          await this.refreshCaptcha();
          continue;
        }

        // 2. OCR 识别
        const captchaText = await this.ocrCaptcha(captchaBase64);
        if (!captchaText || captchaText.length < 3) {
          console.log(`[${this.type}] OCR failed (attempt ${attempt}/${maxRetries}): "${captchaText}"`);
          await this.refreshCaptcha();
          continue;
        }

        // 3. 填写验证码
        await this.waitAndFill(
          this.config.captchaInputSelector || 'input[placeholder="请输入验证码"]',
          captchaText
        );

        console.log(`[${this.type}] OCR captcha filled: "${captchaText}"`);
        return true;
      } catch (error) {
        console.log(`[${this.type}] Captcha attempt ${attempt} error: ${error}`);
        if (attempt < maxRetries) {
          await this.refreshCaptcha();
        }
      }
    }

    return false;
  }

  /**
   * 检查验证码元素是否可见
   */
  private async isCaptchaVisible(): Promise<boolean> {
    if (!this.page) return false;
    
    const selector = this.config.captchaSelector || 'img.wfull.h40.cpt';
    const imgElement = this.page.locator(selector).first();
    
    try {
      return await imgElement.isVisible({ timeout: 3000 }).catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * 读取验证码图片为 base64
   */
  private async readCaptchaImage(): Promise<string | null> {
    if (!this.page) return null;

    const selector = this.config.captchaSelector || 'img.wfull.h40.cpt';
    const imgElement = this.page.locator(selector).first();

    try {
      const isVisible = await imgElement.isVisible({ timeout: 3000 }).catch(() => false);
      if (!isVisible) return null;

      // 尝试获取 src
      const src = await imgElement.getAttribute('src');
      if (!src) return null;

      // 如果是 data URL
      if (src.startsWith('data:image')) {
        const base64Index = src.indexOf('base64,');
        if (base64Index >= 0) {
          return src.substring(base64Index + 7);
        }
      }

      // 否则截图元素
      const buffer = await imgElement.screenshot();
      return buffer.toString('base64');
    } catch {
      return null;
    }
  }

  /**
   * OCR 识别验证码
   * 使用 tesseract 或等价 OCR 工具
   */
  private async ocrCaptcha(_base64Data: string): Promise<string | null> {
    // PaddleOCR is intentionally delegated to a project-provided adapter.
    // The default test path never reaches this method.
    return null;
  }

  /**
   * 刷新验证码图片
   */
  private async refreshCaptcha(): Promise<void> {
    if (!this.page) return;
    try {
      const selector = this.config.captchaSelector || 'img.wfull.h40.cpt';
      const imgElement = this.page.locator(selector).first();
      await imgElement.click({ force: true }).catch(() => {
        // 如果不能点击，尝试重新加载图片
      });
      await this.page.waitForTimeout(500);
    } catch {
      // Ignore
    }
  }

  private async waitAndFill(selector: string, value: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    const element = this.page.locator(selector).first();
    await element.waitFor({ state: 'visible', timeout: this.config.actionTimeout || 10000 });
    await element.fill(value);
  }

  private async checkLoginSuccess(): Promise<boolean> {
    if (!this.page) return false;

    // 检查 URL 是否匹配成功模式
    if (this.config.successUrlPattern) {
      const url = this.page.url();
      const pattern = new RegExp(this.config.successUrlPattern);
      if (pattern.test(url)) {
        return true;
      }
    }

    // 检查页面标题
    if (this.config.successTitlePattern) {
      const title = await this.page.title();
      const pattern = new RegExp(this.config.successTitlePattern);
      if (pattern.test(title)) {
        return true;
      }
    }

    // 检查 localStorage 中的 accessToken
    try {
      const accessToken = await this.page.evaluate(() => {
        const ls = (globalThis as Record<string, unknown>)['localStorage'] as { getItem?: (key: string) => string | null } | undefined;
        return ls?.getItem ? ls.getItem('accessToken') : null;
      });
      if (accessToken && accessToken.length > 0) {
        return true;
      }
    } catch {
      // Ignore
    }

    // 检查是否还在登录页
    const loginKeywords = ['login', 'sign in', '登录', 'user/login'];
    const url = (await this.page.url()).toLowerCase();
    const title = (await this.page.title()).toLowerCase();
    const onLoginPage = loginKeywords.some(kw => url.includes(kw));

    if (onLoginPage) {
      return false;
    }

    return true;
  }

  private async checkLoginFailure(): Promise<boolean> {
    if (!this.page) return false;

    // 检查错误选择器
    if (this.config.errorSelector) {
      const errorElement = this.page.locator(this.config.errorSelector).first();
      if (await errorElement.isVisible().catch(() => false)) {
        return true;
      }
    }

    // 检查是否还在登录页
    const url = (await this.page.url()).toLowerCase();
    const onLoginPage = url.includes('login') || url.includes('user/login');

    return onLoginPage;
  }

  private inferErrorType(errorHint: string | undefined, pageTitle: string | undefined): string {
    if (!errorHint && !pageTitle) return 'UNKNOWN';

    const text = `${errorHint || ''} ${pageTitle || ''}`.toLowerCase();

    if (text.includes('locked') || text.includes('locked out') || text.includes('账户锁定') || text.includes('账号锁定')) {
      return 'ACCOUNT_LOCKED';
    }
    if (text.includes('disabled') || text.includes('账户禁用') || text.includes('账号禁用')) {
      return 'ACCOUNT_DISABLED';
    }
    if (text.includes('invalid username') || text.includes('user not found') || text.includes('用户名错误') || text.includes('用户名不正确') || text.includes('用户不存在') || text.includes('账号不存在')) {
      return 'INVALID_USERNAME';
    }
    if (text.includes('invalid password') || text.includes('incorrect password') || text.includes('wrong password') || text.includes('密码错误') || text.includes('密码不正确')) {
      return 'INVALID_PASSWORD';
    }
    if (text.includes('账号或密码错误') || text.includes('invalid credentials') || text.includes('incorrect credentials')) {
      return 'INVALID_PASSWORD';
    }
    if (text.includes('timeout') || text.includes('超时')) {
      return 'TIMEOUT';
    }
    if (text.includes('network') || text.includes('connection') || text.includes('网络')) {
      return 'NETWORK_ERROR';
    }
    if (text.includes('not found') || text.includes('404')) {
      return 'PAGE_NOT_FOUND';
    }
    if (text.includes('element') || text.includes('not visible') || text.includes('找不到')) {
      return 'ELEMENT_NOT_FOUND';
    }
    if (text.includes('captcha') || text.includes('验证码')) {
      return 'ELEMENT_NOT_FOUND';
    }

    return 'UNKNOWN';
  }

  private async extractErrorHint(): Promise<string | undefined> {
    if (!this.page) return undefined;

    try {
      if (this.config.errorSelector) {
        const errorElement = this.page.locator(this.config.errorSelector).first();
        if (await errorElement.isVisible().catch(() => false)) {
          return await errorElement.textContent() || undefined;
        }
      }

      const errorSelectors = [
        '[role="alert"]',
        '.error-message',
        '.alert-error',
        '.form-error',
        '.invalid-feedback',
        '[data-testid="error"]'
      ];

      for (const selector of errorSelectors) {
        const element = this.page.locator(selector).first();
        if (await element.isVisible().catch(() => false)) {
          const text = await element.textContent();
          if (text && text.trim()) {
            return text.trim();
          }
        }
      }
    } catch {
      // Ignore
    }

    return undefined;
  }

  private async captureEvidence(evidence: EvidenceRef[], filename: string): Promise<void> {
    const strategy = this.config.screenshotStrategy || 'on-failure';
    const shouldCapture = strategy === 'always' ||
                         (strategy === 'on-failure' && !evidence.some(e => e.type === 'screenshot'));

    if (shouldCapture && this.page) {
      try {
        // 确保证据目录存在
        try {
          mkdirSync(this.evidenceDir, { recursive: true });
        } catch {
          // Ignore
        }
        const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${this.type}-${filename}`;
        const path = `${this.evidenceDir}/${uniqueName}`;
        await this.page.screenshot({ path, fullPage: true });
        evidence.push({
          type: 'screenshot',
          path,
          timestamp: new Date().toISOString(),
          description: `${this.type} - ${filename}`
        });
      } catch {
        // Ignore screenshot errors
      }
    }
  }

  async cleanup(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // Ignore
      }
      this.context = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore
      }
      this.browser = null;
    }
    this.page = null;
    await Promise.allSettled(this.retiredContexts);
  }

  async getCurrentUrl(): Promise<string> {
    return this.page?.url() || '';
  }

  async takeScreenshot(name: string): Promise<string> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      mkdirSync(this.evidenceDir, { recursive: true });
    } catch {
      // Ignore
    }
    const path = `${this.evidenceDir}/${this.type}-${name}.png`;
    await this.page.screenshot({ path, fullPage: true });
    return path;
  }

  async startTrace(name: string): Promise<void> {
    if (!this.context || !this.config.traceEnabled) {
      return;
    }

    this.currentTracePath = `${this.evidenceDir}/${this.type}-${name}-trace.zip`;
    await this.context.tracing.start({
      screenshots: true,
      snapshots: true,
      title: name
    });
  }

  async stopTrace(): Promise<string> {
    if (!this.context || !this.currentTracePath) {
      return '';
    }

    try {
      await this.context.tracing.stop({ path: this.currentTracePath });
      const path = this.currentTracePath;
      this.currentTracePath = null;
      return path;
    } catch {
      return '';
    }
  }
}

/**
 * 创建 Playwright 浏览器测试适配器
 */
export function createPlaywrightBrowserAdapter(
  config: BrowserTestAdapterConfig,
  evidenceDir?: string
): BrowserTestAdapter {
  return new PlaywrightBrowserTestAdapter(config, evidenceDir);
}
