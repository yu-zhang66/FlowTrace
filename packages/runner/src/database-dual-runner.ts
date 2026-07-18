/**
 * Database Dual-Run Executor
 * 
 * 支持新旧系统数据库的双跑、快照和比较
 */

export interface DatabaseConfig {
  type: 'oracle' | 'postgresql' | 'mysql';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export interface DatabaseSnapshot {
  timestamp: string;
  tables: Record<string, TableSnapshot>;
}

export interface TableSnapshot {
  rowCount: number;
  rows: Record<string, unknown>[];
  checksum?: string;
}

export interface DatabaseChange {
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  keyField: string;
  keyValue: unknown;
}

export interface DatabaseComparisonResult {
  consistent: boolean;
  changes: {
    legacy: DatabaseChange[];
    current: DatabaseChange[];
  };
  differences: DatabaseDifference[];
  summary: {
    totalChanges: number;
    matchingChanges: number;
    differingChanges: number;
    missingInCurrent: number;
    extraInCurrent: number;
  };
}

export interface DatabaseDifference {
  table: string;
  field: string;
  category: 'value_mismatch' | 'missing_row' | 'extra_row' | 'structure_mismatch';
  legacyValue?: unknown;
  currentValue?: unknown;
  description: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  blocking: boolean;
  criticalBusinessField: boolean;
}

export interface DataMaskingRule {
  pattern: RegExp;
  replacement: string;
}

export const DEFAULT_MASKING_PATTERNS: DataMaskingRule[] = [
  { pattern: /\b\d{11}\b/g, replacement: '***PHONE***' },  // 手机号
  { pattern: /\b\d{18}\b/g, replacement: '***ID***' },     // 身份证
  { pattern: /\b\d{16,19}\b/g, replacement: '***CARD***' }, // 银行卡
  { pattern: /password[:=]\s*\S+/gi, replacement: 'password=***' },
  { pattern: /secret[:=]\s*\S+/gi, replacement: 'secret=***' },
  { pattern: /token[:=]\s*\S+/gi, replacement: 'token=***' },
];

/**
 * Database Dual Runner
 */
export class DatabaseDualRunner {
  private legacyConnection: any = null;
  private currentConnection: any = null;
  private legacyConfig?: DatabaseConfig;
  private currentConfig?: DatabaseConfig;
  private maskingRules: DataMaskingRule[];
  private criticalFields: string[];
  private ignoredFields: string[];

  constructor(options?: {
    legacyConfig?: DatabaseConfig;
    currentConfig?: DatabaseConfig;
    maskingRules?: DataMaskingRule[];
    criticalFields?: string[];
    ignoredFields?: string[];
  }) {
    this.legacyConfig = options?.legacyConfig;
    this.currentConfig = options?.currentConfig;
    this.maskingRules = options?.maskingRules || DEFAULT_MASKING_PATTERNS;
    this.criticalFields = options?.criticalFields || [
      'financing_amount', 'approved_amount', 'status', 'state',
      'core_enterprise', 'supplier', 'contract_id'
    ];
    this.ignoredFields = options?.ignoredFields || [
      'id', 'create_time', 'update_time', 'create_by', 'update_by',
      'request_id', 'trace_id', 'timestamp', 'version'
    ];
  }

  /**
   * 连接数据库
   */
  async connect(): Promise<void> {
    if (this.legacyConfig) {
      this.legacyConnection = await this.createConnection(this.legacyConfig);
    }
    if (this.currentConfig) {
      this.currentConnection = await this.createConnection(this.currentConfig);
    }
  }

  /**
   * 断开数据库连接
   */
  async disconnect(): Promise<void> {
    if (this.legacyConnection) {
      try { await this.legacyConnection.close(); } catch {}
      this.legacyConnection = null;
    }
    if (this.currentConnection) {
      try { await this.currentConnection.close(); } catch {}
      this.currentConnection = null;
    }
  }

  /**
   * 创建数据库连接
   */
  private async createConnection(config: DatabaseConfig): Promise<any> {
    const { type, host, port, database, username, password } = config;

    if (type === 'oracle') {
      const oracledb = await import('oracledb');
      return await oracledb.getConnection({ user: username, password, connectString: `${host}:${port}/${database}` });
    } else if (type === 'postgresql') {
      const { Client } = await import('pg');
      const client = new Client({ host, port, database, user: username, password });
      await client.connect();
      return client;
    } else if (type === 'mysql') {
      const mysql = await import('mysql2/promise');
      return await mysql.createConnection({ host, port, database, user: username, password });
    }

    throw new Error(`Unsupported database type: ${type}`);
  }

