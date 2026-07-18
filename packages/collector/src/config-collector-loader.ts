import { existsSync, readFileSync } from 'fs';
import type { Collector, CollectorContext } from '@flowtrace/core';
import { createDemoCollector, createSourceCollector, createSourceCollectorConfig } from './index.js';

export interface TargetCollectorConfig {
  name: string;
  type: string;
  enabled: boolean;
  priority?: number;
  options?: Record<string, any>;
  path?: string;
}

/**
 * 内置采集器工厂
 */
const BUILT_IN_COLLECTORS: Record<string, (config: TargetCollectorConfig, context: CollectorContext) => Collector> = {
  'demo': (config, context) => {
    return createDemoCollector(context.processId);
  },
  'source-scanner': (config, context) => {
    const options = (config.options || {}) as any;
    return createSourceCollector(
      createSourceCollectorConfig(config.name || 'source-collector', {
        sourceRoot: options.sourceRoot || context.sourceRoot,
        extensions: options.extensions || ['.java', '.xml', '.yaml', '.yml', '.json', '.properties'],
        excludeDirs: options.excludeDirs || ['target', 'node_modules', '.git', 'test', 'tests', 'build', 'dist']
      })
    );
  },
  'source': (config, context) => {
    const options = (config.options || {}) as any;
    return createSourceCollector(
      createSourceCollectorConfig(config.name || 'source-collector', {
        sourceRoot: options.sourceRoot || context.sourceRoot,
        extensions: options.extensions || ['.java', '.xml', '.yaml', '.yml', '.json', '.properties']
      })
    );
  }
};

/**
 * 从目标项目配置加载采集器
 */
export class ConfigCollectorLoader {
  /**
   * 加载采集器列表
   */
  async loadFromConfig(
    configs: TargetCollectorConfig[],
    context: CollectorContext,
    projectRoot: string,
    flowtraceRoot: string
  ): Promise<Collector[]> {
    console.log(`[ConfigCollectorLoader] loadFromConfig called with ${configs.length} configs`);
    const collectors: Collector[] = [];

    const sortedConfigs = [...configs].sort((a, b) => {
      const priorityA = a.priority ?? 100;
      const priorityB = b.priority ?? 100;
      return priorityA - priorityB;
    });

    for (const collectorConfig of sortedConfigs) {
      if (!collectorConfig.enabled) {
        console.log(`[ConfigCollectorLoader] Skipping disabled collector: ${collectorConfig.name}`);
        continue;
      }

      try {
        const collector = this.loadCollector(collectorConfig, context, projectRoot, flowtraceRoot);
        if (collector) {
          await collector.initialize(context);
          collectors.push(collector);
          console.log(`[ConfigCollectorLoader] Loaded collector: ${collector.name}`);
        }
      } catch (error) {
        console.error(`[ConfigCollectorLoader] Failed to load collector ${collectorConfig.name}:`, error);
      }
    }

    return collectors;
  }

  /**
   * 加载单个采集器
   */
  private loadCollector(
    config: TargetCollectorConfig,
    context: CollectorContext,
    projectRoot: string,
    flowtraceRoot: string
  ): Collector | null {
    console.log(`[ConfigCollectorLoader] Attempting to load collector: ${config.name} (type: ${config.type})`);

    // 1. 尝试内置采集器
    if (BUILT_IN_COLLECTORS[config.type]) {
      console.log(`[ConfigCollectorLoader] Found built-in collector for type: ${config.type}`);
      return BUILT_IN_COLLECTORS[config.type](config, context);
    }

    console.log(`[ConfigCollectorLoader] No built-in collector for type: ${config.type}, trying path loading...`);

    // 2. 尝试从项目路径加载
    if (config.path) {
      const collectorPath = this.resolvePath(config.path, projectRoot, flowtraceRoot);
      if (existsSync(collectorPath)) {
        try {
          const module = require(collectorPath);
          const factory = module.default || module.createCollector || module;
          if (typeof factory === 'function') {
            return factory(config);
          }
          if (typeof factory === 'object' && factory !== null && 'collect' in factory) {
            return factory as Collector;
          }
        } catch (error) {
          console.error(`[ConfigCollectorLoader] Failed to load from path ${collectorPath}:`, error);
        }
      }
    }

    // 3. 尝试从 collectors 目录加载
    const collectorsDir = require('path').join(flowtraceRoot, 'collectors');
    const collectorPath = require('path').join(collectorsDir, `${config.name}.mjs`);
    if (existsSync(collectorPath)) {
      try {
        const module = require(collectorPath);
        const factory = module.default || module.createCollector || module;
        if (typeof factory === 'function') {
          return factory(config);
        }
        if (typeof factory === 'object' && factory !== null && 'collect' in factory) {
          return factory as Collector;
        }
      } catch (error) {
        console.error(`[ConfigCollectorLoader] Failed to load from ${collectorPath}:`, error);
      }
    }

    console.warn(`[ConfigCollectorLoader] Could not load collector: ${config.name} (${config.type})`);
    return null;
  }

  /**
   * 解析路径
   */
  private resolvePath(relativePath: string, projectRoot: string, flowtraceRoot: string): string {
    const path = require('path');
    if (relativePath.startsWith('/')) {
      return relativePath;
    }
    if (relativePath.startsWith('.')) {
      return path.resolve(projectRoot, relativePath);
    }
    return path.resolve(flowtraceRoot, relativePath);
  }

  /**
   * 清理采集器
   */
  async cleanup(collectors: Collector[]): Promise<void> {
    for (const collector of collectors) {
      try {
        await collector.cleanup();
      } catch (error) {
        console.error(`[ConfigCollectorLoader] Failed to cleanup ${collector.name}:`, error);
      }
    }
  }
}

/**
 * 创建配置采集器加载器
 */
export function createConfigCollectorLoader(): ConfigCollectorLoader {
  return new ConfigCollectorLoader();
}

/**
 * 执行采集
 */
export async function executeCollection(
  collectors: Collector[],
  context: CollectorContext
): Promise<{
  facts: import('@flowtrace/core').CollectedFact[];
  errors: string[];
  warnings: string[];
  stats: Record<string, number>;
}> {
  const facts: import('@flowtrace/core').CollectedFact[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats: Record<string, number> = {};

  for (const collector of collectors) {
    try {
      console.log(`[ConfigCollectorLoader] Collecting with ${collector.name}...`);
      const collectedFacts = await collector.collect(context);
      facts.push(...collectedFacts);
      stats[collector.name] = collectedFacts.length;
      console.log(`[ConfigCollectorLoader] Collected ${collectedFacts.length} facts from ${collector.name}`);
    } catch (error) {
      const errorMsg = `${collector.name}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      console.error(`[ConfigCollectorLoader] Collection error:`, errorMsg);
    }
  }

  return { facts, errors, warnings, stats };
}
