import { describe, expect, it, vi } from 'vitest';
import { runPlaywrightDualRun, type PlaywrightFlowAdapter } from '../src/playwright-flow-contract';
import type { Scenario } from '@flowtrace/core';

const scenario = { id: 's', name: 'confirmed', process: 'p', status: 'CONFIRMED', enabled: true, actions: [{ type: 'SUBMIT', actor: 'u' }], expected: { finalState: 'DONE' } } as Scenario;
function adapter(side: 'legacy' | 'current', state: string): PlaywrightFlowAdapter {
  return { name: side, side, initialize: vi.fn(async () => {}), reset: vi.fn(async () => {}), executeAction: vi.fn(async () => observation(state)), observe: vi.fn(async () => observation(state)), cleanup: vi.fn(async () => {}) };
}
function observation(state: string) { return { finalState: state, semanticPath: [state], assertions: [{ name: 'state', passed: true }], currentUrl: 'http://target', evidence: [] }; }

describe('Playwright dual-run contract', () => {
  it('runs isolated adapters and reports differences', async () => {
    const legacy = adapter('legacy', 'DONE'); const current = adapter('current', 'PENDING');
    const result = await runPlaywrightDualRun(scenario, { legacy, current }, true);
    expect(result.differences).toContain('finalState differs between legacy and current');
    expect(legacy.reset).toHaveBeenCalled(); expect(current.reset).toHaveBeenCalled();
    expect(legacy.cleanup).toHaveBeenCalled(); expect(current.cleanup).toHaveBeenCalled();
    expect(result.legacyShadow).toBe(true);
  });
  it('refuses unconfirmed candidates', async () => {
    await expect(runPlaywrightDualRun({ ...scenario, status: 'NEEDS_REVIEW', enabled: false }, { legacy: adapter('legacy', 'X'), current: adapter('current', 'X') })).rejects.toThrow('not confirmed');
  });
});