  /**
   * 拍摄数据库快照
   */
  async snapshot(connection?: any, tables?: string[]): Promise<DatabaseSnapshot> {
    const conn = connection || this.legacyConnection;
    if (!conn) {
      throw new Error('No database connection available');
    }

    const snapshot: DatabaseSnapshot = {
      timestamp: new Date().toISOString(),
      tables: {}
    };

    const tablesToCapture = tables || await this.getTables(conn);

    for (const table of tablesToCapture) {
      snapshot.tables[table] = await this.captureTable(conn, table);
    }

    return snapshot;
  }

  /**
   * 获取表列表
   */
  private async getTables(connection: any): Promise<string[]> {
    const dbType = this.legacyConfig?.type || 'oracle';
    let query: string;

    if (dbType === 'oracle') {
      query = 'SELECT TABLE_NAME FROM USER_TABLES';
    } else if (dbType === 'postgresql') {
      query = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'";
    } else {
      query = 'SHOW TABLES';
    }

    const result = await this.executeQuery(connection, query);
    return result.map((row: any) => row.TABLE_NAME || row.table_name || row[Object.keys(row)[0]]);
  }

  /**
   * 捕获单个表
   */
  private async captureTable(connection: any, tableName: string): Promise<TableSnapshot> {
    const query = `SELECT * FROM ${tableName} FETCH FIRST 100 ROWS ONLY`;
    
    try {
      const rows = await this.executeQuery(connection, query);
      const maskedRows = rows.map(row => this.maskData(row));
      
      return {
        rowCount: rows.length,
        rows: maskedRows,
        checksum: this.calculateChecksum(maskRows)
      };
    } catch (error) {
      console.error(`Failed to capture table ${tableName}: ${error}`);
      return { rowCount: 0, rows: [] };
    }
  }

  /**
   * 脱敏数据
   */
  private maskData(data: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      
      // 检查是否应该脱敏
      if (this.shouldMask(lowerKey)) {
        masked[key] = '***MASKED***';
      } else if (typeof value === 'string') {
        masked[key] = this.applyMaskingRules(value);
      } else {
        masked[key] = value;
      }
    }
    
    return masked;
  }

  /**
   * 检查是否应该脱敏
   */
  private shouldMask(key: string): boolean {
    const sensitivePatterns = ['password', 'secret', 'token', 'account', 'id_card', 
                               'bank_account', 'phone', 'mobile', 'email', 'address', 'name'];
    return sensitivePatterns.some(p => key.includes(p));
  }

  /**
   * 应用脱敏规则
   */
  private applyMaskingRules(value: string): string {
    let result = value;
    for (const rule of this.maskingRules) {
      result = result.replace(rule.pattern, rule.replacement);
    }
    return result;
  }

