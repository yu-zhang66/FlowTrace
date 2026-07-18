/**
 * Semantic Comparison Model
 * 
 * Provides semantic-level comparison between legacy and current systems,
 * abstracting away technical differences (URLs, field names, node IDs)
 * to focus on business equivalence.
 */

import { z } from 'zod';

// ============================================================
// Semantic Events
// ============================================================

export const SemanticEventType = z.enum([
  'APPLICATION_SUBMITTED',
  'APPLICATION_APPROVED',
  'APPLICATION_REJECTED',
  'APPLICATION_RETURNED',
  'APPLICATION_WITHDRAWN',
  'APPLICATION_TRANSFERRED',
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
  'COUNTERSIGN_STARTED',
  'COUNTERSIGN_COMPLETED',
  'COUNTERSIGN_REJECTED',
  'APPROVAL_COMPLETED',
  'DOCUMENT_UPLOADED',
  'NOTIFICATION_SENT'
]);
export type SemanticEventType = z.infer<typeof SemanticEventType>;

// ============================================================
// Semantic State
// ============================================================

export const SemanticStateType = z.enum([
  'DRAFT',
  'SUBMITTED',
  'PENDING_ENTERPRISE_APPROVAL',
  'ENTERPRISE_APPROVED',
  'ENTERPRISE_REJECTED',
  'ENTERPRISE_RETURNED',
  'PENDING_RISK_ASSESSMENT',
  'RISK_ASSESSED',
  'RISK_APPROVED',
  'RISK_REJECTED',
  'PENDING_FINANCE_APPROVAL',
  'FINANCE_APPROVED',
  'FINANCE_REJECTED',
  'FINANCE_RETURNED',
  'PENDING_DISBURSEMENT',
  'DISBURSED',
  'WITHDRAWN',
  'TRANSFERRED',
  'COUNTERSIGN_PENDING',
  'COUNTERSIGN_COMPLETE',
  'EXPIRED',
  'CANCELLED'
]);
export type SemanticStateType = z.infer<typeof SemanticStateType>;

// ============================================================
// Semantic Path
// ============================================================

export interface SemanticPathNode {
  event: string;
  actor?: string;
  actorRole?: string;
  timestamp?: string;
  state?: string;
  data?: Record<string, unknown>;
}

export interface SemanticPath {
  nodes: SemanticPathNode[];
  startState: string;
  endState: string;
  duration?: number;
}

// ============================================================
// Comparison Dimension
// ============================================================

export const ComparisonDimension = z.enum([
  'final_state',
  'semantic_path',
  'approval_actors',
  'business_data',
  'api_semantic',
  'database_critical',
  'external_calls',
  'notifications',
  'audit_trail',
  'permission_boundary',
  'parallel_approval',
  'time_constraints'
]);
export type ComparisonDimension = z.infer<typeof ComparisonDimension>;

// ============================================================
// Allowed vs Forbidden Differences
// ============================================================

export const AllowedDifferenceSchema = z.object({
  dimension: ComparisonDimension,
  description: z.string(),
  reason: z.string(),
  businessImpact: z.enum(['none', 'minor', 'significant']).default('none'),
  requiresApproval: z.boolean().default(false)
});
export type AllowedDifference = z.infer<typeof AllowedDifferenceSchema>;

export const ForbiddenDifferenceSchema = z.object({
  dimension: ComparisonDimension,
  description: z.string(),
  businessImpact: z.enum(['blocking', 'major', 'moderate']),
  severity: z.enum(['P0', 'P1'])
});
export type ForbiddenDifference = z.infer<typeof ForbiddenDifferenceSchema>;

// ============================================================
// Semantic Comparison Result
// ============================================================

export const SemanticMatchResult = z.enum(['match', 'acceptable_difference', 'blocking_difference']);
export type SemanticMatchResult = z.infer<typeof SemanticMatchResult>;

export interface SemanticComparisonResult {
  dimension: ComparisonDimension;
  matchResult: SemanticMatchResult;
  
  // Detailed comparison
  legacySemantic: {
    path?: SemanticPath;
    state?: string;
    actors?: string[];
    data?: Record<string, unknown>;
  };
  
  currentSemantic: {
    path?: SemanticPath;
    state?: string;
    actors?: string[];
    data?: Record<string, unknown>;
  };
  
  // Difference details
  differences: Array<{
    aspect: string;
    legacyValue: unknown;
    currentValue: unknown;
    isAllowed: boolean;
    allowedReason?: string;
    businessImpact: 'none' | 'minor' | 'significant' | 'blocking';
    severity: 'P0' | 'P1' | 'P2' | 'P3';
    description: string;
  }>;
  
  // Conclusion
  conclusion: string;
  blocking: boolean;
  requiresHumanApproval: boolean;
}

