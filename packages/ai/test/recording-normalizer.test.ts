import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeRecording } from '../src/recording-normalizer';

describe('recording normalization', () => {
  it('creates a disabled reviewable candidate and preserves provenance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowtrace-normalize-'));
    const path = join(dir, 'purchase.raw.json');
    writeFileSync(path, JSON.stringify({ recordingId: 'r1', steps: [{ businessAction: 'SUBMIT', sourceLine: 8 }, { type: 'click', sourceLine: 9 }] }));
    const result = normalizeRecording({ recordingPath: path, process: 'purchase' });
    expect(result.scenarios[0].enabled).toBe(false);
    expect(result.scenarios[0].status).toBe('NEEDS_REVIEW');
    expect(result.scenarios[0].review?.unmappedSteps).toContain('purchase.raw.json:9');
    expect(result.scenarios[0].actions[0].data?.provenance).toEqual({ recording: 'r1', sourceLine: 8 });
    rmSync(dir, { recursive: true, force: true });
  });
});
