import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderFixedDualRunHtml } from '../src/fixed-dual-run-report.js';

describe('fixed dual-run report template', () => {
  it('locks the canonical visual structure and fills execution evidence', () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'flowtrace-fixed-report-'));
    const legacyScreenshot = join(evidenceDir, 'legacy.png');
    const currentScreenshot = join(evidenceDir, 'current.png');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    writeFileSync(legacyScreenshot, png);
    writeFileSync(currentScreenshot, png);

    const html = renderFixedDualRunHtml({
      runId: 'run-fixed',
      projectName: 'Demo',
      processId: 'approval',
      runtimeAdapter: 'builtin',
      systems: ['legacy', 'current'],
      totalScenarios: 1,
      totalPassed: 1,
      totalFailed: 0,
      timestamp: '2026-01-01T00:00:00.000Z',
      generatedAt: '2026-01-01T00:00:01.000Z',
      releaseGate: { allowed: true },
      executionDetails: {
        scenario: {
          scenarioId: 'scenario',
          processId: 'approval',
          passed: true,
          observations: {
            legacy: { finalState: 'APPROVED', semanticPath: ['DRAFT', 'APPROVED'], actions: [{ actionId: 'APPROVE', index: 0, actor: 'admin', status: 200, evidencePaths: ['/tmp/legacy.json', legacyScreenshot] }] },
            current: { finalState: 'APPROVED', semanticPath: ['DRAFT', 'APPROVED'], actions: [{ actionId: 'APPROVE', index: 0, actor: 'admin', status: 200, evidencePaths: ['/tmp/current.json', currentScreenshot] }] },
          },
        },
      },
    }, [{ id: 'scenario', name: '审批通过', severity: 'P0', expected: { finalState: 'APPROVED', semanticPath: ['DRAFT', 'APPROVED'] } }]);

    for (const marker of [
      'max-width:1500px',
      'class="summary"',
      'Project information',
      'Summary table',
      'Final state comparison',
      'Semantic path comparison',
      'Illegal transition comparison',
      'class="case-systems"',
      'class="shots-grid"',
      'class="evidence-screenshot"',
      'Legacy system',
      'Current system',
    ]) expect(html).toContain(marker);
    expect(html).toContain(legacyScreenshot);
    expect(html).toContain(currentScreenshot);
    expect(html.match(/data:image\/png;base64,/g)).toHaveLength(4);
    expect(html).not.toContain('loading="lazy"');
    rmSync(evidenceDir, { recursive: true });
  });
});
