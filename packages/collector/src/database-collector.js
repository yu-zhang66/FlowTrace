/**
 * Database Facts Collector
 *
 * 采集数据库表结构、约束、索引和样本数据
 * 支持 Oracle、PostgreSQL、MySQL
 *
 * 融资流程相关数据库表：
 * - LOAN_AFTER_INFO: 放款后信息表
 * - SCF_COMPANY_FLOW: 保理公司流程表
 * - SETTLE_WORKFLOW: 工作流定义表
 * - SETTLE_WORKFLOW_STEP: 工作流步骤表
 * - SETTLE_WORKFLOW_INSTANCE: 工作流实例表
 * - SETTLE_WORKFLOW_STEP_INSTANCE: 工作流步骤实例表
 * - SETTLE_WORKFLOW_STEP_INST_USER: 工作流步骤用户表
 */
import { generateCollectorId } from '@flowtrace/core';
/**
 * 融资流程相关数据库表常量
 */
export const FINANCING_DATABASE_TABLES = [
    'LOAN_AFTER_INFO',
    'SCF_COMPANY_FLOW',
    'SETTLE_WORKFLOW',
    'SETTLE_WORKFLOW_STEP',
    'SETTLE_WORKFLOW_INSTANCE',
    'SETTLE_WORKFLOW_STEP_INSTANCE',
    'SETTLE_WORKFLOW_STEP_INST_USER'
];
/**
 * 表用途说明
 */
export const FINANCING_TABLE_DESCRIPTIONS = {
    'LOAN_AFTER_INFO': '放款后信息表 - 存储融资放款后的相关信息',
    'SCF_COMPANY_FLOW': '保理公司流程表 - 存储保理公司的业务流程配置',
    'SETTLE_WORKFLOW': '工作流定义表 - 存储工作流的基本定义',
    'SETTLE_WORKFLOW_STEP': '工作流步骤表 - 存储工作流的各个步骤定义',
    'SETTLE_WORKFLOW_INSTANCE': '工作流实例表 - 存储工作流的具体实例',
    'SETTLE_WORKFLOW_STEP_INSTANCE': '工作流步骤实例表 - 存储工作流步骤的具体实例',
    'SETTLE_WORKFLOW_STEP_INST_USER': '工作流步骤用户表 - 存储工作流步骤的处理人员'
};
/**
 * Database Collector 实现
 */
