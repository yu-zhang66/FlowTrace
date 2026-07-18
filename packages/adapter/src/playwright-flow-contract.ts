import type { Scenario, ScenarioAction } from '@flowtrace/core';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

export async function loadPlaywrightFlowAdapter(projectRoot: string, side: 'legacy' | 'current', evidenceDir: string): Promise<PlaywrightFlowAdapter> {
  const configPath = join(resolve(projectRoot), '.flowtrace', 'adapters', `${side}-playwright-adapter.mjs`);
  const adaptersRoot = resolve(projectRoot, '.flowtrace', 'adapters');
  if (!resolve(configPath).startsWith(adaptersRoot + '/') || !existsSync(configPath)) throw new Error(`Playwright adapter not found for ${side}: ${configPath}`);
  const module = await import(configPath);
  const factory = module.default ?? module[`create${side[0].toUpperCase()}${side.slice(1)}PlaywrightAdapter`] ?? module.createPlaywrightAdapter;
  if (typeof factory !== 'function') throw new Error(`Adapter ${configPath} must export a factory`);
  const adapter = await factory({ side, projectRoot: resolve(projectRoot), evidenceDir });
  if (!adapter || typeof adapter.executeAction !== 'function' || typeof adapter.cleanup !== 'function') throw new Error(`Adapter ${configPath} does not satisfy PlaywrightFlowAdapter`);
  return adapter as PlaywrightFlowAdapter;
}

export interface NormalizedObservation {
  finalState: string;
  semanticPath: string[];
  assertions: Array<{ name: string; passed: boolean; expected?: unknown; actual?: unknown }>;
  currentUrl: string;
  evidence: string[];
  error?: string;
}
export interface PlaywrightFlowAdapter {
  readonly name: string;
  readonly side: 'legacy' | 'current';
  initialize(): Promise<void>;
  reset(): Promise<void>;
  executeAction(action: ScenarioAction): Promise<NormalizedObservation>;
  observe(): Promise<NormalizedObservation>;
  cleanup(): Promise<void>;
}
export type PlaywrightFlowAdapterFactory = (options: { side: 'legacy' | 'current'; projectRoot: string; evidenceDir: string }) => PlaywrightFlowAdapter;

export interface DualRunResult { mode: 'dual-browser'; legacy: NormalizedObservation; current: NormalizedObservation; differences: string[]; legacyShadow: boolean; }

export async function runPlaywrightDualRun(scenario: Scenario, adapters: { legacy: PlaywrightFlowAdapter; current: PlaywrightFlowAdapter }, legacyShadow = false): Promise<DualRunResult> {
  if (scenario.enabled === false || scenario.status === 'NEEDS_REVIEW' || scenario.review?.status === 'NEEDS_REVIEW') throw new Error(`Scenario ${scenario.id} is not confirmed/enabled`);
  await Promise.all([adapters.legacy.initialize(), adapters.current.initialize()]);
  try {
    await Promise.all([adapters.legacy.reset(), adapters.current.reset()]);
    for (const action of scenario.actions) await Promise.all([adapters.legacy.executeAction(action), adapters.current.executeAction(action)]);
    const [legacy, current] = await Promise.all([adapters.legacy.observe(), adapters.current.observe()]);
    const differences: string[] = [];
    if (legacy.finalState !== current.finalState) differences.push('finalState differs between legacy and current');
    if (scenario.expected.finalState !== 'UNKNOWN' && legacy.finalState !== scenario.expected.finalState) differences.push('legacy finalState does not match expected');
    if (scenario.expected.finalState !== 'UNKNOWN' && current.finalState !== scenario.expected.finalState) differences.push('current finalState does not match expected');
    return { mode: 'dual-browser', legacy, current, differences, legacyShadow };
  } finally { await Promise.allSettled([adapters.legacy.cleanup(), adapters.current.cleanup()]); }
}
