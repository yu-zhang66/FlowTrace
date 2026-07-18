/**
 * Enhanced Scenario Model
 * 
 * Upgrades the basic Scenario model to include:
 * - Business goal and background
 * - Detailed execution steps (browser, API, database)
 * - Evidence collection requirements
 * - Comparison rules
 * - Generation metadata
 * - Legacy and current system specifics
 */

import { z } from 'zod';
import { 
  BrowserStepSchema, 
  BrowserStep, 
  BrowserEvidenceSchema,
  EvidenceCollectionSchema,
  EvidenceCollection 
} from './browser.js';
import { BusinessActionType, ScenarioActionSchema } from './scenario.js';

// ============================================================
// Actor Definition
// ============================================================

export const ActorRefSchema = z.object({
  role: z.string(),
  usernameRef: z.string().describe('Reference to username in test data'),
  description: z.string().optional()
});
export type ActorRef = z.infer<typeof ActorRefSchema>;

// ============================================================
// Test Data
// ============================================================

export const TestDataSchema = z.record(z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
  z.array(z.number())
]));
export type TestData = z.infer<typeof TestDataSchema>;

// ============================================================
// Preconditions
// ============================================================

export const PreconditionSchema = z.object({
  description: z.string(),
  type: z.enum(['data', 'system', 'permission', 'state']),
  dataRef: z.string().optional().describe('Reference to test data key'),
  validation: z.object({
    query: z.string().optional(),
    expectedValue: z.unknown().optional(),
    timeout: z.number().default(5000)
  }).optional()
});
export type Precondition = z.infer<typeof PreconditionSchema>;

// ============================================================
// Execution Channels
// ============================================================

export const ExecutionChannelSchema = z.enum(['browser', 'api', 'database']);
export type ExecutionChannel = z.infer<typeof ExecutionChannelSchema>;

export const ExecutionConfigSchema = z.object({
  channels: z.array(ExecutionChannelSchema).min(1),
  resetBeforeScenario: z.boolean().default(true),
  captureScreenshot: z.boolean().default(true),
  captureNetwork: z.boolean().default(false),
  captureDatabase: z.boolean().default(true),
  parallelExecution: z.boolean().default(false),
  stopOnFirstFailure: z.boolean().default(true)
});
export type ExecutionConfig = z.infer<typeof ExecutionConfigSchema>;

// ============================================================
// API Step Definition
// ============================================================

export const ApiRequestMappingSchema = z.object({
  field: z.string(),
  source: z.enum(['testData', 'context', 'previousStep', 'fixed']),
  path: z.string().optional().describe('JSON path for testData extraction'),
  value: z.unknown().optional().describe('Fixed value when source is fixed')
});
export type ApiRequestMapping = z.infer<typeof ApiRequestMappingSchema>;

export const ApiResponseMappingSchema = z.object({
  target: z.string().describe('Field name in extracted data'),
  sourcePath: z.string().describe('JSON path in API response'),
  transform: z.enum(['string', 'number', 'boolean', 'date', 'direct']).optional()
});
export type ApiResponseMapping = z.infer<typeof ApiResponseMappingSchema>;

export const ApiCallDefinitionSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  endpoint: z.string(),
  headers: z.record(z.string()).optional(),
  request: z.object({
    body: z.record(z.unknown()).optional(),
    query: z.record(z.string()).optional(),
    params: z.record(z.string()).optional(),
    mappings: z.array(ApiRequestMappingSchema).optional()
  }).optional(),
  response: z.object({
    status: z.number(),
    extract: z.array(ApiResponseMappingSchema).optional()
  }).optional(),
  businessMeaning: z.object({
    success: z.string().optional().describe('JMESPath or JSONPath expression for success'),
    businessState: z.string().optional().describe('JMESPath or JSONPath expression for state'),
    errorMessage: z.string().optional()
  }).optional(),
  timeout: z.number().default(30000),
  retry: z.object({
    maxAttempts: z.number().default(3),
    delay: z.number().default(1000),
    onStatus: z.array(z.number()).optional()
  }).optional()
});
export type ApiCallDefinition = z.infer<typeof ApiCallDefinitionSchema>;

export const ApiStepSideSchema = z.object({
  call: ApiCallDefinitionSchema,
  expected: z.object({
    status: z.number().optional(),
    success: z.boolean().optional(),
    businessState: z.string().optional(),
    extractedData: z.record(z.unknown()).optional()
  }).optional()
});
export type ApiStepSide = z.infer<typeof ApiStepSideSchema>;

