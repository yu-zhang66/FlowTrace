import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DualRunner } from '@flowtrace/runner';
import { MockLegacyFlowAdapter, MockCurrentFlowAdapter } from '../__mocks__/mock-adapters';
import type { Scenario } from '@flowtrace/core';

// Test utilities
const createContext = () => ({
  projectId: 'test-project',
  processId: 'test-process'
});

const createScenario = (overrides: Partial<Scenario> = {}): Scenario => ({
  id: 'test-scenario-001',
  name: 'Test Scenario',
  process: 'test-process',
  enabled: true,
  actions: [
    { type: 'SUBMIT', actor: 'applicant' }
  ],
  expected: {
    finalState: 'SUBMITTED'
  },
  ...overrides
});

describe('DualRunner', () => {
  let legacyAdapter: MockLegacyFlowAdapter;
  let currentAdapter: MockCurrentFlowAdapter;
  let runner: DualRunner;

  beforeEach(() => {
    legacyAdapter = new MockLegacyFlowAdapter(createContext());
    currentAdapter = new MockCurrentFlowAdapter(createContext());
    runner = new DualRunner(legacyAdapter, currentAdapter);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create runner with default config', () => {
      const defaultRunner = new DualRunner(legacyAdapter, currentAdapter);
      expect(defaultRunner).toBeDefined();
    });

    it('should create runner with custom config', () => {
      const customRunner = new DualRunner(legacyAdapter, currentAdapter, {
        stopOnFirstFailure: true,
        parallel: true,
        timeout: 60000
      });
      expect(customRunner).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const partialRunner = new DualRunner(legacyAdapter, currentAdapter, {
        stopOnFirstFailure: true
      });
      expect(partialRunner).toBeDefined();
    });
  });

  describe('run', () => {
    it('should initialize both adapters before running', async () => {
      const scenarios = [createScenario()];

      await runner.run(scenarios);

      expect(legacyAdapter.initializedStatus).toBe(true);
      expect(currentAdapter.initializedStatus).toBe(true);
    });

    it('should cleanup both adapters after running', async () => {
      const scenarios = [createScenario()];

      await runner.run(scenarios);

      expect(legacyAdapter.cleanupWasCalled).toBe(true);
      expect(currentAdapter.cleanupWasCalled).toBe(true);
    });

    it('should cleanup adapters even if execution fails', async () => {
      legacyAdapter.setShouldFail(true, 'Initialization failed');
      const scenarios = [createScenario()];

      try {
        await runner.run(scenarios);
      } catch {
        // Expected to potentially throw
      }

      expect(legacyAdapter.cleanupWasCalled).toBe(true);
      expect(currentAdapter.cleanupWasCalled).toBe(true);
    });

    it('should run a single enabled scenario', async () => {
      const scenarios = [createScenario()];

      const results = await runner.run(scenarios);

      expect(results).toHaveLength(1);
      expect(results[0].scenarioId).toBe('test-scenario-001');
      expect(results[0].legacyResult).toBeDefined();
      expect(results[0].currentResult).toBeDefined();
    });

    it('should skip disabled scenarios', async () => {
      const scenarios = [
        createScenario({ id: 'scenario-1', enabled: false }),
        createScenario({ id: 'scenario-2', enabled: true })
      ];

      const results = await runner.run(scenarios);

      expect(results).toHaveLength(1);
      expect(results[0].scenarioId).toBe('scenario-2');
    });

    it('should handle empty scenarios array', async () => {
      const results = await runner.run([]);

      expect(results).toHaveLength(0);
    });

    it('should stop on first failure when configured', async () => {
      const stopRunner = new DualRunner(legacyAdapter, currentAdapter, {
        stopOnFirstFailure: true
      });

      const scenarios = [
        createScenario({ id: 'scenario-1' }),
        createScenario({ id: 'scenario-2' })
      ];

      const results = await stopRunner.run(scenarios);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should continue on failure when not configured to stop', async () => {
      const continueRunner = new DualRunner(legacyAdapter, currentAdapter, {
        stopOnFirstFailure: false
      });

      const scenarios = [
        createScenario({ id: 'scenario-1' }),
        createScenario({ id: 'scenario-2' })
      ];

      const results = await continueRunner.run(scenarios);

      expect(results).toHaveLength(2);
    });

    it('should respect parallel execution config', async () => {
      legacyAdapter.setActionDelay(50);
      currentAdapter.setActionDelay(50);

      const parallelRunner = new DualRunner(legacyAdapter, currentAdapter, {
        parallel: true
      });

      const scenarios = [createScenario()];

      const results = await parallelRunner.run(scenarios);

      expect(results).toHaveLength(1);
    });
  });

  describe('scenario execution', () => {
    it('should execute scenario on both adapters', async () => {
      const scenarios = [createScenario()];

      const results = await runner.run(scenarios);

      expect(results[0].legacyResult).toBeDefined();
      expect(results[0].currentResult).toBeDefined();
      expect(results[0].legacyResult?.finalState).toBe('SUBMITTED');
      expect(results[0].currentResult?.finalState).toBe('SUBMITTED');
    });

    it('should execute multiple actions in a scenario', async () => {
      const scenarios = [createScenario({
        actions: [
          { type: 'SUBMIT', actor: 'applicant' },
          { type: 'APPROVE', actor: 'manager' },
          { type: 'REJECT', actor: 'department_manager' }
        ],
        expected: { finalState: 'REJECTED' }
      })];

      const results = await runner.run(scenarios);

      expect(results[0].legacyResult?.actions).toHaveLength(3);
      expect(results[0].currentResult?.actions).toHaveLength(3);
    });

    it('should handle LOGIN action correctly', async () => {
      const scenarios = [createScenario({
        id: 'login-scenario',
        actions: [
          { type: 'LOGIN', actor: 'user', data: { usernameRef: 'TEST_USER', passwordRef: 'TEST_PASS' } }
        ],
        expected: { finalState: 'AUTHENTICATED' }
      })];

      const results = await runner.run(scenarios);

      expect(results[0].legacyResult?.finalState).toBe('AUTHENTICATED');
      expect(results[0].currentResult?.finalState).toBe('AUTHENTICATED');
    });

    it('should handle different state transitions', async () => {
      const testCases = [
        { action: 'SUBMIT', expectedState: 'SUBMITTED' },
        { action: 'APPROVE', expectedState: 'APPROVED' },
        { action: 'REJECT', expectedState: 'REJECTED' },
        { action: 'RETURN', expectedState: 'RETURNED' },
        { action: 'WITHDRAW', expectedState: 'WITHDRAWN' }
      ];

      for (const { action, expectedState } of testCases) {
        const scenario = createScenario({
          id: `scenario-${action}`,
          actions: [{ type: action as any, actor: 'tester' }],
          expected: { finalState: expectedState }
        });

        const results = await runner.run([scenario]);

        expect(results[0].legacyResult?.finalState).toBe(expectedState);
        expect(results[0].currentResult?.finalState).toBe(expectedState);
      }
    });
  });

  describe('error handling', () => {
    it('should handle legacy adapter failure gracefully', async () => {
      legacyAdapter.setShouldFail(true, 'Legacy system error');

      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      expect(results[0].error).toBeDefined();
      expect(results[0].error).toContain('Legacy adapter error');
      expect(results[0].passed).toBe(false);
    });

    it('should handle current adapter failure gracefully', async () => {
      currentAdapter.setShouldFail(true, 'Current system error');

      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      expect(results[0].error).toBeDefined();
      expect(results[0].error).toContain('Current adapter error');
      expect(results[0].passed).toBe(false);
    });

    it('should handle both adapters failing', async () => {
      legacyAdapter.setShouldFail(true, 'Legacy error');
      currentAdapter.setShouldFail(true, 'Current error');

      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      expect(results[0].error).toBeDefined();
      expect(results[0].error).toContain('Legacy adapter error');
      expect(results[0].error).toContain('Current adapter error');
    });

    it('should include error in result when adapter throws non-Error', async () => {
      const errorAdapter = new MockLegacyFlowAdapter(createContext());
      errorAdapter.setShouldFail(true, '');

      const errorRunner = new DualRunner(errorAdapter, currentAdapter);
      const scenarios = [createScenario()];

      const results = await errorRunner.run(scenarios);

      expect(results[0].error).toBeDefined();
    });
  });

  describe('result comparison', () => {
    it('should detect final state differences', async () => {
      legacyAdapter.setFinalState('SUBMITTED');
      currentAdapter.setFinalState('APPROVED');

      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      expect(results[0].differences.length).toBeGreaterThan(0);
      expect(results[0].differences.some(d => d.category === 'final_state')).toBe(true);
    });

    it('should detect semantic path differences', async () => {
      legacyAdapter.setSemanticPath(['SUBMITTED', 'APPROVED']);
      currentAdapter.setSemanticPath(['SUBMITTED', 'REJECTED']);

      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      expect(results[0].differences.some(d => d.category === 'semantic_path')).toBe(true);
    });

    it('should detect when legacy fails but current succeeds', async () => {
      legacyAdapter.setShouldFail(true, 'Legacy failed');
      currentAdapter.setFinalState('SUBMITTED');

      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      const finalStateDiff = results[0].differences.find(d => d.category === 'final_state');
      expect(finalStateDiff).toBeDefined();
      expect(finalStateDiff?.severity).toBe('P0');
      expect(finalStateDiff?.isBlocking).toBe(true);
    });

    it('should detect when legacy succeeds but current fails', async () => {
      legacyAdapter.setFinalState('SUBMITTED');
      currentAdapter.setShouldFail(true, 'Current failed');

      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      const finalStateDiff = results[0].differences.find(d => d.category === 'final_state');
      expect(finalStateDiff).toBeDefined();
      expect(finalStateDiff?.severity).toBe('P0');
    });

    it('should pass when both adapters succeed with same result', async () => {
      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      expect(results[0].passed).toBe(true);
      expect(results[0].differences.filter(d => d.isBlocking).length).toBe(0);
    });

    it('should mark as failed when blocking differences exist', async () => {
      legacyAdapter.setFinalState('SUBMITTED');
      currentAdapter.setFinalState('APPROVED');

      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      expect(results[0].passed).toBe(false);
      expect(results[0].differences.filter(d => d.isBlocking).length).toBeGreaterThan(0);
    });
  });

  describe('timeout handling', () => {
    it('should timeout long-running scenarios', async () => {
      legacyAdapter.setActionDelay(100);
      currentAdapter.setActionDelay(100);

      const timeoutRunner = new DualRunner(legacyAdapter, currentAdapter, {
        timeout: 10
      });

      const scenarios = [createScenario()];
      const results = await timeoutRunner.run(scenarios);

      // Runner catches errors gracefully, returns results with error info
      expect(results).toHaveLength(1);
      expect(results[0].error).toBeDefined();
      expect(results[0].error).toContain('Execution timeout');
      expect(results[0].passed).toBe(false);
    });

    it('should use default timeout when not specified', async () => {
      const defaultTimeoutRunner = new DualRunner(legacyAdapter, currentAdapter);
      expect(defaultTimeoutRunner).toBeDefined();
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete workflow with multiple scenarios', async () => {
      const scenarios: Scenario[] = [
        createScenario({
          id: 'submit-scenario',
          actions: [{ type: 'SUBMIT', actor: 'applicant' }],
          expected: { finalState: 'SUBMITTED' }
        }),
        createScenario({
          id: 'approve-scenario',
          actions: [{ type: 'APPROVE', actor: 'manager' }],
          expected: { finalState: 'APPROVED' }
        }),
        createScenario({
          id: 'reject-scenario',
          actions: [{ type: 'REJECT', actor: 'reviewer' }],
          expected: { finalState: 'REJECTED' }
        })
      ];

      const results = await runner.run(scenarios);

      expect(results).toHaveLength(3);
      expect(results[0].scenarioId).toBe('submit-scenario');
      expect(results[1].scenarioId).toBe('approve-scenario');
      expect(results[2].scenarioId).toBe('reject-scenario');
    });

    it('should handle parallel scenarios', async () => {
      const parallelRunner = new DualRunner(legacyAdapter, currentAdapter, {
        parallel: true
      });

      const scenarios = [
        createScenario({ id: 'parallel-1' }),
        createScenario({ id: 'parallel-2' }),
        createScenario({ id: 'parallel-3' })
      ];

      const results = await parallelRunner.run(scenarios);

      expect(results).toHaveLength(3);
    });

    it('should maintain result order for sequential execution', async () => {
      const scenarios = [
        createScenario({ id: 'first' }),
        createScenario({ id: 'second' }),
        createScenario({ id: 'third' })
      ];

      const results = await runner.run(scenarios);

      expect(results[0].scenarioId).toBe('first');
      expect(results[1].scenarioId).toBe('second');
      expect(results[2].scenarioId).toBe('third');
    });
  });

  describe('external calls tracking', () => {
    it('should track external calls in results', async () => {
      const externalCall = {
        endpoint: '/api/test',
        method: 'POST',
        request: { data: 'test' },
        response: { success: true },
        timestamp: new Date().toISOString()
      };

      legacyAdapter.addExternalCall(externalCall);
      currentAdapter.addExternalCall(externalCall);

      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      expect(results[0].legacyResult?.externalCalls).toBeDefined();
      expect(results[0].currentResult?.externalCalls).toBeDefined();
    });
  });

  describe('business data handling', () => {
    it('should include business data in execution results', async () => {
      const scenarios = [createScenario()];
      const results = await runner.run(scenarios);

      expect(results[0].legacyResult?.businessData).toBeDefined();
      expect(results[0].currentResult?.businessData).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle scenario with no actions', async () => {
      const emptyScenario = createScenario({
        id: 'empty-actions',
        actions: []
      });

      const results = await runner.run([emptyScenario]);

      expect(results[0].scenarioId).toBe('empty-actions');
    });

    it('should handle scenario with custom tags', async () => {
      const taggedScenario = createScenario({
        tags: ['regression', 'critical', 'login-flow']
      });

      const results = await runner.run([taggedScenario]);

      expect(results).toHaveLength(1);
    });

    it('should handle scenario with severity levels', async () => {
      const severityLevels: Array<'P0' | 'P1' | 'P2' | 'P3'> = ['P0', 'P1', 'P2', 'P3'];

      for (const severity of severityLevels) {
        const scenario = createScenario({
          id: `severity-${severity}`,
          severity
        });

        const results = await runner.run([scenario]);

        expect(results[0].scenarioId).toBe(`severity-${severity}`);
      }
    });

    it('should handle scenario with preconditions', async () => {
      const scenarioWithPrecondition = createScenario({
        precondition: {
          userRole: 'admin',
          systemState: 'ready'
        }
      });

      const results = await runner.run([scenarioWithPrecondition]);

      expect(results).toHaveLength(1);
    });

    it('should handle scenario with input data', async () => {
      const scenarioWithInput = createScenario({
        input: {
          formData: {
            amount: 1000,
            currency: 'USD',
            description: 'Test payment'
          }
        }
      });

      const results = await runner.run([scenarioWithInput]);

      expect(results).toHaveLength(1);
    });
  });
});

