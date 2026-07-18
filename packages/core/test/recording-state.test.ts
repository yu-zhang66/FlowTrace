import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearRecordingState,
  createConfirmedState,
  createNotRecordedState,
  createRecordedState,
  readRecordingState,
  writeRecordingState
} from '../src/recording-state.js';

describe('recording-state', () => {
  let cleanupRoots: string[] = [];

  beforeEach(() => {
    cleanupRoots = [];
  });

  afterEach(() => {
    for (const root of cleanupRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function createRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'flowtrace-recording-'));
    cleanupRoots.push(root);
    return root;
  }

  it('writes and reads a confirmed recording state', () => {
    const root = createRoot();
    const state = createConfirmedState({
      processId: 'login',
      artifact: '.flowtrace/recordings/login.har',
      confirmedBy: 'tester@example.com'
    });
    writeRecordingState(root, state);

    const restored = readRecordingState(root);
    expect(restored).not.toBeNull();
    expect(restored?.processId).toBe('login');
    expect(restored?.status).toBe('CONFIRMED');
    expect(restored?.confirmedBy).toBe('tester@example.com');
    expect(restored?.artifact).toBe('.flowtrace/recordings/login.har');
    expect(restored?.confirmedAt).not.toBeNull();
  });

  it('round-trips a recorded (unconfirmed) state', () => {
    const root = createRoot();
    writeRecordingState(root, createRecordedState({ processId: 'submit', artifact: 'submit.har' }));
    const restored = readRecordingState(root);
    expect(restored?.status).toBe('RECORDED');
    expect(restored?.confirmedAt).toBeNull();
  });

  it('returns null when the state file is absent', () => {
    const root = createRoot();
    expect(readRecordingState(root)).toBeNull();
  });

  it('returns null when the state file is corrupted', () => {
    const root = createRoot();
    writeFileSync(join(root, 'recording-state.json'), '{not-json', 'utf8');
    expect(readRecordingState(root)).toBeNull();
  });

  it('clearRecordingState removes the file idempotently', () => {
    const root = createRoot();
    writeRecordingState(root, createNotRecordedState('login'));
    expect(readRecordingState(root)).not.toBeNull();
    clearRecordingState(root);
    expect(readRecordingState(root)).toBeNull();
    clearRecordingState(root); // second call must not throw
    expect(readRecordingState(root)).toBeNull();
  });
});