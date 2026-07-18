import { z } from 'zod';
export const ReviewStatus = z.enum([
    'AUTO_EXTRACTED',
    'PENDING_CONFIRM',
    'CONFIRMED',
    'REJECTED'
]);
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
export const EvidenceSchema = z.object({
    source: z.string(),
    location: z.string().optional(),
    line: z.number().optional(),
    confidence: z.number().min(0).max(1),
    extractedAt: z.string().datetime()
});
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
//# sourceMappingURL=fact.js.map