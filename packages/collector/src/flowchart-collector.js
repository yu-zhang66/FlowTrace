/**
 * Flowchart Collector
 *
 * 从源码和数据库采集流程图证据，生成 FlowchartDocument
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, extname, basename, relative } from 'path';
import { generateCollectorId } from '@flowtrace/core';
import { UNCONFIRMED } from '@flowtrace/core';
/**
 * 融资申请流程节点类型
 */
export const FINANCING_NODES = {
    // 融资信息填写
    FINANCE_INFO: 'finance_info',
    // 合同绑定
    CONTRACT_BINDING: 'contract_binding',
    // 单据选择
    DOCUMENT_SELECTION: 'document_selection',
    // 业务资料上传
    BUSINESS_MATERIALS: 'business_materials',
    // 发起申请
    SUBMIT_APPLICATION: 'submit_application',
    // 上游企业审核
    UPSTREAM_REVIEW: 'upstream_review',
    // 银行审批
    BANK_REVIEW: 'bank_review',
    // 风控复核
    RISK_REVIEW: 'risk_review',
};
/**
 * 融资流程相关类名模式
 */
const FINANCING_CLASS_PATTERNS = [
    'FinanceController',
    'ScfSubmitFlowImpl',
    'FinanceStateEnum',
    'FlowTypeEnum',
    'LoanAfterInfoServiceImpl',
];
/**
 * 检测是否为融资流程相关类
 */
export function isFinancingClass(className) {
    return FINANCING_CLASS_PATTERNS.some(p => className.includes(p));
}
/**
 * FlowchartCollector
 *
 * 从源码和数据库采集流程图证据
 */
