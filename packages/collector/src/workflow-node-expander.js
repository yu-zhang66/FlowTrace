/**
 * Workflow Node Expander
 *
 * 从数据库动态读取真实审批节点，展开为可执行的测试步骤。
 * 支持 SETTLE_WORKFLOW、SETTLE_WORKFLOW_STEP、SETTLE_WORKFLOW_STEP_USER 表查询。
 */
import { z } from 'zod';
// ============================================================
// Zod Schemas for Validation
// ============================================================
const DatabaseConnectionConfigSchema = z.object({
    host: z.string().min(1),
    port: z.number().positive(),
    database: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
    type: z.enum(['oracle', 'postgresql', 'mysql'])
});
const WorkflowNodeExpanderOptionsSchema = z.object({
    processCode: z.string().min(1),
    databaseConnection: DatabaseConnectionConfigSchema,
    readOnlyMode: z.boolean().optional()
});
const StepEvidenceSchema = z.object({
    type: z.enum(['database_schema', 'api_endpoint', 'code_snippet', 'runtime_trace']),
    sourceType: z.enum(['database', 'source_code', 'api_documentation', 'runtime_trace']),
    tableName: z.string().optional(),
    fieldNames: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1),
    confirmed: z.boolean(),
    description: z.string().optional()
});
const ExpandedStepSchema = z.object({
    stepId: z.string().min(1),
    name: z.string().min(1),
    accountRef: z.string().optional(),
    accountType: z.enum(['INITIATOR', 'APPROVER', 'COUNTER_SIGNER', 'FINAL_APPROVER']),
    operation: z.enum(['submit', 'approve', 'reject', 'return', 'transfer']),
    executable: z.boolean(),
    sourceStatus: z.enum(['CONFIRMED', 'PENDING_CONFIRMATION', 'UNCONFIRMED']),
    evidence: z.array(StepEvidenceSchema),
    originalStep: z.any().optional(),
    nextStepId: z.string().optional(),
    configurations: z.record(z.unknown())
});
/**
 * 测试案例步骤 Schema（扩展版本，包含工作流特定字段）
 */
export const WorkflowTestCaseStepSchema = z.object({
    /** 步骤 ID */
    stepId: z.string().min(1),
    /** 步骤名称 */
    name: z.string().min(1),
    /** 账号引用 */
    accountRef: z.string().optional(),
    /** 账号类型 */
    accountType: z.enum(['INITIATOR', 'APPROVER', 'COUNTER_SIGNER', 'FINAL_APPROVER', 'ADMIN', 'VIEWER', 'AUDITOR']).optional(),
    /** 是否需要登录 */
    loginRequired: z.boolean().default(false),
    /** 菜单路径 */
    menu: z.array(z.string()).optional(),
    /** 页面或 API 路径 */
    pageOrApi: z.object({
        type: z.enum(['page', 'api']),
        path: z.string(),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional()
    }).optional(),
    /** 操作类型 */
    operation: z.enum([
        'view', 'create', 'update', 'delete', 'submit', 'approve', 'reject',
        'return', 'withdraw', 'transfer', 'delegate', 'upload', 'download',
        'search', 'filter', 'export', 'import'
    ]),
    /** 输入数据 */
    input: z.record(z.unknown()).optional(),
    /** 输入上下文 */
    contextIn: z.record(z.unknown()).optional(),
    /** 输出上下文 */
    contextOut: z.record(z.unknown()).optional(),
    /** 预期 UI 结果 */
    expectedUiResult: z.object({
        pageLoaded: z.boolean().optional(),
        urlPattern: z.string().optional(),
        elements: z.array(z.object({
            selector: z.string(),
            shouldExist: z.boolean(),
            shouldBeVisible: z.boolean().optional(),
            shouldHaveValue: z.unknown().optional()
        })).optional(),
        messages: z.array(z.object({
            type: z.enum(['success', 'error', 'warning', 'info']),
            contains: z.string()
        })).optional()
    }).optional(),
    /** 预期 API 结果 */
    expectedApiResult: z.object({
        statusCode: z.number(),
        responseContains: z.record(z.unknown()).optional(),
        responseTime: z.object({
            max: z.number(),
            unit: z.enum(['ms', 's'])
        }).optional()
    }).optional(),
    /** 数据库断言 */
    databaseAssertions: z.array(z.object({
        tableName: z.string(),
        query: z.record(z.unknown()),
        assertions: z.array(z.object({
            field: z.string(),
            operator: z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'in', 'contains', 'exists']),
            value: z.unknown()
        }))
    })).optional(),
    /** 失败策略 */
    failurePolicy: z.enum(['STOP', 'SKIP', 'RETRY', 'FALLBACK', 'ABORT']).default('STOP'),
    /** 下一个步骤 ID */
    nextStep: z.string().optional(),
    /** 账号切换信息 */
    accountSwitch: z.object({
        targetAccount: z.string(),
        reason: z.string().optional()
    }).optional(),
    /** 是否可执行（工作流扩展） */
    executable: z.boolean().default(true),
    /** 来源状态（工作流扩展） */
    sourceStatus: z.enum(['AUTO_GENERATED', 'MANUALLY_CREATED', 'DERIVED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'UNCONFIRMED']),
    /** 证据类型列表（工作流扩展） */
    evidence: z.array(z.enum([
        'screenshot', 'api_request', 'api_response', 'database_query',
        'database_result', 'browser_console', 'network_trace', 'log_entry',
        'file_upload', 'file_download', 'email_notification', 'sms_notification'
    ])).optional(),
    /** 扩展配置（工作流扩展） */
    configurations: z.record(z.unknown()).optional()
});
/**
 * WorkflowNodeExpander 类
 *
 * 从数据库动态读取真实审批节点，展开为可执行的测试步骤。
 */
