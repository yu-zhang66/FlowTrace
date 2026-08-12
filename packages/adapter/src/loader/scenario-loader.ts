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

// ============================================================
// Template resolution
// ============================================================

/** Load template definitions from a YAML file. */
export async function loadTemplates(templatePath: string): Promise<Record<string, { steps: unknown[] }>> {
  try {
    const raw = await fs.readFile(templatePath, 'utf8');
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    return (parsed?.templates as Record<string, { steps: unknown[] }>) ?? {};
  } catch {
    return {};
  }
}

/** Substitute `{{ varName }}` in all string values of an object tree. */
function substituteParams(obj: unknown, params: Record<string, string>): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, name) => {
      const key = String(name).trim();
      return Object.prototype.hasOwnProperty.call(params, key) ? params[key] : `{{ ${key} }}`;
    });
  }
  if (Array.isArray(obj)) return obj.map((v) => substituteParams(v, params));
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = substituteParams(v, params);
    }
    return out;
  }
  return obj;
}

/** Recursively resolve template references in steps. */
function resolveTemplateSteps(
  steps: unknown[],
  templates: Record<string, { steps: unknown[] }>,
  params: Record<string, string>,
  depth: number = 0,
): unknown[] {
  if (depth > 10) return steps; // guard against infinite recursion
  const resolved: unknown[] = [];
  for (const step of steps) {
    const s = step as Record<string, unknown> | null;
    if (s?.type === 'template' && s?.name && templates[String(s.name)]) {
      const tmpl = templates[String(s.name)];
      const mergedParams = { ...params, ...(s.params as Record<string, string> ?? {}) };
      const expanded = resolveTemplateSteps(tmpl.steps, templates, mergedParams, depth + 1);
      // Apply parameter substitution to the expanded steps
      const substituted = expanded.map((e) => substituteParams(e, mergedParams));
      resolved.push(...substituted);
    } else {
      // Apply parameter substitution to non-template steps too
      resolved.push(substituteParams(step, params));
    }
  }
  return resolved;
}

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

// ============================================================
// FlowDef-based scenario expansion
// ============================================================

interface FlowDefYaml {
  flowName: string;
  commonFormFields?: Record<string, string>;
  plants: Record<string, FlowDefPlant>;
}

interface FlowDefPlant {
  name: string;
  prefix: string;
  initiate: {
    actor: string;
    nextNode: string;
    formFields?: Record<string, string>;
  };
  steps: FlowDefStep[];
}

interface FlowDefStep {
  taskName: string;
  actor: string;
  nextNode: string;
  fillTemplate?: string;
}

function pad(n: number) { return String(n).padStart(3, '0'); }

function computeRegexPattern(taskName: string): string {
  if (taskName.includes('明细')) {
    return '.*(货运|货票)明细(表)?制单.*';
  }
  if (/[()]/.test(taskName)) {
    return `.*${taskName.replace(/\(/g, '\\(').replace(/\)/g, '\\)')}.*`;
  }
  return taskName;
}

function makeScenario(
  id: string,
  name: string,
  actor: string,
  process: string,
  tags: string[],
  inlineSteps: unknown[],
  sourceFile: string,
): LoadedScenario {
  return {
    id,
    name,
    process,
    enabled: true,
    severity: 'P0',
    tags,
    source: [],
    actions: [{ action: id, actor }],
    expected: { finalState: null, semanticPath: [], illegalActions: [] },
    imported: false,
    status: 'CONFIRMED',
    sourceFile,
    standalone: true,
    inlineSteps,
    actor,
    precondition: { loginAs: actor },
  };
}

