import { z } from 'zod';

export const ReviewStatus = z.enum([
  'AUTO_EXTRACTED',
  'PENDING_CONFIRM',
  'CONFIRMED',
  'REJECTED'
]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const FactCategory = z.enum([
  'process_definition',
  'node',
  'transition',
  'rule',
  'role',
  'data_effect',
  'external_call',
  'page_element',
  'api',
  'database'
]);
export type FactCategory = z.infer<typeof FactCategory>;

export const EvidenceSchema = z.object({
  source: z.string(),
  location: z.string().optional(),
  line: z.number().optional(),
  confidence: z.number().min(0).max(1),
  extractedAt: z.string().datetime()
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FactSchema = z.object({
  id: z.string(),
  type: z.string(),
  category: FactCategory,
  name: z.string(),
  description: z.string().optional(),
  content: z.record(z.unknown()),
  evidence: z.array(EvidenceSchema).optional(),
  reviewStatus: ReviewStatus.default('AUTO_EXTRACTED'),
  metadata: z.record(z.unknown()).optional()
});
export type Fact = z.infer<typeof FactSchema>;

export interface ProcessBaseline {
  id: string;
  processId: string;
  name: string;
  collectedAt: string;
  facts: Fact[];
  summary: {
    totalFacts: number;
    byCategory: Record<string, number>;
    confirmedFacts: number;
    pendingFacts: number;
  };
}