export class WorkflowNodeExpander {
    options;
    connection = null;
    isConnected = false;
    constructor(options) {
        const validated = WorkflowNodeExpanderOptionsSchema.parse(options);
        this.options = validated;
    }
    /**
     * 检查数据库连接是否可用
     */
    async checkConnection() {
        try {
            await this.connect();
            return { available: true };
        }
        catch (error) {
            return {
                available: false,
                reason: error instanceof Error ? error.message : String(error)
            };
        }
    }
    /**
     * 连接到数据库
     */
    async connect() {
        if (this.isConnected && this.connection) {
            return;
        }
        const config = this.options.databaseConnection;
        const type = config.type;
        try {
            if (type === 'oracle') {
                const oracledb = await import('oracledb');
                this.connection = await oracledb.getConnection({
                    user: config.username,
                    password: config.password,
                    connectString: `${config.host}:${config.port}/${config.database}`
                });
            }
            else if (type === 'postgresql') {
                const { Client } = await import('pg');
                const client = new Client({
                    host: config.host,
                    port: config.port,
                    database: config.database,
                    user: config.username,
                    password: config.password
                });
                await client.connect();
                this.connection = client;
            }
            else if (type === 'mysql') {
                const mysql = await import('mysql2/promise');
                this.connection = await mysql.createConnection({
                    host: config.host,
                    port: config.port,
                    database: config.database,
                    user: config.username,
                    password: config.password
                });
            }
            this.isConnected = true;
        }
        catch (error) {
            this.isConnected = false;
            this.connection = null;
            throw new Error(`数据库连接失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * 关闭数据库连接
     */
    async disconnect() {
        if (this.connection) {
            try {
                if (typeof this.connection.close === 'function') {
                    await this.connection.close();
                }
                else if (typeof this.connection.end === 'function') {
                    await this.connection.end();
                }
            }
            catch {
                // 忽略关闭错误
            }
            this.connection = null;
        }
        this.isConnected = false;
    }
    /**
     * 执行数据库查询
     */
    async executeQuery(query) {
        if (!this.connection) {
            await this.connect();
        }
        try {
            if (this.options.databaseConnection.type === 'oracle') {
                const result = await this.connection.execute(query);
                return result.rows || [];
            }
            else {
                const result = await this.connection.query(query);
                return result.rows || [];
            }
        }
        catch (error) {
            console.error(`[WorkflowNodeExpander] Query failed: ${error}`);
            throw error;
        }
    }
    /**
     * 从数据库加载流程配置
     */
    async loadWorkflowConfig() {
        const timestamp = new Date().toISOString();
        const processCode = this.options.processCode;
        try {
            await this.connect();
            // 1. 查询 SETTLE_WORKFLOW 获取流程基本信息
            const workflowRows = await this.queryWorkflow(processCode);
            if (workflowRows.length === 0) {
                console.warn(`[WorkflowNodeExpander] Workflow not found: ${processCode}`);
                return this.createPlaceholderWorkflowConfig(processCode, timestamp);
            }
            const workflow = workflowRows[0];
            // 2. 查询 SETTLE_WORKFLOW_STEP 获取所有步骤
            const stepRows = await this.queryWorkflowSteps(workflow.WORKFLOW_ID);
            // 3. 查询 SETTLE_WORKFLOW_STEP_USER 获取步骤人员配置
            const stepUserRows = await this.queryStepUsers(workflow.WORKFLOW_ID);
            // 构建步骤列表
            const steps = this.buildWorkflowSteps(stepRows, stepUserRows);
            const config = {
                workflowId: workflow.WORKFLOW_ID,
                processCode: workflow.WORKFLOW_CODE || processCode,
                workflowName: workflow.WORKFLOW_NAME || processCode,
                version: workflow.VERSION || '1.0',
                status: workflow.STATUS || 'ACTIVE',
                steps,
                collectedAt: timestamp,
                source: 'database'
            };
            return config;
        }
        catch (error) {
            console.error(`[WorkflowNodeExpander] Failed to load workflow config: ${error}`);
            return this.createPlaceholderWorkflowConfig(processCode, timestamp);
        }
        finally {
            if (this.options.readOnlyMode !== false) {
                await this.disconnect();
            }
        }
    }
    /**
     * 查询流程基本信息
     */
    async queryWorkflow(processCode) {
        const type = this.options.databaseConnection.type;
        let query;
        if (type === 'oracle') {
            query = `
        SELECT 
          WORKFLOW_ID,
          WORKFLOW_CODE,
          WORKFLOW_NAME,
          VERSION,
          STATUS
        FROM SETTLE_WORKFLOW
        WHERE WORKFLOW_CODE = '${processCode}'
          AND STATUS = 'ACTIVE'
      `;
        }
        else if (type === 'postgresql') {
            query = `
        SELECT 
          workflow_id as workflow_id,
          workflow_code as workflow_code,
          workflow_name as workflow_name,
          version as version,
          status as status
        FROM settle_workflow
        WHERE workflow_code = '${processCode}'
          AND status = 'ACTIVE'
      `;
        }
        else {
            query = `
        SELECT 
          WORKFLOW_ID,
          WORKFLOW_CODE,
          WORKFLOW_NAME,
          VERSION,
          STATUS
        FROM SETTLE_WORKFLOW
        WHERE WORKFLOW_CODE = '${processCode}'
          AND STATUS = 'ACTIVE'
      `;
        }
        return this.executeQuery(query);
    }
    /**
     * 查询流程步骤
     */
    async queryWorkflowSteps(workflowId) {
        const type = this.options.databaseConnection.type;
        let query;
        if (type === 'oracle') {
            query = `
        SELECT 
          STEP_ID,
          STEP_CODE,
          STEP_NAME,
          APPROVE_TYPE,
          SEQUENCE,
          STEP_TYPE,
          COSIGN_COUNT,
          COSIGN_PASS_TYPE,
          COSIGN_REQUIRED_COUNT,
          TRANSFER_RULE,
          RETURN_RULE,
          RETURN_TO_STEP,
          TIME_LIMIT,
          CONFIG_JSON
        FROM SETTLE_WORKFLOW_STEP
        WHERE WORKFLOW_ID = '${workflowId}'
        ORDER BY SEQUENCE ASC
      `;
        }
        else if (type === 'postgresql') {
            query = `
        SELECT 
          step_id as step_id,
          step_code as step_code,
          step_name as step_name,
          approve_type as approve_type,
          sequence as sequence,
          step_type as step_type,
          cosign_count as cosign_count,
          cosign_pass_type as cosign_pass_type,
          cosign_required_count as cosign_required_count,
          transfer_rule as transfer_rule,
          return_rule as return_rule,
          return_to_step as return_to_step,
          time_limit as time_limit,
          config_json as config_json
        FROM settle_workflow_step
        WHERE workflow_id = '${workflowId}'
        ORDER BY sequence ASC
      `;
        }
        else {
            query = `
        SELECT 
          STEP_ID,
          STEP_CODE,
          STEP_NAME,
          APPROVE_TYPE,
          SEQUENCE,
          STEP_TYPE,
          COSIGN_COUNT,
          COSIGN_PASS_TYPE,
          COSIGN_REQUIRED_COUNT,
          TRANSFER_RULE,
          RETURN_RULE,
          RETURN_TO_STEP,
          TIME_LIMIT,
          CONFIG_JSON
        FROM SETTLE_WORKFLOW_STEP
        WHERE WORKFLOW_ID = '${workflowId}'
        ORDER BY SEQUENCE ASC
      `;
        }
        return this.executeQuery(query);
    }
    /**
     * 查询步骤人员配置
     */
    async queryStepUsers(workflowId) {
        const type = this.options.databaseConnection.type;
        let query;
        if (type === 'oracle') {
            query = `
        SELECT 
          wsu.APPROVER_ID,
          wsu.APPROVER_CODE,
          wsu.APPROVER_NAME,
          wsu.APPROVER_TYPE,
          wsu.APPROVE_RULE,
          wsu.IS_PRIMARY,
          wsu.STEP_ID
        FROM SETTLE_WORKFLOW_STEP_USER wsu
        WHERE wsu.WORKFLOW_ID = '${workflowId}'
        ORDER BY wsu.STEP_ID, wsu.IS_PRIMARY DESC
      `;
        }
        else if (type === 'postgresql') {
            query = `
        SELECT 
          wsu.approver_id as approver_id,
          wsu.approver_code as approver_code,
          wsu.approver_name as approver_name,
          wsu.approver_type as approver_type,
          wsu.approve_rule as approve_rule,
          wsu.is_primary as is_primary,
          wsu.step_id as step_id
        FROM settle_workflow_step_user wsu
        WHERE wsu.workflow_id = '${workflowId}'
        ORDER BY wsu.step_id, wsu.is_primary DESC
      `;
        }
        else {
            query = `
        SELECT 
          wsu.APPROVER_ID,
          wsu.APPROVER_CODE,
          wsu.APPROVER_NAME,
          wsu.APPROVER_TYPE,
          wsu.APPROVE_RULE,
          wsu.IS_PRIMARY,
          wsu.STEP_ID
        FROM SETTLE_WORKFLOW_STEP_USER wsu
        WHERE wsu.WORKFLOW_ID = '${workflowId}'
        ORDER BY wsu.STEP_ID, wsu.IS_PRIMARY DESC
      `;
        }
        return this.executeQuery(query);
    }
    /**
     * 构建工作流步骤列表
     */
    buildWorkflowSteps(stepRows, stepUserRows) {
        // 按步骤 ID 分组审批人
        const approversByStep = new Map();
        // 标准化字段名（处理 Oracle 大写和 PostgreSQL 小写）
        for (const userRow of stepUserRows) {
            const stepId = userRow.STEP_ID || userRow.step_id || '';
            if (!stepId)
                continue;
            const isPrimaryValue = userRow.IS_PRIMARY || userRow.is_primary;
            const isPrimary = isPrimaryValue === 'Y' || isPrimaryValue === '1' || isPrimaryValue === 1 || isPrimaryValue === true;
            const approver = {
                approverId: userRow.APPROVER_ID || userRow.approver_id || '',
                approverCode: userRow.APPROVER_CODE || userRow.approver_code || '',
                approverName: userRow.APPROVER_NAME || userRow.approver_name || '',
                approverType: this.mapApproverType(userRow.APPROVER_TYPE || userRow.approver_type),
                approveRule: userRow.APPROVE_RULE || userRow.approve_rule,
                isPrimary
            };
            if (!approversByStep.has(stepId)) {
                approversByStep.set(stepId, []);
            }
            approversByStep.get(stepId).push(approver);
        }
        // 构建步骤列表
        return stepRows.map(row => {
            // 标准化字段名
            const approveType = this.mapApproveType(row.APPROVE_TYPE || row.approve_type);
            const stepId = row.STEP_ID || row.step_id || '';
            const stepCode = row.STEP_CODE || row.step_code || '';
            const stepName = row.STEP_NAME || row.step_name || '';
            const sequence = row.SEQUENCE || row.sequence || 0;
            const stepType = row.STEP_TYPE || row.step_type || 'APPROVAL';
            const cosignCount = row.COSIGN_COUNT || row.cosign_count;
            const cosignPassType = row.COSIGN_PASS_TYPE || row.cosign_pass_type;
            const cosignRequiredCount = row.COSIGN_REQUIRED_COUNT || row.cosign_required_count;
            const transferRule = row.TRANSFER_RULE || row.transfer_rule;
            const returnRule = row.RETURN_RULE || row.return_rule;
            const returnToStep = row.RETURN_TO_STEP || row.return_to_step;
            const timeLimit = row.TIME_LIMIT || row.time_limit;
            const configJson = row.CONFIG_JSON || row.config_json;
            let configurations = {};
            if (configJson) {
                try {
                    configurations = JSON.parse(configJson);
                }
                catch {
                    configurations = {};
                }
            }
            return {
                stepId: stepId || `STEP_${sequence}`,
                stepCode: stepCode || `STEP_${sequence}`,
                stepName: stepName || `[步骤 ${sequence}]`,
                approveType,
                sequence,
                stepType,
                cosignCount: approveType === 'COSIGN' ? cosignCount : undefined,
                cosignPassType: approveType === 'COSIGN' ? this.mapCosignPassType(cosignPassType) : undefined,
                cosignRequiredCount: approveType === 'COSIGN' ? cosignRequiredCount : undefined,
                transferRule,
                returnRule,
                returnToStep,
                timeLimit,
                configurations,
                approvers: approversByStep.get(stepId) || []
            };
        });
    }
    /**
     * 映射审批类型
     */
    mapApproveType(type) {
        if (!type)
            return 'NORMAL';
        const upper = type.toUpperCase();
        if (upper === 'COSIGN')
            return 'COSIGN';
        if (upper === 'TRANSFER')
            return 'TRANSFER';
        if (upper === 'RETURN')
            return 'RETURN';
        return 'NORMAL';
    }
    /**
     * 映射审批人类型
     */
    mapApproverType(type) {
        if (!type)
            return 'USER';
        const upper = type.toUpperCase();
        if (upper === 'ROLE')
            return 'ROLE';
        if (upper === 'DEPARTMENT')
            return 'DEPARTMENT';
        if (upper === 'DYNAMIC')
            return 'DYNAMIC';
        return 'USER';
    }
    /**
     * 映射会签通过方式
     */
    mapCosignPassType(type) {
        if (!type)
            return 'ALL';
        const upper = type.toUpperCase();
        if (upper === 'ANY')
            return 'ANY';
        if (upper === 'COUNT')
            return 'COUNT';
        return 'ALL';
    }
    /**
     * 展开步骤为可执行步骤
     */
    expandSteps(workflowConfig) {
        const expandedSteps = [];
        const steps = workflowConfig.steps;
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const isLastStep = i === steps.length - 1;
            const nextStep = isLastStep ? undefined : steps[i + 1];
            if (step.approveType === 'COSIGN') {
                // 会签节点：拆分为多个审批步骤
                const cosignSteps = this.expandCosignStep(step, nextStep?.stepId);
                expandedSteps.push(...cosignSteps);
            }
            else if (step.approveType === 'TRANSFER') {
                // 转交流程节点
                const transferStep = this.createTransferStep(step, nextStep?.stepId);
                expandedSteps.push(transferStep);
            }
            else if (step.approveType === 'RETURN') {
                // 退回节点
                const returnStep = this.createReturnStep(step, nextStep?.stepId);
                expandedSteps.push(returnStep);
            }
            else {
                // 普通审批节点
                const normalStep = this.createNormalStep(step, nextStep?.stepId);
                expandedSteps.push(normalStep);
            }
        }
        // 验证展开后的步骤
        for (const expanded of expandedSteps) {
            ExpandedStepSchema.parse(expanded);
        }
        return expandedSteps;
    }
    /**
     * 展开会签步骤
     */
    expandCosignStep(step, nextStepId) {
        const cosignCount = step.cosignCount || step.approvers.length || 1;
        const passType = step.cosignPassType || 'ALL';
        const steps = [];
        for (let i = 0; i < cosignCount; i++) {
            const approver = step.approvers[i];
            const isLastSigner = i === cosignCount - 1;
            steps.push({
                stepId: `${step.stepId}_COSIGN_${i + 1}`,
                name: `${step.stepName} - 会签人${i + 1}`,
                accountRef: approver?.approverCode,
                accountType: isLastSigner && passType !== 'ALL' ? 'FINAL_APPROVER' : 'COUNTER_SIGNER',
                operation: 'approve',
                executable: !!approver,
                sourceStatus: approver ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
                evidence: this.createDatabaseEvidence('SETTLE_WORKFLOW_STEP', [
                    'STEP_ID', 'STEP_NAME', 'APPROVE_TYPE', 'COSIGN_COUNT', 'COSIGN_PASS_TYPE'
                ], !!approver),
                originalStep: step,
                nextStepId: isLastSigner ? nextStepId : `${step.stepId}_COSIGN_${i + 2}`,
                configurations: {
                    ...step.configurations,
                    cosignIndex: i + 1,
                    cosignTotal: cosignCount,
                    cosignPassType: passType,
                    requiredCount: step.cosignRequiredCount,
                    approveRule: approver?.approveRule
                }
            });
        }
        return steps;
    }
    /**
     * 创建转交流程步骤
     */
    createTransferStep(step, nextStepId) {
        const approver = step.approvers.find(a => a.isPrimary) || step.approvers[0];
        return {
            stepId: `${step.stepId}_TRANSFER`,
            name: `${step.stepName} - 转交`,
            accountRef: approver?.approverCode,
            accountType: 'APPROVER',
            operation: 'transfer',
            executable: !!approver,
            sourceStatus: approver ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
            evidence: this.createDatabaseEvidence('SETTLE_WORKFLOW_STEP', [
                'STEP_ID', 'STEP_NAME', 'APPROVE_TYPE', 'TRANSFER_RULE'
            ], !!approver),
            originalStep: step,
            nextStepId,
            configurations: {
                ...step.configurations,
                transferRule: step.transferRule
            }
        };
    }
    /**
     * 创建退回步骤
     */
    createReturnStep(step, nextStepId) {
        const approver = step.approvers.find(a => a.isPrimary) || step.approvers[0];
        return {
            stepId: `${step.stepId}_RETURN`,
            name: `${step.stepName} - 退回`,
            accountRef: approver?.approverCode,
            accountType: 'APPROVER',
            operation: 'return',
            executable: !!approver,
            sourceStatus: approver ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
            evidence: this.createDatabaseEvidence('SETTLE_WORKFLOW_STEP', [
                'STEP_ID', 'STEP_NAME', 'APPROVE_TYPE', 'RETURN_RULE', 'RETURN_TO_STEP'
            ], !!approver),
            originalStep: step,
            nextStepId,
            configurations: {
                ...step.configurations,
                returnRule: step.returnRule,
                returnToStep: step.returnToStep
            }
        };
    }
    /**
     * 创建普通审批步骤
     */
    createNormalStep(step, nextStepId) {
        const approver = step.approvers.find(a => a.isPrimary) || step.approvers[0];
        const isLastStep = !nextStepId;
        return {
            stepId: step.stepId,
            name: step.stepName,
            accountRef: approver?.approverCode,
            accountType: isLastStep ? 'FINAL_APPROVER' : 'APPROVER',
            operation: 'approve',
            executable: !!approver,
            sourceStatus: approver ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
            evidence: this.createDatabaseEvidence('SETTLE_WORKFLOW_STEP', [
                'STEP_ID', 'STEP_NAME', 'APPROVE_TYPE', 'SEQUENCE', 'TIME_LIMIT'
            ], !!approver),
            originalStep: step,
            nextStepId,
            configurations: {
                ...step.configurations,
                timeLimit: step.timeLimit,
                approveRule: approver?.approveRule
            }
        };
    }
    /**
     * 创建数据库证据
     */
    createDatabaseEvidence(tableName, fieldNames, confirmed) {
        return [{
                type: 'database_schema',
                sourceType: 'database',
                tableName,
                fieldNames,
                confidence: confirmed ? 0.95 : 0,
                confirmed,
                description: `从 ${tableName} 表读取的字段: ${fieldNames.join(', ')}`
            }];
    }
    /**
     * 生成动态占位符
     *
     * 当无法连接数据库或无法读取真实节点时使用
     */
    generateDynamicPlaceholders() {
        const processCode = this.options.processCode;
        const placeholders = [];
        const defaultStepCount = 5; // 默认假设有 5 个步骤
        for (let i = 1; i <= defaultStepCount; i++) {
            const isFirst = i === 1;
            const isLast = i === defaultStepCount;
            const step = {
                stepId: `STEP_${i}`,
                name: `[节点名称待确认]`,
                accountType: isFirst ? 'INITIATOR' : (isLast ? 'FINAL_APPROVER' : 'APPROVER'),
                loginRequired: true,
                operation: isFirst ? 'submit' : 'approve',
                executable: false,
                sourceStatus: 'PENDING_CONFIRMATION',
                evidence: ['database_query'],
                configurations: {
                    processCode,
                    pendingConfirmation: true,
                    reason: '无法连接数据库，节点信息待确认'
                },
                expectedUiResult: {
                    pageLoaded: true,
                    elements: []
                },
                expectedApiResult: {
                    statusCode: 200
                },
                failurePolicy: 'STOP'
            };
            // 添加下一个步骤引用
            if (i < defaultStepCount) {
                step.nextStep = `STEP_${i + 1}`;
            }
            // 验证步骤
            WorkflowTestCaseStepSchema.parse(step);
            placeholders.push(step);
        }
        return placeholders;
    }
    /**
     * 创建占位符流程配置
     */
    createPlaceholderWorkflowConfig(processCode, timestamp) {
        const placeholders = this.generateDynamicPlaceholders();
        return {
            workflowId: `PLACEHOLDER_${processCode}`,
            processCode,
            workflowName: `[流程名称待确认]`,
            version: '1.0',
            status: 'PENDING_CONFIRMATION',
            steps: placeholders.map((step, index) => ({
                stepId: step.stepId,
                stepCode: step.stepId,
                stepName: step.name,
                approveType: 'NORMAL',
                sequence: index + 1,
                stepType: 'APPROVAL',
                configurations: step.configurations || {},
                approvers: []
            })),
            collectedAt: timestamp,
            source: 'placeholder'
        };
    }
    /**
     * 转换为 TestCaseStep 格式
     */
    toTestCaseSteps(expandedSteps) {
        return expandedSteps.map(step => {
            const testStep = {
                stepId: step.stepId,
                name: step.name,
                accountRef: step.accountRef,
                accountType: step.accountType,
                loginRequired: true,
                operation: step.operation,
                executable: step.executable,
                sourceStatus: step.sourceStatus,
                evidence: step.evidence.map(e => {
                    if (e.type === 'database_schema')
                        return 'database_query';
                    if (e.type === 'api_endpoint')
                        return 'api_request';
                    return 'database_query';
                }),
                configurations: step.configurations,
                expectedUiResult: {
                    pageLoaded: true
                },
                expectedApiResult: {
                    statusCode: 200
                },
                failurePolicy: 'STOP',
                nextStep: step.nextStepId
            };
            WorkflowTestCaseStepSchema.parse(testStep);
            return testStep;
        });
    }
}
// ============================================================
// Factory Functions
// ============================================================
/**
 * 创建 WorkflowNodeExpander 实例
 */
export function createWorkflowNodeExpander(options) {
    return new WorkflowNodeExpander(options);
}
/**
 * 创建占位符测试步骤
 */
export function createPlaceholderSteps(processCode, _stepCount = 5) {
    const expander = new WorkflowNodeExpander({
        processCode,
        databaseConnection: {
            host: '',
            port: 0,
            database: '',
            username: '',
            password: '',
            type: 'oracle'
        }
    });
    return expander.generateDynamicPlaceholders();
}
//# sourceMappingURL=workflow-node-expander.js.map