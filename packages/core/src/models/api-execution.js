/**
 * API Execution and Dual-Run Model
 *
 * Provides API execution with dual-run support for comparing
 * legacy and current API implementations.
 */
import { z } from 'zod';
import { BusinessActionType } from './scenario.js';
// ============================================================
// API Mapping Definition
// ============================================================
export const ApiMappingRequestFieldSchema = z.object({
    legacyField: z.string(),
    currentField: z.string(),
    transform: z.enum(['direct', 'string', 'number', 'boolean', 'date', 'json', 'custom']).default('direct'),
    defaultValue: z.unknown().optional()
});
export const ApiMappingResponseFieldSchema = z.object({
    legacyField: z.string(),
    currentField: z.string(),
    transform: z.enum(['direct', 'string', 'number', 'boolean', 'date', 'json', 'custom']).default('direct')
});
export const ApiMappingSchema = z.object({
    id: z.string(),
    name: z.string(),
    businessAction: BusinessActionType,
    // Legacy API definition
    legacy: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        endpoint: z.string(),
        headers: z.record(z.string()).optional()
    }),
    // Current API definition
    current: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        endpoint: z.string(),
        headers: z.record(z.string()).optional()
    }),
    // Request field mappings
    requestMapping: z.array(ApiMappingRequestFieldSchema).optional(),
    // Response field mappings
    responseMapping: z.array(ApiMappingResponseFieldSchema).optional(),
    // Fields to ignore during comparison
    ignoredFields: z.array(z.string()).default([]),
    // Business meaning
    businessMeaning: z.object({
        success: z.string().describe('JMESPath or JSONPath expression for success'),
        businessState: z.string().describe('JMESPath or JSONPath expression for business state'),
        errorMeaning: z.string().optional().describe('JMESPath for error message'),
        resultObject: z.string().optional().describe('Path to main result object')
    }),
    // Execution settings
    timeout: z.number().default(30000),
    retryPolicy: z.object({
        maxAttempts: z.number().default(3),
        delay: z.number().default(1000),
        backoffMultiplier: z.number().default(2),
        retryOnStatus: z.array(z.number()).optional()
    }).optional()
});
// ============================================================
// API Execution
// ============================================================
export const ApiExecutionRequestSchema = z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: z.string(),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
    query: z.record(z.string()).optional(),
    timeout: z.number().default(30000)
});
export const ApiExecutionResponseSchema = z.object({
    status: z.number(),
    statusText: z.string().optional(),
    headers: z.record(z.string()),
    body: z.unknown(),
    timing: z.object({
        start: z.number(),
        end: z.number(),
        duration: z.number()
    }),
    size: z.number().optional()
});
export const ApiCallResultSchema = z.object({
    request: ApiExecutionRequestSchema,
    response: ApiExecutionResponseSchema.optional(),
    error: z.string().optional(),
    normalizedBusiness: z.object({
        success: z.boolean(),
        businessState: z.string().optional(),
        errorMessage: z.string().optional(),
        extractedData: z.record(z.unknown()).optional()
    }).optional(),
    timestamp: z.string().datetime()
});
// ============================================================
// API Comparison
// ============================================================
export const ApiDifferenceType = z.enum([
    'http_method',
    'http_url',
    'http_status',
    'field_name',
    'field_structure',
    'field_type',
    'field_value',
    'business_semantic',
    'error_code',
    'error_message',
    'data_result',
    'missing_field',
    'extra_field'
]);
export const ApiDifferenceSchema = z.object({
    type: ApiDifferenceType,
    category: z.enum(['http', 'data_structure', 'business_semantic']),
    severity: z.enum(['P0', 'P1', 'P2', 'P3']),
    location: z.object({
        request: z.boolean().default(false),
        response: z.boolean().default(false),
        path: z.string().optional()
    }),
    legacyValue: z.unknown(),
    currentValue: z.unknown(),
    description: z.string(),
    isBlocking: z.boolean()
});
export const ApiComparisonResultSchema = z.object({
    apiMappingId: z.string(),
    // HTTP level comparison
    httpComparison: z.object({
        methodMatch: z.boolean(),
        urlMatch: z.boolean(),
        statusCodeMatch: z.boolean(),
        legacyStatus: z.number().optional(),
        currentStatus: z.number().optional()
    }),
    // Data structure comparison
    structureComparison: z.object({
        fieldCountMatch: z.boolean(),
        missingFields: z.array(z.string()),
        extraFields: z.array(z.string()),
        renamedFields: z.array(z.object({
            oldName: z.string(),
            newName: z.string()
        }))
    }),
    // Business semantic comparison
    semanticComparison: z.object({
        successMatch: z.boolean(),
        legacySuccess: z.boolean(),
        currentSuccess: z.boolean(),
        businessStateMatch: z.boolean(),
        legacyState: z.string().optional(),
        currentState: z.string().optional()
    }),
    // Detailed differences
    differences: z.array(ApiDifferenceSchema),
    // Overall result
    passed: z.boolean(),
    blockingDifferences: z.array(z.string()).describe('IDs of blocking differences')
});
// ============================================================
// Dual API Execution Result
// ============================================================
export const DualApiStepResultSchema = z.object({
    mappingId: z.string(),
    businessAction: BusinessActionType,
    legacyResult: ApiCallResultSchema.optional(),
    currentResult: ApiCallResultSchema.optional(),
    comparison: ApiComparisonResultSchema.optional(),
    executionTime: z.object({
        legacy: z.number().optional(),
        current: z.number().optional()
    }).optional(),
    passed: z.boolean(),
    error: z.string().optional()
});
// ============================================================
// API Evidence
// ============================================================
export const ApiEvidenceSchema = z.object({
    request: ApiExecutionRequestSchema,
    response: ApiExecutionResponseSchema,
    normalizedBusiness: z.object({
        success: z.boolean(),
        businessState: z.string().nullable(),
        errorMessage: z.string().nullable(),
        extractedData: z.record(z.unknown())
    }),
    metadata: z.object({
        side: z.enum(['legacy', 'current']),
        mappingId: z.string().optional(),
        scenarioId: z.string().optional(),
        stepId: z.string().optional()
    })
});
//# sourceMappingURL=api-execution.js.map