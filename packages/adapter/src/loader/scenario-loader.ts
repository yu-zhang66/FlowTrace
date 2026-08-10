/**
 * Scenario loader for FlowTrace builtin runtime.
 *
 * Reads scenario YAML files from the project's `.flowtrace/scenarios`
 * directory tree, normalises them into a typed shape used by the runner /
 * reporter, and enforces the review-status contract:
 *
 *   - imported scenarios marked AUTO_EXTRACTED or REVIEW_REQUIRED are
 *     NOT allowed to participate in `flowtrace verify`
 *   - hand-written scenarios (no `imported: true`) are treated as already
 *     CONFIRMED
 *   - explicit `status: CONFIRMED` is always honoured
 *
 * This module is intentionally generic: it has no business identifier.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';

export type ScenarioReviewStatus = 'AUTO_EXTRACTED' | 'REVIEW_REQUIRED' | 'CONFIRMED';

export interface LoadedScenario {
  id: string;
  name: string;
  process: string;
  enabled: boolean;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  tags: string[];
  source: string[];
  actions: Array<{ action: string; actor?: string; data?: Record<string, unknown> }>;
  expected: {
    finalState: string | null;
    semanticPath: string[];
    illegalActions: Array<{ actionIndex: number; errorCode: string }>;
  };
  imported: boolean;
  status: ScenarioReviewStatus;
  sourceFile: string;
  /** Standalone scenarios inline their own DSL steps and need no process file. */
  standalone?: boolean;
  /** Inline DSL steps for standalone scenarios. */
  inlineSteps?: unknown[];
  /** Scenario-level actor (used by standalone scenarios). */
  actor?: string;
  /**
   * Authoritative login state a scenario must start from, established before
   * its main steps run. `loginAs` ensures the given actor is authenticated
   * (logging out any existing session first); `logout` ensures the session is
   * unauthenticated. Enforces the "check login state before the flow" rule.
   */
  precondition?: {
    /** Log in as this actor before the scenario steps run. */
    loginAs?: string;
    /** Ensure logged out before the scenario steps run. */
    logout?: boolean;
  };
}

export async function loadAllScenarios(scenariosDir: string): Promise<LoadedScenario[]> {
  const files: string[] = [];
  await walk(scenariosDir, files);
  const out: LoadedScenario[] = [];
  for (const file of files) {
    const loaded = await loadScenarioFile(file);
    if (loaded) out.push(loaded);
  }
  return out;
}

export async function loadScenarioFile(filePath: string): Promise<LoadedScenario | null> {
  if (!filePath.endsWith('.yaml') && !filePath.endsWith('.yml')) return null;
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = yaml.load(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.id) return null;
  if (!parsed.process && !Array.isArray(parsed.steps)) return null;

  const imported = parsed.imported === true;
  const explicitStatus = typeof parsed.status === 'string' ? (parsed.status as ScenarioReviewStatus) : undefined;
  const status: ScenarioReviewStatus = explicitStatus ?? (imported ? 'REVIEW_REQUIRED' : 'CONFIRMED');

  const expected = (parsed.expected ?? {}) as Record<string, unknown>;
  const illegalActions = normaliseIllegal(expected);

  // Scenario-level login precondition (optional). Enforces the rule that a
  // flow must start from a known authentication state.
  const preconditionRaw = (parsed.precondition ?? null) as null | Record<string, unknown>;
  let precondition: LoadedScenario['precondition'];
  if (preconditionRaw && typeof preconditionRaw === 'object') {
    const loginAs = typeof preconditionRaw.loginAs === 'string' ? preconditionRaw.loginAs : undefined;
    const logout = preconditionRaw.logout === true;
    if (loginAs || logout) precondition = { loginAs, logout: logout || undefined };
  }

  // A standalone scenario inlines its own DSL steps (`steps:`) instead of
  // referencing process actions (`actions:`). It needs no process file.
  const standalone = Array.isArray(parsed.steps);
  const inlineSteps = standalone ? (parsed.steps as unknown[]) : undefined;
  const actor = typeof parsed.actor === 'string' ? parsed.actor : undefined;

  const actionsRaw = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions = actionsRaw.map((a: any) => ({
    action: typeof a?.type === 'string' ? a.type : (typeof a?.action === 'string' ? a.action : 'UNKNOWN'),
    actor: typeof a?.actor === 'string' ? a.actor : undefined,
    data: (a?.data && typeof a.data === 'object') ? (a.data as Record<string, unknown>) : undefined,
  }));

  const out: LoadedScenario = {
    id: String(parsed.id),
    name: typeof parsed.name === 'string' ? parsed.name : String(parsed.id),
    process: parsed.process ? String(parsed.process) : 'functional',
    enabled: parsed.enabled !== false,
    severity: (parsed.severity as any) ?? 'P2',
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t)) : [],
    source: Array.isArray(parsed.source) ? parsed.source.map((s) => String(s)) : [],
    actions,
    expected: {
      finalState: typeof expected.finalState === 'string' ? expected.finalState : null,
      semanticPath: Array.isArray(expected.semanticPath) ? expected.semanticPath.map((s) => String(s)) : [],
      illegalActions,
    },
    imported,
    status,
    sourceFile: filePath,
    standalone,
    inlineSteps,
    actor,
    precondition,
  };
  return out;
}

function normaliseIllegal(expected: Record<string, unknown>): Array<{ actionIndex: number; errorCode: string }> {
  if (Array.isArray(expected.illegalActions) && expected.illegalActions.length > 0) {
    return expected.illegalActions
      .map((x: any) => ({
        actionIndex: Number(x?.actionIndex),
        errorCode: x?.errorCode ? String(x.errorCode) : '',
      }))
      .filter((x) => Number.isInteger(x.actionIndex) && x.errorCode);
  }
  if (expected.illegalActionErrorCode && expected.illegalActionIndex !== undefined && expected.illegalActionIndex !== null) {
    return [{ actionIndex: Number(expected.illegalActionIndex), errorCode: String(expected.illegalActionErrorCode) }];
  }
  return [];
}

async function walk(dir: string, acc: string[]): Promise<void> {
  let entries: any[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, acc);
    else if (e.isFile()) acc.push(full);
  }
}

export class ScenarioNotConfirmedError extends Error {
  readonly scenarioIds: string[];
  readonly processId: string;
  constructor(processId: string, scenarioIds: string[]) {
    const list = scenarioIds.map((id) => '  - ' + id).join('\n');
    super(
      'flowtrace verify refused to run ' +
        scenarioIds.length +
        ' unconfirmed scenario(s) for process "' +
        processId +
        '":\n' +
        list +
        '\nPromote them to CONFIRMED via \'flowtrace record-confirm ' +
        processId +
        '\' or by editing the scenario file\'s status: field.',
    );
    this.name = 'ScenarioNotConfirmedError';
    this.scenarioIds = scenarioIds;
    this.processId = processId;
  }
}