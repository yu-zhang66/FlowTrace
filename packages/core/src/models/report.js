import { z } from 'zod';
import { DifferenceSchema } from './difference.js';
import { ExecutionResultSchema } from './execution.js';
import { validateScenario } from './scenario.js';
export { validateScenario };
export const ScenarioResultSchema = z.object({
    scenarioId: z.string(),
    legacyResult: ExecutionResultSchema.optional(),
    currentResult: ExecutionResultSchema.optional(),
    differences: z.array(DifferenceSchema),
    passed: z.boolean(),
    error: z.string().optional()
});
export const VerificationSummarySchema = z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    differencesBySeverity: z.record(z.string(), z.number())
});
export const ReleaseGateSchema = z.object({
    allowed: z.boolean(),
    blockedBy: z.array(z.string()),
    requiresHumanApproval: z.boolean().optional()
});
export const VerificationRunSchema = z.object({
    id: z.string(),
    projectId: z.string(),
    timestamp: z.string().datetime(),
    scenarios: z.array(ScenarioResultSchema),
    summary: VerificationSummarySchema,
    releaseGate: ReleaseGateSchema,
    metadata: z.record(z.unknown()).optional()
});
//# sourceMappingURL=report.js.map