  /**
   * 计算校验和
   */
  private calculateChecksum(data: unknown[]): string {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * 比较数据库快照
   */
  compareSnapshots(before: DatabaseSnapshot, after: DatabaseSnapshot): DatabaseChange[] {
    const changes: DatabaseChange[] = [];

    // 比较每个表
    for (const [tableName, afterTable] of Object.entries(after.tables)) {
      const beforeTable = before.tables[tableName];
      
      if (!beforeTable) {
        // 新增的表或数据
        for (const row of afterTable.rows) {
          const keyField = this.getPrimaryKey(row);
          changes.push({
            table: tableName,
            operation: 'INSERT',
            after: row,
            keyField: keyField.field,
            keyValue: keyField.value
          });
        }
        continue;
      }

      // 比较行数据
      const beforeRows = new Map(
        beforeTable.rows.map(row => [this.getRowKey(row), row])
      );
      const afterRows = new Map(
        afterTable.rows.map(row => [this.getRowKey(row), row])
      );

      // 检查新增
      for (const [key, row] of afterRows) {
        if (!beforeRows.has(key)) {
          changes.push({
            table: tableName,
            operation: 'INSERT',
            after: row,
            keyField: this.getPrimaryKey(row).field,
            keyValue: this.getPrimaryKey(row).value
          });
        }
      }

      // 检查删除
      for (const [key, row] of beforeRows) {
        if (!afterRows.has(key)) {
          changes.push({
            table: tableName,
            operation: 'DELETE',
            before: row,
            keyField: this.getPrimaryKey(row).field,
            keyValue: this.getPrimaryKey(row).value
          });
        }
      }

      // 检查修改
      for (const [key, afterRow] of afterRows) {
        const beforeRow = beforeRows.get(key);
        if (beforeRow) {
          const diff = this.compareRows(beforeRow, afterRow);
          if (diff) {
            changes.push({
              table: tableName,
              operation: 'UPDATE',
              before: beforeRow,
              after: afterRow,
              keyField: this.getPrimaryKey(afterRow).field,
              keyValue: this.getPrimaryKey(afterRow).value
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * 比较两行数据
   */
  private compareRows(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(after)) {
      if (this.ignoredFields.includes(key.toLowerCase())) continue;
      if (before[key] !== value) return true;
    }
    return false;
  }

  /**
   * 获取行主键
   */
  private getRowKey(row: Record<string, unknown>): string {
    const keyField = this.getPrimaryKey(row);
    return `${keyField.field}=${keyField.value}`;
  }

  /**
   * 获取主键字段
   */
  private getPrimaryKey(row: Record<string, unknown>): { field: string; value: unknown } {
    // 优先使用 id 字段
    if ('id' in row) return { field: 'id', value: row.id };
    if ('ID' in row) return { field: 'ID', value: row.ID };
    if ('application_id' in row) return { field: 'application_id', value: row.application_id };
    if ('APPLICATION_ID' in row) return { field: 'APPLICATION_ID', value: row.APPLICATION_ID };

    // 使用第一个字段
    const keys = Object.keys(row);
    return { field: keys[0], value: row[keys[0]] };
  }

  /**
   * 执行双跑比较
   */
  async executeDualComparison(
    legacySnapshot: DatabaseSnapshot,
    legacyAfterSnapshot: DatabaseSnapshot,
    currentSnapshot: DatabaseSnapshot,
    currentAfterSnapshot: DatabaseSnapshot
  ): Promise<DatabaseComparisonResult> {
    // 获取变化
    const legacyChanges = this.compareSnapshots(legacySnapshot, legacyAfterSnapshot);
    const currentChanges = this.compareSnapshots(currentSnapshot, currentAfterSnapshot);

    // 比较变化
    const differences = this.compareChanges(legacyChanges, currentChanges);

    // 汇总
    const summary = {
      totalChanges: legacyChanges.length + currentChanges.length,
      matchingChanges: this.countMatchingChanges(legacyChanges, currentChanges),
      differingChanges: differences.filter(d => d.severity !== 'P3').length,
      missingInCurrent: differences.filter(d => d.category === 'missing_row').length,
      extraInCurrent: differences.filter(d => d.category === 'extra_row').length
    };

    return {
      consistent: differences.filter(d => d.severity === 'P0' || d.severity === 'P1').length === 0,
      changes: {
        legacy: legacyChanges,
        current: currentChanges
      },
      differences,
      summary
    };
  }

  /**
   * 比较变化
   */
  private compareChanges(
    legacy: DatabaseChange[],
    current: DatabaseChange[]
  ): DatabaseDifference[] {
    const differences: DatabaseDifference[] = [];

    // 按表分组
    const legacyByTable = this.groupByTable(legacy);
    const currentByTable = this.groupByTable(current);

    const allTables = new Set([...Object.keys(legacyByTable), ...Object.keys(currentByTable)]);

    for (const table of allTables) {
      const legacyTable = legacyByTable[table] || [];
      const currentTable = currentByTable[table] || [];

      this.compareTableChanges(table, legacyTable, currentTable, differences);
    }

    return differences;
  }

  /**
   * 按表分组
   */
  private groupByTable(changes: DatabaseChange[]): Record<string, DatabaseChange[]> {
    const grouped: Record<string, DatabaseChange[]> = {};
    for (const change of changes) {
      if (!grouped[change.table]) {
        grouped[change.table] = [];
      }
      grouped[change.table].push(change);
    }
    return grouped;
  }

  /**
   * 比较表变化
   */
  private compareTableChanges(
    table: string,
    legacy: DatabaseChange[],
    current: DatabaseChange[],
    differences: DatabaseDifference[]
  ): void {
    // 比较操作数
    if (legacy.length !== current.length) {
      differences.push({
        table,
        field: '*',
        category: 'structure_mismatch',
        legacyValue: legacy.length,
        currentValue: current.length,
        description: `变化数量不一致: 旧=${legacy.length}, 新=${current.length}`,
        severity: this.isCriticalTable(table) ? 'P0' : 'P2',
        blocking: this.isCriticalTable(table),
        criticalBusinessField: this.isCriticalTable(table)
      });
    }

    // 比较每个操作
    const legacyMap = new Map(legacy.map(c => [c.keyValue, c]));
    const currentMap = new Map(current.map(c => [c.keyValue, c]));

    // 检查缺失
    for (const [key, change] of legacyMap) {
      if (!currentMap.has(key)) {
        differences.push({
          table,
          field: change.keyField,
          category: 'missing_row',
          legacyValue: change.after || change.before,
          description: `新系统缺少旧系统的变化: ${change.operation} ${table}.${change.keyField}=${key}`,
          severity: this.isCriticalTable(table) ? 'P0' : 'P1',
          blocking: this.isCriticalTable(table),
          criticalBusinessField: this.isCriticalTable(table)
        });
      }
    }

    // 检查多余
    for (const [key, change] of currentMap) {
      if (!legacyMap.has(key)) {
        differences.push({
          table,
          field: change.keyField,
          category: 'extra_row',
          currentValue: change.after || change.before,
          description: `新系统有旧系统没有的变化: ${change.operation} ${table}.${change.keyField}=${key}`,
          severity: this.isCriticalTable(table) ? 'P0' : 'P1',
          blocking: this.isCriticalTable(table),
          criticalBusinessField: this.isCriticalTable(table)
        });
      }
    }

    // 比较具体字段值
    for (const [key, legacyChange] of legacyMap) {
      const currentChange = currentMap.get(key);
      if (currentChange) {
        this.compareChangeFields(table, legacyChange, currentChange, differences);
      }
    }
  }

  /**
   * 比较变化字段
   */
  private compareChangeFields(
    table: string,
    legacy: DatabaseChange,
    current: DatabaseChange,
    differences: DatabaseDifference[]
  ): void {
    const legacyData = legacy.after || legacy.before || {};
    const currentData = current.after || current.before || {};

    for (const [field, legacyValue] of Object.entries(legacyData)) {
      if (this.ignoredFields.includes(field.toLowerCase())) continue;

      const currentValue = currentData[field];
      
      if (currentValue !== legacyValue) {
        const isCritical = this.isCriticalField(field);
        
        differences.push({
          table,
          field,
          category: 'value_mismatch',
          legacyValue: this.maskIfSensitive(field, legacyValue),
          currentValue: this.maskIfSensitive(field, currentValue),
          description: `字段值不一致: ${table}.${field}`,
          severity: isCritical ? 'P0' : 'P2',
          blocking: isCritical,
          criticalBusinessField: isCritical
        });
      }
    }
  }

  /**
   * 是否为关键表
   */
  private isCriticalTable(table: string): boolean {
    const criticalTables = ['financing_application', 'financing_transfer', 'payment'];
    return criticalTables.some(t => table.toLowerCase().includes(t));
  }

  /**
   * 是否为关键字段
   */
  private isCriticalField(field: string): boolean {
    return this.criticalFields.some(f => field.toLowerCase().includes(f.toLowerCase()));
  }

  /**
   * 敏感字段脱敏
   */
  private maskIfSensitive(field: string, value: unknown): unknown {
    if (this.shouldMask(field.toLowerCase()) && typeof value === 'string') {
      return '***MASKED***';
    }
    return value;
  }

  /**
   * 计算匹配的变化数量
   */
  private countMatchingChanges(legacy: DatabaseChange[], current: DatabaseChange[]): number {
    let count = 0;
    const currentKeys = new Set(current.map(c => `${c.table}:${c.keyValue}`));
    
    for (const change of legacy) {
      const key = `${change.table}:${change.keyValue}`;
      if (currentKeys.has(key)) {
        count++;
      }
    }
    
    return count;
  }

  /**
   * 执行查询
   */
  private async executeQuery(connection: any, query: string): Promise<any[]> {
    try {
      if (typeof connection.execute === 'function') {
        const result = await connection.execute(query);
        return result.rows || [];
      } else {
        const [rows] = await connection.query(query);
        return rows;
      }
    } catch (error) {
      console.error(`Query failed: ${query}`, error);
      return [];
    }
  }
}

/**
 * 创建 Database Dual Runner
 */
export function createDatabaseDualRunner(options?: {
  legacyConfig?: DatabaseConfig;
  currentConfig?: DatabaseConfig;
  criticalFields?: string[];
}): DatabaseDualRunner {
  return new DatabaseDualRunner(options);
}
