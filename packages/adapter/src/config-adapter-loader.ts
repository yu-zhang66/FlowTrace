/**
 * Config-based Adapter Loader
 *
 * Loads `legacy` and `current` project-local adapter modules for the
 * migration-only `runtime.adapter: legacy` mode. New projects SHOULD use
 * `runtime.adapter: builtin` and the config-driven DSL instead.
 *
 * IMPORTANT: this loader intentionally does NOT silently fall back to any
 * demo / repository example adapter when the configured adapter module is
 * missing, empty, or fails to import. It surfaces an actionable error and
 * the loader honours `allowDemo: false` (the default) for every call path.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import type { FlowAdapter, FlowAdapterContext } from './interfaces.js';
import type { Scenario, ExecutionResult, ExternalCall } from '@flowtrace/core';

export interface TargetAdapterConfig {
  legacy: string;
  current: string;
}

export interface LoadedAdapters {
  legacy: FlowAdapter | null;
  current: FlowAdapter | null;
  errors: string[];
  usingDemo: boolean;
  usingLegacyShadow: boolean;
}

export interface AdapterLoaderOptions {
  /** When true (default false), refuse to fall back to any demo adapter and return an error instead. */
  allowDemo?: boolean;
  /** Use legacy-shadow mode: reuse the legacy adapter for the current side. */
  legacyShadow?: boolean;
}

/**
 * 适配器加载器
 */
export class ConfigAdapterLoader {
  private allowDemo: boolean = false;

  /**
   * 从目标项目配置加载适配器
   */
  async loadFromConfig(
    config: TargetAdapterConfig,
    context: FlowAdapterContext,
    projectRoot: string,
    flowtraceRoot: string,
    options: AdapterLoaderOptions = {}
  ): Promise<LoadedAdapters> {
    this.allowDemo = options.allowDemo ?? false;

    const result: LoadedAdapters = {
      legacy: null,
      current: null,
      errors: [],
      usingDemo: false,
      usingLegacyShadow: false
    };

    // 加载 legacy 适配器
    const legacyResult = await this.loadSingleAdapter(
      config.legacy,
      context,
      projectRoot,
      flowtraceRoot,
      'legacy'
    );
    result.legacy = legacyResult.adapter;
    if (legacyResult.error) result.errors.push(legacyResult.error);
    if (legacyResult.usedDemo) result.usingDemo = true;

    // 加载 current 适配器
    if (options.legacyShadow) {
      result.current = result.legacy;
      result.usingLegacyShadow = true;
      console.log('[ConfigAdapterLoader] Using legacy-shadow mode: current reuses legacy');
    } else {
      const currentResult = await this.loadSingleAdapter(
        config.current,
        context,
        projectRoot,
        flowtraceRoot,
        'current'
      );
      result.current = currentResult.adapter;
      if (currentResult.error) result.errors.push(currentResult.error);
      if (currentResult.usedDemo) result.usingDemo = true;
    }

    return result;
  }

  /**
   * 加载单个适配器
   */
  private async loadSingleAdapter(
    adapterPath: string,
    context: FlowAdapterContext,
    projectRoot: string,
    flowtraceRoot: string,
    type: 'legacy' | 'current'
  ): Promise<{ adapter: FlowAdapter | null; error?: string; usedDemo: boolean }> {
    if (!adapterPath) {
      return {
        adapter: null,
        error: `${type} adapter path is empty. flowtrace runtime.adapter: legacy requires project-local adapter source files; new projects should migrate to runtime.adapter: builtin with declarative systems/processes YAML.`,
        usedDemo: false,
      };
    }

    const fullPath = this.resolveAdapterPath(adapterPath, projectRoot, flowtraceRoot);

    if (!existsSync(fullPath)) {
      return {
        adapter: null,
        error: `${type} adapter not found at ${fullPath}. flowtrace runtime.adapter: legacy requires project-local adapter source files; new projects should migrate to runtime.adapter: builtin.`,
        usedDemo: false,
      };
    }

    try {
      const adapter = await this.importAdapter(fullPath, context, type);
      await adapter.initialize();
      return { adapter, usedDemo: false };
    } catch (error) {
      return {
        adapter: null,
        error: `Failed to load ${type} adapter from ${fullPath}: ${error instanceof Error ? error.message : String(error)}`,
        usedDemo: false,
      };
    }
  }

  /**
   * 导入适配器模块
   */
  private async importAdapter(
    adapterPath: string,
    context: FlowAdapterContext,
    type: 'legacy' | 'current'
  ): Promise<FlowAdapter> {
    const module = await import(adapterPath);

    // Try various export patterns
    const factory = 
      module.createLegacyAdapter ||
      module.createCurrentAdapter ||
      module.createAdapter ||
      module.default?.createLegacyAdapter ||
      module.default?.createCurrentAdapter ||
      module.default?.createAdapter ||
      module.default;

    if (typeof factory === 'function') {
      const adapter = factory(context);
      if (adapter && typeof adapter === 'object' && 'executeAction' in adapter) {
        return adapter;
      }
    }

    if (typeof factory === 'object' && factory !== null && 'executeAction' in factory) {
      return factory;
    }

    throw new Error(`Invalid adapter at ${adapterPath}: no factory or FlowAdapter instance found`);
  }

  /**
   * Resolve an adapter module path against the project / flowtrace roots.
   */
  private resolveAdapterPath(
    relativePath: string,
    projectRoot: string,
    flowtraceRoot: string
  ): string {
    if (relativePath.startsWith('/')) {
      return relativePath;
    }
    if (relativePath.startsWith('.')) {
      return resolve(projectRoot, relativePath);
    }
    return resolve(flowtraceRoot, relativePath);
  }

  /**
   * 清理适配器
   */
  async cleanup(adapters: LoadedAdapters): Promise<void> {
    const toCleanup = new Set<FlowAdapter>();

    if (adapters.legacy) toCleanup.add(adapters.legacy);
    if (adapters.current && adapters.current !== adapters.legacy) {
      toCleanup.add(adapters.current);
    }

    for (const adapter of toCleanup) {
      try {
        await adapter.cleanup();
      } catch (error) {
        console.error(`[ConfigAdapterLoader] Failed to cleanup adapter:`, error);
      }
    }
  }
}

/**
 * Create a config adapter loader.
 */
export function createConfigAdapterLoader(): ConfigAdapterLoader {
  return new ConfigAdapterLoader();
}
