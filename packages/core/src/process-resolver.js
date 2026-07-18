import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
const PROCESS_DIR = ['.flowtrace', 'processes'];
function normalize(value) {
    return (value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}
function asStrings(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean);
}
function processId(metadata, fallback) {
    return metadata.processId ?? metadata.id ?? fallback;
}
function processName(metadata, id) {
    return metadata.name?.trim() || id;
}
function metadataValues(metadata) {
    return {
        aliases: Array.from(new Set([
            ...asStrings(metadata.aliases),
            ...asStrings(metadata.metadata?.aliases)
        ])),
        keywords: Array.from(new Set([
            ...asStrings(metadata.keywords),
            ...asStrings(metadata.metadata?.keywords)
        ])),
        tags: Array.from(new Set([
            ...asStrings(metadata.tags),
            ...asStrings(metadata.metadata?.tags)
        ]))
    };
}
function readJsonMetadata(path) {
    try {
        const value = JSON.parse(readFileSync(path, 'utf8'));
        return value && typeof value === 'object' ? value : null;
    }
    catch {
        return null;
    }
}
function processDirectory(projectRoot) {
    return join(projectRoot, ...PROCESS_DIR);
}
function loadProcesses(projectRoot) {
    const directory = processDirectory(projectRoot);
    if (!existsSync(directory)) {
        return [];
    }
    const byId = new Map();
    const merge = (metadata, fallbackId) => {
        const id = processId(metadata, fallbackId).trim();
        if (!id) {
            return;
        }
        const values = metadataValues(metadata);
        const existing = byId.get(id);
        if (!existing) {
            byId.set(id, {
                candidate: {
                    id,
                    name: processName(metadata, id),
                    aliases: values.aliases,
                    confidence: typeof metadata.confidence === 'number' ? metadata.confidence : 0.5,
                    source: 'inventory'
                },
                keywords: values.keywords,
                tags: values.tags
            });
            return;
        }
        existing.candidate = {
            ...existing.candidate,
            name: metadata.name?.trim() || existing.candidate.name,
            aliases: Array.from(new Set([...existing.candidate.aliases, ...values.aliases])),
            confidence: typeof metadata.confidence === 'number' ? metadata.confidence : existing.candidate.confidence
        };
        existing.keywords = Array.from(new Set([...existing.keywords, ...values.keywords]));
        existing.tags = Array.from(new Set([...existing.tags, ...values.tags]));
    };
    const inventoryPath = join(directory, 'inventory.json');
    if (existsSync(inventoryPath)) {
        const inventory = readJsonMetadata(inventoryPath);
        if (inventory && Array.isArray(inventory.processes)) {
            for (const item of inventory.processes) {
                if (item && typeof item === 'object') {
                    merge(item, '');
                }
            }
        }
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'inventory.json') {
            continue;
        }
        const metadata = readJsonMetadata(join(directory, entry.name));
        if (metadata) {
            merge(metadata, entry.name.replace(/\.json$/, ''));
        }
    }
    for (const [id, loaded] of byId) {
        const metadata = loadProcessMetadata(projectRoot, id);
        if (!metadata) {
            continue;
        }
        const values = metadataValues(metadata);
        loaded.candidate.aliases = Array.from(new Set([...loaded.candidate.aliases, ...values.aliases]));
        loaded.keywords = Array.from(new Set([...loaded.keywords, ...values.keywords]));
        loaded.tags = Array.from(new Set([...loaded.tags, ...values.tags]));
    }
    return Array.from(byId.values());
}
function byExactId(query, processes) {
    return processes.filter(process => process.candidate.id === query.trim());
}
function byExactName(query, processes) {
    const normalizedQuery = normalize(query);
    return processes.filter(process => normalize(process.candidate.name) === normalizedQuery);
}
function byExactAlias(query, processes) {
    const normalizedQuery = normalize(query);
    return processes.filter(process => process.candidate.aliases.some(alias => normalize(alias) === normalizedQuery));
}
function byKeywords(query, processes) {
    const normalizedQuery = normalize(query);
    const tokens = normalizedQuery.split(/[\s,;:/_-]+/).filter(Boolean);
    if (tokens.length === 0) {
        return [];
    }
    return processes.filter(process => {
        const haystack = normalize([
            process.candidate.name,
            ...process.candidate.aliases,
            ...process.keywords,
            ...process.tags
        ].join(' '));
        return tokens.every(token => haystack.includes(token));
    });
}
function sortCandidates(processes) {
    return processes
        .map(process => process.candidate)
        .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id));
}
/** Return all process candidates from the target project's local inventory. */
export function listProcessCandidates(projectRoot) {
    return sortCandidates(loadProcesses(projectRoot));
}
function resolution(ok, code, query, matches) {
    const candidates = sortCandidates(matches);
    return {
        ok,
        code,
        process: ok && candidates.length === 1 ? candidates[0] : null,
        candidates,
        matchedBy: ok && candidates.length === 1 ? 'inventory' : null,
        query
    };
}
export function resolveProcess(projectRoot, query, explicitId = null) {
    const processes = loadProcesses(projectRoot);
    if (explicitId !== null) {
        const matches = byExactId(explicitId, processes);
        return matches.length === 1
            ? resolution(true, 'OK', explicitId, matches)
            : resolution(false, matches.length > 1 ? 'AMBIGUOUS_PROCESS' : 'PROCESS_NOT_FOUND', explicitId, matches);
    }
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
        // With no query, resolve the project-local inventory only when it has a
        // single unambiguous process. This supports commands such as
        // record-confirm without inventing a repository-wide default.
        return resolution(false, 'PROCESS_NOT_FOUND', '', []);
    }
    const exactId = byExactId(normalizedQuery, processes);
    if (exactId.length > 0) {
        return resolution(exactId.length === 1, exactId.length === 1 ? 'OK' : 'AMBIGUOUS_PROCESS', normalizedQuery, exactId);
    }
    const exactName = byExactName(normalizedQuery, processes);
    if (exactName.length > 0) {
        return resolution(exactName.length === 1, exactName.length === 1 ? 'OK' : 'AMBIGUOUS_PROCESS', normalizedQuery, exactName);
    }
    const exactAlias = byExactAlias(normalizedQuery, processes);
    if (exactAlias.length > 0) {
        return resolution(exactAlias.length === 1, exactAlias.length === 1 ? 'OK' : 'AMBIGUOUS_PROCESS', normalizedQuery, exactAlias);
    }
    const keywordMatches = byKeywords(normalizedQuery, processes);
    return keywordMatches.length === 1
        ? resolution(true, 'OK', normalizedQuery, keywordMatches)
        : resolution(false, keywordMatches.length > 1 ? 'AMBIGUOUS_PROCESS' : 'PROCESS_NOT_FOUND', normalizedQuery, keywordMatches);
}
export function loadProcessMetadata(projectRoot, processId) {
    const directory = processDirectory(projectRoot);
    for (const filename of [`${processId}.yaml`, `${processId}.yml`]) {
        const path = join(directory, filename);
        if (!existsSync(path)) {
            continue;
        }
        try {
            const value = yaml.load(readFileSync(path, 'utf8'));
            if (!value || typeof value !== 'object') {
                return null;
            }
            const metadata = value;
            const values = metadataValues(metadata);
            return {
                ...(values.aliases.length > 0 ? { aliases: values.aliases } : {}),
                ...(values.keywords.length > 0 ? { keywords: values.keywords } : {}),
                ...(values.tags.length > 0 ? { tags: values.tags } : {})
            };
        }
        catch {
            return null;
        }
    }
    return null;
}
//# sourceMappingURL=process-resolver.js.map