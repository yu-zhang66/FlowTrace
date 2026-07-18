/**
 * FlowTrace Collector Framework
 *
 * This module defines the interfaces and base types for collecting
 * legacy process facts from various sources.
 */
/**
 * 默认实现：生成唯一 ID
 */
export function generateCollectorId(prefix = 'fact') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}-${timestamp}-${random}`;
}
/**
 * 默认实现：创建空的 CollectionResult
 */
export function createEmptyCollectionResult(collectionMode = 'demo') {
    return {
        facts: [],
        warnings: [],
        errors: [],
        collectionMode,
        stats: {
            byCollector: {},
            byType: {},
            byCategory: {},
            totalFacts: 0,
            autoExtracted: 0,
            pendingConfirm: 0,
            confirmed: 0
        },
        durationMs: 0
    };
}
/**
 * 合并多个采集结果
 */
export function mergeCollectionResults(results) {
    const merged = createEmptyCollectionResult('partial');
    const startTime = Date.now();
    for (const result of results) {
        merged.facts.push(...result.facts);
        merged.warnings.push(...result.warnings);
        merged.errors.push(...result.errors);
        for (const [collector, count] of Object.entries(result.stats.byCollector)) {
            merged.stats.byCollector[collector] = (merged.stats.byCollector[collector] || 0) + count;
        }
        for (const [type, count] of Object.entries(result.stats.byType)) {
            merged.stats.byType[type] = (merged.stats.byType[type] || 0) + count;
        }
        for (const [category, count] of Object.entries(result.stats.byCategory)) {
            merged.stats.byCategory[category] = (merged.stats.byCategory[category] || 0) + count;
        }
        merged.stats.autoExtracted += result.stats.autoExtracted;
        merged.stats.pendingConfirm += result.stats.pendingConfirm;
        merged.stats.confirmed += result.stats.confirmed;
    }
    merged.stats.totalFacts = merged.facts.length;
    merged.durationMs = Date.now() - startTime;
    merged.collectionMode = merged.errors.length > 0 ? 'partial' :
        (merged.facts.length > 0 ? 'full' : 'demo');
    return merged;
}
//# sourceMappingURL=collector.js.map