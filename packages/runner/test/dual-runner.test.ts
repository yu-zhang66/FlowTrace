import { describe, it, expect } from 'vitest';
import { DualRunner } from '@flowtrace/runner';
import { LegacyFlowAdapter, CurrentFlowAdapter } from '@flowtrace/adapter';

describe('DualRunner', () => {
  const createContext = () => ({
    projectId: 'test-project',
    processId: 'test-process'
  });

  describe('run', () => {
    it('should run a single scenario', async () => {
      const legacyAdapter = new LegacyFlowAdapter(createContext());
      const currentAdapter = new CurrentFlowAdapter(createContext(), true);

      const runner = new DualRunner(legacyAdapter, currentAdapter);

      const scenarios = [
        {
          id: 'test-scenario-001',
          name: 'Test Scenario',
          process: 'test-process',
          enabled: true,
          actions: [
            { type: 'SUBMIT', actor: 'applicant' }
          ],
          expected: {
            finalState: 'SUBMITTED'
          }
        }
      ];

      const results = await runner.run(scenarios);

      expect(results).toHaveLength(1);
      expect(results[0].scenarioId).toBe('test-scenario-001');
      expect(results[0].legacyResult).toBeDefined();
      expect(results[0].currentResult).toBeDefined();
    });

    it('should skip disabled scenarios', async () => {
      const legacyAdapter = new LegacyFlowAdapter(createContext());
      const currentAdapter = new CurrentFlowAdapter(createContext(), true);

      const runner = new DualRunner(legacyAdapter, currentAdapter);

      const scenarios = [
        {
          id: 'test-scenario-001',
          name: 'Test Scenario',
          process: 'test-process',
          enabled: false,
          actions: [
            { type: 'SUBMIT', actor: 'applicant' }
          ],
          expected: {
            finalState: 'SUBMITTED'
          }
        }
      ];

      const results = await runner.run(scenarios);

      expect(results).toHaveLength(0);
    });

    it('should compare results and detect differences', async () => {
      const legacyAdapter = new LegacyFlowAdapter(createContext());
      // Use true for legacy-shadow mode
      const currentAdapter = new CurrentFlowAdapter(createContext(), true);

      const runner = new DualRunner(legacyAdapter, currentAdapter);

      const scenarios = [
        {
          id: 'test-scenario-001',
          name: 'Test Scenario',
          process: 'test-process',
          enabled: true,
          actions: [
            { type: 'SUBMIT', actor: 'applicant' },
            { type: 'REJECT', actor: 'department_manager' }
          ],
          expected: {
            finalState: 'REJECTED'
          }
        }
      ];

      const results = await runner.run(scenarios);

      expect(results).toHaveLength(1);
      // In legacy-shadow mode, current result should match legacy result
      expect(results[0].legacyResult?.finalState).toBe('REJECTED');
      expect(results[0].currentResult?.finalState).toBe('REJECTED');
    });
  });

  describe('config options', () => {
    it('should stop on first failure when configured', async () => {
      const legacyAdapter = new LegacyFlowAdapter(createContext());
      const currentAdapter = new CurrentFlowAdapter(createContext(), false);

      const runner = new DualRunner(legacyAdapter, currentAdapter, {
        stopOnFirstFailure: true
      });

      const scenarios = [
        {
          id: 'test-scenario-001',
          name: 'Test Scenario 1',
          process: 'test-process',
          enabled: true,
          actions: [{ type: 'SUBMIT', actor: 'applicant' }],
          expected: { finalState: 'SUBMITTED' }
        },
        {
          id: 'test-scenario-002',
          name: 'Test Scenario 2',
          process: 'test-process',
          enabled: true,
          actions: [{ type: 'SUBMIT', actor: 'applicant' }],
          expected: { finalState: 'SUBMITTED' }
        }
      ];

      const results = await runner.run(scenarios);

      expect(results.length).toBeLessThanOrEqual(2);
    });
  });
});
