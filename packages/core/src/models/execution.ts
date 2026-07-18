import { z } from 'zod';
import { ScenarioActionSchema } from './scenario.js';
import { DifferenceSchema, Difference, DifferenceSeverity, DifferenceCategory } from './difference.js';

export { Difference, DifferenceSeverity, DifferenceCategory };

export const ExternalCallSchema = z.object({
  endpoint: z.string(),
  method: z.string(),
  request: z.record(z.unknown()),
  response: z.record(z.unknown()),
  timestamp: z.string().datetime()
});
export type ExternalCall = z.infer<typeof ExternalCallSchema>;

export const ExecutionResultSchema = z.object({
  scenarioId: z.string(),
  adapter: z.enum(['legacy', 'current']),
  actions: z.array(ScenarioActionSchema),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  finalState: z.string(),
  semanticPath: z.array(z.string()),
  businessData: z.record(z.unknown()),
  databaseChanges: z.record(z.unknown()).optional(),
  externalCalls: z.array(ExternalCallSchema).optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export interface DualExecutionResult {
  scenarioId: string;
  legacyResult?: ExecutionResult;
  currentResult?: ExecutionResult;
  differences: Difference[];
  passed: boolean;
  error?: string;
}
