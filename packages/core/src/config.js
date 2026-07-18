import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join, extname, dirname } from 'path';
import { pathToFileURL } from 'url';
import yaml from 'js-yaml';
import { ProjectConfigSchema } from './models/config.js';
export class ProjectConfigLoader {
    load(configPath) {
        const content = readFileSync(configPath, 'utf-8');
        const result = ProjectConfigSchema.safeParse(yaml.load(content));
        if (!result.success) {
            throw new Error(`Invalid project config: ${result.error.message}`);
        }
        return result.data;
    }
}
export class ArtifactPathResolver {
    flowtraceRoot;
    config;
    constructor(flowtraceRoot, config) {
        this.flowtraceRoot = flowtraceRoot;
        this.config = config;
    }
    get(pathKey) {
        return resolve(this.flowtraceRoot, this.config.paths[pathKey]);
    }
    adapter(relativePath) {
        return resolve(this.flowtraceRoot, relativePath);
    }
}
export class TargetProjectLoader {
    configLoader;
    constructor(configLoader = new ProjectConfigLoader()) {
        this.configLoader = configLoader;
    }
    load(projectPath = process.cwd()) {
        const projectRoot = resolve(projectPath);
        const candidates = [
            resolve(projectRoot, '.flowtrace', 'flowtrace.yaml'),
            resolve(projectRoot, '.flowtrace', 'flowtrace.yml'),
            resolve(projectRoot, 'flowtrace.yaml'),
            resolve(projectRoot, 'flowtrace.yml')
        ];
        const configPath = candidates.find(candidate => existsSync(candidate));
        if (!configPath) {
            throw new Error(`No .flowtrace/flowtrace.yaml found in ${projectRoot}`);
        }
        const flowtraceRoot = dirname(configPath);
        const effectiveProjectRoot = flowtraceRoot.endsWith(`${join('', '.flowtrace')}`)
            ? dirname(flowtraceRoot)
            : projectRoot;
        const config = this.configLoader.load(configPath);
        return {
            projectRoot: effectiveProjectRoot,
            flowtraceRoot,
            configPath,
            config,
            paths: new ArtifactPathResolver(flowtraceRoot, config)
        };
    }
}
export class AdapterLoader {
    async load(target, relativePath, exportName) {
        const adapterPath = target.paths.adapter(relativePath);
        if (!existsSync(adapterPath)) {
            throw new Error(`Adapter not found: ${adapterPath}`);
        }
        if (extname(adapterPath) === '.ts') {
            throw new Error(`TypeScript adapter must be compiled before execution: ${adapterPath}`);
        }
        const module = await import(pathToFileURL(adapterPath).href);
        const adapter = module[exportName] ?? module.default;
        if (!adapter) {
            throw new Error(`Adapter export ${exportName} not found in ${adapterPath}`);
        }
        return adapter;
    }
}
export class ConfigLoader {
    target;
    constructor(projectRoot) {
        this.target = new TargetProjectLoader().load(projectRoot);
    }
    loadProjectConfig() {
        return this.target.config;
    }
    getProject() {
        return this.target;
    }
    getPath(config, pathKey) {
        return new ArtifactPathResolver(this.target.flowtraceRoot, config).get(pathKey);
    }
    loadScenarios(config) {
        const scenariosPath = this.getPath(config, 'scenarios');
        if (!existsSync(scenariosPath)) {
            return [];
        }
        return this.loadFiles(scenariosPath, ['.yaml', '.yml', '.json']);
    }
    loadFiles(dirPath, extensions) {
        if (!existsSync(dirPath)) {
            return [];
        }
        const results = [];
        const files = readdirSync(dirPath, { withFileTypes: true });
        for (const file of files) {
            const fullPath = join(dirPath, file.name);
            if (file.isDirectory()) {
                results.push(...this.loadFiles(fullPath, extensions));
            }
            else if (extensions.includes(extname(file.name))) {
                try {
                    const content = readFileSync(fullPath, 'utf-8');
                    const data = extname(file.name) === '.json'
                        ? JSON.parse(content)
                        : yaml.load(content);
                    if (Array.isArray(data)) {
                        results.push(...data);
                    }
                    else {
                        results.push(data);
                    }
                }
                catch (error) {
                    console.warn(`Failed to load ${fullPath}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        return results;
    }
}
export function discoverProjects(searchPaths) {
    const projects = [];
    for (const searchPath of searchPaths) {
        if (!existsSync(searchPath)) {
            continue;
        }
        const entries = readdirSync(searchPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const rootPath = resolve(searchPath, entry.name);
            const configPath = [
                resolve(rootPath, '.flowtrace', 'flowtrace.yaml'),
                resolve(rootPath, 'flowtrace.yaml')
            ].find(candidate => existsSync(candidate));
            if (configPath) {
                try {
                    const loader = new ConfigLoader(rootPath);
                    const config = loader.loadProjectConfig();
                    projects.push({
                        id: config.project.id,
                        name: config.project.name,
                        rootPath,
                        configPath
                    });
                }
                catch {
                    console.warn(`Failed to load config from ${configPath}`);
                }
            }
        }
    }
    return projects;
}
export function generateId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}
//# sourceMappingURL=config.js.map