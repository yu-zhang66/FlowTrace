import { z } from 'zod';

export const RecordedStepType = z.enum(['navigate', 'fill', 'click', 'assertion', 'unsupported']);
export type RecordedStepType = z.infer<typeof RecordedStepType>;

export const RecordedAssertionType = z.enum(['visible', 'text', 'value', 'url']);
export type RecordedAssertionType = z.infer<typeof RecordedAssertionType>;

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
export type RecordedStep = z.infer<typeof RecordedStepSchema>;

export const RecordingStatus = z.enum(['RECORDED', 'IMPORTED', 'NEEDS_REVIEW']);
export type RecordingStatus = z.infer<typeof RecordingStatus>;

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
export type RecordingMetadata = z.infer<typeof RecordingMetadataSchema>;

export const RecordingArtifactSchema = z.object({
  metadata: RecordingMetadataSchema,
  steps: z.array(RecordedStepSchema),
  warnings: z.array(z.string()).default([])
});
export type RecordingArtifact = z.infer<typeof RecordingArtifactSchema>;