export class FlowchartCollector {
    name;
    type = 'source-scanner';
    config;
    sourceRoot = '';
    dbConnected = false;
    dbConnection = null;
    excludeDirs = ['target', 'node_modules', '.git', 'test', 'tests', 'build', 'dist', '.idea', '.vscode'];
    constructor(config) {
        this.name = config.name || 'flowchart-collector';
        this.config = config;
    }
    async initialize(context) {
        this.sourceRoot = this.config.options?.sourceRoot || context.sourceRoot;
        if (!existsSync(this.sourceRoot)) {
            throw new Error(`Source root does not exist: ${this.sourceRoot}`);
        }
        const dbConfig = this.config.options?.databaseConnection;
        if (dbConfig) {
            try {
                this.dbConnection = await this.createDbConnection(dbConfig);
                this.dbConnected = true;
            }
            catch (error) {
                console.log(`[FlowchartCollector] Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
                this.dbConnected = false;
            }
        }
    }
    async collect(context) {
        const facts = [];
        const timestamp = new Date().toISOString();
        const processCode = this.config.options?.processCode || context.processId;
        // 1. 从源码采集
        const sourceResult = await this.scanSource();
        // 2. 从数据库采集
        const dbResult = await this.collectFromDatabase();
        // 3. 构建流程图文档
        const flowchartDoc = this.buildFlowchartDocument(sourceResult, dbResult, processCode, timestamp);
        // 4. 创建证据采集结果
        const evidenceList = this.extractEvidence(flowchartDoc, sourceResult, dbResult, timestamp);
        // 5. 创建流程图事实
        const flowchartFact = this.createFlowchartFact(flowchartDoc, evidenceList, timestamp);
        facts.push(flowchartFact);
        // 6. 为每个节点创建证据事实
        for (const node of flowchartDoc.nodes) {
            const nodeFact = this.createNodeFact(node, flowchartDoc, timestamp);
            if (nodeFact) {
                facts.push(nodeFact);
            }
        }
        console.log(`[FlowchartCollector] Collected ${facts.length} facts (flowchart + nodes)`);
        return facts;
    }
    async checkAvailability(context) {
        const root = this.sourceRoot || context.sourceRoot;
        if (!existsSync(root)) {
            return { available: false, reason: `Source root does not exist: ${root}` };
        }
        return { available: true };
    }
    async cleanup() {
        if (this.dbConnection) {
            try {
                if (typeof this.dbConnection.close === 'function') {
                    await this.dbConnection.close();
                }
            }
            catch {
                // ignore
            }
            this.dbConnection = null;
        }
        this.dbConnected = false;
    }
    /**
     * 扫描源码
     */
    async scanSource() {
        const result = {
            controllers: [],
            services: [],
            mybatisMappers: [],
            vuePages: [],
            enums: []
        };
        // 扫描 Java 文件
        const javaFiles = this.scanFiles(this.sourceRoot, ['.java']);
        for (const file of javaFiles) {
            const relativePath = relative(this.sourceRoot, file);
            // 检测 Controller
            const controllerInfo = this.extractControllerInfo(file, relativePath);
            if (controllerInfo) {
                result.controllers.push(controllerInfo);
            }
            // 检测 Service
            const serviceInfo = this.extractServiceInfo(file, relativePath);
            if (serviceInfo) {
                result.services.push(serviceInfo);
            }
        }
        // 扫描 XML 文件 (MyBatis)
        const xmlFiles = this.scanFiles(this.sourceRoot, ['.xml']);
        for (const file of xmlFiles) {
            const relativePath = relative(this.sourceRoot, file);
            const mapperInfo = this.extractMapperInfo(file, relativePath);
            if (mapperInfo) {
                result.mybatisMappers.push(mapperInfo);
            }
        }
        // 扫描 Vue 文件
        const vueFiles = this.scanFiles(this.sourceRoot, ['.vue']);
        for (const file of vueFiles) {
            const relativePath = relative(this.sourceRoot, file);
            const pageInfo = this.extractVuePageInfo(file, relativePath);
            if (pageInfo) {
                result.vuePages.push(pageInfo);
            }
        }
        // 扫描 Enum 类
        for (const file of javaFiles) {
            const relativePath = relative(this.sourceRoot, file);
            const enumInfo = this.extractEnumInfo(file, relativePath);
            if (enumInfo) {
                result.enums.push(enumInfo);
            }
        }
        return result;
    }
    /**
     * 扫描文件
     */
    scanFiles(dir, extensions, results = []) {
        if (!existsSync(dir)) {
            return results;
        }
        try {
            const entries = readdirSync(dir);
            for (const entry of entries) {
                const fullPath = join(dir, entry);
                try {
                    const stat = statSync(fullPath);
                    if (stat.isDirectory()) {
                        if (this.excludeDirs.includes(entry)) {
                            continue;
                        }
                        this.scanFiles(fullPath, extensions, results);
                    }
                    else if (stat.isFile()) {
                        const ext = extname(entry).toLowerCase();
                        if (extensions.includes(ext)) {
                            results.push(fullPath);
                        }
                    }
                }
                catch {
                    // skip
                }
            }
        }
        catch {
            // skip
        }
        return results;
    }
    /**
     * 提取 Controller 信息
     */
    extractControllerInfo(filePath, relativePath) {
        try {
            const content = readFileSync(filePath, 'utf-8');
            if (!content.includes('@RestController') && !content.includes('@Controller') && !content.includes('@RequestMapping')) {
                return null;
            }
            const lines = content.split('\n');
            const apiPaths = [];
            // 提取类名
            const classMatch = content.match(/class\s+(\w+)\s*(?:extends|implements|$)/);
            const className = classMatch ? classMatch[1] : basename(filePath, '.java');
            // 提取 API 路径
            const pathPatterns = [
                /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["']([^"']+)["']/g,
                /@RequestMapping\s*\(\s*["']?value\s*=\s*["']([^"']+)["']/g
            ];
            lines.forEach((line, index) => {
                for (const pattern of pathPatterns) {
                    let match;
                    const regex = new RegExp(pattern);
                    while ((match = regex.exec(line)) !== null) {
                        apiPaths.push({
                            path: match[2] || match[1],
                            method: match[1] || 'REQUEST',
                            methodName: this.extractMethodName(line) || 'unknown',
                            lineNumber: index + 1
                        });
                    }
                }
            });
            if (apiPaths.length === 0) {
                return null;
            }
            return {
                filePath: relativePath,
                className,
                apiPaths,
                lineNumber: 1
            };
        }
        catch {
            return null;
        }
    }
    /**
     * 提取方法名
     */
    extractMethodName(line) {
        const match = line.match(/(?:public|private|protected)?\s+\w+\s+(\w+)\s*\(/);
        return match ? match[1] : null;
    }
    /**
     * 提取 Service 信息
     */
    extractServiceInfo(filePath, relativePath) {
        try {
            const content = readFileSync(filePath, 'utf-8');
            if (!content.includes('@Service')) {
                return null;
            }
            const lines = content.split('\n');
            const methods = [];
            // 提取类名
            const classMatch = content.match(/class\s+(\w+)\s*(?:extends|implements|$)/);
            const className = classMatch ? classMatch[1] : basename(filePath, '.java');
            // 提取方法
            lines.forEach((line, index) => {
                const match = line.match(/(?:public|private|protected)?\s+(?:\w+(?:<[^>]+>)?\s+)+(\w+)\s*\(/);
                if (match && !line.includes('//') && !line.includes('*') && match[1] !== className) {
                    methods.push(`${match[1]} (line ${index + 1})`);
                }
            });
            return {
                filePath: relativePath,
                className,
                methods,
                lineNumber: 1
            };
        }
        catch {
            return null;
        }
    }
    /**
     * 提取 MyBatis Mapper 信息
     */
    extractMapperInfo(filePath, relativePath) {
        try {
            const content = readFileSync(filePath, 'utf-8');
            if (!content.includes('<mapper') && !content.includes('<select') && !content.includes('<insert')) {
                return null;
            }
            const statements = [];
            const lines = content.split('\n');
            // 提取所有 SQL 语句
            const statementPatterns = [
                { type: 'select', regex: /<select[^>]+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi },
                { type: 'insert', regex: /<insert[^>]+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/insert>/gi },
                { type: 'update', regex: /<update[^>]+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/update>/gi },
                { type: 'delete', regex: /<delete[^>]+id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/delete>/gi }
            ];
            lines.forEach((line, index) => {
                for (const { type, regex } of statementPatterns) {
                    let match;
                    const lineRegex = new RegExp(regex.source, 'gi');
                    while ((match = lineRegex.exec(line)) !== null) {
                        const sql = match[2]?.trim() || '';
                        const tables = this.extractTablesFromSql(sql);
                        statements.push({
                            id: match[1],
                            type,
                            sql: sql.substring(0, 200),
                            lineNumber: index + 1,
                            tables
                        });
                    }
                }
            });
            if (statements.length === 0) {
                return null;
            }
            return {
                filePath: relativePath,
                statements
            };
        }
        catch {
            return null;
        }
    }
    /**
     * 从 SQL 中提取表名
     */
    extractTablesFromSql(sql) {
        const tables = [];
        // 简单匹配 FROM 和 JOIN 后的表名
        const fromMatch = sql.match(/FROM\s+(\w+)/gi);
        if (fromMatch) {
            fromMatch.forEach(m => {
                const table = m.replace(/FROM\s+/i, '').trim();
                if (!tables.includes(table))
                    tables.push(table);
            });
        }
        const joinMatch = sql.match(/JOIN\s+(\w+)/gi);
        if (joinMatch) {
            joinMatch.forEach(m => {
                const table = m.replace(/JOIN\s+/i, '').trim();
                if (!tables.includes(table))
                    tables.push(table);
            });
        }
        return tables;
    }
    /**
     * 提取 Vue 页面信息
     */
    extractVuePageInfo(filePath, relativePath) {
        try {
            const content = readFileSync(filePath, 'utf-8');
            // 提取路由
            const routeMatch = content.match(/path:\s*['"]([^"']+)['"]/);
            const componentMatch = content.match(/name:\s*['"]([^"']+)['"]/);
            const route = routeMatch ? routeMatch[1] : basename(filePath, '.vue');
            const componentName = componentMatch ? componentMatch[1] : basename(filePath, '.vue');
            return {
                filePath: relativePath,
                route,
                componentName,
                lineNumber: 1
            };
        }
        catch {
            return null;
        }
    }
    /**
     * 提取 Enum 类信息
     */
    extractEnumInfo(filePath, relativePath) {
        try {
            const content = readFileSync(filePath, 'utf-8');
            // 检测是否为 Enum 类
            if (!content.includes('enum ') && !content.includes('Enum')) {
                return null;
            }
            const lines = content.split('\n');
            const values = [];
            // 提取类名
            const classMatch = content.match(/enum\s+(\w+)|class\s+(\w+)\s*(?:extends.*Enum|\{)/);
            const className = classMatch ? (classMatch[1] || classMatch[2]) : basename(filePath, '.java');
            // 提取 Enum 值
            lines.forEach((line, index) => {
                // 匹配 Enum 常量定义，如: FINANCE_INFO("finance_info", "融资信息填写")
                const enumMatch = line.match(/^\s*(\w+)\s*\(\s*["']([^"']*)["']/);
                if (enumMatch) {
                    values.push({
                        name: enumMatch[1],
                        code: enumMatch[2],
                        lineNumber: index + 1
                    });
                }
            });
            if (values.length === 0) {
                return null;
            }
            return {
                filePath: relativePath,
                className,
                values,
                lineNumber: 1
            };
        }
        catch {
            return null;
        }
    }
    /**
     * 从数据库采集工作流表
     */
    async collectFromDatabase() {
        const result = [];
        if (!this.dbConnected) {
            return result;
        }
        const tables = this.config.options?.includeWorkflowTables || [
            'SETTLE_WORKFLOW',
            'SETTLE_WORKFLOW_STEP',
            'SETTLE_WORKFLOW_STEP_USER',
            'SETTLE_WORKFLOW_INSTANCE',
            'SETTLE_WORKFLOW_STEP_INSTANCE',
            'SETTLE_WORKFLOW_STEP_INST_USER'
        ];
        for (const tableName of tables) {
            try {
                const columns = await this.fetchTableColumns(tableName);
                const rowCount = await this.fetchRowCount(tableName);
                const sampleData = await this.fetchSampleData(tableName);
                result.push({
                    tableName,
                    columns,
                    rowCount,
                    data: this.maskSensitiveData(sampleData)
                });
            }
            catch (error) {
                console.log(`[FlowchartCollector] Failed to collect table ${tableName}: ${error}`);
                result.push({ tableName });
            }
        }
        return result;
    }
    /**
     * 获取表列信息
     */
    async fetchTableColumns(tableName) {
        if (!this.dbConnection)
            return [];
        const dbType = this.config.options?.databaseConnection?.type || 'oracle';
        let query;
        if (dbType === 'oracle') {
            query = `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '${tableName}' ORDER BY COLUMN_ID`;
        }
        else if (dbType === 'mysql') {
            query = `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION`;
        }
        else {
            query = `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position`;
        }
        try {
            const result = await this.executeQuery(query);
            return result.map((r) => r.COLUMN_NAME || r.column_name);
        }
        catch {
            return [];
        }
    }
    /**
     * 获取行数
     */
    async fetchRowCount(tableName) {
        if (!this.dbConnection)
            return 0;
        try {
            const result = await this.executeQuery(`SELECT COUNT(*) as cnt FROM ${tableName}`);
            return result[0]?.CNT || result[0]?.cnt || 0;
        }
        catch {
            return 0;
        }
    }
    /**
     * 获取样本数据
     */
    async fetchSampleData(tableName, limit = 5) {
        if (!this.dbConnection)
            return [];
        try {
            const result = await this.executeQuery(`SELECT * FROM ${tableName} FETCH FIRST ${limit} ROWS ONLY`);
            return result;
        }
        catch {
            return [];
        }
    }
    /**
     * 执行查询
     */
    async executeQuery(query) {
        if (!this.dbConnection)
            return [];
        try {
            const result = await this.dbConnection.execute(query);
            return result.rows || [];
        }
        catch {
            return [];
        }
    }
    /**
     * 脱敏敏感数据
     */
    maskSensitiveData(data) {
        const sensitivePatterns = ['password', 'secret', 'token', 'account', 'id_card', 'bank_account', 'phone', 'mobile', 'email', 'address', 'name'];
        return data.map(row => {
            const masked = {};
            for (const [key, value] of Object.entries(row)) {
                const lower = key.toLowerCase();
                if (sensitivePatterns.some(p => lower.includes(p))) {
                    masked[key] = '***';
                }
                else {
                    masked[key] = value;
                }
            }
            return masked;
        });
    }
    /**
     * 创建数据库连接
     */
    async createDbConnection(config) {
        const { type } = config;
        if (type === 'mysql') {
            const mysql = await import('mysql2/promise');
            const connection = await mysql.createConnection({
                host: config.host,
                port: config.port,
                database: config.database,
                user: config.username,
                password: config.password
            });
            return connection;
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
            return client;
        }
        else if (type === 'oracle') {
            const oracledb = await import('oracledb');
            const connection = await oracledb.getConnection({
                user: config.username,
                password: config.password,
                connectString: `${config.host}:${config.port}/${config.database}`
            });
            return connection;
        }
        throw new Error(`Unsupported database type: ${type}`);
    }
    /**
     * 构建流程图文档
     */
    buildFlowchartDocument(sourceResult, dbResult, processCode, timestamp) {
        const nodes = [];
        const edges = [];
        const evidence = {};
        const frontEndPages = [];
        const backEndServices = [];
        const databaseTables = [];
        const evidenceIdMap = new Map();
        // 1. 创建证据和节点 - 从 Controller
        for (const controller of sourceResult.controllers) {
            const serviceEvidenceId = generateCollectorId('ev');
            evidence[serviceEvidenceId] = {
                id: serviceEvidenceId,
                type: 'api_endpoint',
                sourceType: 'source_code',
                filePath: controller.filePath,
                apiPath: controller.apiPaths[0]?.path,
                confidence: 0.9,
                confirmed: false,
                description: `REST API Controller: ${controller.className}`,
                createdAt: timestamp
            };
            // 为每个 API 创建节点
            for (const api of controller.apiPaths) {
                const nodeId = generateCollectorId('node');
                const nodeEvidenceId = generateCollectorId('ev');
                evidence[nodeEvidenceId] = {
                    id: nodeEvidenceId,
                    type: 'api_endpoint',
                    sourceType: 'source_code',
                    filePath: controller.filePath,
                    lineNumbers: [api.lineNumber],
                    apiPath: api.path,
                    confidence: 0.85,
                    confirmed: false,
                    description: `${api.method} ${api.path}`,
                    createdAt: timestamp
                };
                nodes.push({
                    id: nodeId,
                    name: `${controller.className}.${api.methodName}`,
                    type: 'USER_TASK',
                    sourceStatus: 'CONFIRMED',
                    description: `API: ${api.method} ${api.path}`,
                    backEndService: controller.className,
                    evidence: [nodeEvidenceId, serviceEvidenceId]
                });
                evidenceIdMap.set(`${controller.filePath}:${api.lineNumber}`, nodeEvidenceId);
            }
            backEndServices.push({
                serviceId: generateCollectorId('svc'),
                serviceName: controller.className,
                endpoint: controller.apiPaths[0]?.path,
                relatedNodes: []
            });
        }
        // 2. 从 Service 创建节点
        for (const service of sourceResult.services) {
            const serviceEvidenceId = generateCollectorId('ev');
            evidence[serviceEvidenceId] = {
                id: serviceEvidenceId,
                type: 'code_snippet',
                sourceType: 'source_code',
                filePath: service.filePath,
                confidence: 0.85,
                confirmed: false,
                description: `Business Service: ${service.className}`,
                createdAt: timestamp
            };
            // 为每个方法创建节点
            for (const method of service.methods) {
                const methodName = method.split(' (line')[0];
                const lineNumber = parseInt(method.match(/line (\d+)/)?.[1] || '0');
                if (!evidenceIdMap.has(`${service.filePath}:${lineNumber}`)) {
                    const nodeId = generateCollectorId('node');
                    nodes.push({
                        id: nodeId,
                        name: methodName,
                        type: 'SERVICE_TASK',
                        sourceStatus: 'CONFIRMED',
                        description: `Service method: ${methodName}`,
                        backEndService: service.className,
                        evidence: [serviceEvidenceId]
                    });
                    evidenceIdMap.set(`${service.filePath}:${lineNumber}`, serviceEvidenceId);
                }
            }
        }
        // 3. 从 MyBatis Mapper 创建节点
        for (const mapper of sourceResult.mybatisMappers) {
            const mapperEvidenceId = generateCollectorId('ev');
            evidence[mapperEvidenceId] = {
                id: mapperEvidenceId,
                type: 'code_snippet',
                sourceType: 'source_code',
                filePath: mapper.filePath,
                confidence: 0.8,
                confirmed: false,
                description: `MyBatis Mapper with ${mapper.statements.length} statements`,
                createdAt: timestamp
            };
            for (const stmt of mapper.statements) {
                const nodeId = generateCollectorId('node');
                nodes.push({
                    id: nodeId,
                    name: `${stmt.type.toUpperCase()} ${stmt.id}`,
                    type: 'SERVICE_TASK',
                    sourceStatus: 'CONFIRMED',
                    description: `${stmt.type.toUpperCase()} statement: ${stmt.id}`,
                    databaseOperation: stmt.tables.join(', '),
                    evidence: [mapperEvidenceId]
                });
            }
        }
        // 4. 从 Vue 页面创建节点
        for (const page of sourceResult.vuePages) {
            const pageEvidenceId = generateCollectorId('ev');
            evidence[pageEvidenceId] = {
                id: pageEvidenceId,
                type: 'ui_element',
                sourceType: 'source_code',
                filePath: page.filePath,
                lineNumbers: [page.lineNumber],
                confidence: 0.8,
                confirmed: false,
                description: `Vue Page: ${page.componentName}`,
                createdAt: timestamp
            };
            const nodeId = generateCollectorId('node');
            nodes.push({
                id: nodeId,
                name: page.componentName,
                type: 'USER_TASK',
                sourceStatus: 'CONFIRMED',
                description: `Page route: ${page.route}`,
                frontEndPage: page.filePath,
                evidence: [pageEvidenceId]
            });
            frontEndPages.push({
                pageId: generateCollectorId('page'),
                pageName: page.componentName,
                route: page.route,
                relatedNodes: [nodeId]
            });
        }
        // 6. 从 Enum 类创建节点
        for (const enumInfo of sourceResult.enums) {
            const enumEvidenceId = generateCollectorId('ev');
            evidence[enumEvidenceId] = {
                id: enumEvidenceId,
                type: 'code_snippet',
                sourceType: 'source_code',
                filePath: enumInfo.filePath,
                confidence: 0.85,
                confirmed: false,
                description: `Enum: ${enumInfo.className} with ${enumInfo.values.length} values`,
                createdAt: timestamp
            };
            // 为每个 Enum 值创建节点
            for (const value of enumInfo.values) {
                const nodeId = generateCollectorId('node');
                nodes.push({
                    id: nodeId,
                    name: value.name,
                    type: 'SERVICE_TASK',
                    sourceStatus: 'CONFIRMED',
                    description: `${enumInfo.className}.${value.name} = "${value.code}"`,
                    evidence: [enumEvidenceId]
                });
            }
        }
        // 7. 从数据库表创建节点和证据
        for (const table of dbResult) {
            const tableEvidenceId = generateCollectorId('ev');
            evidence[tableEvidenceId] = {
                id: tableEvidenceId,
                type: 'database_schema',
                sourceType: 'database',
                tableName: table.tableName,
                fieldNames: table.columns || [],
                confidence: 0.95,
                confirmed: false,
                description: `Database table: ${table.tableName}`,
                metadata: {
                    rowCount: table.rowCount,
                    columns: table.columns?.length || 0
                },
                createdAt: timestamp
            };
            const nodeId = generateCollectorId('node');
            nodes.push({
                id: nodeId,
                name: table.tableName,
                type: 'SERVICE_TASK',
                sourceStatus: this.dbConnected ? 'CONFIRMED' : 'UNCONFIRMED',
                description: `Database table: ${table.tableName} (${table.rowCount || 0} rows)`,
                databaseOperation: 'CRUD',
                evidence: [tableEvidenceId]
            });
            databaseTables.push({
                tableName: table.tableName,
                tableComment: undefined,
                relatedNodes: [nodeId],
                relatedOperations: ['create', 'read', 'update', 'delete', 'query']
            });
        }
        // 8. 添加 START 和 END 节点
        const startNodeId = generateCollectorId('node');
        const endNodeId = generateCollectorId('node');
        nodes.unshift({
            id: startNodeId,
            name: 'Start',
            type: 'START',
            sourceStatus: 'CONFIRMED',
            description: '流程开始'
        });
        nodes.push({
            id: endNodeId,
            name: 'End',
            type: 'END',
            sourceStatus: 'CONFIRMED',
            description: '流程结束'
        });
        // 9. 创建边
        for (let i = 0; i < nodes.length - 1; i++) {
            if (nodes[i].type !== 'END' && nodes[i + 1].type !== 'START') {
                edges.push({
                    from: nodes[i].id,
                    to: nodes[i + 1].id,
                    sourceStatus: 'CONFIRMED',
                    flowType: 'sequence'
                });
            }
        }
        // 10. 处理未确认的节点
        const unconfirmedNodes = nodes.filter(n => n.sourceStatus === UNCONFIRMED);
        const unconfirmedItems = unconfirmedNodes.map(node => ({
            itemId: generateCollectorId('unconf'),
            itemType: 'node',
            description: `Node "${node.name}" needs source confirmation`,
            relatedNodeIds: [node.id],
            priority: 'medium'
        }));
        // 11. 主路径
        const mainPath = nodes.map(n => n.id);
        // 12. 构建元数据
        const metadata = {
            name: processCode,
            processCode,
            collectedAt: timestamp,
            collectorVersion: '1.0.0',
            description: 'Auto-generated flowchart from source and database'
        };
        // 13. 构建完整的文档
        const document = {
            schemaVersion: '1.0',
            metadata,
            mainPath,
            nodes,
            edges,
            evidence,
            frontEndPages,
            backEndServices,
            databaseTables,
            unconfirmedItems: unconfirmedItems.length > 0 ? unconfirmedItems : undefined
        };
        return document;
    }
    /**
     * 提取证据列表
     */
    extractEvidence(document, sourceResult, dbResult, timestamp) {
        const evidenceList = [];
        for (const [id, ev] of Object.entries(document.evidence)) {
            evidenceList.push({
                source: ev.filePath || ev.tableName || 'unknown',
                line: ev.lineNumbers?.[0],
                confidence: ev.confidence,
                extractedAt: ev.createdAt || timestamp,
                metadata: {
                    id,
                    type: ev.type,
                    sourceType: ev.sourceType,
                    apiPath: ev.apiPath,
                    tableName: ev.tableName,
                    fieldNames: ev.fieldNames
                }
            });
        }
        return evidenceList;
    }
    /**
     * 创建流程图事实
     */
    createFlowchartFact(document, evidence, timestamp) {
        return {
            id: generateCollectorId('flowchart'),
            type: 'flowchart',
            category: 'process_definition',
            name: `流程图: ${document.metadata.processCode}`,
            description: `流程图采集文档，包含 ${document.nodes.length} 个节点，${document.edges.length} 条边`,
            content: {
                schemaVersion: document.schemaVersion,
                metadata: document.metadata,
                nodeCount: document.nodes.length,
                edgeCount: document.edges.length,
                evidenceCount: Object.keys(document.evidence).length,
                hasUnconfirmed: (document.unconfirmedItems?.length || 0) > 0
            },
            evidence,
            reviewStatus: 'AUTO_EXTRACTED',
            collectorType: 'source-scanner',
            collectorName: this.name,
            confidence: 0.85,
            collectedAt: timestamp
        };
    }
    /**
     * 创建节点事实
     */
    createNodeFact(node, document, timestamp) {
        const nodeEvidence = document.evidence[node.evidence?.[0] || ''];
        return {
            id: node.id,
            type: 'flowchart-node',
            category: 'node',
            name: node.name,
            description: node.description || `流程节点: ${node.name}`,
            content: {
                nodeType: node.type,
                actors: node.actors,
                sourceStatus: node.sourceStatus,
                frontEndPage: node.frontEndPage,
                backEndService: node.backEndService,
                databaseOperation: node.databaseOperation,
                configurations: node.configurations
            },
            evidence: node.evidence?.map(eId => {
                const ev = document.evidence[eId];
                return {
                    source: ev?.filePath || ev?.tableName || 'unknown',
                    line: ev?.lineNumbers?.[0],
                    confidence: ev?.confidence || 0.5,
                    extractedAt: ev?.createdAt || timestamp
                };
            }) || [],
            reviewStatus: node.sourceStatus === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING_CONFIRM',
            collectorType: 'source-scanner',
            collectorName: this.name,
            confidence: node.sourceStatus === 'CONFIRMED' ? 0.9 : 0.5,
            collectedAt: timestamp
        };
    }
}
/**
 * 创建 FlowchartCollector 配置
 */
export function createFlowchartCollectorConfig(name = 'flowchart-collector', options) {
    return {
        name,
        type: 'source-scanner',
        enabled: true,
        priority: 20,
        options
    };
}
/**
 * 创建 FlowchartCollector 实例
 */
export function createFlowchartCollector(config) {
    return new FlowchartCollector(config);
}
//# sourceMappingURL=flowchart-collector.js.map