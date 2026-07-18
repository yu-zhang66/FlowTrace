/**
 * Process DSL loader.
 *
 * Reads `processes/<id>.yaml` files from the project's `.flowtrace/`
 * directory, validates them with the DSL schema and returns parsed
 * `ProcessDsl` values. Validation failures are surfaced with file path
 * and the underlying Zod issue list.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import {
  ProcessDslSchema,
  type DslValidationIssue,
  issuesFromZodError,
} from '../dsl/schema.js';
import type { ProcessDsl } from '../runtime/types.js';

export interface LoadProcessResult {
  process: ProcessDsl;
  sourceFile: string;
}

export async function loadProcessDslFromFile(filePath: string): Promise<LoadProcessResult> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = yaml.load(raw);
  const validated = ProcessDslSchema.safeParse(parsed);
  if (!validated.success) {
    throw new DslLoadError(filePath, issuesFromZodError(validated.error));
  }
  return { process: validated.data as ProcessDsl, sourceFile: filePath };
}

export async function loadAllProcessDsls(processesDir: string): Promise<LoadProcessResult[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(processesDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }
  const out: LoadProcessResult[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
    const full = path.join(processesDir, entry);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    const loaded = await loadProcessDslFromFile(full);
    out.push(loaded);
  }
  return out;
}

export class DslLoadError extends Error {
  readonly filePath: string;
  readonly issues: DslValidationIssue[];
  constructor(filePath: string, issues: DslValidationIssue[]) {
    super(`DSL validation failed for ${filePath}:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'DslLoadError';
    this.filePath = filePath;
    this.issues = issues;
  }
}