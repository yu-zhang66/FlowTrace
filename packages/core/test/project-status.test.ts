import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeStatus, statusFromError, summarizeStatus } from '../src/project-status.js';
import { createConfirmedState, writeRecordingState } from '../src/recording-state.js';
import { loadTargetProjectConfig } from '../src/target-config.js';
import type { TargetProjectConfig } from '../src/target-config.js';

function createRoot(): string {
  return mkdtempSync(join(tmpdir(), 'flowtrace-status-'));
}

function writeConfig(projectRoot: string, config: Record<string, unknown> | string): string {
  const flowtraceRoot = join(projectRoot, '.flowtrace');
  mkdirSync(flowtraceRoot, { recursive: true });
  const path = join(flowtraceRoot, 'flowtrace.yaml');
  const body = typeof config === 'string' ? config : JSON.stringify(config);
  writeFileSync(path, body, 'utf8');
  return path;
}

function writeScenario(projectRoot: string, processId: string, body: unknown): void {
  const dir = join(projectRoot, '.flowtrace', 'scenarios', processId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'happy.json'), JSON.stringify(body));
}

function writeProcessInventory(projectRoot: string, processes: { id: string; name: string }[]): void {
  const dir = join(projectRoot, '.flowtrace', 'processes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'inventory.json'), JSON.stringify({
    schemaVersion: '1.0',
    processes: processes.map(process => ({ processId: process.id, name: process.name }))
  }, null, 2));
}

describe('project-status', () => {
  let cleanupRoots: string[] = [];

  beforeEach(() => {
    cleanupRoots = [];
  });

  afterEach(() => {
    for (const root of cleanupRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports NOT_INITIALIZED when flowtrace.yaml is missing', () => {
    const root = createRoot();
    cleanupRoots.push(root);
    const snapshot = statusFromError(root, 'NOT_INITIALIZED', 'config not found');
    expect(snapshot.status).toBe('NOT_INITIALIZED');
    expect(snapshot.config.exists).toBe(false);
    expect(snapshot.config.missing).toContain('.flowtrace/flowtrace.yaml');
    const summary = summarizeStatus(snapshot);
    expect(summary.ok).toBe(false);
    expect(summary.code).toBe('NOT_INITIALIZED');
    expect(summary.remediation[0]).toContain('flowtrace init');
  });

  it('reports INCOMPLETE_CONFIG when collectors are missing', () => {
    const root = createRoot();
    cleanupRoots.push(root);
    const configPath = writeConfig(root, `project:
  id: acme
  name: Acme
database:
  type: postgresql
  configSource: config/database.yaml
  access: read-only-collection
paths:
  scenarios: scenarios
  reports: reports
collectors:
  - name: broken
    type: source-scanner
    enabled: false
`);
    const config = loadTargetProjectConfig(root);
    const snapshot = computeStatus({
      projectRoot: root,
      flowtraceRoot: join(root, '.flowtrace'),
      configPath,
      config
    });
    expect(snapshot.status).toBe('INCOMPLETE_CONFIG');
    expect(snapshot.config.missing.length).toBeGreaterThan(0);
  });

  it('reports RECORDING_NOT_CONFIRMED when only a recorded state exists', () => {
    const root = createRoot();
    cleanupRoots.push(root);
    const configPath = writeConfig(root, `project:
  id: acme
  name: Acme
pilot:
  process: login
collectors:
  - name: src
    type: source-scanner
    enabled: true
database:
  type: postgresql
  configSource: config/database.yaml
  access: read-only-collection
paths:
  scenarios: scenarios
  reports: reports
`);
    const config = loadTargetProjectConfig(root);
    const flowtraceRoot = join(root, '.flowtrace');
    mkdirSync(flowtraceRoot, { recursive: true });
    writeProcessInventory(root, [{ id: 'login', name: 'Login' }]);
    writeRecordingState(flowtraceRoot, {
      schemaVersion: 1,
      processId: 'login',
      status: 'RECORDED',
      artifact: 'login.har',
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const snapshot = computeStatus({
      projectRoot: root,
      flowtraceRoot,
      configPath,
      config,
      processId: 'login'
    });
    expect(snapshot.status).toBe('RECORDING_NOT_CONFIRMED');
    expect(snapshot.recording?.status).toBe('RECORDED');
  });

  it('reports READY after a confirmed recording and valid scenarios', () => {
    const root = createRoot();
    cleanupRoots.push(root);
    const configPath = writeConfig(root, `project:
  id: acme
  name: Acme
pilot:
  process: login
collectors:
  - name: src
    type: source-scanner
    enabled: true
database:
  type: postgresql
  configSource: config/database.yaml
  access: read-only-collection
paths:
  scenarios: scenarios
  reports: reports
`);
    const config: TargetProjectConfig = loadTargetProjectConfig(root);
    const flowtraceRoot = join(root, '.flowtrace');
    mkdirSync(flowtraceRoot, { recursive: true });
    writeProcessInventory(root, [{ id: 'login', name: 'Login' }]);
    writeRecordingState(flowtraceRoot, createConfirmedState({
      processId: 'login',
      artifact: 'login.har',
      confirmedBy: 'tester@example.com'
    }));
    writeScenario(root, 'login', {
      id: 'login-happy-path',
      name: 'Login happy path',
      process: 'login',
      actions: [{ type: 'LOGIN', actor: 'applicant' }],
      expected: { finalState: 'AUTHENTICATED' },
      enabled: true
    });
    const snapshot = computeStatus({
      projectRoot: root,
      flowtraceRoot,
      configPath,
      config,
      processId: 'login'
    });
    expect(snapshot.status).toBe('READY');
    expect(snapshot.scenarios.valid).toBe(1);
    expect(snapshot.scenarios.invalid).toBe(0);
    expect(summarizeStatus(snapshot)).toEqual({ ok: true, code: 'OK', missing: [], remediation: [] });
  });
});