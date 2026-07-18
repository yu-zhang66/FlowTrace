import chalk from 'chalk';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import { generateId, loadTargetProjectConfig, validateTargetConfig, getFactsDir, runGate, gateForCommand } from '@flowtrace/core';
import { createDemoCollector, createSourceCollector, createSourceCollectorConfig, createConfigCollectorLoader, executeCollection } from '@flowtrace/collector';
export async function collectCommand(options) {
    const projectPath = options.project
        ? resolve(process.cwd(), options.project)
        : resolve(process.cwd());
    // --- Gate check ---
    const requirements = gateForCommand('collect');
    const flowtraceRoot = join(projectPath, '.flowtrace');
    const gateResult = runGate({
        projectRoot: projectPath,
        flowtraceRoot,
        requirements,
        explicitProcessId: options.process ?? null,
        query: null
    });
    if (!gateResult.ok) {
        if (options.human) {
            console.error(chalk.red(`\n✗ Gate check failed: ${gateResult.code}`));
            if (gateResult.missing.length > 0) {
                console.log(chalk.yellow(`  Missing: ${gateResult.missing.join(', ')}`));
            }
            for (const remediation of gateResult.remediation) {
                console.log(chalk.gray(`   ${remediation}`));
            }
        }
        else {
            console.error(JSON.stringify(gateResult));
        }
        process.exit(2);
        return;
    }
    console.log(chalk.blue(`\n📋 FlowTrace Collection`));
    console.log(chalk.gray(`Project: ${projectPath}\n`));
    if (!existsSync(projectPath)) {
        console.error(chalk.red(`Project path does not exist: ${projectPath}`));
        process.exit(1);
    }
    // 加载目标项目配置
    let targetConfig;
    try {
        targetConfig = loadTargetProjectConfig(projectPath);
        const errors = validateTargetConfig(targetConfig);
        if (errors.length > 0) {
            console.warn(chalk.yellow(`⚠️  Config validation warnings:`));
            errors.forEach((e) => console.log(chalk.gray(`   - ${e}`)));
        }
        console.log(chalk.green(`✓ Loaded project: ${targetConfig.project.name} (${targetConfig.project.id})`));
    }
    catch (error) {
        console.log(chalk.yellow(`⚠️  No .flowtrace configuration found`));
        console.log(chalk.gray(`   Run: flowtrace init --project ${projectPath}\n`));
        // 创建默认配置
        targetConfig = {
            projectRoot: projectPath,
            flowtraceRoot: resolve(projectPath, '.flowtrace'),
            configPath: '',
            project: {
                id: 'unknown',
                name: 'Unknown Project',
                sourceRoot: '.'
            },
            processId: 'demo-process',
            collectors: [
                { name: 'demo-collector', type: 'demo', enabled: true, priority: 100 }
            ],
            adapters: { legacy: '', current: '' },
            database: { type: 'oracle', configSource: '', access: 'read-only-collection' },
            semantic: { keywordsDir: 'semantic/keywords', mappingsDir: 'mappings' },
            paths: {
                facts: 'facts',
                scenarios: 'scenarios',
                reports: 'reports',
                mappings: 'mappings',
                semantic: 'semantic',
                fixtures: 'fixtures',
                executions: 'executions',
                mocks: 'mocks'
            },
            execution: {
                mode: 'dual-run',
                allowOnlineWrite: false,
                databaseMode: 'snapshot-only',
                testDataMode: 'masked-or-snapshot',
                failOn: ['P0', 'P1']
            }
        };
    }
    const outputDir = options.output
        ? resolve(projectPath, options.output)
        : getFactsDir(targetConfig);
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }
    const processId = options.process || targetConfig.processId;
    const sourceRoot = options.sourceRoot
        ? resolve(projectPath, options.sourceRoot)
        : resolve(projectPath, targetConfig.project.sourceRoot);
    console.log(chalk.blue(`\n🔍 Starting baseline collection for: ${processId}`));
    console.log(chalk.gray(`Source root: ${sourceRoot}\n`));
    // 构建采集上下文
    const context = {
        projectRoot: projectPath,
        flowtraceRoot: resolve(projectPath, '.flowtrace'),
        processId,
        sourceRoot,
        scanSource: options.scanSource !== false,
        scanDatabase: options.scanDatabase || false
    };
    const collectors = [];
    const collectorLoader = createConfigCollectorLoader();
    // 根据参数选择采集器
    // 只有显式指定 --demo 才使用 Demo Collector
    if (options.demo) {
        console.log(chalk.blue(`  📦 Loading Demo Collector (--demo)...`));
        const demoCollector = createDemoCollector(processId);
        await demoCollector.initialize(context);
        collectors.push(demoCollector);
        console.log(chalk.gray(`     ✓ Demo Collector initialized`));
    }
    else if (options.collector && options.collector !== 'auto') {
        // 使用指定的采集器类型（非 auto）
        console.log(chalk.blue(`  📦 Loading ${options.collector} collector...`));
        if (options.collector === 'demo') {
            console.error(chalk.red(`\n✗ Please use --demo flag explicitly to enable Demo Collector`));
            process.exit(1);
        }
        else if (options.collector === 'source' || options.collector === 'source-scanner') {
            const sourceCollector = createSourceCollector(createSourceCollectorConfig('source-collector', { sourceRoot }));
            const availability = await sourceCollector.checkAvailability(context);
            if (availability.available) {
                await sourceCollector.initialize(context);
                collectors.push(sourceCollector);
                console.log(chalk.gray(`     ✓ Source Collector initialized`));
            }
            else {
                console.log(chalk.gray(`     ○ Source Scanner skipped: ${availability.reason}`));
            }
        }
    }
    else {
        // 默认：直接使用 source-collector（--collector auto 或未指定）
        console.log(chalk.blue(`  📦 Using default source-collector...`));
        const sourceCollector = createSourceCollector(createSourceCollectorConfig('source-collector', { sourceRoot }));
        const availability = await sourceCollector.checkAvailability(context);
        if (availability.available) {
            await sourceCollector.initialize(context);
            collectors.push(sourceCollector);
            console.log(chalk.gray(`     ✓ Source Collector initialized`));
        }
        else {
            console.log(chalk.gray(`     ○ Source Scanner skipped: ${availability.reason}`));
        }
    }
    // 禁止自动回退到 Demo Collector
    if (collectors.length === 0 && !options.demo) {
        console.error(chalk.red(`\n✗ No collectors available.`));
        console.log(chalk.gray(`   Configured collectors:`));
        for (const c of targetConfig.collectors) {
            console.log(chalk.gray(`     - ${c.name} (${c.type})`));
        }
        console.log(chalk.yellow(`\n   Use --demo to collect demo data, or configure collectors in flowtrace.yaml`));
        process.exit(1);
    }
    // 只有显式指定 --demo 才使用 Demo Collector
    if (collectors.length === 0 && options.demo) {
        console.log(chalk.blue(`  📦 Loading Demo Collector (explicit --demo)`));
        const demoCollector = createDemoCollector(processId);
        await demoCollector.initialize(context);
        collectors.push(demoCollector);
    }
    // 执行采集
    const startTime = Date.now();
    const { facts, errors, warnings, stats } = await executeCollection(collectors, context);
    const durationMs = Date.now() - startTime;
    // 清理采集器
    await collectorLoader.cleanup(collectors);
    // 统计
    const byType = {};
    const byCategory = {};
    let autoExtracted = 0;
    let pendingConfirm = 0;
    let confirmed = 0;
    for (const fact of facts) {
        byType[fact.type] = (byType[fact.type] || 0) + 1;
        byCategory[fact.category] = (byCategory[fact.category] || 0) + 1;
        if (fact.reviewStatus === 'AUTO_EXTRACTED')
            autoExtracted++;
        else if (fact.reviewStatus === 'PENDING_CONFIRM')
            pendingConfirm++;
        else if (fact.reviewStatus === 'CONFIRMED')
            confirmed++;
    }
    // 生成 baseline
    const baseline = {
        id: generateId('baseline'),
        processId,
        name: `${targetConfig.project.name} - ${processId}`,
        collectedAt: new Date().toISOString(),
        collectionMode: errors.length > 0 ? 'partial' : 'full',
        sourceRoot,
        facts: facts.map(convertToFact),
        summary: {
            totalFacts: facts.length,
            byCategory,
            confirmedFacts: confirmed,
            pendingFacts: pendingConfirm + autoExtracted,
            autoExtractedFacts: autoExtracted
        },
        metadata: {
            collectionVersion: '1.0.0',
            totalFactsCollected: facts.length,
            scanSource: options.scanSource !== false,
            scanDatabase: options.scanDatabase || false,
            warnings: warnings.length,
            errors: errors.length,
            collectors: Object.keys(stats),
            durationMs
        }
    };
    // 保存 baseline JSON
    const outputFile = resolve(outputDir, 'baseline.json');
    writeFileSync(outputFile, JSON.stringify(baseline, null, 2), 'utf-8');
    // 生成 baseline Markdown
    const mdReport = generateBaselineMarkdown(baseline, stats, errors);
    const mdOutputFile = resolve(outputDir, 'baseline.md');
    writeFileSync(mdOutputFile, mdReport, 'utf-8');
    // 采集阶段同时产出机器流程模型和人工流程图，避免流程图只在测试结束后补做。
    const processArtifacts = generateProcessArtifacts(targetConfig, projectPath, processId);
    console.log(chalk.green(`✓ Machine process model saved to: ${processArtifacts.jsonFile}`));
    console.log(chalk.green(`✓ Human flowchart saved to: ${processArtifacts.mdFile}`));
    // 输出结果
    console.log(chalk.green(`\n✓ Collected ${facts.length} facts (${durationMs}ms)`));
    console.log(chalk.green(`✓ Baseline saved to: ${outputFile}`));
    console.log(chalk.green(`✓ Markdown report saved to: ${mdOutputFile}`));
    if (warnings.length > 0) {
        console.log(chalk.yellow(`\n⚠️  Warnings (${warnings.length}):`));
        warnings.slice(0, 5).forEach((w) => console.log(chalk.gray(`   - ${w}`)));
    }
    if (errors.length > 0) {
        console.log(chalk.red(`\n✗ Errors (${errors.length}):`));
        errors.slice(0, 5).forEach((e) => console.log(chalk.gray(`   - ${e}`)));
    }
    const pendingCount = facts.filter((f) => f.reviewStatus === 'AUTO_EXTRACTED' || f.reviewStatus === 'PENDING_CONFIRM').length;
    if (pendingCount > 0) {
        console.log(chalk.yellow(`\n⚠️  Review required: ${pendingCount} facts need human confirmation`));
    }
    return undefined;
}
function generateProcessArtifacts(targetConfig, projectPath, processId) {
    const flowtraceRoot = resolve(projectPath, '.flowtrace');
    const processDir = join(flowtraceRoot, 'processes');
    mkdirSync(processDir, { recursive: true });
    const processFile = join(processDir, `${processId}.yaml`);
    const inventoryFile = join(processDir, 'inventory.json');
    let process = { processId, name: targetConfig.project.name, nodes: [], transitions: [] };
    if (existsSync(processFile))
        process = yaml.load(readFileSync(processFile, 'utf-8'));
    if (process.nodes.length === 0 && existsSync(inventoryFile)) {
        const inventory = JSON.parse(readFileSync(inventoryFile, 'utf-8'));
        const discovered = (inventory.processes || []).find((item) => item.processId === processId);
        if (discovered)
            process = discovered;
    }
    const jsonFile = join(processDir, `${processId}.json`);
    writeFileSync(jsonFile, JSON.stringify(process, null, 2), 'utf-8');
    const nodeNames = new Map((process.nodes || []).map((n) => [n.id, n.name || n.id]));
    const lines = ['# 流程采集结果（人工流程图）', '', '```mermaid', 'flowchart LR'];
    const mermaidId = (value, index) => {
        const normalized = String(value || `node_${index}`).replace(/[^a-zA-Z0-9_]/g, '_');
        if (normalized.toLowerCase() === 'end')
            return 'flow_end';
        return /^[a-zA-Z_]/.test(normalized) ? normalized : `node_${normalized}`;
    };
    const ids = new Map((process.nodes || []).map((n, i) => [String(n.id), mermaidId(n.id, i)]));
    for (const node of process.nodes || []) {
        const shape = node.type === 'start' || node.type === 'end' ? ['([', '])'] : ['[', ']'];
        const id = ids.get(String(node.id)) || mermaidId(node.id, 0);
        const label = String(node.name || node.id).replace(/"/g, '\\"');
        lines.push(`    ${id}${shape[0]}"${label}"${shape[1]}`);
    }
    // Mermaid treats `end` specially and undeclared transition endpoints render
    // inconsistently across Markdown viewers. Declare every implicit endpoint.
    const declared = new Set(ids.values());
    for (const transition of process.transitions || []) {
        const endpoint = String(transition.to || '');
        const id = ids.get(endpoint) || mermaidId(endpoint, declared.size);
        if (!declared.has(id)) {
            const label = endpoint.toLowerCase() === 'end' ? '结束' : endpoint;
            lines.push(`    ${id}(["${label.replace(/"/g, '\\"')}"])`);
            declared.add(id);
            ids.set(endpoint, id);
        }
    }
    for (const transition of process.transitions || []) {
        const from = ids.get(String(transition.from)) || mermaidId(transition.from, 0);
        const to = ids.get(String(transition.to)) || mermaidId(transition.to, 0);
        const event = transition.event ? `|"${String(transition.event).replace(/"/g, '\\"')}"|` : '';
        lines.push(`    ${from} -->${event} ${to}`);
    }
    lines.push('```', '', `流程 ID：\`${process.processId || targetConfig.processId}\``, `流程名称：${process.name || targetConfig.project.name}`);
    lines.push('', '## 流程步骤（兼容不支持 Mermaid 的 Markdown 阅读器）', '', '| 顺序 | 节点 | 角色 |', '|---:|---|---|');
    for (const [index, node] of (process.nodes || []).entries())
        lines.push(`| ${index + 1} | ${node.name || node.id} | ${node.actor || '-'} |`);
    const mdFile = join(processDir, `${processId}-flowchart.md`);
    writeFileSync(mdFile, `${lines.join('\n')}\n`, 'utf-8');
    return { jsonFile, mdFile };
}
/**
 * 将 CollectedFact 转换为 Fact
 */
function convertToFact(collected) {
    return {
        id: collected.id,
        type: collected.type,
        category: collected.category,
        name: collected.name,
        description: collected.description,
        content: collected.content,
        evidence: collected.evidence.map(e => ({
            source: e.source,
            line: e.line,
            confidence: e.confidence,
            extractedAt: e.extractedAt
        })),
        reviewStatus: collected.reviewStatus
    };
}
/**
 * 生成 Markdown 报告
 */
function generateBaselineMarkdown(baseline, stats, errors) {
    const isDemoMode = baseline.collectionMode === 'demo';
    const demoWarning = isDemoMode
        ? `\n> ⚠️  **DEMO MODE**: This baseline was generated by the Demo Collector.\n`
        : '';
    let md = `# FlowTrace 流程基线报告

## 基本信息

${demoWarning}
- **项目**: ${baseline.name}
- **流程**: ${baseline.processId}
- **收集时间**: ${new Date(baseline.collectedAt).toLocaleString('zh-CN')}
- **收集模式**: ${baseline.collectionMode}
- **事实总数**: ${baseline.summary.totalFacts}

## 采集器统计

| 采集器 | 事实数量 |
|--------|----------|
`;
    for (const [name, count] of Object.entries(stats)) {
        md += `| ${name} | ${count} |\n`;
    }
    md += `
## 摘要统计

### 按类别

| 类别 | 数量 |
|------|------|
`;
    for (const [category, count] of Object.entries(baseline.summary.byCategory || {})) {
        md += `| ${category} | ${count} |\n`;
    }
    md += `
### 审核状态

- ✅ 已确认: ${baseline.summary.confirmedFacts}
- ⚠️ 待审核: ${baseline.summary.pendingFacts}
- 🤖 自动提取: ${baseline.summary.autoExtractedFacts}

`;
    // 按类别分组显示事实
    const factsByCategory = {};
    for (const fact of baseline.facts) {
        if (!factsByCategory[fact.category]) {
            factsByCategory[fact.category] = [];
        }
        factsByCategory[fact.category].push(fact);
    }
    for (const [category, facts] of Object.entries(factsByCategory)) {
        md += `## ${category}\n\n`;
        for (const fact of facts) {
            md += `### ${fact.name}\n\n`;
            md += `${fact.description || 'No description'}\n\n`;
            md += `- **类型**: ${fact.type}\n`;
            md += `- **审核状态**: ${fact.reviewStatus}\n`;
            if (fact.content) {
                if (fact.content.filePath) {
                    md += `- **文件**: ${fact.content.filePath}\n`;
                }
                if (fact.content.apiPath) {
                    md += `- **API路径**: ${fact.content.httpMethod} ${fact.content.apiPath}\n`;
                }
                if (fact.content.processId) {
                    md += `- **流程ID**: ${fact.content.processId}\n`;
                }
                if (fact.content.tasks) {
                    md += `- **任务数**: ${fact.content.tasks.length}\n`;
                }
            }
            md += '\n';
        }
    }
    if (errors.length > 0) {
        md += `
## 错误

`;
        for (const error of errors) {
            md += `- ${error}\n`;
        }
    }
    md += `
---

*此报告由 FlowTrace 自动生成*
*收集模式: ${baseline.collectionMode}*
`;
    return md;
}
//# sourceMappingURL=collect.js.map