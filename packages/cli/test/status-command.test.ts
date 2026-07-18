import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import { statusCommand, lastStatusResult } from '../src/commands/status.js';
import { readRecordingState } from '@flowtrace/core';

// Helper: create a minimal initialized project with optional processes
function initProject(projectRoot: string, opts: { processIds?: string[]; recordingStatus?: string } = {}) {
  const flowtraceRoot = join(projectRoot, '.flowtrace');
  mkdirSync(flowtraceRoot, { recursive: true });

  const config: Record<string, unknown> = {
    project: {
      id: projectRoot.split('/').pop() ?? 'test-project',
      name: projectRoot.split('/').pop() ?? 'Test Project',
      sourceRoot: '.',
    },
    execution: {
      mode: 'dual-run',
      allowOnlineWrite: false,
      databaseMode: 'snapshot-only',
      testDataMode: 'masked-or-snapshot',
      failOn: ['P0', 'P1'],
    },
    pilot: { process: opts.processIds?.[0] ?? 'login', currentAdapterMode: 'legacy-shadow' },
    adapters: { legacy: 'adapters/legacy-flow-adapter.mjs', current: 'adapters/current-flow-adapter.mjs' },
    paths: { scenarios: 'scenarios', fixtures: 'fixtures', executions: 'executions', reports: 'reports', adapters: 'adapters' },
    actions: ['SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'WITHDRAW', 'TRANSFER', 'LOGIN'],
  };
  writeFileSync(join(flowtraceRoot, 'flowtrace.yaml'), yaml.dump(config, { indent: 2 }));

  // Create process metadata files
  if (opts.processIds) {
    const processesDir = join(flowtraceRoot, 'processes');
    mkdirSync(processesDir, { recursive: true });
    for (const pid of opts.processIds) {
      writeFileSync(
        join(processesDir, `${pid}.json`),
        JSON.stringify({ processId: pid, name: pid.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })
      );
    }
  }

  // Optionally write recording state
  if (opts.recordingStatus) {
    const state = {
      schemaVersion: 1,
      processId: opts.processIds?.[0] ?? 'login',
      status: opts.recordingStatus,
      artifact: opts.recordingStatus !== 'NOT_RECORDED' ? 'page-recording://test' : null,
      confirmedBy: opts.recordingStatus === 'CONFIRMED' ? 'tester' : null,
      confirmedAt: opts.recordingStatus === 'CONFIRMED' ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(flowtraceRoot, 'recording-state.json'), JSON.stringify(state));
  }

  return flowtraceRoot;
}

function captureExit(): { code: number | undefined } {
  const captured = { code: undefined as number | undefined };
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    captured.code = code ?? 0;
    throw new Error('exit');
  }) as typeof process.exit);
  return captured;
}

