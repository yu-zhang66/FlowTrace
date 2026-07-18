import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRecordingMetadata, resolveRecordingPath } from '../src/commands/record.js';
describe('record command metadata', () => {
    it('creates project-local metadata without storage-state contents', () => {
        const metadata = buildRecordingMetadata({
            id: 'purchase-approval',
            processId: 'purchase-approval',
            url: 'http://localhost:3100/login',
            specFile: 'recordings/purchase-approval.spec.ts',
            authFile: 'recordings/purchase-approval-auth.json',
            playwrightVersion: '1.50.0',
            createdAt: '2026-07-17T00:00:00.000Z'
        });
        expect(metadata).toEqual({
            id: 'purchase-approval',
            processId: 'purchase-approval',
            url: 'http://localhost:3100/login',
            specFile: 'recordings/purchase-approval.spec.ts',
            authFile: 'recordings/purchase-approval-auth.json',
            createdAt: '2026-07-17T00:00:00.000Z',
            playwrightVersion: '1.50.0',
            status: 'RECORDED'
        });
        expect(JSON.stringify(metadata)).not.toContain('password');
    });
    it.each(['../escape.spec.ts', '/tmp/escape.spec.ts'])('rejects output outside recordings for %s', requested => {
        const root = mkdtempSync(join(tmpdir(), 'flowtrace-record-path-'));
        const recordings = join(root, '.flowtrace', 'recordings');
        mkdirSync(recordings, { recursive: true });
        expect(() => resolveRecordingPath(recordings, requested, 'default.spec.ts')).toThrow(/inside/);
        rmSync(root, { recursive: true, force: true });
    });
    it('rejects a symlinked output directory escaping recordings', () => {
        const root = mkdtempSync(join(tmpdir(), 'flowtrace-record-link-'));
        const recordings = join(root, '.flowtrace', 'recordings');
        const outside = join(root, 'outside');
        mkdirSync(recordings, { recursive: true });
        mkdirSync(outside, { recursive: true });
        symlinkSync(outside, join(recordings, 'linked'));
        expect(() => resolveRecordingPath(recordings, 'linked/test.spec.ts', 'default.spec.ts')).toThrow(/inside/);
        rmSync(root, { recursive: true, force: true });
    });
});
//# sourceMappingURL=record-command.test.js.map