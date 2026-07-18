import { describe, it, expect } from 'vitest';
import { LegacyFlowAdapter } from '@flowtrace/adapter';
import type { ScenarioAction } from '@flowtrace/core';

describe('LegacyFlowAdapter', () => {
  const createContext = () => ({
    projectId: 'test-project',
    processId: 'test-process'
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      const adapter = new LegacyFlowAdapter(createContext());
      await expect(adapter.initialize()).resolves.toBeUndefined();
      expect(adapter.name).toBe('supply-chain-legacy');
      expect(adapter.type).toBe('legacy');
    });
  });

  describe('executeAction', () => {
    it('should execute SUBMIT action', async () => {
      const adapter = new LegacyFlowAdapter(createContext());
      await adapter.initialize();

      const action: ScenarioAction = {
        type: 'SUBMIT',
        actor: 'applicant'
      };

      const result = await adapter.executeAction(action, createContext());

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('SUBMIT');
      expect(result.finalState).toBeTruthy();
    });

    it('should execute APPROVE action', async () => {
      const adapter = new LegacyFlowAdapter(createContext());
      await adapter.initialize();

      const submitAction: ScenarioAction = {
        type: 'SUBMIT',
        actor: 'applicant'
      };
      await adapter.executeAction(submitAction, createContext());

      const approveAction: ScenarioAction = {
        type: 'APPROVE',
        actor: 'department_manager'
      };
      const result = await adapter.executeAction(approveAction, createContext());

      expect(result.finalState).toBeTruthy();
    });

    it('should execute REJECT action', async () => {
      const adapter = new LegacyFlowAdapter(createContext());
      await adapter.initialize();

      const submitAction: ScenarioAction = {
        type: 'SUBMIT',
        actor: 'applicant'
      };
      await adapter.executeAction(submitAction, createContext());

      const rejectAction: ScenarioAction = {
        type: 'REJECT',
        actor: 'department_manager',
        data: { reason: 'Test rejection' }
      };
      const result = await adapter.executeAction(rejectAction, createContext());

      expect(result.finalState).toBe('REJECTED');
    });

    it('should execute WITHDRAW action', async () => {
      const adapter = new LegacyFlowAdapter(createContext());
      await adapter.initialize();

      const submitAction: ScenarioAction = {
        type: 'SUBMIT',
        actor: 'applicant'
      };
      await adapter.executeAction(submitAction, createContext());

      const withdrawAction: ScenarioAction = {
        type: 'WITHDRAW',
        actor: 'applicant'
      };
      const result = await adapter.executeAction(withdrawAction, createContext());

      expect(result.finalState).toBe('WITHDRAWN');
    });

    it('should execute RETURN action', async () => {
      const adapter = new LegacyFlowAdapter(createContext());
      await adapter.initialize();

      const submitAction: ScenarioAction = {
        type: 'SUBMIT',
        actor: 'applicant'
      };
      await adapter.executeAction(submitAction, createContext());

      const returnAction: ScenarioAction = {
        type: 'RETURN',
        actor: 'risk_control_officer',
        data: { reason: 'Need more info' }
      };
      const result = await adapter.executeAction(returnAction, createContext());

      expect(result.finalState).toBe('RETURNED');
    });
  });

  describe('executeScenario', () => {
    it('should execute a complete scenario', async () => {
      const adapter = new LegacyFlowAdapter(createContext());
      await adapter.initialize();

      const scenario = {
        id: 'test-scenario',
        name: 'Test Scenario',
        process: 'test-process',
        actions: [
          { type: 'SUBMIT', actor: 'applicant' },
          { type: 'APPROVE', actor: 'department_manager' }
        ],
        expected: {
          finalState: 'COMPLETED',
          semanticPath: ['SUBMIT', 'APPROVE', 'COMPLETED']
        }
      };

      const result = await adapter.executeScenario(scenario, createContext());

      expect(result.scenarioId).toBeTruthy();
      expect(result.adapter).toBe('legacy');
      expect(result.actions).toHaveLength(2);
      expect(result.finalState).toBeTruthy();
    });
  });

  describe('cleanup', () => {
    it('should cleanup successfully', async () => {
      const adapter = new LegacyFlowAdapter(createContext());
      await adapter.initialize();
      await expect(adapter.cleanup()).resolves.toBeUndefined();
    });
  });
});