export const ApiStepSchema = z.object({
  id: z.string(),
  intent: z.string(),
  businessAction: BusinessActionType,
  actor: z.string(),
  old: ApiStepSideSchema.optional(),
  new: ApiStepSideSchema.optional(),
  common: ApiCallDefinitionSchema.optional().describe('Shared API definition if old and new are the same'),
  expected: z.object({
    semanticEvent: z.string().optional(),
    businessState: z.string().optional()
  }).optional(),
  onFailure: z.enum(['continue', 'stop', 'mark-skipped']).default('stop')
});
export type ApiStep = z.infer<typeof ApiStepSchema>;

// ============================================================
// Database Verification
// ============================================================

export const DatabaseQuerySchema = z.object({
  query: z.string(),
  params: z.record(z.unknown()).optional(),
  timeout: z.number().default(10000)
});
export type DatabaseQuery = z.infer<typeof DatabaseQuerySchema>;

export const DatabaseAssertionSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'in', 'contains', 'notNull', 'isNull']),
  expected: z.unknown(),
  message: z.string().optional()
});
export type DatabaseAssertion = z.infer<typeof DatabaseAssertionSchema>;

export const DatabaseStepSchema = z.object({
  id: z.string(),
  intent: z.string(),
  timing: z.enum(['before-scenario', 'after-legacy', 'after-current', 'after-scenario']),
  before: DatabaseQuerySchema.optional(),
  after: DatabaseQuerySchema.optional(),
  assertions: z.array(DatabaseAssertionSchema).optional(),
  compare: z.object({
    equal: z.array(z.string()).optional(),
    ignore: z.array(z.string()).optional(),
    ignorePatterns: z.array(z.string()).optional().describe('Regex patterns for field names to ignore')
  }).optional()
});
export type DatabaseStep = z.infer<typeof DatabaseStepSchema>;

// ============================================================
// Expected Results
// ============================================================

export const ExpectedBusinessResultSchema = z.object({
  finalState: z.string(),
  requiredEvents: z.array(z.string()).optional(),
  forbiddenEvents: z.array(z.string()).optional(),
  businessData: z.record(z.unknown()).optional(),
  notifications: z.array(z.object({
    type: z.string(),
    recipient: z.string(),
    content: z.string()
  })).optional()
});
export type ExpectedBusinessResult = z.infer<typeof ExpectedBusinessResultSchema>;

export const ExpectedApiResultSchema = z.object({
  success: z.boolean(),
  statusCode: z.number().optional(),
  responseFields: z.record(z.unknown()).optional(),
  extractedVariables: z.record(z.string()).optional()
});
export type ExpectedApiResult = z.infer<typeof ExpectedApiResultSchema>;

export const ExpectedDatabaseResultSchema = z.object({
  tables: z.record(z.object({
    rows: z.number().optional(),
    columns: z.record(z.unknown()).optional()
  })).optional()
});
export type ExpectedDatabaseResult = z.infer<typeof ExpectedDatabaseResultSchema>;

// ============================================================
// Comparison Rules
// ============================================================

export const ComparisonRuleSchema = z.object({
  mode: z.enum(['exact', 'semantic', 'lenient']),
  allowReordering: z.boolean().default(false),
  allowParallelization: z.boolean().default(false),
  ignoredFields: z.array(z.string()).default([]),
  customRules: z.array(z.object({
    field: z.string(),
    comparison: z.enum(['exact', 'contains', 'regex', 'custom']),
    expected: z.unknown()
  })).optional()
});
export type ComparisonRule = z.infer<typeof ComparisonRuleSchema>;

// ============================================================
// Semantic Events
// ============================================================

export const SemanticEventSchema = z.enum([
  'APPLICATION_SUBMITTED',
  'ENTERPRISE_APPROVED',
  'ENTERPRISE_REJECTED',
  'ENTERPRISE_RETURNED',
  'RISK_ASSESSED',
  'RISK_APPROVED',
  'RISK_REJECTED',
  'FINANCE_APPROVED',
  'FINANCE_REJECTED',
  'FINANCE_RETURNED',
  'DISBURSEMENT_STARTED',
  'DISBURSEMENT_COMPLETED',
  'APPLICATION_WITHDRAWN',
  'APPLICATION_TRANSFERRED',
  'COUNTERSIGN_STARTED',
  'COUNTERSIGN_COMPLETED',
  'COUNTERSIGN_REJECTED'
]);
export type SemanticEvent = z.infer<typeof SemanticEventSchema>;

// ============================================================
// Generation Metadata
// ============================================================