// ============================================================
// Overall Semantic Equivalence
// ============================================================

export interface SemanticEquivalenceResult {
  overallMatch: boolean;
  
  dimensionResults: SemanticComparisonResult[];
  
  summary: {
    totalDimensions: number;
    matchingDimensions: number;
    acceptableDifferenceDimensions: number;
    blockingDimensions: number;
  };
  
  processPathEquivalence: {
    equivalent: boolean;
    allowedReordering: boolean;
    allowedParallelization: boolean;
    pathDifference?: string;
  };
  
  finalStateEquivalence: {
    equivalent: boolean;
    legacyState: string;
    currentState: string;
  };
  
  businessDataEquivalence: {
    equivalent: boolean;
    criticalFieldsMatch: boolean;
    differences: Array<{
      field: string;
      legacyValue: unknown;
      currentValue: unknown;
      severity: 'P0' | 'P1' | 'P2' | 'P3';
    }>;
  };
  
  // Release recommendation
  releaseRecommendation: {
    canRelease: boolean;
    blockingReasons: string[];
    requiresHumanReview: boolean;
    reviewItems: string[];
  };
}

// ============================================================
// Comparison Rules
// ============================================================

export interface SemanticComparisonConfig {
  // Process path comparison
  allowNodeReordering: boolean;
  allowParallelToSequential: boolean;
  allowSequentialToParallel: boolean;
  
  // State comparison
  allowStateMapping: boolean;
  stateMappings?: Record<string, string>;
  
  // Actor comparison
  compareActorRoles: boolean;
  compareActorIdentity: boolean;
  
  // Data comparison
  criticalDataFields: string[];
  ignoredDataFields: string[];
  ignoredDataPatterns?: string[];
  
  // API comparison
  compareApiBySemantic: boolean;
  ignoreApiFieldNames: boolean;
  
  // Time comparison
  allowTimeDifference?: number; // in milliseconds
  ignoreTimezone: boolean;
  
  // Custom rules
  customAllowedDifferences?: AllowedDifference[];
  customForbiddenDifferences?: ForbiddenDifference[];
}

// ============================================================
// Normalizer Functions
// ============================================================

export interface SemanticNormalizerOptions {
  // Extract semantic path from execution result
  extractSemanticPath: (result: {
    actions: Array<{ type: string; actor?: string; data?: unknown; timestamp?: string }>;
    state: string;
  }) => SemanticPath;
  
  // Extract semantic state from raw state
  extractSemanticState: (rawState: string) => string;
  
  // Normalize actor to role
  normalizeActor: (actor: string) => { role: string; identity?: string };
  
  // Normalize business data field names
  normalizeFieldName: (field: string) => string;
  
  // Extract semantic event from action
  extractSemanticEvent: (action: {
    type: string;
    data?: unknown;
  }) => string;
}

// ============================================================
// Default Comparison Rules
// ============================================================

export const DEFAULT_ALLOWED_DIFFERENCES: AllowedDifference[] = [
  {
    dimension: 'semantic_path',
    description: 'Sequential to parallel approval conversion',
    reason: 'Performance optimization, same business outcome',
    businessImpact: 'none',
    requiresApproval: false
  },
  {
    dimension: 'semantic_path',
    description: 'Parallel to sequential approval conversion',
    reason: 'Compliance or risk requirement',
    businessImpact: 'minor',
    requiresApproval: true
  },
  {
    dimension: 'audit_trail',
    description: 'Different timestamp precision',
    reason: 'System clock differences',
    businessImpact: 'none',
    requiresApproval: false
  },
  {
    dimension: 'audit_trail',
    description: 'Additional audit fields',
    reason: 'Enhanced logging',
    businessImpact: 'none',
    requiresApproval: false
  },
  {
    dimension: 'api_semantic',
    description: 'Different API endpoints with same semantic',
    reason: 'REST API redesign',
    businessImpact: 'none',
    requiresApproval: false
  },
  {
    dimension: 'api_semantic',
    description: 'Different field names with same semantic',
    reason: 'Schema evolution',
    businessImpact: 'none',
    requiresApproval: false
  }
];

export const DEFAULT_FORBIDDEN_DIFFERENCES: ForbiddenDifference[] = [
  {
    dimension: 'final_state',
    description: 'Final business state mismatch',
    businessImpact: 'blocking',
    severity: 'P0'
  },
  {
    dimension: 'business_data',
    description: 'Critical business data mismatch',
    businessImpact: 'blocking',
    severity: 'P0'
  },
  {
    dimension: 'permission_boundary',
    description: 'Unauthorized role can perform action',
    businessImpact: 'blocking',
    severity: 'P0'
  },
  {
    dimension: 'approval_actors',
    description: 'Approval by different required role',
    businessImpact: 'major',
    severity: 'P1'
  },
  {
    dimension: 'semantic_path',
    description: 'Required approval step skipped',
    businessImpact: 'blocking',
    severity: 'P0'
  },
  {
    dimension: 'database_critical',
    description: 'Critical data not persisted correctly',
    businessImpact: 'blocking',
    severity: 'P0'
  }
];

