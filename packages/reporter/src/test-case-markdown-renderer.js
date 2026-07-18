/**
 * Test Case Markdown Renderer
 *
 * 将测试案例 JSON 渲染为人工可读的 Markdown 格式。
 * 支持离线打开，包含 Mermaid 流程图。
 */
import { z } from 'zod';
// ============================================================
// Config Check Result Schema
// ============================================================
export const ConfigCheckResultSchema = z.object({
    valid: z.boolean(),
    errors: z.array(z.object({
        itemId: z.string(),
        itemType: z.string(),
        description: z.string(),
        severity: z.enum(['high', 'medium', 'low'])
    })).optional(),
    warnings: z.array(z.object({
        itemId: z.string(),
        description: z.string()
    })).optional(),
    timestamp: z.string().datetime()
});
// ============================================================
// Constants
// ============================================================
const CASE_TYPE_LABELS_ZH = {
    'FULL_PATH_PASS': '全节点通过',
    'FIRST_REJECT': '第一个拒绝',
    'INTERMEDIATE_REJECT': '中间拒绝',
    'FINAL_REJECT': '最终拒绝',
    'FIRST_RETURN': '第一个退回',
    'INTERMEDIATE_RETURN': '中间退回',
    'FINAL_RETURN': '最终退回',
    'RETURN_SUPPLEMENT': '退回后补件',
    'TRANSFER': '转交',
    'COSIGN_ALL_PASS': '会签全部通过',
    'COSIGN_PARTIAL_INCOMPLETE': '会签部分未完成',
    'COSIGN_ONE_REJECT': '会签一人拒绝',
    'UNAUTHORIZED_ATTEMPT': '无权限尝试',
    'DUPLICATE_APPROVAL_HANDLED': '已处理重复审批',
    'TIMEOUT_AUTO_COMPLETE': '超时自动完成',
    'BULK_OPERATION': '批量操作',
    'BATCH_APPROVE': '批量审批',
    'DELEGATION': '委托',
    'ESCALATION': '升级'
};
const ACCOUNT_TYPE_LABELS_ZH = {
    'INITIATOR': '发起人',
    'APPROVER': '审批人',
    'COUNTER_SIGNER': '会签人',
    'FINAL_APPROVER': '最终审批人',
    'ADMIN': '管理员',
    'VIEWER': '查看者',
    'AUDITOR': '审计员'
};
const OPERATION_LABELS_ZH = {
    'view': '查看',
    'create': '创建',
    'update': '更新',
    'delete': '删除',
    'submit': '提交',
    'approve': '审批通过',
    'reject': '审批拒绝',
    'return': '退回',
    'withdraw': '撤回',
    'transfer': '转交',
    'delegate': '委托',
    'upload': '上传',
    'download': '下载',
    'search': '搜索',
    'filter': '筛选',
    'export': '导出',
    'import': '导入'
};
const SEVERITY_LABELS_ZH = {
    'P0': 'P0 - 阻断级',
    'P1': 'P1 - 严重',
    'P2': 'P2 - 一般',
    'P3': 'P3 - 轻微'
};
const SOURCE_STATUS_LABELS_ZH = {
    'AUTO_GENERATED': '自动生成',
    'MANUALLY_CREATED': '人工创建',
    'DERIVED': '派生',
    'PENDING_CONFIRMATION': '待确认'
};
const WORKFLOW_STATUS_LABELS_ZH = {
    'not_reached': '未到达',
    'in_progress': '进行中',
    'completed': '已完成',
    'skipped': '已跳过',
    'failed': '失败'
};
const FLOW_STATUS_LABELS_ZH = {
    'pending': '待处理',
    'approved': '已通过',
    'rejected': '已拒绝',
    'returned': '已退回',
    'withdrawn': '已撤回',
    'transferred': '已转交'
};
const POST_FLOW_STATUS_LABELS_ZH = {
    'completed': '已完成',
    'terminated': '已终止',
    'archived': '已归档'
};
const DEFAULT_OPTIONS = {
    language: 'zh',
    includeMermaid: true,
    includeAccountSwitchDetail: true
};
const PENDING_CONFIRMATION_MARKER = 'PENDING_CONFIRMATION';
/**
 * 测试案例 Markdown 渲染器
 */
