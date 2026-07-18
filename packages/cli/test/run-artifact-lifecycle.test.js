import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { saveReport } from '../dist/commands/test/test.js';
describe('login run artifact lifecycle', () => {
    it('keeps run data, reports, and manifest under one run directory', async () => {
        const projectRoot = mkdtempSync(join(tmpdir(), 'flowtrace-artifacts-'));
        const executionsDir = join(projectRoot, '.flowtrace', 'executions');
        const run = {
            runId: 'run-test-artifacts',
            projectId: 'project',
            processId: 'user-login',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            releaseGate: { allowed: true, blockedBy: [] },
            mode: 'dual-browser',
            summary: { totalCases: 0, passedCases: 0, failedCases: 0, differencesBySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 } },
            caseResults: []
        };
        try {
            const paths = await saveReport(run, projectRoot, executionsDir);
            const runDir = join(executionsDir, run.runId);
            const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8'));
            expect(paths.jsonPath).toBe(join(runDir, 'reports', `login-report-${run.runId}.json`));
            expect(paths.mdPath).toBe(join(runDir, 'reports', `login-report-${run.runId}.md`));
            expect(paths.htmlPath).toBe(join(runDir, 'reports', `login-report-${run.runId}.html`));
            expect(manifest.artifactRoot).toBe(runDir);
            expect(manifest.paths.run).toBe(join(runDir, 'run.json'));
            expect(existsSync(join(runDir, 'reports'))).toBe(true);
        }
        finally {
            rmSync(projectRoot, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=run-artifact-lifecycle.test.js.map