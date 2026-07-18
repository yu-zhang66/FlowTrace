/**
 * FlowTrace Collector Loader
 *
 * 负责动态加载目标项目的采集器插件
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
/**
 * 动态加载采集器
 */
export class CollectorLoader {
    loadedModules = new Map();
    /**
     * 从配置加载采集器
     */
    async loadFromConfig(config, context, options) {
        const result = {
            collectors: [],
            errors: [],
            warnings: []
        };
        if (!config.collectors || config.collectors.length === 0) {
            result.warnings.push('No collectors configured, using defaults');
            return result;
        }
        // 按优先级排序
        const sortedCollectors = [...config.collectors].sort((a, b) => {
            const priorityA = a.priority ?? 100;
            const priorityB = b.priority ?? 100;
            return options.priority === 'desc' ? priorityB - priorityA : priorityA - priorityB;
        });
        for (const collectorConfig of sortedCollectors) {
            if (!collectorConfig.enabled) {
                continue;
            }
            try {
                const collector = await this.loadCollector(collectorConfig, options.collectorsDir);
                if (collector) {
                    await collector.initialize(context);
                    result.collectors.push(collector);
                }
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                result.errors.push({
                    name: collectorConfig.name,
                    error: errorMsg
                });
            }
        }
        return result;
    }
    /**
     * 加载单个采集器
     */
    async loadCollector(config, baseDir) {
        // 尝试多种路径格式
        const possiblePaths = [
            join(baseDir, config.name + '.js'),
            join(baseDir, config.name + '.mjs'),
            join(baseDir, config.name, 'index.js'),
            join(baseDir, config.name, 'index.mjs'),
            config.name // 绝对路径或包名
        ];
        for (const collectorPath of possiblePaths) {
            try {
                if (!existsSync(collectorPath)) {
                    continue;
                }
                const module = await import(collectorPath);
                // 尝试多种导出格式
                const factory = module.default || module.createCollector || module;
                if (typeof factory === 'function') {
                    const collector = factory(config);
                    if (this.isCollector(collector)) {
                        return collector;
                    }
                }
                // 直接导出 Collector 实例
                if (this.isCollector(factory)) {
                    return factory;
                }
            }
            catch (error) {
                // 继续尝试其他路径
                continue;
            }
        }
        // 尝试作为 npm 包加载
        try {
            const module = await import(config.name);
            const factory = module.default || module.createCollector || module;
            if (typeof factory === 'function') {
                const collector = factory(config);
                if (this.isCollector(collector)) {
                    return collector;
                }
            }
        }
        catch {
            // npm 包加载失败
        }
        return null;
    }
    /**
     * 检查是否是有效的 Collector
     */
    isCollector(obj) {
        return (obj &&
            typeof obj.name === 'string' &&
            typeof obj.type === 'string' &&
            typeof obj.initialize === 'function' &&
            typeof obj.collect === 'function' &&
            typeof obj.cleanup === 'function');
    }
    /**
     * 卸载所有采集器
     */
    async unloadAll() {
        for (const [name, module] of this.loadedModules) {
            try {
                if (module && typeof module.cleanup === 'function') {
                    await module.cleanup();
                }
            }
            catch (error) {
                console.warn(`Failed to cleanup collector: ${name}`);
            }
        }
        this.loadedModules.clear();
    }
}
/**
 * 创建默认采集器加载器
 */
export function createCollectorLoader(collectorsDir) {
    return new CollectorLoader();
}
/**
 * 从 YAML/JSON 配置加载采集器配置
 */
export function loadCollectorConfigs(configPath) {
    if (!existsSync(configPath)) {
        return [];
    }
    const content = readFileSync(configPath, 'utf-8');
    try {
        // 尝试 JSON
        const json = JSON.parse(content);
        return json.collectors || [];
    }
    catch {
        // 尝试 YAML
        try {
            const yaml = require('js-yaml');
            const parsed = yaml.load(content);
            return parsed?.collectors || [];
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=collector-loader.js.map