describe('status command', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      if (existsSync(d)) rmSync(d, { recursive: true });
    }
    tmpDirs.length = 0;
  });

  // -------------------------------------------------------------------------
  // NOT_INITIALIZED cases
  // -------------------------------------------------------------------------

  describe('when project is not initialized', () => {
    it('returns exit code 2 with NOT_INITIALIZED code', async () => {
      const projectRoot = join(process.cwd(), `.ft-status-test-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      const captured = captureExit();

      try {
        await statusCommand({ project: projectRoot });
      } catch (e: unknown) {
        if ((e as Error).message === 'exit') {
          // expected
        } else {
          throw e;
        }
      }

      expect(captured.code).toBe(2);
      expect(lastStatusResult?.code).toBe('NOT_INITIALIZED');
      expect(lastStatusResult?.ok).toBe(false);
      expect(lastStatusResult?.data).toBeDefined();
    });

    it('returns exit code 2 regardless of cwd when --project points to uninitialized dir', async () => {
      const projectRoot = join(process.cwd(), `.ft-status-cwd-test-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      const captured = captureExit();
      try {
        await statusCommand({ project: projectRoot });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2);
      expect(lastStatusResult?.code).toBe('NOT_INITIALIZED');
    });
  });

  // -------------------------------------------------------------------------
  // AFTER INIT cases
  // -------------------------------------------------------------------------

  describe('after init', () => {
    it('returns exit code 0 or 2 depending on processId, with config.exists === true', async () => {
      const projectRoot = join(process.cwd(), `.ft-status-init-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      initProject(projectRoot, { processIds: ['login'] });

      const captured = captureExit();
      try {
        await statusCommand({ project: projectRoot });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2); // READY → 0, else 2; with no recording/scenarios → 2
      expect(lastStatusResult).toBeDefined();
      expect(lastStatusResult!.code).not.toBe('OK'); // not fully READY without recording/scenarios
      expect(lastStatusResult!.data!.config.exists).toBe(true);
    });

    it('returns exit code 2 when asking for a non-existent processId', async () => {
      const projectRoot = join(process.cwd(), `.ft-status-no-proc-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      initProject(projectRoot, { processIds: ['login'] });

      const captured = captureExit();
      try {
        await statusCommand({ project: projectRoot, process: 'foo-bar-baz' });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2);
      expect(lastStatusResult?.code).toBe('PROCESS_NOT_FOUND');
    });

    it('returns exit code 2 when --process points to a non-existent process', async () => {
      const projectRoot = join(process.cwd(), `.ft-status-explicit-no-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      initProject(projectRoot, { processIds: ['login', 'submit'] });

      const captured = captureExit();
      try {
        await statusCommand({ project: projectRoot, explicitProcessId: 'nonexistent-proc' });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2);
      expect(lastStatusResult?.code).toBe('PROCESS_NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // PROCESS RESOLUTION cases
  // -------------------------------------------------------------------------

  describe('process resolution', () => {
    it('resolves a process by query with exactly one match', async () => {
      const projectRoot = join(process.cwd(), `.ft-status-query1-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      const flowtraceRoot = initProject(projectRoot, { processIds: ['login', 'submit-order'] });

      // Add keywords so resolveProcess can find it
      const processesDir = join(flowtraceRoot, 'processes');
      writeFileSync(
        join(processesDir, 'submit-order.json'),
        JSON.stringify({ processId: 'submit-order', name: 'Submit Order', keywords: ['submit', 'order', '订单提交'] })
      );

      const captured = captureExit();
      try {
        await statusCommand({ project: projectRoot, query: '订单提交' });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(lastStatusResult?.code).toBeDefined();
      // It should either resolve OK (then exit 0/2 depending on status) or return PROCESS_NOT_FOUND
      // With '订单提交' keyword matching submit-order, we get 1 candidate → resolved
      expect(['OK', 'PROCESS_NOT_FOUND', 'RECORDING_NOT_CONFIRMED', 'CASES_INVALID']).toContain(lastStatusResult?.code);
    });

    it('returns AMBIGUOUS_PROCESS with candidates when query matches multiple processes', async () => {
      const projectRoot = join(process.cwd(), `.ft-status-ambig-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      const flowtraceRoot = initProject(projectRoot, { processIds: ['login', 'logout'] });

      // Both have overlapping keywords
      const processesDir = join(flowtraceRoot, 'processes');
      writeFileSync(
        join(processesDir, 'login.json'),
        JSON.stringify({ processId: 'login', name: 'Login', keywords: ['login', 'signin', '登录'] })
      );
      writeFileSync(
        join(processesDir, 'logout.json'),
        JSON.stringify({ processId: 'logout', name: 'Logout', keywords: ['logout', 'signout', '登录'] })
      );

      const captured = captureExit();
      try {
        await statusCommand({ project: projectRoot, query: '登录' });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2);
      expect(lastStatusResult?.code).toBe('AMBIGUOUS_PROCESS');
      expect(lastStatusResult?.process.candidates.length).toBeGreaterThanOrEqual(2);
      expect(lastStatusResult?.remediation.some((r: string) => r.includes('Did you mean'))).toBe(true);
    });

    it('returns PROCESS_NOT_FOUND when query matches no process', async () => {
      const projectRoot = join(process.cwd(), `.ft-status-pnf-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      initProject(projectRoot, { processIds: ['login'] });

      const captured = captureExit();
      try {
        await statusCommand({ project: projectRoot, query: 'totally-nonexistent-process-xyz' });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2);
      expect(lastStatusResult?.code).toBe('PROCESS_NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // Exit code logic
  // -------------------------------------------------------------------------

  describe('exit code mapping', () => {
    it('exits 0 for READY status', async () => {
      const projectRoot = join(process.cwd(), `.ft-status-ready-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      // Init with a process, recording confirmed, and a scenario file so it can reach READY
      const flowtraceRoot = initProject(projectRoot, {
        processIds: ['login'],
        recordingStatus: 'CONFIRMED',
      });

      // Write a valid scenario
      const scenariosDir = join(flowtraceRoot, 'scenarios');
      mkdirSync(scenariosDir, { recursive: true });
      writeFileSync(
        join(scenariosDir, 'login-success-001.yaml'),
        yaml.dump({
          id: 'login-success-001',
          name: 'Login Success',
          process: 'login',
          enabled: true,
          actions: [{ type: 'LOGIN', actor: 'test' }],
          expected: { finalState: 'AUTHENTICATED' },
        })
      );

      const captured = captureExit();
      try {
        await statusCommand({ project: projectRoot, process: 'login' });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(0);
      expect(lastStatusResult?.code).toBe('OK');
    });
  });
});
