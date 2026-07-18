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

import type { 
  Collector, 
  CollectorContext, 
  CollectedFact,
  CollectorConfig
} from '@flowtrace/core';
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
] as const;

/**
 * 表用途说明
 */
export const FINANCING_TABLE_DESCRIPTIONS: Record<string, string> = {
  'LOAN_AFTER_INFO': '放款后信息表 - 存储融资放款后的相关信息',
  'SCF_COMPANY_FLOW': '保理公司流程表 - 存储保理公司的业务流程配置',
  'SETTLE_WORKFLOW': '工作流定义表 - 存储工作流的基本定义',
  'SETTLE_WORKFLOW_STEP': '工作流步骤表 - 存储工作流的各个步骤定义',
  'SETTLE_WORKFLOW_INSTANCE': '工作流实例表 - 存储工作流的具体实例',
  'SETTLE_WORKFLOW_STEP_INSTANCE': '工作流步骤实例表 - 存储工作流步骤的具体实例',
  'SETTLE_WORKFLOW_STEP_INST_USER': '工作流步骤用户表 - 存储工作流步骤的处理人员'
};

/**
 * Database Collector 配置
 */
export interface DatabaseCollectorConfig extends CollectorConfig {
  options?: {
    /** 数据库连接配置 */
    connection?: {
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      type: 'oracle' | 'postgresql' | 'mysql';
    };
    /** 表名列表（留空则采集所有表） */
    tables?: string[];
    /** 是否采集样本数据 */
    includeSampleData?: boolean;
    /** 每表最大样本行数 */
    maxSampleRows?: number;
    /** 是否采集索引 */
    includeIndexes?: boolean;
    /** 是否采集约束 */
    includeConstraints?: boolean;
    /** 是否脱敏 */
    maskSensitive?: boolean;
    /** 脱敏字段名模式 */
    sensitiveFieldPatterns?: string[];
    /** 是否采集融资流程相关表（LOAN_AFTER_INFO, SCF_COMPANY_FLOW, SETTLE_WORKFLOW 等） */
    includeFinancingTables?: boolean;
  };
}

/**
 * 表结构事实
 */
export interface TableStructureFact {
  tableName: string;
  schema: string;
  columns: ColumnInfo[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  rowCount?: number;
  sampleData?: Record<string, unknown>[];
}

/**
 * 列信息
 */
export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
}

/**
 * 外键信息
 */
export interface ForeignKeyInfo {
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  constraintName: string;
}

/**
 * 索引信息
 */
export interface IndexInfo {
  indexName: string;
  columns: string[];
  isUnique: boolean;
  type: string;
}

/**
 * Database Collector 实现
 */
export class DatabaseCollector implements Collector {
  readonly name: string;
  readonly type = 'database' as const;
  config: DatabaseCollectorConfig;
  
  private isConnected: boolean = false;
  private connection: any = null;
  private maskSensitive: boolean = true;
  private sensitivePatterns: string[];

  constructor(config: DatabaseCollectorConfig) {
    this.name = config.name || 'database-collector';
    this.config = config;
    this.maskSensitive = config.options?.maskSensitive ?? true;
    this.sensitivePatterns = config.options?.sensitiveFieldPatterns ?? [
      'password', 'secret', 'token', 'account', 'id_card', 'bank_account',
      'phone', 'mobile', 'email', 'address', 'name'
    ];
  }

