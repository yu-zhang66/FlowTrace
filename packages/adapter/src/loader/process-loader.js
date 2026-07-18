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
import { ProcessDslSchema, issuesFromZodError, } from '../dsl/schema.js';
export async function loadProcessDslFromFile(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = yaml.load(raw);
    const validated = ProcessDslSchema.safeParse(parsed);
    if (!validated.success) {
        throw new DslLoadError(filePath, issuesFromZodError(validated.error));
    }
    return { process: validated.data, sourceFile: filePath };
}
export async function loadAllProcessDsls(processesDir) {
    let entries = [];
    try {
        entries = await fs.readdir(processesDir);
    }
    catch (err) {
        if (err?.code === 'ENOENT')
            return [];
        throw err;
    }
    const out = [];
    for (const entry of entries) {
        if (!entry.endsWith('.yaml') && !entry.endsWith('.yml'))
            continue;
        const full = path.join(processesDir, entry);
        const stat = await fs.stat(full);
        if (!stat.isFile())
            continue;
        const loaded = await loadProcessDslFromFile(full);
        out.push(loaded);
    }
    return out;
}
export class DslLoadError extends Error {
    filePath;
    issues;
    constructor(filePath, issues) {
        super(`DSL validation failed for ${filePath}:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
        this.name = 'DslLoadError';
        this.filePath = filePath;
        this.issues = issues;
    }
}
//# sourceMappingURL=process-loader.js.map