export class TestCaseMarkdownRenderer {
    options;
    labels;
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        if (this.options.language === 'en') {
            this.labels = {
                caseType: {},
                accountType: {},
                operation: {},
                severity: {},
                sourceStatus: {},
                workflowStatus: {},
                flowStatus: {},
                postFlowStatus: {}
            };
        }
        else {
            this.labels = {
                caseType: CASE_TYPE_LABELS_ZH,
                accountType: ACCOUNT_TYPE_LABELS_ZH,
                operation: OPERATION_LABELS_ZH,
                severity: SEVERITY_LABELS_ZH,
                sourceStatus: SOURCE_STATUS_LABELS_ZH,
                workflowStatus: WORKFLOW_STATUS_LABELS_ZH,
                flowStatus: FLOW_STATUS_LABELS_ZH,
                postFlowStatus: POST_FLOW_STATUS_LABELS_ZH
            };
        }
    }
    /**
     * 渲染单个测试案例
     */
    render(testCase) {
        const validation = this.validateTestCase(testCase);
        if (!validation.valid) {
            console.warn(`Test case "${testCase.id}" validation failed:`, validation.errors);
        }
        let md = '';
        // 标题
        md += this.renderHeader(testCase);
        // 基本信息
        md += this.renderBasicInfo(testCase);
        // 前置条件
        md += this.renderPreconditions(testCase);
        // 所需资源
        md += this.renderRequiredResources(testCase);
        // 测试步骤
        md += this.renderSteps(testCase);
        // 预期结果
        md += this.renderExpectedResults(testCase);
        // 账号切换时间线
        md += this.renderAccountSwitchTimeline(testCase);
        // 数据清理策略
        md += this.renderDataCleanup(testCase);
        // 页脚
        md += this.renderFooter(testCase);
        return md;
    }
    /**
     * 渲染所有测试案例
     */
    renderAll(testCases) {
        let md = '# 测试案例集\n\n';
        md += `> 生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
        md += `> 案例总数: ${testCases.length}\n\n`;
        // 案例索引
        md += '## 案例索引\n\n';
        md += '| 编号 | 名称 | 类型 | 严重级别 | 来源 |\n';
        md += '|------|------|------|----------|------|\n';
        for (const tc of testCases) {
            const typeLabel = this.labels.caseType[tc.type] || tc.type;
            const severityLabel = tc.severity ? this.labels.severity[tc.severity] || tc.severity : '-';
            const sourceLabel = this.labels.sourceStatus[tc.sourceStatus] || tc.sourceStatus;
            md += `| ${tc.id} | ${tc.name} | ${typeLabel} | ${severityLabel} | ${sourceLabel} |\n`;
        }
        md += '\n---\n\n';
        // 各个案例详情
        for (const tc of testCases) {
            md += this.render(tc);
            md += '\n\n---\n\n';
        }
        return md;
    }
    /**
     * 渲染配置检查结果
     */
    renderConfigCheck(result) {
        const validation = ConfigCheckResultSchema.safeParse(result);
        if (!validation.success) {
            throw new Error(`Invalid ConfigCheckResult: ${validation.error.message}`);
        }
        let md = '# 配置检查报告\n\n';
        // 检查状态
        if (result.valid) {
            md += '✅ **配置检查通过**\n\n';
        }
        else {
            md += '❌ **配置检查未通过**\n\n';
        }
        md += `> 检查时间: ${new Date(result.timestamp).toLocaleString('zh-CN')}\n\n`;
        // 错误
        if (result.errors && result.errors.length > 0) {
            md += '## 错误列表\n\n';
            md += '| 级别 | 项目 | 描述 |\n';
            md += '|------|------|------|\n';
            for (const err of result.errors) {
                const severityIcon = err.severity === 'high' ? '🔴' : err.severity === 'medium' ? '🟡' : '🟢';
                md += `| ${severityIcon} ${err.severity} | ${err.itemId} (${err.itemType}) | ${err.description} |\n`;
            }
            md += '\n';
        }
        // 警告
        if (result.warnings && result.warnings.length > 0) {
            md += '## 警告列表\n\n';
            for (const warn of result.warnings) {
                md += `- ⚠️ **${warn.itemId}**: ${warn.description}\n`;
            }
            md += '\n';
        }
        return md;
    }
    /**
     * 渲染案例索引
     */
    renderIndex(testCases) {
        let md = '# 测试案例索引\n\n';
        md += `> 生成时间: ${new Date().toLocaleString('zh-CN')}\n\n`;
        // 统计信息
        const stats = this.calculateStats(testCases);
        md += '## 统计概览\n\n';
        md += '| 指标 | 数值 |\n';
        md += `|------|------|\n`;
        md += `| 案例总数 | ${stats.total} |\n`;
        md += `| 可执行案例 | ${stats.executable} |\n`;
        md += `| 待确认案例 | ${stats.pendingConfirmation} |\n`;
        md += `| P0 案例 | ${stats.p0} |\n`;
        md += `| P1 案例 | ${stats.p1} |\n`;
        md += '\n';
        // 按类型分组
        md += '## 按类型分组\n\n';
        for (const [type, count] of Object.entries(stats.byType)) {
            const typeLabel = this.labels.caseType[type] || type;
            md += `- **${typeLabel}**: ${count} 个案例\n`;
        }
        md += '\n';
        // 按严重级别分组
        md += '## 按严重级别分组\n\n';
        md += '| 严重级别 | 数量 | 占比 |\n';
        md += '|----------|------|------|\n';
        for (const severity of ['P0', 'P1', 'P2', 'P3']) {
            const count = stats.bySeverity[severity] || 0;
            const percent = ((count / stats.total) * 100).toFixed(1);
            md += `| ${this.labels.severity[severity] || severity} | ${count} | ${percent}% |\n`;
        }
        md += '\n';
        // 案例列表
        md += '## 案例列表\n\n';
        md += '| 编号 | 名称 | 类型 | 级别 | 可执行 | 标签 |\n';
        md += '|------|------|------|------|--------|------|\n';
        for (const tc of testCases) {
            const typeLabel = this.labels.caseType[tc.type] || tc.type;
            const severityLabel = tc.severity ? this.labels.severity[tc.severity] || tc.severity : '-';
            const tags = tc.tags?.join(', ') || '-';
            md += `| ${tc.id} | ${tc.name} | ${typeLabel} | ${severityLabel} | ${tc.executable ? '✅' : '❌'} | ${tags} |\n`;
        }
        return md;
    }
    /**
     * 渲染 Mermaid 流程图
     */
    renderMermaid(flowchart) {
        const validation = this.validateFlowchart(flowchart);
        if (!validation.valid) {
            console.warn('Flowchart validation failed:', validation.errors);
        }
        let mermaid = '```mermaid\n';
        mermaid += 'flowchart TD\n\n';
        // 节点定义
        for (const node of flowchart.nodes) {
            const nodeType = this.getNodeShape(node.type);
            const sourceStatusSuffix = node.sourceStatus === 'PENDING_CONFIRMATION' ? ' ⚠️' :
                node.sourceStatus === 'UNCONFIRMED' ? ' ❓' : '';
            const actors = node.actors?.join(', ') || '';
            const actorSuffix = actors ? '\\n👤 ' + actors : '';
            mermaid += `    ${node.id}${nodeType}["${node.name}${sourceStatusSuffix}${actorSuffix}"]\n`;
        }
        // 边定义
        for (const edge of flowchart.edges) {
            const condition = edge.condition ? '|' + edge.condition + '|' : '';
            const label = edge.label ? '["' + edge.label + '"]' : '';
            mermaid += `    ${edge.from} -->${condition}${label} ${edge.to}\n`;
        }
        // 主路径高亮
        if (flowchart.mainPath.length > 0) {
            mermaid += '\n    %% Main Path\n';
            for (let i = 0; i < flowchart.mainPath.length - 1; i++) {
                mermaid += `    style ${flowchart.mainPath[i]} fill:#e1f5fe,stroke:#01579b\n`;
            }
            mermaid += `    style ${flowchart.mainPath[flowchart.mainPath.length - 1]} fill:#e8f5e9,stroke:#2e7d32\n`;
        }
        // 未确认项标注
        const pendingNodes = flowchart.nodes.filter(n => n.sourceStatus === 'PENDING_CONFIRMATION');
        for (const node of pendingNodes) {
            mermaid += `    %% ${node.id}: 待确认\n`;
        }
        mermaid += '```\n';
        return mermaid;
    }
    // ============================================================
    // Private Methods
    // ============================================================
    validateTestCase(data) {
        try {
            const { TestCaseSchema } = require('@flowtrace/core');
            const result = TestCaseSchema.safeParse(data);
            if (!result.success) {
                return {
                    valid: false,
                    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
                };
            }
            return { valid: true };
        }
        catch {
            return { valid: true }; // Schema not available, skip validation
        }
    }
    validateFlowchart(data) {
        try {
            const { FlowchartDocumentSchema } = require('@flowtrace/core');
            const result = FlowchartDocumentSchema.safeParse(data);
            if (!result.success) {
                return {
                    valid: false,
                    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
                };
            }
            return { valid: true };
        }
        catch {
            return { valid: true };
        }
    }
    renderHeader(tc) {
        const pendingWarning = tc.sourceStatus === 'PENDING_CONFIRMATION' ?
            '\n> ⚠️ **注意**: 此案例包含待确认项目，请人工核实后再执行。\n' : '';
        return `# 测试案例: ${tc.name}
${pendingWarning}
`;
    }
    renderBasicInfo(tc) {
        let md = '## 基本信息\n\n';
        md += '| 属性 | 值 |\n';
        md += '|------|-----|\n';
        md += '| 案例编号 | `' + tc.id + '` |\n';
        md += '| 案例名称 | ' + tc.name + ' |\n';
        md += '| 案例类型 | ' + (this.labels.caseType[tc.type] || tc.type) + ' |\n';
        md += '| 测试目的 | ' + tc.purpose + ' |\n';
        md += '| 严重级别 | ' + (tc.severity ? this.labels.severity[tc.severity] || tc.severity : '-') + ' |\n';
        md += '| 来源状态 | ' + (this.labels.sourceStatus[tc.sourceStatus] || tc.sourceStatus) + ' |\n';
        md += '| 可执行 | ' + (tc.executable ? '✅ 是' : '❌ 否') + ' |\n';
        if (tc.flowId) {
            md += '| 关联流程ID | `' + tc.flowId + '` |\n';
        }
        if (tc.sourceScenarioId) {
            md += '| 来源场景ID | `' + tc.sourceScenarioId + '` |\n';
        }
        if (tc.relatedNodeIds && tc.relatedNodeIds.length > 0) {
            md += '| 关联节点 | ' + tc.relatedNodeIds.map(id => '`' + id + '`').join(', ') + ' |\n';
        }
        // 标签
        if (tc.tags && tc.tags.length > 0) {
            md += '\n**标签**: ' + tc.tags.map(t => '`' + t + '`').join(' ') + '\n';
        }
        md += '\n';
        return md;
    }
    renderPreconditions(tc) {
        let md = '## 前置条件\n\n';
        if (!tc.precondition || Object.keys(tc.precondition).length === 0) {
            md += '*无特殊前置条件*\n\n';
            return md;
        }
        for (const [key, value] of Object.entries(tc.precondition)) {
            if (value === PENDING_CONFIRMATION_MARKER) {
                md += '- ⚠️ **' + key + '**: `PENDING_CONFIRMATION` - 待人工确认\n';
            }
            else if (Array.isArray(value)) {
                md += '- **' + key + '**: ' + value.map(v => '`' + v + '`').join(', ') + '\n';
            }
            else if (typeof value === 'object') {
                md += '- **' + key + '**:\n';
                md += '  ```json\n';
                md += '  ' + JSON.stringify(value, null, 2).split('\n').join('\n  ') + '\n';
                md += '  ```\n';
            }
            else {
                md += '- **' + key + '**: `' + value + '`\n';
            }
        }
        md += '\n';
        return md;
    }
    renderRequiredResources(tc) {
        let md = '## 所需资源\n\n';
        // 账号
        md += '### 账号\n\n';
        if (tc.requiredAccounts && tc.requiredAccounts.length > 0) {
            md += '| 账号引用 | 类型 | 权限 | 说明 |\n';
            md += '|----------|------|------|------|\n';
            for (const acc of tc.requiredAccounts) {
                const typeLabel = this.labels.accountType[acc.accountType] || acc.accountType;
                const permissions = acc.permissions?.map(p => '`' + p + '`').join(', ') || '-';
                const desc = acc.description || '-';
                md += '| `' + acc.accountRef + '` | ' + typeLabel + ' | ' + permissions + ' | ' + desc + ' |\n';
            }
        }
        else {
            md += '*无*\n';
        }
        md += '\n';
        // 企业
        if (tc.requiredEnterprise) {
            md += '### 企业账号\n\n';
            md += '| 企业ID | 企业名称 | 账号类型 |\n';
            md += '|--------|----------|----------|\n';
            md += '| `' + tc.requiredEnterprise.enterpriseId + '` | ' + (tc.requiredEnterprise.enterpriseName || '-') + ' | ' + (tc.requiredEnterprise.accountType || '-') + ' |\n';
            md += '\n';
        }
        // 额度
        if (tc.requiredCredit) {
            md += '### 授信额度\n\n';
            const creditTypeLabels = {
                'loan': '贷款',
                'credit_line': '信用额度',
                'card_credit': '卡额度'
            };
            md += '- **额度类型**: ' + (creditTypeLabels[tc.requiredCredit.creditType] || tc.requiredCredit.creditType) + '\n';
            md += '- **额度金额**: ' + tc.requiredCredit.amount.toLocaleString() + ' ' + tc.requiredCredit.currency + '\n';
            md += '\n';
        }
        // 合同
        if (tc.requiredContracts && tc.requiredContracts.length > 0) {
            md += '### 合同\n\n';
            md += '| 合同ID | 合同类型 |\n';
            md += '|--------|----------|\n';
            for (const contract of tc.requiredContracts) {
                md += '| `' + contract.contractId + '` | ' + (contract.contractType || '-') + ' |\n';
            }
            md += '\n';
        }
        // 方案
        if (tc.requiredPlans && tc.requiredPlans.length > 0) {
            md += '### 方案\n\n';
            md += '| 方案ID | 方案类型 |\n';
            md += '|--------|----------|\n';
            for (const plan of tc.requiredPlans) {
                md += '| `' + plan.planId + '` | ' + (plan.planType || '-') + ' |\n';
            }
            md += '\n';
        }
        // 单据
        if (tc.requiredDocuments && tc.requiredDocuments.length > 0) {
            md += '### 单据\n\n';
            md += '| 单据ID | 单据类型 |\n';
            md += '|--------|----------|\n';
            for (const doc of tc.requiredDocuments) {
                md += '| `' + doc.documentId + '` | ' + (doc.documentType || '-') + ' |\n';
            }
            md += '\n';
        }
        // 文件
        if (tc.requiredFiles && tc.requiredFiles.length > 0) {
            md += '### 文件\n\n';
            md += '| 文件ID | 文件类型 | 文件大小 |\n';
            md += '|--------|----------|----------|\n';
            for (const file of tc.requiredFiles) {
                const size = file.fileSize ? (file.fileSize / 1024).toFixed(1) + ' KB' : '-';
                md += '| `' + file.fileId + '` | ' + (file.fileType || '-') + ' | ' + size + ' |\n';
            }
            md += '\n';
        }
        return md;
    }
    renderSteps(tc) {
        let md = '## 测试步骤\n\n';
        for (let i = 0; i < tc.steps.length; i++) {
            const step = tc.steps[i];
            if ('type' in step && step.type === 'ACCOUNT_SWITCH') {
                md += this.renderAccountSwitchStep(step, i + 1);
            }
            else {
                md += this.renderTestStep(step, i + 1);
            }
        }
        return md;
    }
    renderTestStep(step, index) {
        let md = '### 步骤 ' + index + ': ' + step.name + '\n\n';
        // 基础信息
        md += '| 属性 | 值 |\n';
        md += '|------|-----|\n';
        md += '| 步骤ID | `' + step.stepId + '` |\n';
        if (step.accountRef) {
            const accountTypeLabel = step.accountType ? this.labels.accountType[step.accountType] : '';
            md += '| 执行账号 | `' + step.accountRef + '` ' + (accountTypeLabel ? '(' + accountTypeLabel + ')' : '') + ' |\n';
        }
        if (step.loginRequired) {
            md += '| 需要登录 | ✅ 是 |\n';
        }
        if (step.menu && step.menu.length > 0) {
            md += '| 菜单路径 | ' + step.menu.join(' → ') + ' |\n';
        }
        if (step.pageOrApi) {
            const method = step.pageOrApi.method || '';
            md += '| 页面/接口 | ' + step.pageOrApi.type.toUpperCase() + ' ' + method + ' `' + step.pageOrApi.path + '` |\n';
        }
        const opLabel = this.labels.operation[step.operation] || step.operation;
        md += '| 操作类型 | ' + opLabel + ' |\n';
        if (step.failurePolicy && step.failurePolicy !== 'STOP') {
            md += '| 失败策略 | ' + step.failurePolicy + ' |\n';
        }
        md += '\n';
        // 输入数据
        if (step.input && Object.keys(step.input).length > 0) {
            md += '**输入数据**:\n\n';
            md += '```json\n';
            md += JSON.stringify(step.input, null, 2) + '\n';
            md += '```\n\n';
        }
        // 输入上下文
        if (step.contextIn && Object.keys(step.contextIn).length > 0) {
            md += '**输入上下文**:\n\n';
            md += '```json\n';
            md += JSON.stringify(step.contextIn, null, 2) + '\n';
            md += '```\n\n';
        }
        // 预期 UI 结果
        if (step.expectedUiResult) {
            md += '**预期 UI 结果**:\n\n';
            if (step.expectedUiResult.pageLoaded !== undefined) {
                md += '- 页面加载: ' + (step.expectedUiResult.pageLoaded ? '✅' : '❌') + '\n';
            }
            if (step.expectedUiResult.urlPattern) {
                md += '- URL 匹配: `' + step.expectedUiResult.urlPattern + '`\n';
            }
            if (step.expectedUiResult.elements && step.expectedUiResult.elements.length > 0) {
                md += '- UI 元素检查:\n';
                for (const el of step.expectedUiResult.elements) {
                    const existIcon = el.shouldExist ? '✅' : '❌';
                    const visibleIcon = el.shouldBeVisible !== undefined ? (el.shouldBeVisible ? '👁️' : '🚫') : '';
                    md += '  - ' + existIcon + visibleIcon + ' `' + el.selector + '`\n';
                }
            }
            if (step.expectedUiResult.messages && step.expectedUiResult.messages.length > 0) {
                md += '- 消息检查:\n';
                for (const msg of step.expectedUiResult.messages) {
                    md += '  - [' + msg.type + '] 应包含: "' + msg.contains + '"\n';
                }
            }
            md += '\n';
        }
        // 预期 API 结果
        if (step.expectedApiResult) {
            md += '**预期 API 结果**:\n\n';
            md += '- 状态码: `' + step.expectedApiResult.statusCode + '`\n';
            if (step.expectedApiResult.responseTime) {
                md += '- 响应时间: ≤' + step.expectedApiResult.responseTime.max + step.expectedApiResult.responseTime.unit + '\n';
            }
            if (step.expectedApiResult.responseContains) {
                md += '- 响应应包含:\n';
                for (const [key, value] of Object.entries(step.expectedApiResult.responseContains)) {
                    if (value === PENDING_CONFIRMATION_MARKER) {
                        md += '  - ⚠️ `' + key + '`: `PENDING_CONFIRMATION`\n';
                    }
                    else {
                        md += '  - `' + key + '`: `' + value + '`\n';
                    }
                }
            }
            md += '\n';
        }
        // 数据库断言
        if (step.databaseAssertions && step.databaseAssertions.length > 0) {
            md += '**数据库断言**:\n\n';
            for (const assertion of step.databaseAssertions) {
                md += '```sql\n';
                md += '-- 表: ' + assertion.tableName + '\n';
                // 构建 SELECT 语句
                const fields = assertion.assertions.map(a => a.field).join(', ');
                const whereClause = assertion.assertions
                    .map(a => a.field + ' ' + this.operatorToSql(a.operator) + ' ' + this.formatValue(a.value))
                    .join(' AND ');
                md += 'SELECT ' + (fields || '*') + ' FROM ' + assertion.tableName + '\n';
                if (whereClause) {
                    md += 'WHERE ' + whereClause + '\n';
                }
                md += '```\n\n';
                md += '断言条件:\n';
                for (const cond of assertion.assertions) {
                    const opLabel = this.operatorLabel(cond.operator);
                    if (cond.value === PENDING_CONFIRMATION_MARKER) {
                        md += '- ⚠️ `' + cond.field + '` ' + opLabel + ' `PENDING_CONFIRMATION`\n';
                    }
                    else {
                        md += '- `' + cond.field + '` ' + opLabel + ' `' + cond.value + '`\n';
                    }
                }
                md += '\n';
            }
        }
        // 证据类型
        if (step.evidence && step.evidence.length > 0) {
            const evidenceIcons = {
                'screenshot': '📸',
                'api_request': '📤',
                'api_response': '📥',
                'database_query': '🗄️',
                'database_result': '📊',
                'browser_console': '🖥️',
                'network_trace': '🌐',
                'log_entry': '📝',
                'file_upload': '📁',
                'file_download': '📥',
                'email_notification': '📧',
                'sms_notification': '📱'
            };
            md += '**证据收集**: ';
            md += step.evidence.map(e => (evidenceIcons[e] || '📎') + ' ' + e).join(' ');
            md += '\n\n';
        }
        // 账号切换
        if (step.accountSwitch) {
            md += '**账号切换**:\n\n';
            md += '- 目标账号: `' + step.accountSwitch.targetAccount + '`\n';
            if (step.accountSwitch.reason) {
                md += '- 切换原因: ' + step.accountSwitch.reason + '\n';
            }
            md += '\n';
        }
        // 下一个步骤
        if (step.nextStep) {
            md += '*下一步: `' + step.nextStep + '`*\n\n';
        }
        return md;
    }
    renderAccountSwitchStep(step, index) {
        let md = '### 步骤 ' + index + ': ' + step.name + ' (账号切换)\n\n';
        md += '> 🔄 从 `' + step.fromAccount + '` 切换到 `' + step.toAccount + '`\n';
        if (step.reason) {
            md += '> 原因: ' + step.reason + '\n';
        }
        md += '\n';
        if (!this.options.includeAccountSwitchDetail) {
            return md;
        }
        // 简化的账号切换表格
        md += '| 阶段 | 操作 | 结果 |\n';
        md += '|------|------|------|\n';
        md += '| 1. 记录上下文 | 记录会话状态 | ' + (step.step1_recordContext ? '✅' : '❌') + ' |\n';
        md += '| 2. 截图 | 捕获当前状态 | ' + (step.step2_captureCurrentState ? '✅' : '❌') + ' |\n';
        md += '| 3. 验证登出能力 | 检查是否可以登出 | ' + (step.step3_verifyLogoutAbility ? '✅' : '⚠️') + ' |\n';
        md += '| 4. 执行登出 | ' + step.step4_executeLogout.method + ' | ' + (step.step4_executeLogout.success ? '✅' : '❌') + ' |\n';
        md += '| 5. 验证登出 | 会话已清除: ' + (step.step5_verifyLogoutComplete.sessionCleared ? '✅' : '❌') + ' | ' + (step.step5_verifyLogoutComplete.cookiesCleared ? '✅' : '❌') + ' |\n';
        md += '| 6. 保存凭据 | 凭据有效性 | ' + (step.step6_saveTargetCredentials.credentialsValid ? '✅' : '❌') + ' |\n';
        md += '| 7. 执行登录 | ' + step.step7_executeLogin.method + ' | ' + (step.step7_executeLogin.success ? '✅' : '❌') + ' |\n';
        md += '| 8. 验证登录 | 认证状态: ' + (step.step8_verifyLoginSuccess.authenticated ? '✅' : '❌') + ' | - |\n';
        md += '| 9. 恢复上下文 | 恢复本地存储 | ' + (step.step9_restoreContext ? '✅' : '❌') + ' |\n';
        md += '| 10. 验证会话 | 新会话ID: `' + step.step10_verifySessionState.newSessionId + '` | - |\n';
        md += '| 11. 验证权限 | 查看: ' + (step.step11_verifyPermissions.canView ? '✅' : '❌') + ' 编辑: ' + (step.step11_verifyPermissions.canEdit ? '✅' : '❌') + ' | - |\n';
        md += '| 12. 验证导航 | ' + step.step12_verifyNavigation.currentUrl + ' | ' + (step.step12_verifyNavigation.matched ? '✅' : '❌') + ' |\n';
        md += '| 13. 验证UI元素 | ' + step.step13_verifyUIElements.elements.length + ' 个元素 | - |\n';
        md += '| 14. 记录映射 | 时间戳: ' + step.step14_recordSessionMapping.switchTimestamp + ' | ✅ |\n';
        md += '| 15. 验证业务上下文 | 可继续: ' + (step.step15_verifyBusinessContext.canProceed ? '✅' : '❌') + ' | - |\n';
        md += '\n';
        // 详细上下文信息
        md += '<details>\n<summary>📋 查看完整账号切换详情</summary>\n\n';
        // 会话状态
        if (step.step1_recordContext.sessionState) {
            md += '#### 会话状态\n\n';
            md += '```json\n';
            md += JSON.stringify(step.step1_recordContext.sessionState, null, 2) + '\n';
            md += '```\n\n';
        }
        // 截图信息
        if (step.step2_captureCurrentState.screenshot) {
            md += '#### 截图\n\n';
            md += '> 📸 截图文件: `' + step.step2_captureCurrentState.screenshot + '`\n\n';
        }
        // 用户信息
        if (step.step10_verifySessionState.userInfo) {
            md += '#### 用户信息\n\n';
            md += '- 用户ID: `' + step.step10_verifySessionState.userInfo.userId + '`\n';
            md += '- 用户名: `' + step.step10_verifySessionState.userInfo.username + '`\n';
            md += '- 角色: ' + step.step10_verifySessionState.userInfo.roles.map(r => '`' + r + '`').join(', ') + '\n';
            md += '- 权限: ' + step.step10_verifySessionState.permissions.map(p => '`' + p + '`').join(', ') + '\n\n';
        }
        // 权限详情
        md += '#### 权限检查\n\n';
        md += '- 查看权限: ' + (step.step11_verifyPermissions.canView ? '✅' : '❌') + '\n';
        md += '- 编辑权限: ' + (step.step11_verifyPermissions.canEdit ? '✅' : '❌') + '\n';
        md += '- 审批权限: ' + (step.step11_verifyPermissions.canApprove ? '✅' : '❌') + '\n';
        if (step.step11_verifyPermissions.allowedResources) {
            md += '- 允许资源: ' + step.step11_verifyPermissions.allowedResources.join(', ') + '\n';
        }
        if (step.step11_verifyPermissions.deniedResources) {
            md += '- 拒绝资源: ' + step.step11_verifyPermissions.deniedResources.join(', ') + '\n';
        }
        md += '\n';
        // UI 元素状态
        md += '#### UI 元素状态\n\n';
        md += '| 选择器 | 可见 | 可用 |\n';
        md += '|--------|------|------|\n';
        for (const el of step.step13_verifyUIElements.elements) {
            md += '| `' + el.selector + '` | ' + (el.visible ? '✅' : '❌') + ' | ' + (el.enabled ? '✅' : '❌') + ' |\n';
        }
        md += '\n';
        // 业务上下文
        md += '#### 业务上下文\n\n';
        if (step.step15_verifyBusinessContext.businessEntity) {
            md += '- 业务实体: ' + step.step15_verifyBusinessContext.businessEntity + '\n';
        }
        if (step.step15_verifyBusinessContext.currentState) {
            md += '- 当前状态: ' + step.step15_verifyBusinessContext.currentState + '\n';
        }
        md += '- 可用操作: ' + step.step15_verifyBusinessContext.availableActions.join(', ') + '\n';
        md += '- 可继续: ' + (step.step15_verifyBusinessContext.canProceed ? '✅' : '❌') + '\n\n';
        md += '</details>\n\n';
        return md;
    }
    renderExpectedResults(tc) {
        let md = '## 预期结果\n\n';
        // 预期业务状态
        if (tc.expectedBusinessState && tc.expectedBusinessState.length > 0) {
            md += '### 预期业务状态\n\n';
            md += '| 状态键 | 状态值 | 说明 |\n';
            md += '|--------|--------|------|\n';
            for (const state of tc.expectedBusinessState) {
                const value = state.stateValue === PENDING_CONFIRMATION_MARKER
                    ? '⚠️ `PENDING_CONFIRMATION`'
                    : '`' + state.stateValue + '`';
                md += '| `' + state.stateKey + '` | ' + value + ' | ' + (state.description || '-') + ' |\n';
            }
            md += '\n';
        }
        // 预期流程状态
        if (tc.expectedFlowState) {
            md += '### 预期流程状态\n\n';
            if (tc.expectedFlowState.nodeId) {
                md += '- 节点ID: `' + tc.expectedFlowState.nodeId + '`\n';
            }
            if (tc.expectedFlowState.nodeName) {
                md += '- 节点名称: ' + tc.expectedFlowState.nodeName + '\n';
            }
            md += '- 状态: ' + (this.labels.flowStatus[tc.expectedFlowState.status] || tc.expectedFlowState.status) + '\n';
            if (tc.expectedFlowState.timestamp) {
                md += '- 时间: ' + tc.expectedFlowState.timestamp + '\n';
            }
            md += '\n';
        }
        // 预期审批历史
        if (tc.expectedApprovalHistory && tc.expectedApprovalHistory.length > 0) {
            md += '### 预期审批历史\n\n';
            md += '| 审批人 | 操作 | 节点 | 时间 | 意见 |\n';
            md += '|--------|------|------|------|------|\n';
            for (const history of tc.expectedApprovalHistory) {
                const actionLabel = history.action === 'approved' ? '✅ 通过' :
                    history.action === 'rejected' ? '❌ 拒绝' :
                        history.action === 'returned' ? '↩️ 退回' :
                            history.action === 'transferred' ? '🔄 转交' :
                                history.action === 'delegated' ? '👤 委托' : history.action;
                md += '| ' + history.approver + ' | ' + actionLabel + ' | ' + (history.nodeId || '-') + ' | ' + (history.timestamp || '-') + ' | ' + (history.comments || '-') + ' |\n';
            }
            md += '\n';
        }
        // 预期流程后状态
        if (tc.expectedPostFlow) {
            md += '### 预期流程后状态\n\n';
            md += '- 流程状态: ' + (this.labels.postFlowStatus[tc.expectedPostFlow.flowStatus] || tc.expectedPostFlow.flowStatus) + '\n';
            md += '- 最终状态: ' + tc.expectedPostFlow.finalState + '\n';
            if (tc.expectedPostFlow.downstreamEffects && tc.expectedPostFlow.downstreamEffects.length > 0) {
                md += '\n**下游影响**:\n\n';
                for (const effect of tc.expectedPostFlow.downstreamEffects) {
                    md += '- 类型: ' + effect.effectType + '\n';
                    if (effect.targetSystem) {
                        md += '  目标系统: ' + effect.targetSystem + '\n';
                    }
                    md += '  详情: `' + JSON.stringify(effect.details) + '`\n';
                }
            }
            md += '\n';
        }
        // 工作流节点状态
        if (tc.workflowNodeStatus && tc.workflowNodeStatus.length > 0) {
            md += '### 工作流节点状态\n\n';
            md += '| 节点ID | 节点名称 | 状态 | 进入时间 | 完成时间 | 处理人 |\n';
            md += '|--------|----------|------|----------|----------|--------|\n';
            for (const node of tc.workflowNodeStatus) {
                const statusLabel = this.labels.workflowStatus[node.status] || node.status;
                const statusIcon = node.status === 'completed' ? '✅' :
                    node.status === 'in_progress' ? '🔄' :
                        node.status === 'failed' ? '❌' :
                            node.status === 'skipped' ? '⏭️' : '⏳';
                md += '| ' + node.nodeId + ' | ' + node.nodeName + ' | ' + statusIcon + ' ' + statusLabel + ' | ' + (node.enteredAt || '-') + ' | ' + (node.completedAt || '-') + ' | ' + (node.assignee || '-') + ' |\n';
            }
            md += '\n';
        }
        // 失败终止状态
        if (tc.failureTerminalState) {
            md += '### 失败终止状态\n\n';
            const terminalLabels = {
                'cancelled': '已取消',
                'rejected': '已拒绝',
                'withdrawn': '已撤回',
                'expired': '已过期',
                'error': '错误'
            };
            md += '当测试失败时，预期终止状态为: **' + (terminalLabels[tc.failureTerminalState] || tc.failureTerminalState) + '**\n\n';
        }
        return md;
    }
    renderAccountSwitchTimeline(tc) {
        const accountSwitchSteps = tc.steps.filter(s => 'type' in s && s.type === 'ACCOUNT_SWITCH');
        if (accountSwitchSteps.length === 0) {
            return '';
        }
        let md = '## 账号切换时间线\n\n';
        md += '```mermaid\n';
        md += 'gantt\n';
        md += '    title 账号切换序列\n';
        md += '    dateFormat X\n';
        md += '    axisFormat %s\n\n';
        for (let i = 0; i < accountSwitchSteps.length; i++) {
            const step = accountSwitchSteps[i];
            const duration = 15;
            const start = i * 20;
            md += '    section ' + step.stepId + '\n';
            md += '    ' + step.fromAccount + ' -> ' + step.toAccount + ' :' + start + ', ' + duration + '\n';
        }
        md += '```\n\n';
        // 账号切换摘要表
        md += '| # | 步骤ID | 从 | 到 | 时间戳 | 上下文保留 |\n';
        md += '|---|--------|---|----|--------|------------|\n';
        for (let i = 0; i < accountSwitchSteps.length; i++) {
            const step = accountSwitchSteps[i];
            md += '| ' + (i + 1) + ' | `' + step.stepId + '` | `' + step.fromAccount + '` | `' + step.toAccount + '` | ' + step.step14_recordSessionMapping.switchTimestamp + ' | ' + (step.step14_recordSessionMapping.contextPreserved ? '✅' : '❌') + ' |\n';
        }
        md += '\n';
        return md;
    }
    renderDataCleanup(tc) {
        let md = '## 数据清理策略\n\n';
        if (!tc.dataCleanupStrategy) {
            md += '*未配置数据清理策略*\n\n';
            return md;
        }
        const strategy = tc.dataCleanupStrategy;
        md += '**启用状态**: ' + (strategy.enabled ? '✅ 是' : '❌ 否') + '\n\n';
        if (strategy.cleanupOrder.length > 0) {
            md += '**清理顺序**:\n\n';
            for (let i = 0; i < strategy.cleanupOrder.length; i++) {
                const order = strategy.cleanupOrder[i];
                const orderLabels = {
                    'database': '🗄️ 数据库',
                    'file_storage': '📁 文件存储',
                    'cache': '💾 缓存',
                    'external_systems': '🌐 外部系统',
                    'audit_logs': '📝 审计日志'
                };
                md += (i + 1) + '. ' + (orderLabels[order] || order) + '\n';
            }
            md += '\n';
        }
        if (strategy.cleanupActions.length > 0) {
            md += '**清理操作**:\n\n';
            md += '| 目标类型 | 标识符 | 查询条件 |\n';
            md += '|----------|--------|----------|\n';
            for (const action of strategy.cleanupActions) {
                const targetLabels = {
                    'table': '表',
                    'file': '文件',
                    'cache_key': '缓存键',
                    'external_api': '外部API'
                };
                const query = action.query ? JSON.stringify(action.query) : '-';
                md += '| ' + (targetLabels[action.target] || action.target) + ' | `' + action.identifier + '` | `' + query + '` |\n';
            }
            md += '\n';
        }
        md += '**验证清理**: ' + (strategy.verifyCleanup ? '✅ 是' : '❌ 否') + '\n\n';
        return md;
    }
    renderFooter(tc) {
        let md = '---\n\n';
        md += '*本文档由 FlowTrace 自动生成 | 案例ID: `' + tc.id + '` | 生成时间: ' + new Date().toLocaleString('zh-CN') + '*\n';
        return md;
    }
    getNodeShape(type) {
        const shapes = {
            'START': '(',
            'END': ')',
            'TASK': '[',
            'APPROVAL': '[',
            'CONDITION': '{',
            'PARALLEL': '{',
            'SERVICE_TASK': '['
        };
        return shapes[type] || '[';
    }
    operatorToSql(op) {
        const operators = {
            'eq': '=',
            'ne': '!=',
            'gt': '>',
            'lt': '<',
            'gte': '>=',
            'lte': '<=',
            'in': 'IN',
            'contains': 'LIKE',
            'exists': 'IS NOT NULL'
        };
        return operators[op] || op;
    }
    operatorLabel(op) {
        const labels = {
            'eq': '等于',
            'ne': '不等于',
            'gt': '大于',
            'lt': '小于',
            'gte': '大于等于',
            'lte': '小于等于',
            'in': '在...中',
            'contains': '包含',
            'exists': '存在'
        };
        return labels[op] || op;
    }
    formatValue(value) {
        if (value === null)
            return 'NULL';
        if (value === undefined)
            return 'NULL';
        if (typeof value === 'string')
            return "'" + value + "'";
        if (typeof value === 'number')
            return String(value);
        if (typeof value === 'boolean')
            return String(value);
        if (Array.isArray(value))
            return '(' + value.map(v => this.formatValue(v)).join(', ') + ')';
        return "'" + JSON.stringify(value) + "'";
    }
    calculateStats(testCases) {
        const stats = {
            total: testCases.length,
            executable: 0,
            pendingConfirmation: 0,
            p0: 0,
            p1: 0,
            byType: {},
            bySeverity: {}
        };
        for (const tc of testCases) {
            if (tc.executable)
                stats.executable++;
            if (tc.sourceStatus === 'PENDING_CONFIRMATION')
                stats.pendingConfirmation++;
            if (tc.severity === 'P0')
                stats.p0++;
            if (tc.severity === 'P1')
                stats.p1++;
            stats.byType[tc.type] = (stats.byType[tc.type] || 0) + 1;
            if (tc.severity) {
                stats.bySeverity[tc.severity] = (stats.bySeverity[tc.severity] || 0) + 1;
            }
        }
        return stats;
    }
}
// ============================================================
// Factory Function
// ============================================================
export function createTestCaseMarkdownRenderer(options) {
    return new TestCaseMarkdownRenderer(options);
}
//# sourceMappingURL=test-case-markdown-renderer.js.map