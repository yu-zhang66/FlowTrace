/**
 * Database Observation Model
 * 
 * Provides database verification capabilities for dual-run scenarios,
 * including snapshot comparison, data masking, and critical field analysis.
 */

import { z } from 'zod';

// ============================================================
// Database Configuration
// ============================================================

export const DatabaseType = z.enum(['oracle', 'postgresql', 'mysql', 'sqlserver']);
export type DatabaseType = z.infer<typeof DatabaseType>;

export const DatabaseConfigSchema = z.object({
  type: DatabaseType,
  host: z.string(),
  port: z.number(),
  database: z.string(),
  username: z.string(),
  // Password should be provided via environment variable, not in config
  passwordEnvVar: z.string().default('DB_PASSWORD'),
  // Connection string for advanced configurations
  connectionString: z.string().optional(),
  // Oracle specific
  serviceName: z.string().optional(),
  // Connection pool settings
  poolMin: z.number().default(1),
  poolMax: z.number().default(5),
  // Timeout settings
  connectTimeout: z.number().default(10000),
  queryTimeout: z.number().default(30000),
  // Read-only mode (enforced)
  readOnly: z.boolean().default(true),
  // SSL settings
  ssl: z.boolean().default(false)
});
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

// ============================================================
// Data Masking Rules
// ============================================================

export const DataMaskingRuleSchema = z.object({
  field: z.string().describe('Field name or pattern (supports wildcards)'),
  type: z.enum(['mask', 'hash', 'null', 'redact', 'pattern']),
  pattern: z.string().optional().describe('Pattern for redaction'),
  replacement: z.string().optional().describe('Replacement string'),
  length: z.number().optional().describe('Length for hash truncation')
});
export type DataMaskingRule = z.infer<typeof DataMaskingRuleSchema>;

export const DataMaskingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  rules: z.array(DataMaskingRuleSchema).default([
    // Default masking rules
    { field: 'password', type: 'redact' },
    { field: '*password*', type: 'redact' },
    { field: 'token', type: 'redact' },
    { field: '*token*', type: 'redact' },
    { field: 'secret', type: 'redact' },
    { field: 'key', type: 'mask', pattern: '***' },
    { field: 'ssn', type: 'pattern', pattern: '***-**-****' },
    { field: 'credit_card', type: 'pattern', pattern: '****-****-****-****' },
    { field: 'phone', type: 'pattern', pattern: '***-****-****' },
    { field: 'email', type: 'pattern', pattern: '***@***.***' }
  ])
});
export type DataMaskingConfig = z.infer<typeof DataMaskingConfigSchema>;

// ============================================================
// Table and Column Definitions
// ============================================================

export const ColumnInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  keyType: z.enum(['PRIMARY', 'FOREIGN', 'INDEX', 'NONE']).optional(),
  defaultValue: z.string().optional(),
  comment: z.string().optional()
});
export type ColumnInfo = z.infer<typeof ColumnInfoSchema>;

export const ForeignKeyInfoSchema = z.object({
  column: z.string(),
  referencedTable: z.string(),
  referencedColumn: z.string(),
  onDelete: z.enum(['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION']).optional()
});
export type ForeignKeyInfo = z.infer<typeof ForeignKeyInfoSchema>;

export const IndexInfoSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean(),
  type: z.string().optional()
});
export type IndexInfo = z.infer<typeof IndexInfoSchema>;

export const TableSchemaSchema = z.object({
  tableName: z.string(),
  columns: z.array(ColumnInfoSchema),
  primaryKey: z.array(z.string()),
  foreignKeys: z.array(ForeignKeyInfoSchema).optional(),
  indexes: z.array(IndexInfoSchema).optional(),
  comment: z.string().optional()
});
export type TableSchema = z.infer<typeof TableSchemaSchema>;

// ============================================================
// Database Snapshot
// ============================================================

export const RowSnapshotSchema = z.record(z.unknown());
export type RowSnapshot = z.infer<typeof RowSnapshotSchema>;

export const TableSnapshotSchema = z.object({
  tableName: z.string(),
  rows: z.array(RowSnapshotSchema),
  rowCount: z.number(),
  columns: z.array(z.string()),
  maskedFields: z.array(z.string()).describe('Fields that were masked in this snapshot'),
  takenAt: z.string().datetime()
});
export type TableSnapshot = z.infer<typeof TableSnapshotSchema>;