  async initialize(context: CollectorContext): Promise<void> {
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
    } catch (error) {
      console.log(`[DatabaseCollector] Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`[DatabaseCollector] Falling back to not-connected mode`);
      this.isConnected = false;
    }
  }

  async collect(context: CollectorContext): Promise<CollectedFact[]> {
    const facts: CollectedFact[] = [];
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
      } else if (includeFinancingTables) {
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
          } else {
            // 表不存在时添加占位信息
            facts.push(this.createTableNotFoundFact(tableName, timestamp));
          }
        }
      } else {
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
    } catch (error) {
      console.error(`[DatabaseCollector] Collection failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return facts;
  }

  async checkAvailability(context: CollectorContext): Promise<{ available: boolean; reason?: string }> {
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

  async cleanup(): Promise<void> {
    if (this.connection) {
      try {
        await this.closeConnection(this.connection);
      } catch {
        // 忽略关闭错误
      }
      this.connection = null;
    }
    this.isConnected = false;
  }

  /**
   * 创建未连接状态的事实
   */
  private createNotConnectedFact(timestamp: string): CollectedFact {
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
  private createTableNotFoundFact(tableName: string, timestamp: string): CollectedFact {
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
  private async collectTable(tableName: string, timestamp: string): Promise<CollectedFact | null> {
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

      const tableFact: TableStructureFact = {
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
    } catch (error) {
      console.error(`[DatabaseCollector] Failed to collect table ${tableName}: ${error}`);
      return null;
    }
  }

  /**
   * 创建表结构事实
   */
  private createTableFact(table: TableStructureFact, timestamp: string): CollectedFact {
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
  private isSensitiveField(fieldName: string): boolean {
    const lower = fieldName.toLowerCase();
    return this.sensitivePatterns.some(pattern => lower.includes(pattern.toLowerCase()));
  }

  /**
   * 脱敏样本数据
   */
  private maskSampleData(data: Record<string, unknown>[] | undefined): Record<string, unknown>[] {
    if (!data) return [];
    
    return data.map(row => {
      const masked: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (this.isSensitiveField(key)) {
          masked[key] = '***';
        } else {
          masked[key] = value;
        }
      }
      return masked;
    });
  }

  /**
   * 获取所有表
   */
  private async fetchAllTables(): Promise<string[]> {
    const dbType = this.config.options?.connection?.type || 'oracle';
    
    let query: string;
    if (dbType === 'oracle') {
      query = `SELECT TABLE_NAME FROM USER_TABLES ORDER BY TABLE_NAME`;
    } else if (dbType === 'postgresql') {
      query = `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
    } else if (dbType === 'mysql') {
      query = `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`;
    } else {
      return [];
    }

    try {
      const result = await this.executeQuery(query);
      return result.map((row: any) => row.TABLE_NAME || row.table_name);
    } catch {
      return [];
    }
  }

  /**
   * 获取表列信息
   */
  private async fetchTableColumns(tableName: string): Promise<ColumnInfo[]> {
    const dbType = this.config.options?.connection?.type || 'oracle';
    
    let query: string;
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
    } else if (dbType === 'postgresql') {
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
    } else {
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
      return result.map((row: any) => this.mapToColumnInfo(row, dbType));
    } catch {
      return [];
    }
  }

  /**
   * 获取外键信息
   */
  private async fetchForeignKeys(tableName: string): Promise<ForeignKeyInfo[]> {
    const dbType = this.config.options?.connection?.type || 'oracle';
    
    let query: string;
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
    } else if (dbType === 'postgresql') {
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
    } else {
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
      return result.map((row: any) => ({
        columnName: row.COLUMN_NAME || row.column_name,
        referencedTable: row.REFERENCED_TABLE || row.referenced_table_name,
        referencedColumn: row.REFERENCED_COLUMN || row.referenced_column_name,
        constraintName: row.CONSTRAINT_NAME || row.constraint_name
      }));
    } catch {
      return [];
    }
  }

  /**
   * 获取索引信息
   */
  private async fetchIndexes(tableName: string): Promise<IndexInfo[]> {
    const dbType = this.config.options?.connection?.type || 'oracle';
    
    let query: string;
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
    } else if (dbType === 'postgresql') {
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
    } else {
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
      const indexMap = new Map<string, IndexInfo>();
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
        indexMap.get(indexName)!.columns.push(row.COLUMN_NAME || row.column_name);
      }
      
      return Array.from(indexMap.values());
    } catch {
      return [];
    }
  }

  /**
   * 获取行数
   */
  private async fetchRowCount(tableName: string): Promise<number> {
    const query = `SELECT COUNT(*) as cnt FROM ${tableName}`;
    try {
      const result = await this.executeQuery(query);
      return result[0]?.CNT || result[0]?.cnt || 0;
    } catch {
      return 0;
    }
  }

  /**
   * 获取样本数据
   */
  private async fetchSampleData(tableName: string): Promise<Record<string, unknown>[]> {
    const maxRows = this.config.options?.maxSampleRows || 5;
    const query = `SELECT * FROM ${tableName} FETCH FIRST ${maxRows} ROWS ONLY`;
    
    try {
      return await this.executeQuery(query);
    } catch {
      return [];
    }
  }

  /**
   * 执行查询
   */
  private async executeQuery(query: string, params?: any[]): Promise<any[]> {
    if (!this.connection) return [];
    
    try {
      if (Array.isArray(params) && params.length > 0) {
        const result = await this.connection.execute(query, params);
        return result.rows || [];
      } else {
        const result = await this.connection.execute(query);
        return result.rows || [];
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * 创建数据库连接
   */
  private async createConnection(config: any): Promise<any> {
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
      } catch (error) {
        throw new Error(`Oracle connection failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (type === 'postgresql') {
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
    } else if (type === 'mysql') {
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
  private async closeConnection(connection: any): Promise<void> {
    if (connection && typeof connection.close === 'function') {
      await connection.close();
    }
  }

  /**
   * 获取模式名
   */
  private getSchemaName(): string {
    return this.config.options?.connection?.database || 'UNKNOWN';
  }

  /**
   * 映射列为 ColumnInfo
   */
  private mapToColumnInfo(row: any, dbType: string): ColumnInfo {
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
    } else if (dbType === 'postgresql') {
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
    } else {
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
export function createDatabaseCollectorConfig(
  name: string = 'database-collector',
  options?: DatabaseCollectorConfig['options']
): DatabaseCollectorConfig {
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
export function createDatabaseCollector(config: DatabaseCollectorConfig): Collector {
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
export function createFinancingDatabaseCollectorConfig(
  connection: DatabaseCollectorConfig['options'] extends { connection: infer C } ? NonNullable<C> : never,
  options?: {
    includeSampleData?: boolean;
    maxSampleRows?: number;
    includeIndexes?: boolean;
    maskSensitive?: boolean;
    sensitiveFieldPatterns?: string[];
  }
): DatabaseCollectorConfig {
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
