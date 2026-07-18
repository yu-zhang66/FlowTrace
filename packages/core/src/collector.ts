/**
 * FlowTrace Collector Framework
 * 
 * This module defines the interfaces and base types for collecting
 * legacy process facts from various sources.
 */

import type { Fact, ReviewStatus } from './models/fact.js';

/**
 * 采集来源类型
 */
export type CollectorType = 
  | 'source-scanner'    // 源码扫描
  | 'config-scanner'    // 配置扫描
  | 'database'          // 数据库采集
  | 'process-instance'  // 流程实例采集
  | 'api-scanner'      // API 扫描
  | 'manual'            // 人工录入
  | 'demo';             // Demo/示例数据

/**
 * 采集器配置
 */
export interface CollectorConfig {
  /** 采集器名称 */
  name: string;
  /** 采集器类型 */
  type: CollectorType;
  /** 是否启用 */
  enabled: boolean;
  /** 采集来源路径 (源码目录、数据库配置等) */
  sourcePaths?: string[];
  /** 采集器特定配置 */
  options?: Record<string, any>;
  /** 采集优先级 (数字越小优先级越高) */
  priority?: number;
}

/**
 * 采集上下文
 */
export interface CollectorContext {
  projectId?: string;
  /** 项目根目录 */
  projectRoot: string;
  /** .flowtrace 配置目录 */
  flowtraceRoot: string;
  /** 流程 ID */
  processId: string;
  /** 采集来源根目录 */
  sourceRoot: string;
  /** 是否扫描源码 */
  scanSource: boolean;
  /** 是否采集数据库 */
  scanDatabase: boolean;
  /** 采集器配置列表 */
  collectors?: CollectorConfig[];
}

/**
 * 单个采集结果
 */
export interface CollectedFact {
  /** 事实 ID */
  id: string;
  /** 事实类型 */
  type: string;
  /** 事实类别 */
  category: string;
  /** 事实名称 */
  name: string;
  /** 事实描述 */
  description: string;
  /** 事实内容 */
  content: Record<string, any>;
  /** 证据列表 */
  evidence: CollectorEvidence[];
  /** 审核状态 */
  reviewStatus: ReviewStatus;
  /** 采集来源类型 */
  collectorType: CollectorType;
  /** 采集器名称 */
  collectorName: string;
  /** 置信度 */
  confidence: number;
  /** 采集时间 */
  collectedAt: string;
}

/**
 * 证据
 */
export interface CollectorEvidence {
  /** 来源 (文件路径、数据库表名等) */
  source: string;
  /** 行号 (可选) */
  line?: number;
  /** 置信度 */
  confidence: number;
  /** 提取时间 */
  extractedAt: string;
  /** 额外元数据 */
  metadata?: Record<string, any>;
}

/**
 * 采集结果汇总
 */
export interface CollectionResult {
  /** 收集到的事实 */
  facts: CollectedFact[];
  /** 警告信息 */
  warnings: string[];
  /** 错误信息 */
  errors: string[];
  /** 采集模式 */
  collectionMode: 'full' | 'demo' | 'partial';
  /** 各采集器的统计 */
  stats: CollectorStats;
  /** 采集耗时 (毫秒) */
  durationMs: number;
}

/**
 * 采集器统计
 */
export interface CollectorStats {
  /** 各采集器收集的事实数量 */
  byCollector: Record<string, number>;
  /** 各类型收集的事实数量 */
  byType: Record<string, number>;
  /** 各类别收集的事实数量 */
  byCategory: Record<string, number>;
  /** 总事实数 */
  totalFacts: number;
  /** 自动提取数量 */
  autoExtracted: number;
  /** 待确认数量 */
  pendingConfirm: number;
  /** 已确认数量 */
  confirmed: number;
}

/**
 * 采集器接口
 */
export interface Collector {
  /** 采集器名称 */
  readonly name: string;
  /** 采集器类型 */
  readonly type: CollectorType;
  /** 采集器配置 */
  config: CollectorConfig;
  
  /** 
   * 初始化采集器
   * @param context 采集上下文
   */
  initialize(context: CollectorContext): Promise<void>;
  
  /** 
   * 执行采集
   * @param context 采集上下文
   * @returns 采集到的事实列表
   */
  collect(context: CollectorContext): Promise<CollectedFact[]>;
  
  /** 
   * 检查采集器是否可用
   * @param context 采集上下文
   */
  checkAvailability(context: CollectorContext): Promise<{ available: boolean; reason?: string }>;
  
  /** 
   * 清理资源
   */
  cleanup(): Promise<void>;
}

/**
 * 采集器工厂
 */
export interface CollectorFactory {
  /** 创建采集器实例 */
  create(config: CollectorConfig): Collector;
  /** 获取支持的采集器类型 */
  getSupportedTypes(): CollectorType[];
}

/**
 * 采集结果渲染器接口
 */
export interface CollectionRenderer {
  /** 渲染为 JSON */
  renderJson(result: CollectionResult): string;
  /** 渲染为 Markdown */
  renderMarkdown(result: CollectionResult): string;
  /** 渲染为 Human-readable 报告 */
  renderReport(result: CollectionResult): string;
}

/**
 * 默认实现：生成唯一 ID
 */
export function generateCollectorId(prefix: string = 'fact'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * 默认实现：创建空的 CollectionResult
 */
export function createEmptyCollectionResult(collectionMode: 'full' | 'demo' | 'partial' = 'demo'): CollectionResult {
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
export function mergeCollectionResults(results: CollectionResult[]): CollectionResult {
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
