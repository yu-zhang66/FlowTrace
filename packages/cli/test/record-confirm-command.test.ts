import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import { recordConfirmCommand, lastRecordConfirmResult } from '../src/commands/record-confirm.js';
import { readRecordingState } from '@flowtrace/core';

// Helper: create a minimal initialized project with optional processes
function initProject(projectRoot: string, opts: { processIds?: string[] } = {}) {
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
        JSON.stringify({
          processId: pid,
          name: pid.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        })
      );
    }
  }

  return flowtraceRoot;
}

function captureExit(): { code: number | undefined } {
  const captured = { code: undefined as number | undefined };
  vi.spyOn(process, 'exit').mockImplementation(
    ((code?: number) => {
      captured.code = code ?? 0;
      throw new Error('exit');
    }) as typeof process.exit
  );
  return captured;
}

describe('record-confirm command', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of tmpDirs) {
      if (existsSync(d)) rmSync(d, { recursive: true });
    }
    tmpDirs.length = 0;
  });

  // -------------------------------------------------------------------------
  // NOT_INITIALIZED
  // -------------------------------------------------------------------------

  describe('when project is not initialized', () => {
    it('returns exit code 2 with NOT_INITIALIZED code', async () => {
      const projectRoot = join(process.cwd(), `.ft-rc-notinit-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      const captured = captureExit();
      try {
        await recordConfirmCommand({ project: projectRoot });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2);
      expect(lastRecordConfirmResult?.code).toBe('NOT_INITIALIZED');
      expect(lastRecordConfirmResult?.ok).toBe(false);
    });

    it('returns NOT_INITIALIZED regardless of cwd when --project points elsewhere', async () => {
      const projectRoot = join(process.cwd(), `.ft-rc-notinit2-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      const captured = captureExit();
      try {
        await recordConfirmCommand({ project: projectRoot });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2);
      expect(lastRecordConfirmResult?.code).toBe('NOT_INITIALIZED');
    });
  });

  // -------------------------------------------------------------------------
  // AMBIGUOUS_PROCESS
  // -------------------------------------------------------------------------

  describe('when multiple processes exist and no process is specified', () => {
    it('returns AMBIGUOUS_PROCESS with candidates and exit code 2', async () => {
      const projectRoot = join(process.cwd(), `.ft-rc-ambig-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      const flowtraceRoot = initProject(projectRoot, { processIds: ['login', 'logout', 'submit-order'] });

      // Give them overlapping keywords so resolveProcess returns multiple
      const processesDir = join(flowtraceRoot, 'processes');
      writeFileSync(
        join(processesDir, 'login.json'),
        JSON.stringify({ processId: 'login', name: 'Login', keywords: ['login'] })
      );
      writeFileSync(
        join(processesDir, 'logout.json'),
        JSON.stringify({ processId: 'logout', name: 'Logout', keywords: ['logout', 'login'] })
      );
      writeFileSync(
        join(processesDir, 'submit-order.json'),
        JSON.stringify({ processId: 'submit-order', name: 'Submit Order', keywords: ['login'] })
      );

      const captured = captureExit();
      try {
        await recordConfirmCommand({ project: projectRoot });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2);
      expect(lastRecordConfirmResult?.code).toBe('AMBIGUOUS_PROCESS');
      expect(lastRecordConfirmResult!.process.candidates.length).toBeGreaterThanOrEqual(2);
      expect(lastRecordConfirmResult!.remediation.some((r: string) => r.includes('Did you mean'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // PROCESS_NOT_FOUND
  // -------------------------------------------------------------------------

  describe('when no processes exist and none specified', () => {
    it('returns PROCESS_NOT_FOUND with exit code 2', async () => {
      const projectRoot = join(process.cwd(), `.ft-rc-pnf-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      // init with no processes → resolveProcess returns PROCESS_NOT_FOUND
      initProject(projectRoot, { processIds: [] });

      const captured = captureExit();
      try {
        await recordConfirmCommand({ project: projectRoot });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2);
      expect(lastRecordConfirmResult?.code).toBe('PROCESS_NOT_FOUND');
    });
  });

  // -------------------------------------------------------------------------
  // SUCCESS cases
  // -------------------------------------------------------------------------

  describe('after init with a single process', () => {
    it('writes CONFIRMED recording state and returns exit code 0', async () => {
      const projectRoot = join(process.cwd(), `.ft-rc-ok-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      initProject(projectRoot, { processIds: ['login'] });

      const captured = captureExit();
      try {
        await recordConfirmCommand({ project: projectRoot });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(0);
      expect(lastRecordConfirmResult?.code).toBe('OK');
      expect(lastRecordConfirmResult?.ok).toBe(true);
    });

    it('readRecordingState returns status CONFIRMED with correct confirmedBy', async () => {
      const projectRoot = join(process.cwd(), `.ft-rc-confirm-by-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      initProject(projectRoot, { processIds: ['login'] });

      const captured = captureExit();
      try {
        await recordConfirmCommand({ project: projectRoot, by: 'ci-tester-01', process: 'login' });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(0);
      expect(lastRecordConfirmResult?.process.id).toBe('login');

      // Verify file on disk
      const state = readRecordingState(join(projectRoot, '.flowtrace'));
      expect(state).not.toBeNull();
      expect(state!.status).toBe('CONFIRMED');
      expect(state!.confirmedBy).toBe('ci-tester-01');
    });

    it('uses explicit process argument instead of --process option', async () => {
      const projectRoot = join(process.cwd(), `.ft-rc-positional-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      initProject(projectRoot, { processIds: ['login', 'logout'] });

      const captured = captureExit();
      try {
        // The Commander action wrapper passes positional as `process`
        await recordConfirmCommand({ project: projectRoot, process: 'logout' });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(0);
      expect(lastRecordConfirmResult?.process.id).toBe('logout');

      const state = readRecordingState(join(projectRoot, '.flowtrace'));
      expect(state!.processId).toBe('logout');
    });

    it('uses --artifact option when provided', async () => {
      const projectRoot = join(process.cwd(), `.ft-rc-artifact-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      initProject(projectRoot, { processIds: ['login'] });

      const captured = captureExit();
      try {
        await recordConfirmCommand({
          project: projectRoot,
          process: 'login',
          artifact: '/tmp/my-recording.har',
        });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(0);
      const state = readRecordingState(join(projectRoot, '.flowtrace'));
      expect(state!.artifact).toBe('/tmp/my-recording.har');
    });

    it('uses $USER env var as confirmedBy when --by is not provided', async () => {
      const projectRoot = join(process.cwd(), `.ft-rc-user-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      initProject(projectRoot, { processIds: ['login'] });

      // Call without by option
      const captured = captureExit();
      try {
        await recordConfirmCommand({ project: projectRoot, process: 'login' });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(0);
      const state = readRecordingState(join(projectRoot, '.flowtrace'));
      expect(state!.confirmedBy).toBe(process.env.USER ?? 'manual');
    });

    it('returns PROCESS_NOT_FOUND when explicit process does not exist', async () => {
      const projectRoot = join(process.cwd(), `.ft-rc-explicit-pnf-${Date.now()}`);
      mkdirSync(projectRoot, { recursive: true });
      tmpDirs.push(projectRoot);

      initProject(projectRoot, { processIds: ['login'] });

      const captured = captureExit();
      try {
        await recordConfirmCommand({ project: projectRoot, process: 'nonexistent-proc' });
      } catch (e: unknown) {
        if ((e as Error).message !== 'exit') throw e;
      }

      expect(captured.code).toBe(2);
      expect(lastRecordConfirmResult?.code).toBe('PROCESS_NOT_FOUND');
    });
  });
});
