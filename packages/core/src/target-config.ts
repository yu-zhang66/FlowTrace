/**
 * Target Project Configuration Loader
 * 
 * 负责从目标项目的 .flowtrace/ 目录加载配置
 * 并解析 collectors、adapters、database、semantic 等配置
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import yaml from 'js-yaml';

/**
 * 目标项目配置
 */
export interface TargetProjectConfig {
  /** 项目根目录 */
  projectRoot: string;
  /** FlowTrace 配置目录 */
  flowtraceRoot: string;
  /** 配置文件路径 */
  configPath: string;
  /** 项目基本信息 */
  project: {
    id: string;
    name: string;
    sourceRoot: string;
  };
  /** 流程 ID */
  processId: string;
  /** 采集器配置 */
  collectors: CollectorConfig[];
  /** 适配器配置 */
  adapters: AdapterConfig;
  /** 数据库配置 */
  database: DatabaseConfig;
  /** 语义配置 */
  semantic: SemanticConfig;
  /** 路径配置 */
  paths: PathsConfig;
  /** 执行配置 */
  execution: ExecutionConfig;
  /** 试点配置 */
  pilot?: PilotConfig;
}

/**
 * 采集器配置
 */
export interface CollectorConfig {
  name: string;
  type: string;
  enabled: boolean;
  priority?: number;
  options?: Record<string, any>;
  path?: string;
}

/**
 * 适配器配置
 */
export interface AdapterConfig {
  legacy: string;
  current: string;
}

/**
 * 数据库配置
 */
export interface DatabaseConfig {
  type: 'oracle' | 'mysql' | 'postgresql' | 'sqlserver';
  configSource: string;
  access: 'read-only-collection' | 'read-only-test' | 'snapshot-only';
  connection?: {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
  };
}

/**
 * 语义配置
 */
export interface SemanticConfig {
  keywordsDir: string;
  mappingsDir: string;
}

/**
 * 路径配置
 */
export interface PathsConfig {
  facts: string;
  scenarios: string;
  reports: string;
  mappings: string;
  semantic: string;
  fixtures: string;
  executions: string;
  mocks: string;
}

/**
 * 执行配置
 */
export interface ExecutionConfig {
  mode: 'dual-run' | 'legacy-only' | 'current-only';
  allowOnlineWrite: boolean;
  databaseMode: 'snapshot-only' | 'readonly' | 'live';
  testDataMode: 'masked-or-snapshot' | 'snapshot' | 'live';
  failOn: string[];
}

/**
 * 试点配置
 */
export interface PilotConfig {
  process?: string;
  currentAdapterMode?: 'legacy-shadow' | 'current';
  note?: string;
}

/**
 * 加载目标项目配置
 */
export function loadTargetProjectConfig(projectPath: string): TargetProjectConfig {
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
  const flowtraceRoot = basename(dirname(configPath)) === '.flowtrace'
    ? resolve(projectRoot, '.flowtrace')
    : projectRoot;

  const content = readFileSync(configPath, 'utf-8');
  const raw = yaml.load(content) as any;

  // 解析路径
  const paths: PathsConfig = {
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
  const collectors: CollectorConfig[] = [];
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
    collectors.push(
      { name: 'source-collector', type: 'source-scanner', enabled: true, priority: 10 },
      { name: 'demo-collector', type: 'demo', enabled: true, priority: 100 }
    );
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
export function resolveTargetPath(config: TargetProjectConfig, relativePath: string): string {
  if (relativePath.startsWith('/')) {
    return relativePath;
  }
  return resolve(config.flowtraceRoot, relativePath);
}

/**
 * 获取 facts 目录
 */
export function getFactsDir(config: TargetProjectConfig): string {
  return resolveTargetPath(config, config.paths.facts);
}

/**
 * 获取 scenarios 目录
 */
export function getScenariosDir(config: TargetProjectConfig): string {
  return resolveTargetPath(config, config.paths.scenarios);
}

/**
 * 获取 semantic 目录
 */
export function getSemanticDir(config: TargetProjectConfig): string {
  return resolveTargetPath(config, config.paths.semantic);
}

/**
 * 获取 reports 目录
 */
export function getReportsDir(config: TargetProjectConfig): string {
  return resolveTargetPath(config, config.paths.reports);
}

/**
 * 获取 executions 目录
 */
export function getExecutionsDir(config: TargetProjectConfig): string {
  return resolveTargetPath(config, config.paths.executions);
}

/**
 * 获取源文件根目录
 */
export function getSourceRoot(config: TargetProjectConfig): string {
  if (config.project.sourceRoot.startsWith('/')) {
    return config.project.sourceRoot;
  }
  return resolve(config.projectRoot, config.project.sourceRoot);
}

/**
 * 从项目路径提取 ID
 */
function extractProjectId(projectPath: string): string {
  const parts = projectPath.split(/[/\\]/);
  const name = parts[parts.length - 1] || 'unknown';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * 从项目路径提取名称
 */
function extractProjectName(projectPath: string): string {
  const parts = projectPath.split(/[/\\]/);
  return parts[parts.length - 1] || 'Unknown Project';
}

/**
 * 验证配置完整性
 */
export function validateTargetConfig(config: TargetProjectConfig): string[] {
  const errors: string[] = [];

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
