import { z } from 'zod';
export const RecordedStepType = z.enum(['navigate', 'fill', 'click', 'assertion', 'unsupported']);
export const RecordedAssertionType = z.enum(['visible', 'text', 'value', 'url']);
export const RecordedStepSchema = z.object({
    id: z.string().min(1),
    type: RecordedStepType,
    locator: z.string().optional(),
    url: z.string().optional(),
    value: z.string().optional(),
    assertionType: RecordedAssertionType.optional(),
    expected: z.string().optional(),
    sourceLine: z.number().int().positive(),
    sourceText: z.string().optional(),
    warning: z.string().optional()
});
export const RecordingStatus = z.enum(['RECORDED', 'IMPORTED', 'NEEDS_REVIEW']);
export const RecordingMetadataSchema = z.object({
    id: z.string().min(1),
    processId: z.string().min(1),
    sourceFile: z.string().min(1),
    baseUrl: z.string().optional(),
    authFile: z.string().optional(),
    playwrightVersion: z.string().optional(),
    createdAt: z.string().datetime(),
    status: RecordingStatus
});
export const RecordingArtifactSchema = z.object({
    metadata: RecordingMetadataSchema,
    steps: z.array(RecordedStepSchema),
    warnings: z.array(z.string()).default([])
});
//# sourceMappingURL=recording.js.map