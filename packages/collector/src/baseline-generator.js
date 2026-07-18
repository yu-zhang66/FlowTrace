/**
 * Baseline Generator
 *
 * 生成所有必需的基线文件：
 * - source-baseline: 源码采集的事实
 * - runtime-baseline: 运行时采集的事实（实际流程实例）
 * - database-baseline: 数据库采集的事实
 * - api-baseline: API 采集的事实
 * - collection-summary: 采集汇总
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
/**
 * 生成所有基线文件
 */
export class BaselineGenerator {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * 生成所有基线文件
     */
    generate(options) {
        const outputDir = this.config.outputDir;
        if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
        }
        // 生成源码基线
        this.generateSourceBaseline(options.sourceFacts || []);
        // 生成运行时基线
        this.generateRuntimeBaseline(options.runtimeFacts || [], options.collectionStatus?.runtimeConnected ?? false);
        // 生成数据库基线
        this.generateDatabaseBaseline(options.databaseFacts || [], options.collectionStatus?.databaseConnected ?? false);
        // 生成 API 基线
        this.generateApiBaseline(options.apiFacts || [], options.collectionStatus?.apiConnected ?? false);
        // 生成采集汇总
        this.generateCollectionSummary(options.collectionStatus, options.currentAdapterMode);
    }
    /**
     * 生成源码基线
     */
    generateSourceBaseline(facts) {
        const data = {
            version: '1.0',
            type: 'source-baseline',
            metadata: {
                projectId: this.config.projectId,
                projectName: this.config.projectName,
                processId: this.config.processId,
                collectedAt: new Date().toISOString(),
                collectorType: 'source-scanner',
                confidence: 'high',
                note: '源码采集的事实，可信度高，但不代表实际运行行为'
            },
            summary: {
                totalFacts: facts.length,
                byCategory: this.countByCategory(facts)
            },
            facts
        };
        const jsonPath = join(this.config.outputDir, 'source-baseline.json');
        writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
        const md = this.renderSourceBaselineMarkdown(data);
        const mdPath = join(this.config.outputDir, 'source-baseline.md');
        writeFileSync(mdPath, md, 'utf-8');
        console.log(`Generated: ${jsonPath}`);
        console.log(`Generated: ${mdPath}`);
    }
    /**
     * 生成运行时基线
     */
    generateRuntimeBaseline(facts, connected) {
        const data = {
            version: '1.0',
            type: 'runtime-baseline',
            metadata: {
                projectId: this.config.projectId,
                projectName: this.config.projectName,
                processId: this.config.processId,
                collectedAt: new Date().toISOString(),
                collectorType: 'process-instance',
                connected,
                confidence: connected ? 'high' : 'unavailable',
                note: connected
                    ? '运行时采集的事实，代表真实流程执行行为'
                    : '数据库未连接，未采集真实运行时数据，当前仅使用源码'
            },
            summary: {
                totalFacts: connected ? facts.length : 0,
                totalProcessInstances: connected ? this.countProcessInstances(facts) : 0,
                totalEvents: connected ? this.countEvents(facts) : 0,
                byStatus: connected ? this.countByStatus(facts) : {}
            },
            facts: connected ? facts : [],
            unconnectedMessage: connected ? null : {
                status: '未连接',
                reason: '数据库连接未配置或连接失败',
                required: [
                    '配置旧系统数据库连接',
                    '确保流程实例表可读',
                    '配置流程定义ID'
                ],
                currentStatus: '当前仅使用源码，不能作为真实业务基线'
            }
        };
        const jsonPath = join(this.config.outputDir, 'runtime-baseline.json');
        writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
        const md = this.renderRuntimeBaselineMarkdown(data);
        const mdPath = join(this.config.outputDir, 'runtime-baseline.md');
        writeFileSync(mdPath, md, 'utf-8');
        console.log(`Generated: ${jsonPath}`);
        console.log(`Generated: ${mdPath}`);
    }
    /**
     * 生成数据库基线
     */
    generateDatabaseBaseline(facts, connected) {
        const data = {
            version: '1.0',
            type: 'database-baseline',
            metadata: {
                projectId: this.config.projectId,
                projectName: this.config.projectName,
                processId: this.config.processId,
                collectedAt: new Date().toISOString(),
                collectorType: 'database',
                connected,
                confidence: connected ? 'high' : 'unavailable',
                note: connected
                    ? '数据库采集的事实，包括表结构和样本数据'
                    : '数据库未连接，未采集真实数据库数据'
            },
            summary: {
                totalFacts: connected ? facts.length : 0,
                tables: connected ? this.extractTableNames(facts) : [],
                maskedFields: ['password', 'account', 'phone', 'email', 'bankAccount']
            },
            facts: connected ? facts : [],
            unconnectedMessage: connected ? null : {
                status: '未连接',
                reason: '数据库连接未配置或连接失败',
                required: [
                    '配置数据库连接信息',
                    '确保只读权限',
                    '配置需要采集的表名'
                ],
                currentStatus: '当前仅使用源码，不能作为真实数据库基线'
            }
        };
        const jsonPath = join(this.config.outputDir, 'database-baseline.json');
        writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
        const md = this.renderDatabaseBaselineMarkdown(data);
        const mdPath = join(this.config.outputDir, 'database-baseline.md');
        writeFileSync(mdPath, md, 'utf-8');
        console.log(`Generated: ${jsonPath}`);
        console.log(`Generated: ${mdPath}`);
    }
    /**
     * 生成 API 基线
     */
    generateApiBaseline(facts, connected) {
        const data = {
            version: '1.0',
            type: 'api-baseline',
            metadata: {
                projectId: this.config.projectId,
                projectName: this.config.projectName,
                processId: this.config.processId,
                collectedAt: new Date().toISOString(),
                collectorType: 'api-scanner',
                connected,
                confidence: connected ? 'high' : 'unavailable',
                note: connected
                    ? 'API 采集的事实，包括接口定义和调用记录'
                    : 'API 端点未连接，未采集真实 API 调用记录'
            },
            summary: {
                totalFacts: connected ? facts.length : 0,
                endpoints: connected ? this.extractEndpoints(facts) : [],
                methods: connected ? this.countMethods(facts) : {}
            },
            facts: connected ? facts : [],
            unconnectedMessage: connected ? null : {
                status: '未连接',
                reason: 'API 端点未配置或不可访问',
                required: [
                    '配置 API 基础 URL',
                    '配置认证信息',
                    '确保 API 可访问'
                ],
                currentStatus: '当前仅使用源码，不能作为真实 API 基线'
            }
        };
        const jsonPath = join(this.config.outputDir, 'api-baseline.json');
        writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
        const md = this.renderApiBaselineMarkdown(data);
        const mdPath = join(this.config.outputDir, 'api-baseline.md');
        writeFileSync(mdPath, md, 'utf-8');
        console.log(`Generated: ${jsonPath}`);
        console.log(`Generated: ${mdPath}`);
    }
    /**
     * 生成采集汇总
     */
    generateCollectionSummary(status, currentAdapterMode) {
        const mode = currentAdapterMode || 'legacy-shadow';
        const runtimeConnected = status?.runtimeConnected ?? false;
        const databaseConnected = status?.databaseConnected ?? false;
        const apiConnected = status?.apiConnected ?? false;
        const blockers = [];
        if (!runtimeConnected)
            blockers.push('运行时数据未采集 - 需要配置数据库连接');
        if (!databaseConnected)
            blockers.push('数据库数据未采集 - 需要配置数据库连接');
        if (!apiConnected)
            blockers.push('API 调用记录未采集 - 需要配置 API 端点');
        if (mode === 'legacy-shadow')
            blockers.push('Current Adapter 仍为 legacy-shadow - 不能作为真实业务测试');
        const summary = {
            timestamp: new Date().toISOString(),
            projectId: this.config.projectId,
            projectName: this.config.projectName,
            processId: this.config.processId,
            collectors: [
                {
                    name: 'source-collector',
                    type: 'source-scanner',
                    enabled: true,
                    connected: true,
                    factCount: 0,
                    message: '源码采集已完成'
                },
                {
                    name: 'runtime-collector',
                    type: 'process-instance',
                    enabled: true,
                    connected: runtimeConnected,
                    factCount: runtimeConnected ? 0 : 0,
                    message: runtimeConnected ? '运行时采集已完成' : '数据库未连接'
                },
                {
                    name: 'database-collector',
                    type: 'database',
                    enabled: true,
                    connected: databaseConnected,
                    factCount: databaseConnected ? 0 : 0,
                    message: databaseConnected ? '数据库采集已完成' : '数据库未连接'
                },
                {
                    name: 'api-collector',
                    type: 'api-scanner',
                    enabled: true,
                    connected: apiConnected,
                    factCount: apiConnected ? 0 : 0,
                    message: apiConnected ? 'API 采集已完成' : 'API 端点未连接'
                }
            ],
            baselines: {
                source: { exists: true, path: 'facts/source-baseline.json' },
                runtime: { exists: runtimeConnected, path: 'facts/runtime-baseline.json', connected: runtimeConnected },
                database: { exists: databaseConnected, path: 'facts/database-baseline.json', connected: databaseConnected },
                api: { exists: apiConnected, path: 'facts/api-baseline.json', connected: apiConnected }
            },
            currentAdapterMode: mode,
            isLegacyShadow: mode === 'legacy-shadow',
            canBeTrustedAsRealBaseline: runtimeConnected && databaseConnected && apiConnected && mode !== 'legacy-shadow',
            blockers
        };
        const md = this.renderCollectionSummaryMarkdown(summary);
        const mdPath = join(this.config.outputDir, 'collection-summary.md');
        writeFileSync(mdPath, md, 'utf-8');
        console.log(`Generated: ${mdPath}`);
        return;
    }
    // ==================== Markdown 渲染 ====================
    renderSourceBaselineMarkdown(data) {
        let md = `# 源码基线\n\n`;
        md += `**项目**: ${data.metadata.projectName}\n`;
        md += `**流程**: ${data.metadata.processId}\n`;
        md += `**采集时间**: ${data.metadata.collectedAt}\n`;
        md += `**采集类型**: ${data.metadata.collectorType}\n`;
        md += `**可信度**: ${data.metadata.confidence}\n\n`;
        md += `> ${data.metadata.note}\n\n`;
        md += `## 汇总\n\n`;
        md += `| 指标 | 值 |\n`;
        md += `|------|---|\n`;
        md += `| 事实总数 | ${data.summary.totalFacts} |\n`;
        md += `\n## 事实类别统计\n\n`;
        md += `| 类别 | 数量 |\n`;
        md += `|------|------|\n`;
        for (const [cat, count] of Object.entries(data.summary.byCategory)) {
            md += `| ${cat} | ${count} |\n`;
        }
        return md;
    }
    renderRuntimeBaselineMarkdown(data) {
        let md = `# 运行时基线\n\n`;
        md += `**项目**: ${data.metadata.projectName}\n`;
        md += `**流程**: ${data.metadata.processId}\n`;
        md += `**采集时间**: ${data.metadata.collectedAt}\n`;
        md += `**采集类型**: ${data.metadata.collectorType}\n`;
        md += `**数据库连接**: ${data.metadata.connected ? '✅ 已连接' : '❌ 未连接'}\n`;
        md += `**可信度**: ${data.metadata.confidence}\n\n`;
        md += `> ${data.metadata.note}\n\n`;
        if (!data.metadata.connected && data.unconnectedMessage) {
            md += `## ⚠️ 警告\n\n`;
            md += `**状态**: ${data.unconnectedMessage.status}\n\n`;
            md += `**原因**: ${data.unconnectedMessage.reason}\n\n`;
            md += `**当前状态**: ${data.unconnectedMessage.currentStatus}\n\n`;
            md += `**需要配置**:\n`;
            for (const req of data.unconnectedMessage.required) {
                md += `- ${req}\n`;
            }
            return md;
        }
        md += `## 汇总\n\n`;
        md += `| 指标 | 值 |\n`;
        md += `|------|---|\n`;
        md += `| 流程实例数 | ${data.summary.totalProcessInstances} |\n`;
        md += `| 事件总数 | ${data.summary.totalEvents} |\n`;
        md += `\n## 流程状态分布\n\n`;
        md += `| 状态 | 数量 |\n`;
        md += `|------|------|\n`;
        for (const [status, count] of Object.entries(data.summary.byStatus)) {
            md += `| ${status} | ${count} |\n`;
        }
        md += `\n## 流程实例详情\n\n`;
        const processInstances = data.facts.filter((f) => f.type === 'process-instance');
        for (const instance of processInstances) {
            md += `### ${instance.name}\n\n`;
            md += `| 属性 | 值 |\n`;
            md += `|------|---|\n`;
            md += `| 实例ID | ${instance.content.processInstanceId} |\n`;
            md += `| 业务键 | ${instance.content.businessKey} |\n`;
            md += `| 状态 | ${instance.content.status} |\n`;
            md += `| 开始时间 | ${instance.content.startTime} |\n`;
            if (instance.content.endTime) {
                md += `| 结束时间 | ${instance.content.endTime} |\n`;
            }
            md += `| 开始人 | ${instance.content.startActor} |\n`;
            md += `\n`;
        }
        return md;
    }
    renderDatabaseBaselineMarkdown(data) {
        let md = `# 数据库基线\n\n`;
        md += `**项目**: ${data.metadata.projectName}\n`;
        md += `**流程**: ${data.metadata.processId}\n`;
        md += `**采集时间**: ${data.metadata.collectedAt}\n`;
        md += `**采集类型**: ${data.metadata.collectorType}\n`;
        md += `**数据库连接**: ${data.metadata.connected ? '✅ 已连接' : '❌ 未连接'}\n`;
        md += `**可信度**: ${data.metadata.confidence}\n\n`;
        md += `> ${data.metadata.note}\n\n`;
        if (!data.metadata.connected && data.unconnectedMessage) {
            md += `## ⚠️ 警告\n\n`;
            md += `**状态**: ${data.unconnectedMessage.status}\n\n`;
            md += `**原因**: ${data.unconnectedMessage.reason}\n\n`;
            md += `**当前状态**: ${data.unconnectedMessage.currentStatus}\n\n`;
            md += `**需要配置**:\n`;
            for (const req of data.unconnectedMessage.required) {
                md += `- ${req}\n`;
            }
            return md;
        }
        md += `## 汇总\n\n`;
        md += `| 指标 | 值 |\n`;
        md += `|------|---|\n`;
        md += `| 表数量 | ${data.summary.tables.length} |\n`;
        md += `| 脱敏字段 | ${data.summary.maskedFields.join(', ')} |\n`;
        md += `\n## 表清单\n\n`;
        md += `| 表名 | 列数 | 行数 |\n`;
        md += `|------|------|------|\n`;
        for (const fact of data.facts.filter((f) => f.type === 'database-table')) {
            md += `| ${fact.content.tableName} | ${fact.content.columns?.length || 0} | ${fact.content.rowCount || 0} |\n`;
        }
        return md;
    }
    renderApiBaselineMarkdown(data) {
        let md = `# API 基线\n\n`;
        md += `**项目**: ${data.metadata.projectName}\n`;
        md += `**流程**: ${data.metadata.processId}\n`;
        md += `**采集时间**: ${data.metadata.collectedAt}\n`;
        md += `**采集类型**: ${data.metadata.collectorType}\n`;
        md += `**API 连接**: ${data.metadata.connected ? '✅ 已连接' : '❌ 未连接'}\n`;
        md += `**可信度**: ${data.metadata.confidence}\n\n`;
        md += `> ${data.metadata.note}\n\n`;
        if (!data.metadata.connected && data.unconnectedMessage) {
            md += `## ⚠️ 警告\n\n`;
            md += `**状态**: ${data.unconnectedMessage.status}\n\n`;
            md += `**原因**: ${data.unconnectedMessage.reason}\n\n`;
            md += `**当前状态**: ${data.unconnectedMessage.currentStatus}\n\n`;
            md += `**需要配置**:\n`;
            for (const req of data.unconnectedMessage.required) {
                md += `- ${req}\n`;
            }
            return md;
        }
        md += `## 汇总\n\n`;
        md += `| 指标 | 值 |\n`;
        md += `|------|---|\n`;
        md += `| 端点总数 | ${data.summary.endpoints.length} |\n`;
        md += `\n## HTTP 方法分布\n\n`;
        md += `| 方法 | 数量 |\n`;
        md += `|------|------|\n`;
        for (const [method, count] of Object.entries(data.summary.methods)) {
            md += `| ${method} | ${count} |\n`;
        }
        return md;
    }
    renderCollectionSummaryMarkdown(summary) {
        let md = `# FlowTrace 采集汇总报告\n\n`;
        md += `**项目**: ${summary.projectName}\n`;
        md += `**项目ID**: ${summary.projectId}\n`;
        md += `**流程**: ${summary.processId}\n`;
        md += `**生成时间**: ${summary.timestamp}\n\n`;
        md += `## 执行模式\n\n`;
        md += `| 配置项 | 值 |\n`;
        md += `|--------|---|\n`;
        md += `| Current Adapter 模式 | ${summary.currentAdapterMode} |\n`;
        md += `| 是否为 legacy-shadow | ${summary.isLegacyShadow ? '是 ⚠️' : '否 ✓'} |\n`;
        md += `| 可否作为真实基线 | ${summary.canBeTrustedAsRealBaseline ? '是 ✓' : '否 ❌'} |\n\n`;
        if (summary.isLegacyShadow) {
            md += `> ⚠️ **legacy-shadow 模式说明**: 当前适配器复用旧流程适配器，结果仅验证测试框架，不能证明新旧流程等价。\n\n`;
        }
        md += `## 采集器状态\n\n`;
        md += `| 采集器 | 类型 | 启用 | 连接 | 事实数 | 状态 |\n`;
        md += `|--------|------|------|------|--------|------|\n`;
        for (const collector of summary.collectors) {
            md += `| ${collector.name} | ${collector.type} | ${collector.enabled ? '是' : '否'} | ${collector.connected ? '是 ✓' : '否 ❌'} | ${collector.factCount} | ${collector.message} |\n`;
        }
        md += `\n## 基线文件\n\n`;
        md += `| 类型 | 存在 | 路径 | 连接 |\n`;
        md += `|------|------|------|------|\n`;
        md += `| 源码基线 | ${summary.baselines.source.exists ? '是 ✓' : '否 ❌'} | ${summary.baselines.source.path} | - |\n`;
        md += `| 运行时基线 | ${summary.baselines.runtime.exists ? '是 ✓' : '否 ❌'} | ${summary.baselines.runtime.path} | ${summary.baselines.runtime.connected ? '是 ✓' : '否 ❌'} |\n`;
        md += `| 数据库基线 | ${summary.baselines.database.exists ? '是 ✓' : '否 ❌'} | ${summary.baselines.database.path} | ${summary.baselines.database.connected ? '是 ✓' : '否 ❌'} |\n`;
        md += `| API 基线 | ${summary.baselines.api.exists ? '是 ✓' : '否 ❌'} | ${summary.baselines.api.path} | ${summary.baselines.api.connected ? '是 ✓' : '否 ❌'} |\n`;
        if (summary.blockers.length > 0) {
            md += `\n## ⚠️ 阻塞项\n\n`;
            md += `以下问题必须解决才能进行真实业务测试：\n\n`;
            for (const blocker of summary.blockers) {
                md += `- ${blocker}\n`;
            }
        }
        if (summary.canBeTrustedAsRealBaseline) {
            md += `\n## ✅ 可信度评估\n\n`;
            md += `当前配置已满足真实业务测试要求，可以作为新旧流程等价性的参考依据。\n`;
        }
        else {
            md += `\n## ❌ 可信度限制\n\n`;
            md += `当前测试结果不能完全证明新旧流程等价。\n`;
            md += `需要解决上述阻塞项后才能进行真实业务测试。\n`;
        }
        return md;
    }
    // ==================== 辅助方法 ====================
    countByCategory(facts) {
        const counts = {};
        for (const fact of facts) {
            const cat = fact.category || 'unknown';
            counts[cat] = (counts[cat] || 0) + 1;
        }
        return counts;
    }
    countProcessInstances(facts) {
        return facts.filter(f => f.type === 'process-instance').length;
    }
    countEvents(facts) {
        return facts.filter(f => f.type === 'process-event').length;
    }
    countByStatus(facts) {
        const counts = {};
        for (const fact of facts.filter(f => f.type === 'process-instance')) {
            const status = fact.content?.status || 'UNKNOWN';
            counts[status] = (counts[status] || 0) + 1;
        }
        return counts;
    }
    extractTableNames(facts) {
        return facts
            .filter(f => f.type === 'database-table')
            .map(f => f.content?.tableName)
            .filter(Boolean);
    }
    extractEndpoints(facts) {
        return facts
            .filter(f => f.type === 'api-call' || f.type === 'api-endpoint')
            .map(f => f.content?.endpoint || f.content?.path)
            .filter(Boolean);
    }
    countMethods(facts) {
        const counts = {};
        for (const fact of facts.filter(f => f.type === 'api-call')) {
            const method = fact.content?.method || 'UNKNOWN';
            counts[method] = (counts[method] || 0) + 1;
        }
        return counts;
    }
}
/**
 * 创建基线生成器
 */
export function createBaselineGenerator(config) {
    return new BaselineGenerator(config);
}
//# sourceMappingURL=baseline-generator.js.map