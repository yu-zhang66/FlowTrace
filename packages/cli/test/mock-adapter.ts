import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrowserTestAdapter, BrowserTestAdapterConfig } from '@flowtrace/adapter';
import type { LoginInput, LoginObservation } from '@flowtrace/core';

/**
 * Mock Browser Test Adapter for testing
 * Simulates login behavior without a real browser
 */
export class MockBrowserTestAdapter implements BrowserTestAdapter {
  readonly name: string;
  readonly type: 'legacy' | 'current';
  readonly config: BrowserTestAdapterConfig;

  private initialized = false;
  private loginAttempts: Array<{ username: string; password: string; timestamp: Date }> = [];
  public resetCount = 0;

  // Simulated users
  private readonly validUsers = [
    { username: 'supplier001', password: 'Supplier@123' },
    { username: 'supplier002', password: 'Supplier@456' },
  ];

  // Simulation options
  public simulateSuccess = true;
  public simulateErrorCode: string | undefined;
  public simulateErrorMessage: string | undefined;
  public delay = 0;

  constructor(config: BrowserTestAdapterConfig) {
    this.name = config.name;
    this.type = config.type;
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
    this.loginAttempts = [];
    this.resetCount = 0;
  }

  async reset(): Promise<void> {
    this.loginAttempts = [];
    this.resetCount += 1;
  }

  async login(actor: string, input: LoginInput): Promise<LoginObservation> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }

    const username = input.usernameRef;
    const password = input.passwordRef;

    this.loginAttempts.push({ username, password, timestamp: new Date() });

    // Simulate delay
    if (this.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delay));
    }

    const baseObservation: LoginObservation = {
      finalState: 'LOGIN_FAILED',
      semanticPath: ['LOGIN_PAGE', 'LOGIN_SUBMITTED', 'LOGIN_FAILED'],
      currentUrl: `${this.config.baseUrl}/login`,
      evidence: [],
      errorCode: 'UNKNOWN',
      errorMessage: 'Unknown error'
    };

    // If explicit error code is set, use it directly
    if (this.simulateErrorCode) {
      return {
        ...baseObservation,
        finalState: 'LOGIN_FAILED',
        semanticPath: ['LOGIN_PAGE', 'LOGIN_SUBMITTED', 'LOGIN_FAILED'],
        errorCode: this.simulateErrorCode as LoginObservation['errorCode'],
        errorMessage: this.simulateErrorMessage || this.simulateErrorCode,
        errorHint: this.simulateErrorMessage
      };
    }

    if (this.simulateSuccess) {
      // Check if user is valid
      const user = this.validUsers.find(
        u => u.username === username && u.password === password
      );

      if (user) {
        return {
          finalState: 'AUTHENTICATED',
          semanticPath: ['LOGIN_PAGE', 'LOGIN_SUBMITTED', 'AUTHENTICATED'],
          currentUrl: `${this.config.baseUrl}/dashboard`,
          pageTitle: 'Dashboard',
          evidence: []
        };
      } else {
        // Invalid credentials
        const isInvalidUsername = !this.validUsers.some(u => u.username === username);
        return {
          finalState: 'LOGIN_FAILED',
          semanticPath: ['LOGIN_PAGE', 'LOGIN_SUBMITTED', 'LOGIN_FAILED'],
          currentUrl: `${this.config.baseUrl}/login?error=invalid_credentials`,
          evidence: [],
          errorCode: isInvalidUsername ? 'INVALID_USERNAME' : 'INVALID_PASSWORD',
          errorMessage: isInvalidUsername ? '用户名或密码不正确' : '密码错误，请重新输入'
        };
      }
    }

    return baseObservation;
  }

  async cleanup(): Promise<void> {
    this.initialized = false;
    this.loginAttempts = [];
  }

  async getCurrentUrl(): Promise<string> {
    return `${this.config.baseUrl}/login`;
  }

  async takeScreenshot(name: string): Promise<string> {
    return `/mock/screenshots/${name}.png`;
  }

  async startTrace(name: string): Promise<void> {
    // No-op for mock
  }

  async stopTrace(): Promise<string> {
    return '/mock/traces/trace.zip';
  }

  getLoginAttempts() {
    return [...this.loginAttempts];
  }

  resetLoginAttempts() {
    this.loginAttempts = [];
  }
}

/**
 * Create a mock adapter for testing
 */
export function createMockAdapter(
  type: 'legacy' | 'current',
  options: {
    success?: boolean;
    errorCode?: string;
    errorMessage?: string;
    delay?: number;
  } = {}
): MockBrowserTestAdapter {
  const config: BrowserTestAdapterConfig = {
    name: `mock-${type}-adapter`,
    type,
    baseUrl: type === 'legacy' ? 'http://localhost:3001' : 'http://localhost:3002',
    usernameSelector: 'input#username',
    passwordSelector: 'input#password',
    submitSelector: 'button[type="submit"]'
  };

  const adapter = new MockBrowserTestAdapter(config);
  adapter.simulateSuccess = options.success ?? true;
  adapter.simulateErrorCode = options.errorCode;
  adapter.simulateErrorMessage = options.errorMessage;
  adapter.delay = options.delay ?? 0;

  return adapter;
}
