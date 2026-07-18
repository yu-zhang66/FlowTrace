import { describe, expect, it } from 'vitest';
import { parsePlaywrightRecording } from './recording-parser.js';

describe('parsePlaywrightRecording', () => {
  it('parses navigation, test-id actions and assertions with source lines', () => {
    const result = parsePlaywrightRecording([
      "await page.goto('http://localhost:3100/login');",
      "await page.getByTestId('login-username').fill('supplier001');",
      "await page.getByTestId('login-submit').click();",
      "await expect(page.getByTestId('process-state')).toHaveText('SUBMITTED');",
      "await expect(page).toHaveURL('/purchase/1');"
    ].join('\n'), { sourceFile: 'purchase.spec.ts', metadata: { processId: 'purchase' } });

    expect(result.metadata.processId).toBe('purchase');
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'navigate', url: 'http://localhost:3100/login', sourceLine: 1 }),
      expect.objectContaining({ type: 'fill', locator: 'testid=login-username', value: 'supplier001', sourceLine: 2 }),
      expect.objectContaining({ type: 'click', locator: 'testid=login-submit', sourceLine: 3 }),
      expect.objectContaining({ type: 'assertion', assertionType: 'text', locator: 'testid=process-state', expected: 'SUBMITTED', sourceLine: 4 }),
      expect.objectContaining({ type: 'assertion', assertionType: 'url', expected: '/purchase/1', sourceLine: 5 })
    ]));
    expect(result.warnings).toHaveLength(0);
  });

  it('parses role, label and css locators', () => {
    const result = parsePlaywrightRecording([
      "await page.getByRole('button', { name: 'Submit' }).click();",
      "await page.getByLabel('Amount').fill('100');",
      "await page.locator('[data-testid=approve]').click();",
      "await expect(page.getByRole('heading')).toBeVisible();"
    ].join('\n'));

    expect(result.steps.map(step => step.locator)).toEqual([
      'role=button[name=Submit]',
      'label=Amount',
      'locator=[data-testid=approve]',
      'role=heading'
    ]);
  });

  it('preserves unsupported statements as steps and warnings', () => {
    const result = parsePlaywrightRecording("await page.waitForTimeout(100);\nawait page.getByTestId('submit').click();");

    expect(result.steps[0]).toMatchObject({ type: 'unsupported', sourceLine: 1 });
    expect(result.warnings[0]).toContain('Unsupported statement at line 1');
    expect(result.steps[1]).toMatchObject({ type: 'click', locator: 'testid=submit' });
  });
});
