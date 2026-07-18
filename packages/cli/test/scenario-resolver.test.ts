import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import {
  resolveScenarios,
  findLoginScenarios,
  findScenarioById,
  checkScenarioSecurity,
  loadScenariosFromDir
} from '../../cli/src/commands/test/scenario-resolver.js';

describe('Scenario Resolver', () => {
  const testDir = join(process.cwd(), '.test-scenarios-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('loadScenariosFromDir', () => {
    it('should load scenarios from directory', () => {
      const scenario = {
        id: 'test-001',
        name: 'Test Scenario',
        process: 'login',
        actions: [{ type: 'LOGIN', actor: 'test' }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      writeFileSync(join(testDir, 'scenario.json'), JSON.stringify(scenario));
      const scenarios = loadScenariosFromDir(testDir);

      expect(scenarios.length).toBe(1);
      expect((scenarios[0] as any).id).toBe('test-001');
    });

    it('should load scenarios from nested directories', () => {
      const nestedDir = join(testDir, 'nested');
      mkdirSync(nestedDir, { recursive: true });

      const scenario = {
        id: 'nested-001',
        name: 'Nested Scenario',
        process: 'login',
        actions: [{ type: 'LOGIN', actor: 'test' }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      writeFileSync(join(nestedDir, 'scenario.yaml'), `
id: nested-001
name: Nested Scenario
process: login
actions:
  - type: LOGIN
    actor: test
expected:
  finalState: AUTHENTICATED
`);
      const scenarios = loadScenariosFromDir(testDir);

      expect(scenarios.length).toBe(1);
      expect((scenarios[0] as any).id).toBe('nested-001');
    });

    it('should return empty array for non-existent directory', () => {
      const scenarios = loadScenariosFromDir('/non-existent/path');
      expect(scenarios.length).toBe(0);
    });
  });

  describe('resolveScenarios', () => {
    beforeEach(() => {
      // Create test scenarios
      const loginScenario = {
        id: 'login-success-001',
        name: 'Login Success',
        process: 'login',
        enabled: true,
        actions: [{ type: 'LOGIN', actor: 'supplier', data: { usernameRef: 'USER', passwordRef: 'PASS' } }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      const submitScenario = {
        id: 'submit-001',
        name: 'Submit',
        process: 'submit',
        enabled: true,
        actions: [{ type: 'SUBMIT', actor: 'supplier' }],
        expected: { finalState: 'SUBMITTED' }
      };

      const disabledScenario = {
        id: 'login-disabled-001',
        name: 'Login Disabled',
        process: 'login',
        enabled: false,
        actions: [{ type: 'LOGIN', actor: 'supplier', data: { usernameRef: 'USER', passwordRef: 'PASS' } }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      writeFileSync(join(testDir, 'login.json'), JSON.stringify(loginScenario));
      writeFileSync(join(testDir, 'submit.json'), JSON.stringify(submitScenario));
      writeFileSync(join(testDir, 'disabled.json'), JSON.stringify(disabledScenario));
    });

    it('should resolve all enabled scenarios', () => {
      const result = resolveScenarios({
        scenariosDir: testDir,
        filter: { enabledOnly: true }
      });

      // Only enabled scenarios: login-success-001 and submit-001
      // disabledScenario has enabled: false
      expect(result.validScenarios.length).toBe(2);
      expect(result.invalidScenarios.length).toBe(0);
    });

    it('should filter by process', () => {
      const result = resolveScenarios({
        scenariosDir: testDir,
        filter: { process: 'login', enabledOnly: true }
      });

      expect(result.validScenarios.length).toBe(1);
      expect(result.validScenarios[0].scenario.id).toBe('login-success-001');
    });

    it('should filter by id', () => {
      const result = resolveScenarios({
        scenariosDir: testDir,
        filter: { id: 'submit-001' }
      });

      expect(result.validScenarios.length).toBe(1);
      expect(result.validScenarios[0].scenario.id).toBe('submit-001');
    });

    it('should filter by enabledOnly', () => {
      const result = resolveScenarios({
        scenariosDir: testDir,
        filter: { enabledOnly: true }
      });

      expect(result.validScenarios.length).toBe(2);
    });

    it('should filter by tags', () => {
      const taggedScenario = {
        id: 'login-tagged-001',
        name: 'Login Tagged',
        process: 'login',
        enabled: true,
        tags: ['critical', 'P0'],
        actions: [{ type: 'LOGIN', actor: 'supplier', data: { usernameRef: 'USER', passwordRef: 'PASS' } }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      writeFileSync(join(testDir, 'tagged.json'), JSON.stringify(taggedScenario));

      // Filter by tags AND enabled status to get only the tagged enabled scenario
      const result = resolveScenarios({
        scenariosDir: testDir,
        filter: { tags: ['critical'], enabledOnly: true }
      });

      expect(result.validScenarios.length).toBe(1);
      expect(result.validScenarios[0].scenario.id).toBe('login-tagged-001');
    });
  });

  describe('findLoginScenarios', () => {
    beforeEach(() => {
      const loginScenario = {
        id: 'login-001',
        name: 'Login',
        process: 'login',
        enabled: true,
        actions: [{ type: 'LOGIN', actor: 'supplier', data: { usernameRef: 'USER', passwordRef: 'PASS' } }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      const submitScenario = {
        id: 'submit-001',
        name: 'Submit',
        process: 'submit',
        enabled: true,
        actions: [{ type: 'SUBMIT', actor: 'supplier' }],
        expected: { finalState: 'SUBMITTED' }
      };

      writeFileSync(join(testDir, 'login.json'), JSON.stringify(loginScenario));
      writeFileSync(join(testDir, 'submit.json'), JSON.stringify(submitScenario));
    });

    it('should find only login process scenarios', () => {
      const result = findLoginScenarios(testDir);

      expect(result.validScenarios.length).toBe(1);
      expect(result.validScenarios[0].scenario.process).toBe('login');
    });
  });

  describe('findScenarioById', () => {
    beforeEach(() => {
      const scenario = {
        id: 'specific-id-001',
        name: 'Specific ID',
        process: 'login',
        enabled: true,
        actions: [{ type: 'LOGIN', actor: 'supplier', data: { usernameRef: 'USER', passwordRef: 'PASS' } }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      writeFileSync(join(testDir, 'scenario.json'), JSON.stringify(scenario));
    });

    it('should find scenario by id', () => {
      const result = findScenarioById(testDir, 'specific-id-001');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('specific-id-001');
    });

    it('should return null for non-existent id', () => {
      const result = findScenarioById(testDir, 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('checkScenarioSecurity', () => {
    it('should pass for scenario with credential refs', () => {
      const scenario = {
        id: 'secure-001',
        name: 'Secure',
        process: 'login',
        actions: [{
          type: 'LOGIN',
          actor: 'supplier',
          data: { usernameRef: 'SUPPLIER_USERNAME', passwordRef: 'SUPPLIER_PASSWORD' }
        }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      const result = checkScenarioSecurity(scenario);

      expect(result.hasIssues).toBe(false);
      expect(result.issues.length).toBe(0);
    });

    it('should detect plaintext password', () => {
      const scenario = {
        id: 'insecure-001',
        name: 'Insecure',
        process: 'login',
        actions: [{
          type: 'LOGIN',
          actor: 'supplier',
          data: { username: 'test', password: 'secret123' }
        }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      const result = checkScenarioSecurity(scenario);

      expect(result.hasIssues).toBe(true);
      expect(result.issues.some(i => i.includes('password'))).toBe(true);
    });

    it('should detect plaintext token', () => {
      const scenario = {
        id: 'insecure-002',
        name: 'Insecure',
        process: 'login',
        actions: [{
          type: 'LOGIN',
          actor: 'supplier',
          data: { token: 'Bearer eyJhbGciOiJIUzI1NiJ9.test' }
        }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      const result = checkScenarioSecurity(scenario);

      expect(result.hasIssues).toBe(true);
    });

    it('should detect cookie fields', () => {
      const scenario = {
        id: 'insecure-003',
        name: 'Insecure',
        process: 'login',
        actions: [{
          type: 'LOGIN',
          actor: 'supplier',
          data: { cookie: 'session=abc123' }
        }],
        expected: { finalState: 'AUTHENTICATED' }
      };

      const result = checkScenarioSecurity(scenario);

      expect(result.hasIssues).toBe(true);
      expect(result.issues.some(i => i.includes('cookie'))).toBe(true);
    });
  });
});
