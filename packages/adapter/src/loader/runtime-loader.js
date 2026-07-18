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
import * as path from 'node:path';
import { createBuiltinRuntime } from '../runtime/builtin-runtime.js';
import { RuntimeConfigSchema, issuesFromZodError } from '../dsl/schema.js';
/**
 * Validate the `runtime:` block of a project's `flowtrace.yaml` and return
 * either a typed `RuntimeConfig` or a list of validation issues.
 */
export function validateRuntimeBlock(input) {
    const parsed = RuntimeConfigSchema.safeParse(input);
    if (parsed.success)
        return { ok: true, config: parsed.data };
    return { ok: false, issues: issuesFromZodError(parsed.error) };
}
/**
 * Build the adapter set for a project. Returns the structured result plus a
 * human-readable `messages` array used by the CLI / reporter for warnings
 * and migration notices.
 */
export async function loadAdapterSet(rawRuntime, opts) {
    const messages = [];
    const validated = validateRuntimeBlock(rawRuntime);
    if (!validated.ok) {
        throw new RuntimeValidationError(validated.issues);
    }
    const runtime = validated.config;
    const evidenceRoot = opts.evidenceRoot ?? path.join(opts.flowtraceRoot, 'executions');
    if (runtime.adapter === 'builtin') {
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
function buildBuiltinSet(runtime, evidenceRoot) {
    const runtimes = {};
    const systems = {};
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
async function loadExternalSet(runtime, _evidenceRoot) {
    if (!runtime.external) {
        throw new RuntimeValidationError([
            { path: 'runtime.external', message: 'runtime.adapter is `external` but runtime.external is missing' },
        ]);
    }
    const external = runtime.external;
    let mod;
    try {
        mod = await import(external.module);
    }
    catch (err) {
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
async function loadLegacySet(runtime, opts, messages) {
    const cfg = opts.__legacyPaths;
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
    const legacySet = {
        kind: 'legacy',
        systems: runtime.systems,
        paths: { legacy: legacyPath, current: currentPath },
        resolvedPaths: { legacy: resolvedLegacy, current: resolvedCurrent },
        warning,
    };
    return legacySet;
}
function resolveAdapterPath(relativePath, projectRoot, flowtraceRoot) {
    if (relativePath.startsWith('/'))
        return relativePath;
    if (relativePath.startsWith('.'))
        return path.resolve(projectRoot, relativePath);
    return path.resolve(flowtraceRoot, relativePath);
}
export class RuntimeValidationError extends Error {
    issues;
    constructor(issues) {
        super(`runtime configuration is invalid:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
        this.name = 'RuntimeValidationError';
        this.issues = issues;
    }
}
//# sourceMappingURL=runtime-loader.js.map