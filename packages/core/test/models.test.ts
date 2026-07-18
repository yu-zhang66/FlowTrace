import { describe, it, expect } from 'vitest';
import {
  ScenarioSchema,
  BusinessActionType,
  validateScenario,
  generateId,
  ConfigLoader
} from '@flowtrace/core';

describe('Core Models', () => {
  describe('BusinessActionType', () => {
    it('should accept valid action types', () => {
      const validActions = ['SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'WITHDRAW', 'TRANSFER', 'COUNTERSIGN'];
      validActions.forEach(action => {
        const result = BusinessActionType.safeParse(action);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid action types', () => {
      const result = BusinessActionType.safeParse('INVALID_ACTION');
      expect(result.success).toBe(false);
    });
  });

  describe('Scenario Schema', () => {
    it('should validate a complete scenario', () => {
      const scenario = {
        id: 'test-scenario-001',
        name: 'Test Scenario',
        process: 'test-process',
        actions: [
          { type: 'SUBMIT', actor: 'applicant' },
          { type: 'APPROVE', actor: 'manager' }
        ],
        expected: {
          finalState: 'COMPLETED',
          semanticPath: ['SUBMIT', 'APPROVE', 'COMPLETED']
        }
      };

      const result = ScenarioSchema.safeParse(scenario);
      expect(result.success).toBe(true);
    });

    it('should reject scenario without actions', () => {
      const scenario = {
        id: 'test-scenario-002',
        name: 'Test Scenario',
        process: 'test-process',
        actions: [],
        expected: {
          finalState: 'COMPLETED'
        }
      };

      const result = ScenarioSchema.safeParse(scenario);
      expect(result.success).toBe(false);
    });

    it('should reject scenario without expected finalState', () => {
      const scenario = {
        id: 'test-scenario-003',
        name: 'Test Scenario',
        process: 'test-process',
        actions: [
          { type: 'SUBMIT', actor: 'applicant' }
        ],
        expected: {}
      };

      const result = ScenarioSchema.safeParse(scenario);
      expect(result.success).toBe(false);
    });
  });

  describe('validateScenario', () => {
    it('should return valid for correct scenarios', () => {
      const scenario = {
        id: 'test-scenario-001',
        name: 'Test Scenario',
        process: 'test-process',
        actions: [
          { type: 'SUBMIT', actor: 'applicant' }
        ],
        expected: {
          finalState: 'COMPLETED'
        }
      };

      const result = validateScenario(scenario);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return errors for invalid scenarios', () => {
      const scenario = {
        id: '',
        name: 'Test',
        process: 'test',
        actions: [],
        expected: { finalState: 'TEST' }
      };

      const result = validateScenario(scenario);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });
});

describe('ConfigLoader', () => {
  it('should generate unique IDs', () => {
    const id1 = generateId('test');
    const id2 = generateId('test');

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    expect(id1.startsWith('test-')).toBe(true);
  });

  it('should generate IDs with prefix', () => {
    const id = generateId('scenario');
    expect(id).toMatch(/^scenario-[a-z0-9]+-[a-z0-9]+$/);
  });

  it('should generate IDs without prefix', () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });
});

describe('Difference Classification', () => {
  it('should classify final_state as P0', async () => {
    const { classifySeverity } = await import('@flowtrace/core');

    const diff = {
      id: 'diff-001',
      scenarioId: 'scenario-001',
      category: 'final_state' as const,
      severity: 'P0' as const,
      description: 'Final state mismatch',
      legacyValue: 'APPROVED',
      currentValue: 'REJECTED',
      isBlocking: true
    };

    expect(classifySeverity(diff)).toBe('P0');
  });

  it('should classify semantic_path as P1', async () => {
    const { classifySeverity } = await import('@flowtrace/core');

    const diff = {
      id: 'diff-002',
      scenarioId: 'scenario-001',
      category: 'semantic_path' as const,
      severity: 'P1' as const,
      description: 'Path differs',
      legacyValue: ['A', 'B', 'C'],
      currentValue: ['A', 'C'],
      isBlocking: false
    };

    expect(classifySeverity(diff)).toBe('P1');
  });
});