export const DatabaseSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  database: z.string(),
  tables: z.record(TableSnapshotSchema),
  totalRows: z.number(),
  takenAt: z.string().datetime(),
  metadata: z.object({
    databaseType: DatabaseType,
    maskedFields: z.array(z.string()),
    filteredFields: z.array(z.string()).describe('Fields excluded from snapshot')
  })
});
export type DatabaseSnapshot = z.infer<typeof DatabaseSnapshotSchema>;

// ============================================================
// Database Queries
// ============================================================

export const DatabaseQuerySchema = z.object({
  sql: z.string().describe('SQL query (should be SELECT only for safety)'),
  params: z.record(z.unknown()).optional(),
  timeout: z.number().default(30000),
  maxRows: z.number().default(1000)
});
export type DatabaseQuery = z.infer<typeof DatabaseQuerySchema>;

// ============================================================
// Database Changes
// ============================================================

export const RowChangeSchema = z.object({
  operation: z.enum(['INSERT', 'UPDATE', 'DELETE']),
  rowKey: z.record(z.unknown()).describe('Primary key values'),
  before: RowSnapshotSchema.optional().describe('State before change'),
  after: RowSnapshotSchema.optional().describe('State after change'),
  changedFields: z.array(z.object({
    field: z.string(),
    oldValue: z.unknown(),
    newValue: z.unknown()
  })).optional()
});
export type RowChange = z.infer<typeof RowChangeSchema>;

export const TableChangesSchema = z.object({
  tableName: z.string(),
  insertCount: z.number().default(0),
  updateCount: z.number().default(0),
  deleteCount: z.number().default(0),
  changes: z.array(RowChangeSchema)
});
export type TableChanges = z.infer<typeof TableChangesSchema>;

export const DatabaseChangeSchema = z.object({
  snapshotId: z.string(),
  tables: z.record(TableChangesSchema),
  summary: z.object({
    totalInserts: z.number(),
    totalUpdates: z.number(),
    totalDeletes: z.number(),
    tablesAffected: z.number()
  }),
  timestamp: z.string().datetime()
});
export type DatabaseChange = z.infer<typeof DatabaseChangeSchema>;

// ============================================================
// Database Comparison
// ============================================================

export const FieldComparisonResultSchema = z.object({
  field: z.string(),
  legacyValue: z.unknown(),
  currentValue: z.unknown(),
  match: z.boolean(),
  difference: z.enum(['added', 'removed', 'changed', 'equal']),
  isCritical: z.boolean().describe('Whether this field is critical for business'),
  isIgnored: z.boolean().describe('Whether this field should be ignored'),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']).optional()
});
export type FieldComparisonResult = z.infer<typeof FieldComparisonResultSchema>;

export const TableComparisonResultSchema = z.object({
  tableName: z.string(),
  match: z.boolean(),
  rowCountMatch: z.boolean(),
  legacyRowCount: z.number(),
  currentRowCount: z.number(),
  fieldComparisons: z.array(FieldComparisonResultSchema),
  missingRows: z.array(RowSnapshotSchema).optional(),
  extraRows: z.array(RowSnapshotSchema).optional(),
  changes: z.array(RowChangeSchema).optional()
});
export type TableComparisonResult = z.infer<typeof TableComparisonResultSchema>;

export const DatabaseComparisonResultSchema = z.object({
  id: z.string(),
  legacySnapshotId: z.string(),
  currentSnapshotId: z.string(),
  comparedAt: z.string().datetime(),
  
  overallMatch: z.boolean(),
  
  tableComparisons: z.record(TableComparisonResultSchema),
  
  summary: z.object({
    totalTables: z.number(),
    matchingTables: z.number(),
    differentTables: z.number(),
    totalCriticalDifferences: z.number(),
    totalDifferences: z.number()
  }),
  
  criticalDifferences: z.array(z.object({
    table: z.string(),
    field: z.string(),
    legacyValue: z.unknown(),
    currentValue: z.unknown(),
    description: z.string()
  })),
  
  blockingDifferences: z.array(z.string()).describe('IDs of blocking differences'),
  
  metadata: z.object({
    ignoredFields: z.array(z.string()),
    maskedFields: z.array(z.string()),
    comparisonConfig: z.record(z.unknown()).optional()
  })
});
export type DatabaseComparisonResult = z.infer<typeof DatabaseComparisonResultSchema>;

// ============================================================
// Database Assertion
// ============================================================

export const DatabaseAssertionSchema = z.object({
  id: z.string(),
  description: z.string(),
  query: DatabaseQuerySchema,
  assertion: z.enum(['hasRows', 'noRows', 'rowCount', 'fieldValue', 'fieldExists']),
  expected: z.unknown(),
  critical: z.boolean().default(false),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2')
});
export type DatabaseAssertion = z.infer<typeof DatabaseAssertionSchema>;