export async function loadFlowDefScenarios(
  flowtraceDir: string,
  templates: Record<string, { steps: unknown[] }>,
): Promise<LoadedScenario[]> {
  const scenarios: LoadedScenario[] = [];
  const scenariosDir = path.join(flowtraceDir, 'scenarios');

  // Find scenario files that reference a flowDef
  let entries: any[] = [];
  try { entries = await fs.readdir(scenariosDir, { withFileTypes: true }); } catch { return scenarios; }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.yaml') && !entry.name.endsWith('.yml')) continue;

    const filePath = path.join(scenariosDir, entry.name);
    let parsed: Record<string, unknown> | null;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      parsed = yaml.load(raw) as Record<string, unknown> | null;
    } catch { continue; }
    if (!parsed || typeof parsed.flowDef !== 'string') continue;

    const flowDefName = parsed.flowDef;
    const flowDefPath = path.join(flowtraceDir, 'flow-defs', `${flowDefName}.yaml`);
    let flowDef: FlowDefYaml;
    try {
      const raw = await fs.readFile(flowDefPath, 'utf8');
      flowDef = yaml.load(raw) as FlowDefYaml;
    } catch (err) {
      console.warn(`[flowtrace] flowDef "${flowDefName}" not found at ${flowDefPath}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!flowDef || !flowDef.plants) continue;

    const flowName = flowDef.flowName || flowDefName;
    const plantKeys = Array.isArray(parsed.plants) ? parsed.plants as string[] : Object.keys(flowDef.plants);
    const commonFields = flowDef.commonFormFields ?? {};

    for (const plantKey of plantKeys) {
      const plant = flowDef.plants[plantKey];
      if (!plant) continue;

      const sourceFile = `<flowDef:${flowDefName}@${plantKey}>`;

      // --- Initiate scenario ---
      const init = plant.initiate;
      const allFormFields: Record<string, string> = { ...commonFields, ...(init.formFields ?? {}) };
      const initParams: Record<string, string> = {
        plantKey,
        plantName: plant.name,
        flowName,
        nextNode: init.nextNode,
        ...allFormFields,
      };
      const initSteps = resolveTemplateSteps(
        templates['initiate']?.steps ?? [],
        templates,
        initParams,
      );
      scenarios.push(makeScenario(
        `tc-${plantKey}-initiate-001`,
        `${flowName}-${plant.name}-发起流程`,
        init.actor,
        'functional',
        ['flow-center', 'initiate', 'port-coal', plantKey, 'main'],
        initSteps.map((s) => substituteParams(s, initParams)),
        sourceFile,
      ));

      // --- Todo scenarios ---
      let idx = 1;
      for (const step of plant.steps) {
        if (step.taskName === '流程结束') continue;

        const templateName = step.fillTemplate === 'qualityFormFields'
          ? 'todo-fill-quality'
          : step.fillTemplate === 'freigthFormFields'
          ? 'todo-fill-freight'
          : 'todo-no-fill';

        const regexPattern = computeRegexPattern(step.taskName);
        const todoParams: Record<string, string> = {
          plantKey,
          actor: step.actor,
          taskName: step.taskName,
          regexPattern,
          flowName,
          nextNode: step.nextNode,
          index: String(idx),
        };

        const todoSteps = resolveTemplateSteps(
          templates[templateName]?.steps ?? [],
          templates,
          todoParams,
        );
        scenarios.push(makeScenario(
          `tc-${plantKey}-todo-${pad(idx)}`,
          `${flowName}-${plant.name}-${step.taskName}`,
          step.actor,
          'functional',
          ['flow-center', 'todo', 'port-coal', plantKey, 'main'],
          todoSteps.map((s) => substituteParams(s, todoParams)),
          sourceFile,
        ));
        idx++;
      }
    }
  }

  return scenarios;
}

export async function loadAllScenarios(scenariosDir: string): Promise<LoadedScenario[]> {
  const flowtraceDir = path.dirname(scenariosDir);
  const templatePath = path.join(flowtraceDir, 'templates.yaml');
  const templates = await loadTemplates(templatePath);

  const files: string[] = [];
  await walk(scenariosDir, files);
  const out: LoadedScenario[] = [];
  for (const file of files) {
    const loaded = await loadScenarioFile(file, templates);
    if (loaded) out.push(loaded);
  }

  // Expand flowDef-based scenarios (one file → many virtual scenarios)
  const flowDefScenarios = await loadFlowDefScenarios(flowtraceDir, templates);
  out.push(...flowDefScenarios);

  return out;
}

export async function loadScenarioFile(filePath: string, templates?: Record<string, { steps: unknown[] }>): Promise<LoadedScenario | null> {
  if (!filePath.endsWith('.yaml') && !filePath.endsWith('.yml')) return null;
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = yaml.load(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.id) return null;
  if (!parsed.process && !Array.isArray(parsed.steps)) return null;

  // Skip flowDef scenario files (they are expanded by loadFlowDefScenarios)
  if (parsed.flowDef) return null;

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
  // Resolve template references in inline steps
  let inlineSteps = standalone ? (parsed.steps as unknown[]) : undefined;
  if (inlineSteps && templates && Object.keys(templates).length > 0) {
    const scenarioParams: Record<string, string> = {};
    // Extract scenario-level params (id, actor, etc.) as template variables
    if (typeof parsed.id === 'string') scenarioParams.id = parsed.id;
    if (typeof parsed.actor === 'string') scenarioParams.actor = parsed.actor;
    inlineSteps = resolveTemplateSteps(inlineSteps, templates, scenarioParams);
  }
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