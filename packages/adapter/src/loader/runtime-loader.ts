/**
 * Runtime loader for FlowTrace builtin runtime.
 *
 * Selects one of three adapter modes based on the project's `runtime:`
 * block:
 *
 *  - `builtin` (default for new projects): construct a `BuiltinRuntime`
 *    per system id. Project-local `.flowtrace/adapters/*.mjs` are NEVER
 *    read.
 *
 *  - `external`: dynamic `import()` of the declared module. The module
 *    MUST export `name`, `version`, and either a default factory
 *    `(systemConfig) => Promise<{ executeAction, executeScenario, ... }>`
 *    or `{ createExternalAdapter }`. Missing module → actionable error,
 *    NO demo fallback.
 *
 *  - `legacy`: explicit legacy compatibility mode. The project MUST
 *    declare `legacy.legacy` / `legacy.current` paths under `adapters:`.
 *    A migration warning is emitted. This mode is provided only for
 *    migration; new projects MUST NOT default to it.
 *
 * The loader is intentionally generic: it does not know any particular
 * business identifier.
 */

import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { createBuiltinRuntime, type BuiltinRuntime } from '../runtime/builtin-runtime.js';
import type { RuntimeConfig, RuntimeSystemConfig } from '../runtime/types.js';
import { RuntimeConfigSchema, type DslValidationIssue, issuesFromZodError } from '../dsl/schema.js';

export interface RuntimeLoaderOptions {
  flowtraceRoot: string;
  projectRoot: string;
  evidenceRoot?: string | null;
}

export interface LegacyAdapterPaths {
  legacy?: string;
  current?: string;
}

export interface LoaderContext {
  runtime: RuntimeConfig;
  evidenceRoot: string | null;
}

export interface BuiltinAdapterSet {
  kind: 'builtin';
  runtimes: Record<string, BuiltinRuntime>;
  systems: Record<string, RuntimeSystemConfig>;
}

export interface ExternalAdapterSet {
  kind: 'external';
  systems: Record<string, RuntimeSystemConfig>;
  module: string;
  pluginName: string;
  pluginVersion: string;
  factory: unknown;
}

export interface LegacyAdapterSet {
  kind: 'legacy';
  systems: Record<string, RuntimeSystemConfig>;
  paths: Required<LegacyAdapterPaths>;
  /** Resolved absolute adapter module paths. */
  resolvedPaths: { legacy: string; current: string };
  warning: string;
}

export type AdapterSet = BuiltinAdapterSet | ExternalAdapterSet | LegacyAdapterSet;

/**
 * Validate the `runtime:` block of a project's `flowtrace.yaml` and return
 * either a typed `RuntimeConfig` or a list of validation issues.
 */
export function validateRuntimeBlock(input: unknown): { ok: true; config: RuntimeConfig } | { ok: false; issues: DslValidationIssue[] } {
  const parsed = RuntimeConfigSchema.safeParse(input);
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, issues: issuesFromZodError(parsed.error) };
}

/**
 * Build the adapter set for a project. Returns the structured result plus a
 * human-readable `messages` array used by the CLI / reporter for warnings
 * and migration notices.
 *
 * When `runtime.adapter` is `builtin`, this function also merges each
 * system's per-system YAML configuration from `<flowtraceRoot>/systems/<id>.yaml`
 * into the `runtime.systems.<id>` block declared in `flowtrace.yaml`. The
 * `flowtrace.yaml` block provides the identity / baseUrl / channel; the
 * per-system YAML adds `endpoints`, `selectors`, `pages`, `login`, `redact`,
 * `browser` and similar fields.
 */
export async function loadAdapterSet(rawRuntime: unknown, opts: RuntimeLoaderOptions): Promise<{ set: AdapterSet; messages: string[] }> {
  const messages: string[] = [];
  const validated = validateRuntimeBlock(rawRuntime);
  if (!validated.ok) {
    throw new RuntimeValidationError(validated.issues);
  }
  const runtime = validated.config;
  const evidenceRoot = opts.evidenceRoot ?? path.join(opts.flowtraceRoot, 'executions');

  if (runtime.adapter === 'builtin') {
    await mergeSystemFiles(runtime, opts);
    return { set: buildBuiltinSet(runtime, evidenceRoot), messages };
  }
  if (runtime.adapter === 'external') {
    const ext = await loadExternalSet(runtime, evidenceRoot);
    return { set: ext, messages };
  }
  // legacy: explicit paths required
  const legacySet = await loadLegacySet(runtime, opts, messages);
  return { set: legacySet, messages };
}