export const DatabaseAssertionResultSchema = z.object({
  assertionId: z.string(),
  passed: z.boolean(),
  actual: z.unknown(),
  expected: z.unknown(),
  message: z.string(),
  timestamp: z.string().datetime()
});
export type DatabaseAssertionResult = z.infer<typeof DatabaseAssertionResultSchema>;

// ============================================================
// Database Verification Result
// ============================================================

export const DatabaseVerificationResultSchema = z.object({
  scenarioId: z.string(),
  
  // Snapshots
  beforeSnapshot: DatabaseSnapshotSchema.optional(),
  afterLegacySnapshot: DatabaseSnapshotSchema.optional(),
  afterCurrentSnapshot: DatabaseSnapshotSchema.optional(),
  
  // Changes
  legacyChanges: DatabaseChangeSchema.optional(),
  currentChanges: DatabaseChangeSchema.optional(),
  
  // Comparisons
  legacyComparison: DatabaseComparisonResultSchema.optional(),
  currentComparison: DatabaseComparisonResultSchema.optional(),
  
  // Assertions
  assertions: z.array(DatabaseAssertionResultSchema),
  
  // Overall result
  passed: z.boolean(),
  blockingDifferences: z.array(z.string()),
  
  metadata: z.object({
    databaseType: DatabaseType,
    tablesVerified: z.array(z.string()),
    criticalFields: z.array(z.string()),
    ignoredFields: z.array(z.string())
  })
});
export type DatabaseVerificationResult = z.infer<typeof DatabaseVerificationResultSchema>;

// ============================================================
// Database Observer Interface
// ============================================================

export interface DatabaseObserver {
  // Connection management
  connect(config: DatabaseConfig): Promise<void>;
  disconnect(): Promise<void>;
  
  // Schema inspection
  getSchema(tableName: string): Promise<TableSchema>;
  listTables(): Promise<string[]>;
  
  // Snapshot operations
  takeSnapshot(options?: {
    tables?: string[];
    where?: Record<string, unknown>;
    maxRows?: number;
  }): Promise<DatabaseSnapshot>;
  
  // Query execution (read-only)
  query(query: DatabaseQuery): Promise<RowSnapshot[]>;
  
  // Data masking
  applyMasking(data: RowSnapshot[], rules: DataMaskingRule[]): RowSnapshot[];
  
  // Comparison
  compareSnapshots(
    before: DatabaseSnapshot,
    after: DatabaseSnapshot,
    options?: {
      compareKeys?: string[];
      ignoreFields?: string[];
      criticalFields?: string[];
    }
  ): Promise<DatabaseComparisonResult>;
  
  // Assertions
  assert(assertion: DatabaseAssertion): Promise<DatabaseAssertionResult>;
  
  // Transaction management (for test data setup)
  beginTransaction(): Promise<void>;
  rollback(): Promise<void>;
  commit(): Promise<void>;
}

// ============================================================
// Critical Fields Configuration
// ============================================================

export const CRITICAL_BUSINESS_FIELDS = [
  'status',
  'amount',
  'approved_amount',
  'rejected_amount',
  'balance',
  'credit_limit',
  'interest_rate',
  'term',
  'repayment_date',
  'approval_status',
  'risk_level',
  'customer_id',
  'account_id',
  'contract_id'
];

export const IGNORABLE_TECHNICAL_FIELDS = [
  'id',
  'uuid',
  'create_time',
  'create_time',
  'update_time',
  'update_by',
  'create_by',
  'version',
  'row_version',
  'last_modified',
  'last_modified_by',
  'trace_id',
  'workflow_instance_id',
  'workflow_task_id',
  'process_instance_id',
  'process_definition_id',
  'ip_address',
  'user_agent',
  'request_id',
  'session_id'
];

// ============================================================
// Default Comparison Configuration
// ============================================================

export const DEFAULT_DATABASE_COMPARISON_CONFIG = {
  criticalFields: CRITICAL_BUSINESS_FIELDS,
  ignoreFields: IGNORABLE_TECHNICAL_FIELDS,
  ignoreFieldPatterns: [
    '^_.*',
    '.*_id$',
    '.*timestamp$',
    '.*time$',
    '.*by$',
    '.*ip$',
    '.*agent$',
    '.*version$'
  ],
  maxTolerance: {
    // Allow small differences in numeric fields due to rounding
    amount: 0.01,
    rate: 0.0001
  }
};