export const GenerationMetadataSchema = z.object({
  provider: z.enum(['ai', 'deterministic', 'deterministic-fallback']),
  model: z.string().nullable().optional(),
  promptVersion: z.string().nullable().optional(),
  generationTime: z.string().datetime().optional(),
  fallbackReason: z.string().nullable().optional(),
  humanConfirmed: z.boolean().default(false),
  humanConfirmTime: z.string().datetime().nullable().optional(),
  humanConfirmBy: z.string().nullable().optional()
});
export type GenerationMetadata = z.infer<typeof GenerationMetadataSchema>;

// ============================================================
// Evidence Requirements
// ============================================================

export const EvidenceRequirementSchema = z.object({
  screenshots: z.enum(['none', 'before', 'after', 'both']).default('both'),
  network: z.boolean().default(false),
  database: z.boolean().default(true),
  audit: z.boolean().default(true),
  extraction: z.array(z.string()).optional()
});
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;

// ============================================================
// Enhanced Scenario
// ============================================================

export const EnhancedScenarioSchema = z.object({
  // Basic identification
  id: z.string().min(1),
  name: z.string().min(1),
  process: z.string().min(1),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  
  // Business intent
  businessGoal: z.string().describe('What business goal this scenario validates'),
  businessBackground: z.string().optional(),
  
  // Actors
  actors: z.record(ActorRefSchema),
  
  // Test data
  testData: TestDataSchema.optional(),
  
  // Preconditions
  preconditions: z.array(PreconditionSchema).optional(),
  
  // Execution configuration
  execution: ExecutionConfigSchema,
  
  // Detailed steps (replaces simple actions array)
  steps: z.array(z.object({
    id: z.string(),
    intent: z.string(),
    businessAction: BusinessActionType,
    actor: z.string(),
    
    // Browser execution
    browser: BrowserStepSchema.partial().extend({
      legacy: BrowserStepSchema.shape.legacy.optional(),
      current: BrowserStepSchema.shape.current.optional()
    }).optional(),
    
    // API execution
    api: ApiStepSchema.partial().extend({
      old: ApiStepSchema.shape.old.optional(),
      new: ApiStepSchema.shape.new.optional()
    }).optional(),
    
    // Expected result for this step
    expected: z.object({
      semanticEvent: z.string().optional(),
      businessState: z.string().optional(),
      businessData: z.record(z.unknown()).optional()
    }).optional(),
    
    onFailure: z.enum(['continue', 'stop', 'mark-skipped']).default('stop')
  })).optional(),
  
  // Legacy steps (for backwards compatibility with simple scenarios)
  legacyActions: z.array(ScenarioActionSchema).optional(),
  
  // Database verification steps
  database: z.array(DatabaseStepSchema).optional(),
  
  // Final expected results
  finalExpected: z.object({
    finalState: z.string(),
    requiredEvents: z.array(z.string()).optional(),
    forbiddenEvents: z.array(z.string()).optional(),
    businessResult: ExpectedBusinessResultSchema.optional(),
    apiResult: ExpectedApiResultSchema.optional(),
    databaseResult: ExpectedDatabaseResultSchema.optional()
  }).optional(),
  
  // Fallback to simple expected for backwards compatibility
  expected: z.any().optional(),
  
  // Comparison rules
  comparison: ComparisonRuleSchema.optional(),
  
  // Evidence collection
  evidence: EvidenceRequirementSchema,
  
  // Generation info
  generationMetadata: GenerationMetadataSchema.optional(),
  
  // Source and tags
  source: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  
  // Enabled flag
  enabled: z.boolean().default(true),
  
  // Legacy compatibility
  input: z.record(z.unknown()).optional(),
  precondition: z.record(z.unknown()).optional()
});
export type EnhancedScenario = z.infer<typeof EnhancedScenarioSchema>;

// ============================================================
// Validation Functions
// ============================================================

export function validateEnhancedScenario(data: unknown): { valid: boolean; errors?: string[] } {
  const result = EnhancedScenarioSchema.safeParse(data);
  if (result.success) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
  };
}

// ============================================================
// Backwards Compatibility
// ============================================================

export function isEnhancedScenario(scenario: unknown): scenario is EnhancedScenario {
  return EnhancedScenarioSchema.safeParse(scenario).success;
}

export function hasBrowserSteps(scenario: EnhancedScenario): boolean {
  return (scenario.steps?.some(s => s.browser) ?? false) || 
         (scenario.execution?.channels?.includes('browser') ?? false);
}

export function hasApiSteps(scenario: EnhancedScenario): boolean {
  return (scenario.steps?.some(s => s.api) ?? false) || 
         (scenario.execution?.channels?.includes('api') ?? false);
}

export function hasDatabaseSteps(scenario: EnhancedScenario): boolean {
  return (scenario.database && scenario.database.length > 0) || 
         (scenario.execution?.channels?.includes('database') ?? false);
}
