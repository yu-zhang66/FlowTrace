/**
 * Flow-package importer.
 *
 * Reads a directory containing `manifest.yaml` + `process.yaml` +
 * `systems/*.yaml` + `scenarios.yaml` + optional recordings / HAR / masked
 * fixtures and writes them into the target project's `.flowtrace/`
 * directory. Imported processes and scenarios are marked
 * `status: AUTO_EXTRACTED` (if no human review is required) or
 * `status: REVIEW_REQUIRED` (if selectors / error codes / transitions
 * must be validated by a human before verify may run them).
 *
 * This module is intentionally generic: it does not know any particular
 * business identifier.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { ProcessDslSchema, RuntimeConfigSchema, issuesFromZodError } from '../dsl/schema.js';
export async function importFlowPackage(opts) {
    const manifest = await readManifest(path.join(opts.packageDir, 'manifest.yaml'));
    const reviewRequired = manifest.reviewRequired ?? true;
    const systemsSrc = path.join(opts.packageDir, 'systems');
    const systemsTarget = path.join(opts.targetFlowtraceRoot, 'systems');
    await fs.mkdir(systemsTarget, { recursive: true });
    const importedSystems = [];
    let systemEntries = [];
    try {
        systemEntries = await fs.readdir(systemsSrc);
    }
    catch { /* no systems dir is fine */ }
    for (const entry of systemEntries) {
        if (!entry.endsWith('.yaml') && !entry.endsWith('.yml'))
            continue;
        const from = path.join(systemsSrc, entry);
        const target = path.join(systemsTarget, entry);
        const text = await fs.readFile(from, 'utf8');
        const systemSchema = RuntimeConfigSchema._def?.shape?.()?.systems ?? RuntimeConfigSchema.shape?.systems;
        const validated = validateOrThrow('systems/' + entry, yaml.load(text), systemSchema);
        await fs.writeFile(target, yaml.dump({ [entry.replace(/\.ya?ml$/, '')]: validated }, { indent: 2 }), 'utf8');
        importedSystems.push(entry);
    }
    let importedProcess = null;
    const processFile = path.join(opts.packageDir, 'process.yaml');
    try {
        const text = await fs.readFile(processFile, 'utf8');
        const parsed = yaml.load(text);
        const validated = validateOrThrow('process.yaml', parsed, ProcessDslSchema);
        const status = reviewRequired ? 'REVIEW_REQUIRED' : 'AUTO_EXTRACTED';
        const targetProcessDir = path.join(opts.targetFlowtraceRoot, 'processes');
        await fs.mkdir(targetProcessDir, { recursive: true });
        const target = path.join(targetProcessDir, `${validated.id}.yaml`);
        const payload = { ...validated, status };
        await fs.writeFile(target, yaml.dump(payload, { indent: 2 }), 'utf8');
        importedProcess = validated.id;
    }
    catch (err) {
        if (err?.code !== 'ENOENT')
            throw err;
    }
    let scenariosImported = 0;
    const scenariosFile = path.join(opts.packageDir, 'scenarios.yaml');
    const scenariosTarget = path.join(opts.targetFlowtraceRoot, 'scenarios');
    await fs.mkdir(scenariosTarget, { recursive: true });
    try {
        const text = await fs.readFile(scenariosFile, 'utf8');
        const parsed = yaml.load(text);
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.scenarios) ? parsed.scenarios : [];
        for (const raw of list) {
            if (!raw?.id)
                continue;
            const status = reviewRequired ? 'REVIEW_REQUIRED' : 'AUTO_EXTRACTED';
            const payload = { ...raw, imported: true, status };
            const target = path.join(scenariosTarget, `${raw.id}.yaml`);
            await fs.writeFile(target, yaml.dump(payload, { indent: 2 }), 'utf8');
            scenariosImported += 1;
        }
    }
    catch (err) {
        if (err?.code !== 'ENOENT')
            throw err;
    }
    let recordingsImported = 0;
    const recordingsSrc = path.join(opts.packageDir, 'recordings');
    const recordingsTarget = path.join(opts.targetFlowtraceRoot, 'recordings');
    try {
        const entries = await fs.readdir(recordingsSrc);
        await fs.mkdir(recordingsTarget, { recursive: true });
        for (const entry of entries) {
            await fs.copyFile(path.join(recordingsSrc, entry), path.join(recordingsTarget, entry));
            recordingsImported += 1;
        }
    }
    catch { /* no recordings dir is fine */ }
    let fixturesImported = 0;
    const fixturesSrc = path.join(opts.packageDir, 'fixtures');
    const fixturesTarget = path.join(opts.targetFlowtraceRoot, 'facts');
    try {
        const entries = await fs.readdir(fixturesSrc, { withFileTypes: true });
        await fs.mkdir(fixturesTarget, { recursive: true });
        for (const entry of entries) {
            if (!entry.isFile())
                continue;
            await fs.copyFile(path.join(fixturesSrc, entry.name), path.join(fixturesTarget, entry.name));
            fixturesImported += 1;
        }
    }
    catch { /* no fixtures dir is fine */ }
    return {
        imported: {
            systems: importedSystems,
            process: importedProcess,
            scenarios: scenariosImported,
            recordings: recordingsImported,
            fixtures: fixturesImported,
        },
        reviewRequired: reviewRequired ? [importedProcess, ...Array.from({ length: scenariosImported }, (_, i) => `scenario#${i + 1}`)].filter(Boolean) : [],
    };
}
async function readManifest(file) {
    try {
        const raw = await fs.readFile(file, 'utf8');
        const parsed = yaml.load(raw);
        if (!parsed?.id || !parsed?.name) {
            throw new Error(`manifest.yaml must declare at least 'id' and 'name'`);
        }
        return {
            id: String(parsed.id),
            name: String(parsed.name),
            version: String(parsed.version ?? '0.0.0'),
            reviewRequired: parsed.reviewRequired !== false,
        };
    }
    catch (err) {
        if (err?.code === 'ENOENT') {
            throw new Error(`flow-package manifest.yaml not found at ${file}`);
        }
        throw err;
    }
}
function validateOrThrow(label, input, schema) {
    const r = schema.safeParse(input);
    if (r.success)
        return r.data;
    const issues = issuesFromZodError(r.error);
    throw new Error(`flow-package ${label} failed validation:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
}
//# sourceMappingURL=import-package.js.map