async function mergeSystemFiles(runtime: RuntimeConfig, opts: RuntimeLoaderOptions): Promise<void> {
  const systemsDir = path.join(opts.flowtraceRoot, 'systems');
  let entries: string[] = [];
  try {
    entries = await fs.readdir(systemsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
    const sysId = entry.replace(/\.ya?ml$/, '');
    const filePath = path.join(systemsDir, entry);
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') continue;
    const existing = runtime.systems[sysId];
    if (!existing) {
      // Only file with no corresponding runtime.systems entry: skip
      continue;
    }
    runtime.systems[sysId] = { ...parsed, id: existing.id, baseUrl: existing.baseUrl, channel: existing.channel, label: existing.label ?? parsed.label } as any;
  }
}

function buildBuiltinSet(runtime: RuntimeConfig, evidenceRoot: string | null): BuiltinAdapterSet {
  const runtimes: Record<string, BuiltinRuntime> = {};
  const systems: Record<string, RuntimeSystemConfig> = {};
  for (const [id, system] of Object.entries(runtime.systems)) {
    systems[id] = system;
    runtimes[id] = createBuiltinRuntime({
      system,
      side: id,
      evidenceRoot,
    });
  }
  return { kind: 'builtin', runtimes, systems };
}

async function loadExternalSet(runtime: RuntimeConfig, _evidenceRoot: string | null): Promise<ExternalAdapterSet> {
  if (!runtime.external) {
    throw new RuntimeValidationError([
      { path: 'runtime.external', message: 'runtime.adapter is `external` but runtime.external is missing' },
    ]);
  }
  const external = runtime.external;
  let mod: any;
  try {
    mod = await import(external.module);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RuntimeValidationError([
      {
        path: 'runtime.external.module',
        message: `Failed to load external plugin module "${external.module}": ${message}. Check that the module is installed and resolvable from the project root.`,
      },
    ]);
  }
  const factory = mod?.default ?? mod?.createExternalAdapter ?? mod?.createFlowAdapter;
  if (typeof factory !== 'function') {
    throw new RuntimeValidationError([
      {
        path: 'runtime.external.module',
        message: `External plugin "${external.module}" must export a default factory or createExternalAdapter/createFlowAdapter function.`,
      },
    ]);
  }
  return {
    kind: 'external',
    systems: runtime.systems,
    module: external.module,
    pluginName: external.name,
    pluginVersion: external.version,
    factory,
  };
}

async function loadLegacySet(
  runtime: RuntimeConfig,
  opts: RuntimeLoaderOptions,
  messages: string[],
): Promise<LegacyAdapterSet> {
  const cfg = (opts as any).__legacyPaths as LegacyAdapterPaths | undefined;
  // In legacy mode the project still needs to declare adapter paths via the
  // CLI / flowtrace.yaml `adapters.legacy` / `adapters.current` keys. The
  // loader requires those to be passed in via `RuntimeLoaderOptions.__legacyPaths`
  // so the caller can keep the legacy metadata in target-config.ts without
  // FlowTrace depending on it directly.
  const legacyPath = cfg?.legacy;
  const currentPath = cfg?.current;
  if (!legacyPath || !currentPath) {
    throw new RuntimeValidationError([
      {
        path: 'adapters.legacy',
        message: 'runtime.adapter is `legacy` but the project did not declare adapters.legacy / adapters.current paths. Provide them in flowtrace.yaml under `adapters:`.',
      },
    ]);
  }
  const resolvedLegacy = resolveAdapterPath(legacyPath, opts.projectRoot, opts.flowtraceRoot);
  const resolvedCurrent = resolveAdapterPath(currentPath, opts.projectRoot, opts.flowtraceRoot);
  if (!existsSync(resolvedLegacy)) {
    throw new RuntimeValidationError([
      {
        path: 'adapters.legacy',
        message: `Legacy adapter module not found at ${resolvedLegacy}. flowtrace runtime.adapter: legacy requires project-local adapter source files; new projects should switch to runtime.adapter: builtin.`,
      },
    ]);
  }
  if (!existsSync(resolvedCurrent)) {
    throw new RuntimeValidationError([
      {
        path: 'adapters.current',
        message: `Legacy current adapter module not found at ${resolvedCurrent}. flowtrace runtime.adapter: legacy requires project-local adapter source files; new projects should switch to runtime.adapter: builtin.`,
      },
    ]);
  }
  const warning = [
    '[flowtrace] Migration warning: runtime.adapter is `legacy`.',
    '   Legacy mode loads project-local JavaScript modules from .flowtrace/adapters/.',
    '   This mode is provided only for backward compatibility. New projects should migrate to runtime.adapter: builtin with declarative systems/processes YAML.',
  ].join('\n');
  messages.push(warning);
  const legacySet: LegacyAdapterSet = {
    kind: 'legacy',
    systems: runtime.systems,
    paths: { legacy: legacyPath, current: currentPath },
    resolvedPaths: { legacy: resolvedLegacy, current: resolvedCurrent },
    warning,
  };
  return legacySet;
}

function resolveAdapterPath(relativePath: string, projectRoot: string, flowtraceRoot: string): string {
  if (relativePath.startsWith('/')) return relativePath;
  if (relativePath.startsWith('.')) return path.resolve(projectRoot, relativePath);
  return path.resolve(flowtraceRoot, relativePath);
}

export class RuntimeValidationError extends Error {
  readonly issues: DslValidationIssue[];
  constructor(issues: DslValidationIssue[]) {
    super(`runtime configuration is invalid:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'RuntimeValidationError';
    this.issues = issues;
  }
}