import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProcess } from '../src/process-resolver.js';

interface SeedProcess {
  id: string;
  name: string;
  aliases?: string[];
  keywords?: string[];
  tags?: string[];
}

function seedProject(processes: SeedProcess[], options: { inventory?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'flowtrace-resolver-'));
  const dir = join(root, '.flowtrace', 'processes');
  mkdirSync(dir, { recursive: true });

  if (options.inventory) {
    writeFileSync(join(dir, 'inventory.json'), JSON.stringify({
      schemaVersion: '1.0',
      processes: processes.map(process => ({
        id: process.id,
        name: process.name,
        aliases: process.aliases ?? [],
        keywords: process.keywords ?? [],
        tags: process.tags ?? []
      }))
    }, null, 2));
  } else {
    for (const process of processes) {
      writeFileSync(join(dir, `${process.id}.json`), JSON.stringify({
        processId: process.id,
        name: process.name,
        metadata: {
          aliases: process.aliases ?? [],
          keywords: process.keywords ?? []
        },
        tags: process.tags ?? []
      }));
    }
  }

  return root;
}

describe('resolveProcess', () => {
  let cleanupRoots: string[] = [];

  beforeEach(() => {
    cleanupRoots = [];
  });

  afterEach(() => {
    for (const root of cleanupRoots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves a unique process by exact name', () => {
    const root = seedProject([
      { id: 'login', name: 'Login' },
      { id: 'submit', name: 'Submit Order' }
    ]);
    cleanupRoots.push(root);

    const result = resolveProcess(root, 'Login');
    expect(result.ok).toBe(true);
    expect(result.code).toBe('OK');
    expect(result.process?.id).toBe('login');
    expect(result.candidates).toHaveLength(1);
  });

  it('honors an explicit process ID over name collisions', () => {
    const root = seedProject([
      { id: 'login-v1', name: 'Login' },
      { id: 'login-v2', name: 'Login' }
    ]);
    cleanupRoots.push(root);

    const result = resolveProcess(root, 'Login', 'login-v2');
    expect(result.ok).toBe(true);
    expect(result.process?.id).toBe('login-v2');
    expect(result.query).toBe('login-v2');
  });

  it('reports AMBIGUOUS_PROCESS when two candidates match by name', () => {
    const root = seedProject([
      { id: 'login-v1', name: 'Login' },
      { id: 'login-v2', name: 'Login' }
    ]);
    cleanupRoots.push(root);

    const result = resolveProcess(root, 'Login');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AMBIGUOUS_PROCESS');
    expect(result.candidates.map(candidate => candidate.id).sort()).toEqual(['login-v1', 'login-v2']);
  });

  it('reports PROCESS_NOT_FOUND when nothing matches', () => {
    const root = seedProject([
      { id: 'login', name: 'Login' }
    ]);
    cleanupRoots.push(root);

    const result = resolveProcess(root, 'unknown');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PROCESS_NOT_FOUND');
    expect(result.process).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });
});