export const DEFAULT_COMPARISON_CONFIG: SemanticComparisonConfig = {
  allowNodeReordering: true,
  allowParallelToSequential: true,
  allowSequentialToParallel: false,
  allowStateMapping: true,
  compareActorRoles: true,
  compareActorIdentity: false,
  criticalDataFields: ['amount', 'status', 'approved', 'rejected'],
  ignoredDataFields: ['updateTime', 'updateBy', 'traceId', 'workflowInstanceId', 'ipAddress'],
  ignoredDataPatterns: ['^_.*', '.*timestamp$', '.*id$'],
  compareApiBySemantic: true,
  ignoreApiFieldNames: true,
  ignoreTimezone: true,
  customAllowedDifferences: DEFAULT_ALLOWED_DIFFERENCES,
  customForbiddenDifferences: DEFAULT_FORBIDDEN_DIFFERENCES
};

// ============================================================
// State Mapping for Semantic Comparison
// ============================================================

export const STATE_MAPPINGS: Record<string, string> = {
  // Legacy states to semantic states
  'DRAFT': 'DRAFT',
  'PENDING': 'SUBMITTED',
  'SUBMITTED': 'SUBMITTED',
  'PENDING_CORE': 'PENDING_ENTERPRISE_APPROVAL',
  'CORE_APPROVED': 'ENTERPRISE_APPROVED',
  'CORE_REJECTED': 'ENTERPRISE_REJECTED',
  'CORE_RETURNED': 'ENTERPRISE_RETURNED',
  'PENDING_RISK': 'PENDING_RISK_ASSESSMENT',
  'RISK_PASSED': 'RISK_ASSESSED',
  'RISK_APPROVED': 'RISK_APPROVED',
  'RISK_REJECTED': 'RISK_REJECTED',
  'PENDING_FINANCE': 'PENDING_FINANCE_APPROVAL',
  'FINANCE_APPROVED': 'FINANCE_APPROVED',
  'FINANCE_REJECTED': 'FINANCE_REJECTED',
  'FINANCE_RETURNED': 'FINANCE_RETURNED',
  'PENDING_DISBURSE': 'PENDING_DISBURSEMENT',
  'DISBURSED': 'DISBURSED',
  'WITHDRAWN': 'WITHDRAWN',
  'TRANSFERRED': 'TRANSFERRED',
  'COUNTERSIGN': 'COUNTERSIGN_PENDING',
  'COUNTERSIGN_COMPLETE': 'COUNTERSIGN_COMPLETE',
  'EXPIRED': 'EXPIRED',
  'CANCELLED': 'CANCELLED',
  'APPROVED': 'APPLICATION_APPROVED',
  'REJECTED': 'APPLICATION_REJECTED',
  'RETURNED': 'APPLICATION_RETURNED'
};

// ============================================================
// Event to State Mapping
// ============================================================

export const EVENT_TO_STATE: Record<string, string> = {
  'APPLICATION_SUBMITTED': 'SUBMITTED',
  'ENTERPRISE_APPROVED': 'ENTERPRISE_APPROVED',
  'ENTERPRISE_REJECTED': 'ENTERPRISE_REJECTED',
  'ENTERPRISE_RETURNED': 'ENTERPRISE_RETURNED',
  'RISK_ASSESSED': 'RISK_ASSESSED',
  'RISK_APPROVED': 'RISK_APPROVED',
  'RISK_REJECTED': 'RISK_REJECTED',
  'FINANCE_APPROVED': 'FINANCE_APPROVED',
  'FINANCE_REJECTED': 'FINANCE_REJECTED',
  'FINANCE_RETURNED': 'FINANCE_RETURNED',
  'DISBURSEMENT_STARTED': 'PENDING_DISBURSEMENT',
  'DISBURSEMENT_COMPLETED': 'DISBURSED',
  'APPLICATION_WITHDRAWN': 'WITHDRAWN',
  'APPLICATION_TRANSFERRED': 'TRANSFERRED',
  'COUNTERSIGN_STARTED': 'COUNTERSIGN_PENDING',
  'COUNTERSIGN_COMPLETED': 'COUNTERSIGN_COMPLETE',
  'COUNTERSIGN_REJECTED': 'COUNTERSIGN_PENDING',
  'APPLICATION_APPROVED': 'APPLICATION_APPROVED',
  'APPLICATION_REJECTED': 'APPLICATION_REJECTED',
  'APPLICATION_RETURNED': 'APPLICATION_RETURNED'
};