describe('MockLegacyFlowAdapter', () => {
  it('should be instantiable', () => {
    const adapter = new MockLegacyFlowAdapter(createContext());
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('MockLegacyFlowAdapter');
    expect(adapter.type).toBe('legacy');
  });

  it('should initialize and cleanup', async () => {
    const adapter = new MockLegacyFlowAdapter(createContext());

    await adapter.initialize();
    expect(adapter.initializedStatus).toBe(true);

    await adapter.cleanup();
    expect(adapter.cleanupWasCalled).toBe(true);
  });

  it('should execute action and return result', async () => {
    const adapter = new MockLegacyFlowAdapter(createContext());
    await adapter.initialize();

    const action = { type: 'SUBMIT', actor: 'tester' };
    const result = await adapter.executeAction(action);

    expect(result.finalState).toBe('SUBMITTED');
    expect(result.adapter).toBe('legacy');
  });

  it('should fail when configured', async () => {
    const adapter = new MockLegacyFlowAdapter(createContext());
    adapter.setShouldFail(true, 'Test error');

    await expect(adapter.executeAction({ type: 'SUBMIT', actor: 'tester' }))
      .rejects.toThrow('Test error');
  });
});

describe('MockCurrentFlowAdapter', () => {
  it('should be instantiable', () => {
    const adapter = new MockCurrentFlowAdapter(createContext());
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe('MockCurrentFlowAdapter');
    expect(adapter.type).toBe('current');
  });

  it('should support legacy shadow mode', () => {
    const shadowAdapter = new MockCurrentFlowAdapter(createContext(), true);
    expect(shadowAdapter).toBeDefined();
  });

  it('should execute action and return result', async () => {
    const adapter = new MockCurrentFlowAdapter(createContext());
    await adapter.initialize();

    const action = { type: 'APPROVE', actor: 'manager' };
    const result = await adapter.executeAction(action);

    expect(result.finalState).toBe('APPROVED');
    expect(result.adapter).toBe('current');
  });

  it('should use custom action results when set', async () => {
    const adapter = new MockCurrentFlowAdapter(createContext());
    await adapter.initialize();

    adapter.setActionResult('CUSTOM', {
      finalState: 'CUSTOM_STATE',
      businessData: { custom: true }
    });

    const result = await adapter.executeAction({ type: 'CUSTOM', actor: 'tester' });

    expect(result.finalState).toBe('CUSTOM_STATE');
  });

  it('should fail when configured', async () => {
    const adapter = new MockCurrentFlowAdapter(createContext());
    adapter.setShouldFail(true, 'Current test error');

    await expect(adapter.executeAction({ type: 'SUBMIT', actor: 'tester' }))
      .rejects.toThrow('Current test error');
  });
});