export class DatabaseCollector {
    name;
    type = 'database';
    config;
    isConnected = false;
    connection = null;
    maskSensitive = true;
    sensitivePatterns;
    constructor(config) {
        this.name = config.name || 'database-collector';
        this.config = config;
        this.maskSensitive = config.options?.maskSensitive ?? true;
        this.sensitivePatterns = config.options?.sensitiveFieldPatterns ?? [
            'password', 'secret', 'token', 'account', 'id_card', 'bank_account',
            'phone', 'mobile', 'email', 'address', 'name'
        ];
    }
    async initialize(context) {
        console.log(`[DatabaseCollector] Initializing for project: ${context.projectId}`);
        const dbConfig = this.config.options?.connection;
        if (!dbConfig) {
            console.log(`[DatabaseCollector] No database connection configured. Will output not-connected status.`);
            return;
        }
        try {
            this.connection = await this.createConnection(dbConfig);
            this.isConnected = true;
            console.log(`[DatabaseCollector] Database connection established`);
        }
        catch (error) {
            console.log(`[DatabaseCollector] Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
            console.log(`[DatabaseCollector] Falling back to not-connected mode`);
            this.isConnected = false;
        }
    }
    async collect(context) {
        const facts = [];
        const timestamp = new Date().toISOString();
        if (!this.isConnected) {
            console.log(`[DatabaseCollector] NOT CONNECTED - Cannot collect real database facts`);
            facts.push(this.createNotConnectedFact(timestamp));
            return facts;
        }
        try {
            const tables = this.config.options?.tables;
            const includeFinancingTables = this.config.options?.includeFinancingTables ?? false;
            if (tables && tables.length > 0) {
                // 采集指定表
                for (const tableName of tables) {
                    const tableFact = await this.collectTable(tableName, timestamp);
                    if (tableFact) {
                        facts.push(tableFact);
                    }
                }
            }
            else if (includeFinancingTables) {
                // 采集融资流程相关表
                console.log(`[DatabaseCollector] Collecting financing workflow tables: ${FINANCING_DATABASE_TABLES.join(', ')}`);
                for (const tableName of FINANCING_DATABASE_TABLES) {
                    const tableFact = await this.collectTable(tableName, timestamp);
                    if (tableFact) {
                        // 添加表用途描述
                        if (FINANCING_TABLE_DESCRIPTIONS[tableName]) {
                            tableFact.description = FINANCING_TABLE_DESCRIPTIONS[tableName];
                        }
                        facts.push(tableFact);
                    }
                    else {
                        // 表不存在时添加占位信息
                        facts.push(this.createTableNotFoundFact(tableName, timestamp));
                    }
                }
            }
            else {
                // 采集所有相关表
                const allTables = await this.fetchAllTables();
                for (const tableName of allTables) {
                    const tableFact = await this.collectTable(tableName, timestamp);
                    if (tableFact) {
                        facts.push(tableFact);
                    }
                }
            }
            console.log(`[DatabaseCollector] Collected ${facts.length} database facts`);
        }
        catch (error) {
            console.error(`[DatabaseCollector] Collection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return facts;
    }
    async checkAvailability(context) {
        const dbConfig = this.config.options?.connection;
        if (!dbConfig) {
            return {
                available: false,
                reason: '数据库连接未配置 - 当前仅使用源码采集，不能作为真实数据库基线'
            };
        }
        if (!this.isConnected) {
            return {
                available: false,
                reason: '数据库连接失败 - 请检查连接配置和网络安全'
            };
        }
        return { available: true };
    }
    async cleanup() {
        if (this.connection) {
            try {
                await this.closeConnection(this.connection);
            }
            catch {
                // 忽略关闭错误
            }
            this.connection = null;
        }
        this.isConnected = false;
    }
    /**
     * 创建未连接状态的事实
     */
    createNotConnectedFact(timestamp) {
        return {
            id: generateCollectorId('db'),
            type: 'database-collection-status',
            category: 'database',
            name: '数据库采集状态',
            description: '数据库连接未建立，无法采集真实数据库数据',
            content: {
                connected: false,
                status: '未连接',
                message: '当前仅使用源码事实，不能作为真实数据库基线',
                required: [
                    '数据库连接配置',
                    '有效的数据库凭据',
                    '只读权限'
                ],
                note: '必须配置真实的数据库连接才能采集数据库数据'
            },
            evidence: [{
                    source: 'database-collector',
                    confidence: 1.0,
                    extractedAt: timestamp,
                    metadata: {
                        collector: 'database-collector',
                        mode: 'not-connected'
                    }
                }],
            reviewStatus: 'AUTO_EXTRACTED',
            collectorType: 'database',
            collectorName: this.name,
            confidence: 1.0,
            collectedAt: timestamp
        };
    }
    /**
     * 创建表不存在的事实（用于融资流程相关表）
     */
    createTableNotFoundFact(tableName, timestamp) {
        return {
            id: generateCollectorId('db'),
            type: 'database-table',
            category: 'database',
            name: `表: ${tableName}`,
            description: FINANCING_TABLE_DESCRIPTIONS[tableName] || `数据库表 ${tableName}`,
            content: {
                tableName,
                schema: this.getSchemaName(),
                columns: [],
                primaryKeys: [],
                foreignKeys: [],
                indexes: [],
                rowCount: 0,
                sampleData: [],
                sampleDataCount: 0,
                status: 'table-not-found',
                note: `表 ${tableName} 在数据库中不存在或无法访问`
            },
            evidence: [{
                    source: `${this.getSchemaName()}.${tableName}`,
                    confidence: 0.5,
                    extractedAt: timestamp,
                    metadata: {
                        collector: 'database-collector',
                        realData: false,
                        tableExists: false,
                        reason: 'table-not-found'
                    }
                }],
            reviewStatus: 'AUTO_EXTRACTED',
            collectorType: 'database',
            collectorName: this.name,
            confidence: 0.5,
            collectedAt: timestamp
        };
    }
    /**
     * 采集单个表
     */
    async collectTable(tableName, timestamp) {
        try {
            const columns = await this.fetchTableColumns(tableName);
            if (columns.length === 0) {
                return null;
            }
            const primaryKeys = columns.filter(c => c.isPrimaryKey).map(c => c.name);
            const foreignKeys = await this.fetchForeignKeys(tableName);
            const indexes = this.config.options?.includeIndexes !== false
                ? await this.fetchIndexes(tableName)
                : [];
            const rowCount = await this.fetchRowCount(tableName);
            const sampleData = this.config.options?.includeSampleData !== false
                ? await this.fetchSampleData(tableName)
                : [];
            const tableFact = {
                tableName,
                schema: this.getSchemaName(),
                columns,
                primaryKeys,
                foreignKeys,
                indexes,
                rowCount,
                sampleData
            };
            return this.createTableFact(tableFact, timestamp);
        }
        catch (error) {
            console.error(`[DatabaseCollector] Failed to collect table ${tableName}: ${error}`);
            return null;
        }
    }
    /**
     * 创建表结构事实
     */
    createTableFact(table, timestamp) {
        const tableDescription = FINANCING_TABLE_DESCRIPTIONS[table.tableName]
            || `数据库表 ${table.tableName}，包含 ${table.columns.length} 个字段，${table.rowCount || 0} 行数据`;
        return {
            id: generateCollectorId('db'),
            type: 'database-table',
            category: 'database',
            name: `表: ${table.tableName}`,
            description: tableDescription,
            content: {
                tableName: table.tableName,
                schema: table.schema,
                columns: table.columns.map(c => ({
                    ...c,
                    // 脱敏列名检查
                    isSensitive: this.isSensitiveField(c.name)
                })),
                primaryKeys: table.primaryKeys,
                foreignKeys: table.foreignKeys,
                indexes: table.indexes,
                rowCount: table.rowCount,
                sampleData: this.maskSensitive ? this.maskSampleData(table.sampleData) : table.sampleData,
                sampleDataCount: table.sampleData?.length || 0
            },
            evidence: [{
                    source: `${this.getSchemaName()}.${table.tableName}`,
                    confidence: 0.95,
                    extractedAt: timestamp,
                    metadata: {
                        collector: 'database-collector',
                        realData: true,
                        rowCount: table.rowCount
                    }
                }],
            reviewStatus: 'AUTO_EXTRACTED',
            collectorType: 'database',
            collectorName: this.name,
            confidence: 0.95,
            collectedAt: timestamp
        };
    }
    /**
     * 检查字段是否敏感
     */
    isSensitiveField(fieldName) {
        const lower = fieldName.toLowerCase();
        return this.sensitivePatterns.some(pattern => lower.includes(pattern.toLowerCase()));
    }
    /**
     * 脱敏样本数据
     */
    maskSampleData(data) {
        if (!data)
            return [];
        return data.map(row => {
            const masked = {};
            for (const [key, value] of Object.entries(row)) {
                if (this.isSensitiveField(key)) {
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
     * 获取所有表
     */
    async fetchAllTables() {
        const dbType = this.config.options?.connection?.type || 'oracle';
        let query;
        if (dbType === 'oracle') {
            query = `SELECT TABLE_NAME FROM USER_TABLES ORDER BY TABLE_NAME`;
        }
        else if (dbType === 'postgresql') {
            query = `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
        }
        else if (dbType === 'mysql') {
            query = `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`;
        }
        else {
            return [];
        }
        try {
            const result = await this.executeQuery(query);
            return result.map((row) => row.TABLE_NAME || row.table_name);
        }
        catch {
            return [];
        }
    }
    /**
     * 获取表列信息
     */
    async fetchTableColumns(tableName) {
        const dbType = this.config.options?.connection?.type || 'oracle';
        let query;
        if (dbType === 'oracle') {
            query = `
        SELECT 
          COLUMN_NAME,
          DATA_TYPE,
          DATA_LENGTH,
          DATA_PRECISION,
          DATA_SCALE,
          NULLABLE,
          DATA_DEFAULT,
          CASE WHEN c.COLUMN_NAME IN (
            SELECT cc.COLUMN_NAME FROM USER_CONS_COLUMNS cc
            JOIN USER_CONSTRAINTS pc ON cc.CONSTRAINT_NAME = pc.CONSTRAINT_NAME
            WHERE pc.TABLE_NAME = '${tableName}' AND pc.CONSTRAINT_TYPE = 'P'
          ) THEN 'Y' ELSE 'N' END AS IS_PRIMARY_KEY
        FROM USER_TAB_COLUMNS c
        WHERE TABLE_NAME = '${tableName}'
        ORDER BY COLUMN_ID
      `;
        }
        else if (dbType === 'postgresql') {
            query = `
        SELECT 
          c.column_name,
          c.data_type,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale,
          c.is_nullable,
          c.column_default,
          CASE WHEN pk.column_name IS NOT NULL THEN 'Y' ELSE 'N' END as is_primary_key
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
          WHERE tc.table_name = '${tableName}' AND tc.constraint_type = 'PRIMARY KEY'
        ) pk ON c.column_name = pk.column_name
        WHERE c.table_name = '${tableName}'
        ORDER BY c.ordinal_position
      `;
        }
        else {
            query = `
        SELECT 
          COLUMN_NAME,
          DATA_TYPE,
          CHARACTER_MAXIMUM_LENGTH,
          NUMERIC_PRECISION,
          NUMERIC_SCALE,
          IS_NULLABLE,
          COLUMN_DEFAULT,
          COLUMN_KEY as IS_PRIMARY_KEY
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
        ORDER BY ORDINAL_POSITION
      `;
        }
        try {
            const result = await this.executeQuery(query);
            return result.map((row) => this.mapToColumnInfo(row, dbType));
        }
        catch {
            return [];
        }
    }
    /**
     * 获取外键信息
     */
    async fetchForeignKeys(tableName) {
        const dbType = this.config.options?.connection?.type || 'oracle';
        let query;
        if (dbType === 'oracle') {
            query = `
        SELECT 
          a.column_name,
          c_pk.table_name as referenced_table,
          b.column_name as referenced_column,
          a.constraint_name
        FROM user_cons_columns a
        JOIN user_constraints c ON a.constraint_name = c.constraint_name
        JOIN user_constraints c_pk ON c.r_constraint_name = c_pk.constraint_name
        JOIN user_cons_columns b ON c_pk.constraint_name = b.constraint_name AND b.position = a.position
        WHERE c.table_name = '${tableName}' AND c.constraint_type = 'R'
      `;
        }
        else if (dbType === 'postgresql') {
            query = `
        SELECT 
          kcu.column_name,
          ccu.table_name AS referenced_table,
          ccu.column_name AS referenced_column,
          tc.constraint_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.confraint_name
        WHERE tc.table_name = '${tableName}' AND tc.constraint_type = 'FOREIGN KEY'
      `;
        }
        else {
            query = `
        SELECT 
          COLUMN_NAME,
          REFERENCED_TABLE_NAME,
          REFERENCED_COLUMN_NAME,
          CONSTRAINT_NAME
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}' AND REFERENCED_TABLE_NAME IS NOT NULL
      `;
        }
        try {
            const result = await this.executeQuery(query);
            return result.map((row) => ({
                columnName: row.COLUMN_NAME || row.column_name,
                referencedTable: row.REFERENCED_TABLE || row.referenced_table_name,
                referencedColumn: row.REFERENCED_COLUMN || row.referenced_column_name,
                constraintName: row.CONSTRAINT_NAME || row.constraint_name
            }));
        }
        catch {
            return [];
        }
    }
    /**
     * 获取索引信息
     */
    async fetchIndexes(tableName) {
        const dbType = this.config.options?.connection?.type || 'oracle';
        let query;
        if (dbType === 'oracle') {
            query = `
        SELECT 
          index_name,
          COLUMN_NAME,
          UNIQUENESS,
          INDEX_TYPE
        FROM USER_IND_COLUMNS ic
        JOIN USER_INDEXES i ON ic.index_name = i.index_name
        WHERE ic.TABLE_NAME = '${tableName}'
        ORDER BY INDEX_NAME, COLUMN_POSITION
      `;
        }
        else if (dbType === 'postgresql') {
            query = `
        SELECT 
          i.relname as index_name,
          a.attname as column_name,
          ix.indisunique as is_unique,
          am.amname as index_type
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        JOIN pg_am am ON i.relam = am.oid
        WHERE t.relname = '${tableName}' AND n.nspname = 'public'
        ORDER BY i.relname, array_position(ix.indkey, a.attnum)
      `;
        }
        else {
            query = `
        SELECT 
          INDEX_NAME,
          COLUMN_NAME,
          NON_UNIQUE,
          INDEX_TYPE
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
      `;
        }
        try {
            const result = await this.executeQuery(query);
            // 按索引名分组
            const indexMap = new Map();
            for (const row of result) {
                const indexName = row.INDEX_NAME || row.index_name;
                if (!indexMap.has(indexName)) {
                    indexMap.set(indexName, {
                        indexName,
                        columns: [],
                        isUnique: (row.UNIQUENESS || row.is_unique || row.NON_UNIQUE) === 'UNIQUE' || row.is_unique === false,
                        type: row.INDEX_TYPE || row.index_type || 'BTREE'
                    });
                }
                indexMap.get(indexName).columns.push(row.COLUMN_NAME || row.column_name);
            }
            return Array.from(indexMap.values());
        }
        catch {
            return [];
        }
    }
    /**
     * 获取行数
     */
    async fetchRowCount(tableName) {
        const query = `SELECT COUNT(*) as cnt FROM ${tableName}`;
        try {
            const result = await this.executeQuery(query);
            return result[0]?.CNT || result[0]?.cnt || 0;
        }
        catch {
            return 0;
        }
    }
    /**
     * 获取样本数据
     */
    async fetchSampleData(tableName) {
        const maxRows = this.config.options?.maxSampleRows || 5;
        const query = `SELECT * FROM ${tableName} FETCH FIRST ${maxRows} ROWS ONLY`;
        try {
            return await this.executeQuery(query);
        }
        catch {
            return [];
        }
    }
    /**
     * 执行查询
     */
    async executeQuery(query, params) {
        if (!this.connection)
            return [];
        try {
            if (Array.isArray(params) && params.length > 0) {
                const result = await this.connection.execute(query, params);
                return result.rows || [];
            }
            else {
                const result = await this.connection.execute(query);
                return result.rows || [];
            }
        }
        catch (error) {
            throw error;
        }
    }
    /**
     * 创建数据库连接
     */
    async createConnection(config) {
        const type = config.type || 'oracle';
        if (type === 'oracle') {
            try {
                const oracledb = await import('oracledb');
                const connection = await oracledb.getConnection({
                    user: config.username,
                    password: config.password,
                    connectString: `${config.host}:${config.port}/${config.database}`
                });
                return connection;
            }
            catch (error) {
                throw new Error(`Oracle connection failed: ${error instanceof Error ? error.message : String(error)}`);
            }
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
        else if (type === 'mysql') {
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
        throw new Error(`Unsupported database type: ${type}`);
    }
    /**
     * 关闭数据库连接
     */
    async closeConnection(connection) {
        if (connection && typeof connection.close === 'function') {
            await connection.close();
        }
    }
    /**
     * 获取模式名
     */
    getSchemaName() {
        return this.config.options?.connection?.database || 'UNKNOWN';
    }
    /**
     * 映射列为 ColumnInfo
     */
    mapToColumnInfo(row, dbType) {
        if (dbType === 'oracle') {
            return {
                name: row.COLUMN_NAME,
                dataType: row.DATA_TYPE,
                nullable: row.NULLABLE === 'Y',
                defaultValue: row.DATA_DEFAULT,
                isPrimaryKey: row.IS_PRIMARY_KEY === 'Y',
                isForeignKey: false,
                maxLength: row.DATA_LENGTH,
                precision: row.DATA_PRECISION,
                scale: row.DATA_SCALE
            };
        }
        else if (dbType === 'postgresql') {
            return {
                name: row.column_name,
                dataType: row.data_type,
                nullable: row.is_nullable === 'YES',
                defaultValue: row.column_default,
                isPrimaryKey: row.is_primary_key === 'Y',
                isForeignKey: false,
                maxLength: row.character_maximum_length,
                precision: row.numeric_precision,
                scale: row.numeric_scale
            };
        }
        else {
            return {
                name: row.COLUMN_NAME,
                dataType: row.DATA_TYPE,
                nullable: row.IS_NULLABLE === 'YES',
                defaultValue: row.COLUMN_DEFAULT,
                isPrimaryKey: row.IS_PRIMARY_KEY === 'PRI',
                isForeignKey: row.IS_PRIMARY_KEY === 'MUL',
                maxLength: row.CHARACTER_MAXIMUM_LENGTH,
                precision: row.NUMERIC_PRECISION,
                scale: row.NUMERIC_SCALE
            };
        }
    }
}
/**
 * 创建 Database Collector 配置
 */
export function createDatabaseCollectorConfig(name = 'database-collector', options) {
    return {
        name,
        type: 'database',
        enabled: true,
        priority: 30,
        options
    };
}
/**
 * 创建 Database Collector 实例
 */
export function createDatabaseCollector(config) {
    return new DatabaseCollector(config);
}
/**
 * 创建融资流程数据库 Collector 配置
 *
 * @param connection 数据库连接配置
 * @param options 可选配置
 * @returns DatabaseCollectorConfig
 *
 * @example
 * ```typescript
 * const config = createFinancingDatabaseCollectorConfig({
 *   host: 'localhost',
 *   port: 1521,
 *   database: 'ORCL',
 *   username: 'scott',
 *   password: 'tiger',
 *   type: 'oracle'
 * });
 * ```
 */
export function createFinancingDatabaseCollectorConfig(connection, options) {
    return {
        name: 'financing-database-collector',
        type: 'database',
        enabled: true,
        priority: 35,
        options: {
            connection,
            includeFinancingTables: true,
            includeSampleData: options?.includeSampleData ?? true,
            maxSampleRows: options?.maxSampleRows ?? 5,
            includeIndexes: options?.includeIndexes ?? true,
            maskSensitive: options?.maskSensitive ?? true,
            sensitiveFieldPatterns: options?.sensitiveFieldPatterns
        }
    };
}
//# sourceMappingURL=database-collector.js.map