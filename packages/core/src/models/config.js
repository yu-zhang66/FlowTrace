import { z } from 'zod';
import { BusinessActionType } from './scenario.js';
export const ExecutionModeSchema = z.object({
    mode: z.enum(['dual-run', 'legacy-only', 'current-only']),
    allowOnlineWrite: z.boolean().default(false),
    databaseMode: z.enum(['snapshot-only', 'transaction-rollback', 'mocked']),
    testDataMode: z.enum(['masked-or-snapshot', 'isolated-database']),
    failOn: z.array(z.enum(['P0', 'P1', 'P2', 'P3'])).default(['P0', 'P1'])
});
export const PilotConfigSchema = z.object({
    process: z.string(),
    currentAdapterMode: z.enum(['legacy-shadow', 'current']),
    note: z.string().optional()
});
export const ProjectConfigSchema = z.object({
    project: z.object({
        id: z.string(),
        name: z.string(),
        sourceRoot: z.string().default('.')
    }),
    execution: ExecutionModeSchema,
    pilot: PilotConfigSchema.optional(),
    legacy: z.object({
        modules: z.array(z.string())
    }).optional(),
    adapters: z.object({
        legacy: z.string(),
        current: z.string(),
        oracleReadonly: z.string().optional(),
        externalSystem: z.string().optional()
    }).optional(),
    current: z.object({
        adapter: z.string()
    }).optional(),
    database: z.object({
        type: z.enum(['oracle', 'postgresql', 'mysql']),
        configSource: z.string().optional(),
        access: z.enum(['read-only-collection', 'read-only-collection-and-test-snapshot', 'isolated-test'])
    }),
    paths: z.object({
        facts: z.string().default('facts'),
        mappings: z.string().default('semantic'),
        semantic: z.string().default('semantic'),
        scenarios: z.string().default('scenarios'),
        fixtures: z.string().default('fixtures'),
        executions: z.string().default('executions'),
        mocks: z.string().default('mocks'),
        reports: z.string().default('reports')
    }),
    actions: z.array(BusinessActionType).optional(),
    mapping: z.record(z.string()).optional()
});
//# sourceMappingURL=config.js.map