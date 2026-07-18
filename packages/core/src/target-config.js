/**
 * Target Project Configuration Loader
 *
 * 负责从目标项目的 .flowtrace/ 目录加载配置
 * 并解析 collectors、adapters、database、semantic 等配置
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import yaml from 'js-yaml';
/**
 * 加载目标项目配置
 */
export function loadTargetProjectConfig(projectPath) {
    const projectRoot = resolve(projectPath);
    const candidates = [
        resolve(projectRoot, '.flowtrace', 'flowtrace.yaml'),
        resolve(projectRoot, '.flowtrace', 'flowtrace.yml'),
        resolve(projectRoot, 'flowtrace.yaml'),
        resolve(projectRoot, 'flowtrace.yml')
    ];
    const configPath = candidates.find(candidate => existsSync(candidate));
    if (!configPath) {
        throw new Error(`FlowTrace config not found in ${projectRoot}\nRun: flowtrace init --project ${projectPath}`);
    }
    const flowtraceRoot = configPath.endsWith(`${join('', '.flowtrace', 'flowtrace.yaml')}`)
        ? resolve(projectRoot, '.flowtrace')
        : projectRoot;
    const content = readFileSync(configPath, 'utf-8');
    const raw = yaml.load(content);
    // 解析路径
    const paths = {
        facts: raw.paths?.facts || 'facts',
        scenarios: raw.paths?.scenarios || 'scenarios',
        reports: raw.paths?.reports || 'reports',
        mappings: raw.paths?.mappings || 'mappings',
        semantic: raw.paths?.semantic || 'semantic',
        fixtures: raw.paths?.fixtures || 'fixtures',
        executions: raw.paths?.executions || 'executions',
        mocks: raw.paths?.mocks || 'mocks'
    };
    // 解析采集器配置
    const collectors = [];
    if (raw.collectors) {
        for (const c of raw.collectors) {
            collectors.push({
                name: c.name,
                type: c.type,
                enabled: c.enabled !== false,
                priority: c.priority,
                options: c.options,
                path: c.path
            });
        }
    }
    // 添加默认采集器（如果没有配置）
    if (collectors.length === 0) {
        collectors.push({ name: 'source-collector', type: 'source-scanner', enabled: true, priority: 10 }, { name: 'demo-collector', type: 'demo', enabled: true, priority: 100 });
    }
    return {
        projectRoot,
        flowtraceRoot,
        configPath,
        project: {
            id: raw.project?.id || extractProjectId(projectPath),
            name: raw.project?.name || extractProjectName(projectPath),
            sourceRoot: raw.project?.sourceRoot || '.'
        },
        processId: raw.pilot?.process || 'demo-process',
        collectors,
        adapters: {
            legacy: raw.adapters?.legacy || 'adapters/legacy-flow-adapter.mjs',
            current: raw.adapters?.current || 'adapters/current-flow-adapter.mjs'
        },
        database: {
            type: raw.database?.type || 'oracle',
            configSource: raw.database?.configSource || 'config/database.yaml',
            access: raw.database?.access || 'read-only-collection',
            connection: raw.database?.connection
        },
        semantic: {
            keywordsDir: raw.semantic?.keywordsDir || 'semantic/keywords',
            mappingsDir: raw.semantic?.mappingsDir || 'mappings'
        },
        paths,
        execution: {
            mode: raw.execution?.mode || 'dual-run',
            allowOnlineWrite: raw.execution?.allowOnlineWrite ?? false,
            databaseMode: raw.execution?.databaseMode || 'snapshot-only',
            testDataMode: raw.execution?.testDataMode || 'masked-or-snapshot',
            failOn: raw.execution?.failOn || ['P0', 'P1']
        },
        pilot: raw.pilot ? {
            process: raw.pilot.process,
            currentAdapterMode: raw.pilot.currentAdapterMode || 'legacy-shadow',
            note: raw.pilot.note
        } : undefined
    };
}
/**
 * 获取绝对路径
 */
export function resolveTargetPath(config, relativePath) {
    if (relativePath.startsWith('/')) {
        return relativePath;
    }
    return resolve(config.flowtraceRoot, relativePath);
}
/**
 * 获取 facts 目录
 */
export function getFactsDir(config) {
    return resolveTargetPath(config, config.paths.facts);
}
/**
 * 获取 scenarios 目录
 */
export function getScenariosDir(config) {
    return resolveTargetPath(config, config.paths.scenarios);
}
/**
 * 获取 semantic 目录
 */
export function getSemanticDir(config) {
    return resolveTargetPath(config, config.paths.semantic);
}
/**
 * 获取 reports 目录
 */
export function getReportsDir(config) {
    return resolveTargetPath(config, config.paths.reports);
}
/**
 * 获取 executions 目录
 */
export function getExecutionsDir(config) {
    return resolveTargetPath(config, config.paths.executions);
}
/**
 * 获取源文件根目录
 */
export function getSourceRoot(config) {
    if (config.project.sourceRoot.startsWith('/')) {
        return config.project.sourceRoot;
    }
    return resolve(config.projectRoot, config.project.sourceRoot);
}
/**
 * 从项目路径提取 ID
 */
function extractProjectId(projectPath) {
    const parts = projectPath.split(/[/\\]/);
    const name = parts[parts.length - 1] || 'unknown';
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
/**
 * 从项目路径提取名称
 */
function extractProjectName(projectPath) {
    const parts = projectPath.split(/[/\\]/);
    return parts[parts.length - 1] || 'Unknown Project';
}
/**
 * 验证配置完整性
 */
export function validateTargetConfig(config) {
    const errors = [];
    if (!config.project.id) {
        errors.push('project.id is required');
    }
    if (!config.processId) {
        errors.push('pilot.process is required');
    }
    if (config.collectors.length === 0) {
        errors.push('At least one collector must be configured');
    }
    const enabledCollectors = config.collectors.filter(c => c.enabled);
    if (enabledCollectors.length === 0) {
        errors.push('At least one collector must be enabled');
    }
    return errors;
}
//# sourceMappingURL=target-config.js.map