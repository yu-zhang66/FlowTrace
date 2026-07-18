import { describe, it, expect } from 'vitest';
import { RuntimeConfigSchema, ProcessDslSchema, validateRuntimeConfig, validateProcessDsl, } from '../src/dsl/schema.js';
describe('dsl/schema', () => {
    it('accepts a minimal valid runtime config with two systems', () => {
        const cfg = {
            adapter: 'builtin',
            systems: {
                legacy: {
                    id: 'legacy',
                    baseUrl: 'http://localhost:3100',
                    channel: 'http',
                },
                current: {
                    id: 'current',
                    baseUrl: 'http://localhost:3200',
                    channel: 'http',
                },
            },
        };
        const r = validateRuntimeConfig(cfg);
        expect(r.success).toBe(true);
    });
    it('rejects runtime config without systems', () => {
        const r = validateRuntimeConfig({ adapter: 'builtin', systems: {} });
        expect(r.success).toBe(false);
    });
    it('rejects runtime adapter=external without external block', () => {
        const r = validateRuntimeConfig({
            adapter: 'external',
            systems: { a: { id: 'a', baseUrl: 'http://x', channel: 'http' } },
        });
        expect(r.success).toBe(false);
    });
    it('accepts a minimal process DSL with fsm metadata', () => {
        const dsl = {
            id: 'purchase-approval',
            name: 'Purchase Approval',
            channel: 'http',
            fsm: {
                states: [{ id: 'DRAFT' }, { id: 'PENDING' }, { id: 'APPROVED', terminal: true }],
                transitions: [
                    { from: 'DRAFT', action: 'SUBMIT', to: 'PENDING' },
                    { from: 'PENDING', action: 'APPROVE', to: 'APPROVED' },
                ],
            },
            actions: [
                {
                    id: 'SUBMIT',
                    actor: 'requester',
                    steps: [{ type: 'request', method: 'POST', path: '/api/purchases/{id}/submit' }],
                },
            ],
        };
        const r = validateProcessDsl(dsl);
        expect(r.success).toBe(true);
    });
    it('rejects request step missing endpoint / path / url', () => {
        const dsl = {
            id: 'p',
            name: 'p',
            channel: 'http',
            actions: [{ id: 'X', steps: [{ type: 'request', method: 'POST' }] }],
        };
        const r = validateProcessDsl(dsl);
        expect(r.success).toBe(false);
    });
    it('rejects goto step without page or url', () => {
        const dsl = {
            id: 'p',
            name: 'p',
            channel: 'browser',
            actions: [{ id: 'X', steps: [{ type: 'goto' }] }],
        };
        const r = validateProcessDsl(dsl);
        expect(r.success).toBe(false);
    });
    it('rejects empty actions list', () => {
        const r = validateProcessDsl({
            id: 'p', name: 'p', channel: 'http', actions: [],
        });
        expect(r.success).toBe(false);
    });
    it('RuntimeConfigSchema defaults version to "1"', () => {
        const parsed = RuntimeConfigSchema.parse({
            adapter: 'builtin',
            systems: { x: { id: 'x', baseUrl: 'http://y', channel: 'http' } },
        });
        expect(parsed.version).toBe('1');
    });
    it('ProcessDslSchema is exported and is a zod object', () => {
        expect(ProcessDslSchema).toBeDefined();
        expect(typeof ProcessDslSchema.parse).toBe('function');
    });
});
//# sourceMappingURL=schema.test.js.map