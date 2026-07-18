import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateForCommand, runGate } from '../src/command-gate.js';
import { loadTargetProjectConfig } from '../src/target-config.js';
import { createConfirmedState, writeRecordingState } from '../src/recording-state.js';

interface ScenarioFixture {
  id: string;
  process: string;
  invalid?: boolean;
}

function createRoot(): string {
  return mkdtempSync(join(tmpdir(), 'flowtrace-gate-'));
}

function seedConfig(root: string, options: { withCollectors?: boolean } = {}): void {
  const flowtraceRoot = join(root, '.flowtrace');
  mkdirSync(flowtraceRoot, { recursive: true });
  const collectors = options.withCollectors === false
    ? 'collectors: []'
    : `collectors:
  - name: src
    type: source-scanner
    enabled: true`;
  const body = `project:
  id: acme
  name: Acme
pilot:
  process: login
database:
  type: postgresql
  configSource: config/database.yaml
  access: read-only-collection
paths:
  scenarios: scenarios
  reports: reports
${collectors}`;
  writeFileSync(join(flowtraceRoot, 'flowtrace.yaml'), body, 'utf8');
}

function seedProcessInventory(root: string): void {
  const dir = join(root, '.flowtrace', 'processes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'inventory.json'), JSON.stringify({
    schemaVersion: '1.0',
    processes: [{ processId: 'login', name: 'Login' }]
  }, null, 2));
}

function seedScenarios(root: string, processId: string, scenarios: ScenarioFixture[]): void {
  const dir = join(root, '.flowtrace', 'scenarios', processId);
  mkdirSync(dir, { recursive: true });
  for (const scenario of scenarios) {
    const payload = scenario.invalid
      ? { id: scenario.id, name: 'broken', process: scenario.process, expected: { finalState: 'X' }, actions: [] }
      : {
          id: scenario.id,
          name: 'Happy path',
          process: scenario.process,
          actions: [{ type: 'LOGIN', actor: 'applicant' }],
          expected: { finalState: 'AUTHENTICATED' },
          enabled: true
        };
    writeFileSync(join(dir, `${scenario.id}.json`), JSON.stringify(payload));
  }
}

function seedRecording(root: string, processId: string, confirmed: boolean): void {
  const flowtraceRoot = join(root, '.flowtrace');
  mkdirSync(flowtraceRoot, { recursive: true });
  if (!confirmed) {
    writeRecordingState(flowtraceRoot, {
      schemaVersion: 1,
      processId,
      status: 'RECORDED',
      artifact: `${processId}.har`,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return;
  }
  writeRecordingState(flowtraceRoot, createConfirmedState({
    processId,
    artifact: `${processId}.har`,
    confirmedBy: 'tester@example.com'
  }));
}

describe('command-gate', () => {
  let cleanupRoots: string[] = [];

  beforeEach(() => {
    cleanupRoots = [];
  });

  afterEach(() => {
    for (const root of cleanupRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks generate-cases when the recording is not confirmed', () => {
    const root = createRoot();
    cleanupRoots.push(root);
    seedConfig(root);
    seedProcessInventory(root);
    seedRecording(root, 'login', false);
    const config = loadTargetProjectConfig(root);
    const result = runGate({
      projectRoot: root,
      flowtraceRoot: config.flowtraceRoot,
      config,
      configPath: config.configPath,
      requirements: gateForCommand('generate-cases'),
      explicitProcessId: 'login'
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECORDING_NOT_CONFIRMED');
    expect(result.missing).toContain('recording.confirmedAt');
    expect(result.remediation[0]).toContain('record-confirm');
  });

  it('blocks test when no scenarios exist for the process', () => {
    const root = createRoot();
    cleanupRoots.push(root);
    seedConfig(root);
    seedProcessInventory(root);
    seedRecording(root, 'login', true);
    const config = loadTargetProjectConfig(root);
    const result = runGate({
      projectRoot: root,
      flowtraceRoot: config.flowtraceRoot,
      config,
      configPath: config.configPath,
      requirements: gateForCommand('test'),
      explicitProcessId: 'login'
    });
    expect(result.ok).toBe(false);
    expect(['CASES_INVALID', 'PROCESS_NOT_FOUND']).toContain(result.code);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('allows pipeline after confirmed recording and valid cases', () => {
    const root = createRoot();
    cleanupRoots.push(root);
    seedConfig(root);
    seedProcessInventory(root);
    seedRecording(root, 'login', true);
    seedScenarios(root, 'login', [{ id: 'login-happy', process: 'login' }]);
    const config = loadTargetProjectConfig(root);
    const result = runGate({
      projectRoot: root,
      flowtraceRoot: config.flowtraceRoot,
      config,
      configPath: config.configPath,
      requirements: gateForCommand('pipeline'),
      explicitProcessId: 'login'
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe('OK');
    expect(result.releaseGate?.allowed).toBe(true);
    expect(result.process.id).toBe('login');
  });
});