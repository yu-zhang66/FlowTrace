import { describe, it, expect, beforeEach } from 'vitest';
import {
  BusinessActionType,
  validateScenario,
  validateNoPlaintextSecrets,
  LoginInputSchema,
  LoginFinalState,
  assertLoginSuccess,
  assertLoginFailure,
  assertAuthStateConsistency,
  assertErrorConsistency,
  inferErrorType,
  LoginInput,
  LoginObservation
} from '@flowtrace/core';

describe('Login Models', () => {
  describe('BusinessActionType - LOGIN', () => {
    it('should accept LOGIN action type', () => {
      const result = BusinessActionType.safeParse('LOGIN');
      expect(result.success).toBe(true);
    });

    it('should include LOGIN in valid action types', () => {
      const validActions = [
        'SUBMIT', 'APPROVE', 'REJECT', 'RETURN',
        'WITHDRAW', 'TRANSFER', 'COUNTERSIGN', 'COUNTERSIGN_COMPLETE', 'LOGIN'
      ];
      validActions.forEach(action => {
        const result = BusinessActionType.safeParse(action);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('LoginInput Schema', () => {
    it('should validate login input with refs', () => {
      const input = {
        usernameRef: 'SUPPLIER_USERNAME',
        passwordRef: 'SUPPLIER_PASSWORD'
      };
      const result = LoginInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should validate login input with optional fields', () => {
      const input = {
        usernameRef: 'SUPPLIER_USERNAME',
        passwordRef: 'SUPPLIER_PASSWORD',
        domain: 'supply-chain',
        rememberMe: true
      };
      const result = LoginInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty usernameRef', () => {
      const input = {
        usernameRef: '',
        passwordRef: 'SUPPLIER_PASSWORD'
      };
      const result = LoginInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject empty passwordRef', () => {
      const input = {
        usernameRef: 'SUPPLIER_USERNAME',
        passwordRef: ''
      };
      const result = LoginInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('LoginFinalState', () => {
    it('should accept AUTHENTICATED', () => {
      const result = LoginFinalState.safeParse('AUTHENTICATED');
      expect(result.success).toBe(true);
    });

    it('should accept LOGIN_FAILED', () => {
      const result = LoginFinalState.safeParse('LOGIN_FAILED');
      expect(result.success).toBe(true);
    });

    it('should reject invalid states', () => {
      const result = LoginFinalState.safeParse('UNKNOWN');
      expect(result.success).toBe(false);
    });
  });

  describe('validateScenario - LOGIN action', () => {
    it('should validate valid login scenario', () => {
      const scenario = {
        id: 'login-success-001',
        name: '登录成功',
        process: 'login',
        severity: 'P0',
        actions: [
          {
            type: 'LOGIN',
            actor: 'supplier',
            data: {
              usernameRef: 'SUPPLIER_USERNAME',
              passwordRef: 'SUPPLIER_PASSWORD'
            }
          }
        ],
        expected: {
          finalState: 'AUTHENTICATED',
          semanticPath: ['LOGIN_PAGE', 'LOGIN_SUBMITTED', 'AUTHENTICATED']
        }
      };

      const result = validateScenario(scenario);
      expect(result.valid).toBe(true);
    });

    it('should reject LOGIN action without actor', () => {
      const scenario = {
        id: 'login-no-actor-001',
        name: '登录无执行者',
        process: 'login',
        actions: [
          {
            type: 'LOGIN',
            data: {
              usernameRef: 'SUPPLIER_USERNAME',
              passwordRef: 'SUPPLIER_PASSWORD'
            }
          }
        ],
        expected: {
          finalState: 'AUTHENTICATED'
        }
      };

      const result = validateScenario(scenario);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should validate login scenario expecting failure', () => {
      const scenario = {
        id: 'login-invalid-username-001',
        name: '用户名错误',
        process: 'login',
        severity: 'P0',
        actions: [
          {
            type: 'LOGIN',
            actor: 'supplier',
            data: {
              usernameRef: 'INVALID_USERNAME',
              passwordRef: 'SUPPLIER_PASSWORD'
            }
          }
        ],
        expected: {
          finalState: 'LOGIN_FAILED',
          semanticPath: ['LOGIN_PAGE', 'LOGIN_SUBMITTED', 'LOGIN_FAILED']
        }
      };

      const result = validateScenario(scenario);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateNoPlaintextSecrets', () => {
    it('should accept scenario with credential refs', () => {
      const scenario = {
        id: 'login-ref-001',
        name: 'Login with refs',
        process: 'login',
        actions: [
          {
            type: 'LOGIN',
            actor: 'supplier',
            data: {
              usernameRef: 'SUPPLIER_USERNAME',
              passwordRef: 'SUPPLIER_PASSWORD'
            }
          }
        ],
        expected: {
          finalState: 'AUTHENTICATED'
        }
      };

      const result = validateNoPlaintextSecrets(scenario);
      expect(result.valid).toBe(true);
    });

    it('should reject scenario with plaintext password', () => {
      const scenario = {
        id: 'login-plaintext-001',
        name: 'Login with plaintext',
        process: 'login',
        actions: [
          {
            type: 'LOGIN',
            actor: 'supplier',
            data: {
              username: 'testuser',
              password: 'mySecretPassword123'
            }
          }
        ],
        expected: {
          finalState: 'AUTHENTICATED'
        }
      };

      const result = validateNoPlaintextSecrets(scenario);
      expect(result.valid).toBe(false);
      expect(result.violations).toBeDefined();
      expect(result.violations!.length).toBeGreaterThan(0);
    });

    it('should reject scenario with plaintext token', () => {
      const scenario = {
        id: 'login-token-001',
        name: 'Login with token',
        process: 'login',
        actions: [
          {
            type: 'LOGIN',
            actor: 'supplier',
            data: {
              usernameRef: 'SUPPLIER_USERNAME',
              token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
            }
          }
        ],
        expected: {
          finalState: 'AUTHENTICATED'
        }
      };

      const result = validateNoPlaintextSecrets(scenario);
      expect(result.valid).toBe(false);
    });
  });
});

describe('Login Assertions', () => {
  describe('assertLoginSuccess', () => {
    it('should pass for AUTHENTICATED observation', () => {
      const observation: LoginObservation = {
        finalState: 'AUTHENTICATED',
        semanticPath: ['LOGIN_PAGE', 'AUTHENTICATED'],
        currentUrl: 'http://example.com/dashboard',
        evidence: []
      };

      const result = assertLoginSuccess(observation);
      expect(result.passed).toBe(true);
      expect(result.expected).toBe('AUTHENTICATED');
      expect(result.actual).toBe('AUTHENTICATED');
    });

    it('should fail for LOGIN_FAILED observation', () => {
      const observation: LoginObservation = {
        finalState: 'LOGIN_FAILED',
        semanticPath: ['LOGIN_PAGE', 'LOGIN_FAILED'],
        currentUrl: 'http://example.com/login',
        evidence: [],
        errorCode: 'INVALID_PASSWORD',
        errorMessage: '密码错误'
      };

      const result = assertLoginSuccess(observation);
      expect(result.passed).toBe(false);
      expect(result.actual).toBe('LOGIN_FAILED');
    });
  });

  describe('assertLoginFailure', () => {
    it('should pass for LOGIN_FAILED with correct error type', () => {
      const observation: LoginObservation = {
        finalState: 'LOGIN_FAILED',
        semanticPath: ['LOGIN_PAGE', 'LOGIN_FAILED'],
        currentUrl: 'http://example.com/login',
        evidence: [],
        errorCode: 'INVALID_PASSWORD',
        errorMessage: '密码错误'
      };

      const result = assertLoginFailure(observation, 'INVALID_PASSWORD');
      expect(result.passed).toBe(true);
    });

    it('should fail for AUTHENTICATED when expecting failure', () => {
      const observation: LoginObservation = {
        finalState: 'AUTHENTICATED',
        semanticPath: ['LOGIN_PAGE', 'AUTHENTICATED'],
        currentUrl: 'http://example.com/dashboard',
        evidence: []
      };

      const result = assertLoginFailure(observation);
      expect(result.passed).toBe(false);
      expect(result.actual).toBe('AUTHENTICATED');
    });
  });

  describe('assertAuthStateConsistency', () => {
    it('should pass when both systems authenticated', () => {
      const legacy: LoginObservation = {
        finalState: 'AUTHENTICATED',
        semanticPath: ['AUTHENTICATED'],
        currentUrl: 'http://legacy.com/dashboard',
        evidence: []
      };
      const current: LoginObservation = {
        finalState: 'AUTHENTICATED',
        semanticPath: ['AUTHENTICATED'],
        currentUrl: 'http://current.com/dashboard',
        evidence: []
      };

      const result = assertAuthStateConsistency(legacy, current);
      expect(result.passed).toBe(true);
    });

    it('should fail when systems have different auth states', () => {
      const legacy: LoginObservation = {
        finalState: 'AUTHENTICATED',
        semanticPath: ['AUTHENTICATED'],
        currentUrl: 'http://legacy.com/dashboard',
        evidence: []
      };
      const current: LoginObservation = {
        finalState: 'LOGIN_FAILED',
        semanticPath: ['LOGIN_FAILED'],
        currentUrl: 'http://current.com/login',
        evidence: [],
        errorCode: 'INVALID_PASSWORD'
      };

      const result = assertAuthStateConsistency(legacy, current);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('mismatch');
    });
  });

  describe('assertErrorConsistency', () => {
    it('should pass when both systems have same error', () => {
      const legacy: LoginObservation = {
        finalState: 'LOGIN_FAILED',
        semanticPath: ['LOGIN_FAILED'],
        currentUrl: 'http://legacy.com/login',
        evidence: [],
        errorCode: 'INVALID_USERNAME',
        errorMessage: '用户名或密码不正确'
      };
      const current: LoginObservation = {
        finalState: 'LOGIN_FAILED',
        semanticPath: ['LOGIN_FAILED'],
        currentUrl: 'http://current.com/login',
        evidence: [],
        errorCode: 'INVALID_USERNAME',
        errorMessage: '用户名或密码不正确'
      };

      const result = assertErrorConsistency(legacy, current);
      expect(result.passed).toBe(true);
      expect(result.errorTypeMatch).toBe(true);
    });

    it('should fail when error types differ', () => {
      const legacy: LoginObservation = {
        finalState: 'LOGIN_FAILED',
        semanticPath: ['LOGIN_FAILED'],
        currentUrl: 'http://legacy.com/login',
        evidence: [],
        errorCode: 'INVALID_USERNAME'
      };
      const current: LoginObservation = {
        finalState: 'LOGIN_FAILED',
        semanticPath: ['LOGIN_FAILED'],
        currentUrl: 'http://current.com/login',
        evidence: [],
        errorCode: 'INVALID_PASSWORD'
      };

      const result = assertErrorConsistency(legacy, current);
      expect(result.passed).toBe(false);
      expect(result.errorTypeMatch).toBe(false);
    });
  });

  describe('inferErrorType', () => {
    it('should infer INVALID_USERNAME', () => {
      expect(inferErrorType('Invalid username', undefined)).toBe('INVALID_USERNAME');
      expect(inferErrorType('用户不存在', undefined)).toBe('INVALID_USERNAME');
      expect(inferErrorType(undefined, 'User not found')).toBe('INVALID_USERNAME');
    });

    it('should infer INVALID_PASSWORD', () => {
      expect(inferErrorType('Incorrect password', undefined)).toBe('INVALID_PASSWORD');
      expect(inferErrorType('密码错误', undefined)).toBe('INVALID_PASSWORD');
    });

    it('should infer TIMEOUT', () => {
      expect(inferErrorType('Connection timeout', undefined)).toBe('TIMEOUT');
      expect(inferErrorType('请求超时', undefined)).toBe('TIMEOUT');
    });

    it('should infer NETWORK_ERROR', () => {
      expect(inferErrorType('Network error', undefined)).toBe('NETWORK_ERROR');
      expect(inferErrorType('网络连接失败', undefined)).toBe('NETWORK_ERROR');
    });

    it('should infer UNKNOWN for unrecognized patterns', () => {
      expect(inferErrorType('Something went wrong', undefined)).toBe('UNKNOWN');
      expect(inferErrorType(undefined, undefined)).toBe('UNKNOWN');
    });
  });
});
