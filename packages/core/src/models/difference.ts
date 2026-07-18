import { z } from 'zod';

export const DifferenceSeverity = z.enum(['P0', 'P1', 'P2', 'P3']);
export type DifferenceSeverity = z.infer<typeof DifferenceSeverity>;

export const DifferenceCategory = z.enum([
  'final_state',
  'semantic_path',
  'business_data',
  'database',
  'external_call',
  'permission',
  'notification',
  'audit',
  'action_failure'
]);
export type DifferenceCategory = z.infer<typeof DifferenceCategory>;

export const DifferenceSchema = z.object({
  id: z.string(),
  scenarioId: z.string(),
  category: DifferenceCategory,
  severity: DifferenceSeverity,
  description: z.string(),
  legacyValue: z.unknown(),
  currentValue: z.unknown(),
  location: z.object({
    process: z.string().optional(),
    node: z.string().optional(),
    field: z.string().optional()
  }).optional(),
  evidence: z.array(z.string()).optional(),
  isBlocking: z.boolean()
});
export type Difference = z.infer<typeof DifferenceSchema>;

export function isBlockingDifference(difference: { severity: string }): boolean {
  return difference.severity === 'P0' || difference.severity === 'P1';
}

export function classifySeverity(difference: { category: string }): DifferenceSeverity {
  const blockingCategories: string[] = [
    'final_state',
    'business_data',
    'permission'
  ];

  if (blockingCategories.includes(difference.category)) {
    return 'P0';
  }

  if (difference.category === 'semantic_path') {
    return 'P1';
  }

  if (difference.category === 'database' || difference.category === 'external_call') {
    return 'P1';
  }

  return 'P2';
}
