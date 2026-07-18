import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { importRecordingCommand } from '../src/commands/import-recording.js';
import { ScenarioSchema, validateScenario } from '../../core/src/models/scenario.ts';

describe('import-recording command', () => {
  const projects: string[] = [];

  afterEach(() => {
    for (const project of projects.splice(0)) {
      if (existsSync(project)) rmSync(project, { recursive: true, force: true });
    }
  });

  it('writes a raw recording and a NEEDS_REVIEW scenario using project-local mappings', async () => {
    const project = join(tmpdir(), `flowtrace-import-${Date.now()}`);
    projects.push(project);
    const flowtrace = join(project, '.flowtrace');
    const recordingDir = join(flowtrace, 'recordings');
    const mappingDir = join(flowtrace, 'mappings');
    mkdirSync(recordingDir, { recursive: true });
    mkdirSync(mappingDir, { recursive: true });
    writeFileSync(join(flowtrace, 'flowtrace.yaml'), yaml.dump({
      project: { id: 'import-test', name: 'Import Test', sourceRoot: '.' },
      pilot: { process: 'purchase-approval' },
      paths: { scenarios: 'scenarios', recordings: 'recordings' }
    }));
    writeFileSync(join(mappingDir, 'browser-actions.yaml'), yaml.dump({
      mappings: [
        { locator: 'testid=purchase-submit', semanticAction: 'SUBMIT' },
        { locator: 'testid=approve-purchase', semanticAction: 'APPROVE' }
      ]
    }));
    writeFileSync(join(recordingDir, 'purchase-approve.spec.ts'), [
      "import { test, expect } from '@playwright/test';",
      "test('purchase', async ({ page }) => {",
      "  await page.getByTestId('purchase-submit').click();",
      "  await expect(page.getByTestId('process-state')).toHaveText('SUBMITTED');",
      "  await page.getByTestId('approve-purchase').click();",
      "  await expect(page.getByTestId('process-state')).toHaveText('APPROVED');",
      "  await page.getByTestId('unmapped-button').click();",
      '});'
    ].join('\n'));

    await importRecordingCommand({
      project,
      process: 'purchase-approval',
      input: '.flowtrace/recordings/purchase-approve.spec.ts'
    });

    const raw = join(flowtrace, 'recordings', 'purchase-approve.raw.json');
    const scenario = join(flowtrace, 'scenarios', 'purchase-approve.yaml');
    expect(existsSync(raw)).toBe(true);
    expect(existsSync(scenario)).toBe(true);
    expect(JSON.parse(readFileSync(raw, 'utf8')).steps).toHaveLength(5);
    const parsed = yaml.load(readFileSync(scenario, 'utf8')) as Record<string, any>;
    expect(parsed.status).toBe('NEEDS_REVIEW');
    const roundTripped = ScenarioSchema.parse(parsed);
    expect(roundTripped.status).toBe('NEEDS_REVIEW');
    expect(roundTripped.review?.unmappedSteps).toContain('click testid=unmapped-button');
    expect(parsed.actions.map((action: any) => action.type)).toEqual(['SUBMIT', 'APPROVE']);
    expect(parsed.review.unmappedSteps).toContain('click testid=unmapped-button');
    expect(validateScenario(parsed).valid).toBe(true);
  });

  it('does not infer finalState from visibility or input-value assertions', async () => {
    const project = join(tmpdir(), `flowtrace-import-assertions-${Date.now()}`);
    projects.push(project);
    const flowtrace = join(project, '.flowtrace');
    mkdirSync(join(flowtrace, 'recordings'), { recursive: true });
    writeFileSync(join(flowtrace, 'flowtrace.yaml'), yaml.dump({
      project: { id: 'assertion-test', name: 'Assertion Test', sourceRoot: '.' },
      pilot: { process: 'purchase-approval' }
    }));
    mkdirSync(join(flowtrace, 'mappings'), { recursive: true });
    writeFileSync(join(flowtrace, 'mappings', 'browser-actions.yaml'), yaml.dump({
      mappings: [{ locator: 'testid=submit', semanticAction: 'SUBMIT' }]
    }));
    writeFileSync(join(flowtrace, 'recordings', 'assertions.spec.ts'), [
      "import { test, expect } from '@playwright/test';",
      "test('assertions', async ({ page }) => {",
      "  await page.getByTestId('submit').click();",
      "  await expect(page.getByTestId('approve-purchase')).toBeVisible();",
      "  await expect(page.getByTestId('purchase-amount')).toHaveValue('100');",
      '});'
    ].join('\n'));

    await importRecordingCommand({ project, process: 'purchase-approval', input: '.flowtrace/recordings/assertions.spec.ts' });
    const parsed = yaml.load(readFileSync(join(flowtrace, 'scenarios', 'assertions.yaml'), 'utf8')) as Record<string, any>;
    expect(parsed.expected.finalState).toBe('UNKNOWN');
    expect(ScenarioSchema.parse(parsed).review?.status).toBe('NEEDS_REVIEW');
  });
});
