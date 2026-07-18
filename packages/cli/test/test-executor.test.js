import { describe, it, expect } from 'vitest';
import { createLoginTestExecutor } from '../src/commands/test/test-executor.ts';
import { createMockAdapter } from './mock-adapter.ts';
describe('LoginTestExecutor', () => {
    const createTestScenario = (overrides = {}) => ({
        id: 'login-test-001',
        name: 'Login Test',
        process: 'login',
        severity: 'P0',
        enabled: true,
        actions: [
            {
                type: 'LOGIN',
                actor: 'supplier',
                data: {
                    usernameRef: 'supplier001',
                    passwordRef: 'Supplier@123'
                }
            }
        ],
        expected: {
            finalState: 'AUTHENTICATED',
            semanticPath: ['LOGIN_PAGE', 'AUTHENTICATED']
        },
        ...overrides
    });
    describe('single-browser mode', () => {
        it('should execute scenario with success adapter', async () => {
            const legacyAdapter = createMockAdapter('legacy', { success: true });
            await legacyAdapter.initialize();
            const executor = createLoginTestExecutor({
                mode: 'single-browser',
                legacyAdapter
            });
            const scenario = createTestScenario();
            const run = await executor.executeScenarios([scenario]);
            expect(run.summary.totalCases).toBe(1);
            expect(run.caseResults[0]).toBeDefined();
            await legacyAdapter.cleanup();
        });
        it('should execute scenario with failure adapter', async () => {
            const legacyAdapter = createMockAdapter('legacy', { success: false });
            await legacyAdapter.initialize();
            const executor = createLoginTestExecutor({
                mode: 'single-browser',
                legacyAdapter
            });
            const scenario = createTestScenario();
            const run = await executor.executeScenarios([scenario]);
            expect(run.summary.totalCases).toBe(1);
            expect(run.caseResults[0]).toBeDefined();
            await legacyAdapter.cleanup();
        });
        it('should execute multiple scenarios', async () => {
            const legacyAdapter = createMockAdapter('legacy', { success: true });
            await legacyAdapter.initialize();
            const executor = createLoginTestExecutor({
                mode: 'single-browser',
                legacyAdapter
            });
            const scenarios = [
                createTestScenario({ id: 'login-001' }),
                createTestScenario({ id: 'login-002' }),
                createTestScenario({ id: 'login-003' })
            ];
            const run = await executor.executeScenarios(scenarios);
            expect(run.summary.totalCases).toBe(3);
            expect(run.caseResults.length).toBe(3);
            await legacyAdapter.cleanup();
        });
    });
    describe('dual-browser mode', () => {
        it('resets both adapters after every scenario in a serial run', async () => {
            const legacyAdapter = createMockAdapter('legacy', { success: true });
            const currentAdapter = createMockAdapter('current', { success: true });
            await legacyAdapter.initialize();
            await currentAdapter.initialize();
            const executor = createLoginTestExecutor({ mode: 'dual-browser', legacyAdapter, currentAdapter });
            const run = await executor.executeScenarios([
                createTestScenario({ id: 'login-001' }),
                createTestScenario({ id: 'login-002' }),
                createTestScenario({ id: 'login-003' })
            ]);
            expect(run.summary.totalCases).toBe(3);
            expect(legacyAdapter.resetCount).toBe(3);
            expect(currentAdapter.resetCount).toBe(3);
            await legacyAdapter.cleanup();
            await currentAdapter.cleanup();
        });
        it('should execute scenario on both systems', async () => {
            const legacyAdapter = createMockAdapter('legacy', { success: true });
            const currentAdapter = createMockAdapter('current', { success: true });
            await legacyAdapter.initialize();
            await currentAdapter.initialize();
            const executor = createLoginTestExecutor({
                mode: 'dual-browser',
                legacyAdapter,
                currentAdapter
            });
            const scenario = createTestScenario();
            const run = await executor.executeScenarios([scenario]);
            expect(run.summary.totalCases).toBe(1);
            expect(run.caseResults[0].legacyResult).toBeDefined();
            expect(run.caseResults[0].currentResult).toBeDefined();
            await legacyAdapter.cleanup();
            await currentAdapter.cleanup();
        });
        it('should handle mismatched results', async () => {
            const legacyAdapter = createMockAdapter('legacy', { success: true });
            const currentAdapter = createMockAdapter('current', { success: false });
            await legacyAdapter.initialize();
            await currentAdapter.initialize();
            const executor = createLoginTestExecutor({
                mode: 'dual-browser',
                legacyAdapter,
                currentAdapter
            });
            const scenario = createTestScenario();
            const run = await executor.executeScenarios([scenario]);
            expect(run.summary.totalCases).toBe(1);
            expect(run.summary.differencesBySeverity).toBeDefined();
            await legacyAdapter.cleanup();
            await currentAdapter.cleanup();
        });
        it('should handle both failing', async () => {
            const legacyAdapter = createMockAdapter('legacy', {
                success: false,
                errorCode: 'INVALID_USERNAME'
            });
            const currentAdapter = createMockAdapter('current', {
                success: false,
                errorCode: 'INVALID_PASSWORD'
            });
            await legacyAdapter.initialize();
            await currentAdapter.initialize();
            const executor = createLoginTestExecutor({
                mode: 'dual-browser',
                legacyAdapter,
                currentAdapter
            });
            const scenario = createTestScenario({
                expected: { finalState: 'LOGIN_FAILED' }
            });
            const run = await executor.executeScenarios([scenario]);
            expect(run.summary.totalCases).toBe(1);
            expect(run.caseResults[0].differences).toBeDefined();
            await legacyAdapter.cleanup();
            await currentAdapter.cleanup();
        });
    });
    describe('legacy-shadow mode', () => {
        it('should set isLegacyShadow flag', async () => {
            const legacyAdapter = createMockAdapter('legacy', { success: true });
            await legacyAdapter.initialize();
            const executor = createLoginTestExecutor({
                mode: 'single-browser',
                legacyAdapter,
                isLegacyShadow: true
            });
            const scenario = createTestScenario();
            const run = await executor.executeScenarios([scenario]);
            expect(run.isLegacyShadow).toBe(true);
            await legacyAdapter.cleanup();
        });
    });
    describe('release gate', () => {
        it('should compute release gate with results', async () => {
            const legacyAdapter = createMockAdapter('legacy', { success: true });
            const currentAdapter = createMockAdapter('current', { success: false });
            await legacyAdapter.initialize();
            await currentAdapter.initialize();
            const executor = createLoginTestExecutor({
                mode: 'dual-browser',
                legacyAdapter,
                currentAdapter
            });
            const scenario = createTestScenario();
            const run = await executor.executeScenarios([scenario]);
            expect(run.releaseGate).toBeDefined();
            expect(run.releaseGate.blockedBy).toBeDefined();
            await legacyAdapter.cleanup();
            await currentAdapter.cleanup();
        });
    });
    describe('stopOnFailure', () => {
        it('should continue by default when failure occurs', async () => {
            const legacyAdapter = createMockAdapter('legacy', { success: false });
            await legacyAdapter.initialize();
            const executor = createLoginTestExecutor({
                mode: 'single-browser',
                legacyAdapter,
                stopOnFailure: false
            });
            const scenarios = [
                createTestScenario({ id: 'login-001' }),
                createTestScenario({ id: 'login-002' }),
                createTestScenario({ id: 'login-003' })
            ];
            const run = await executor.executeScenarios(scenarios);
            // All scenarios should be executed regardless of failure
            expect(run.summary.totalCases).toBe(3);
            expect(run.caseResults.length).toBe(3);
            await legacyAdapter.cleanup();
        });
        it('should stop on first failure when configured', async () => {
            const legacyAdapter = createMockAdapter('legacy', { success: false });
            await legacyAdapter.initialize();
            const executor = createLoginTestExecutor({
                mode: 'single-browser',
                legacyAdapter,
                stopOnFailure: true
            });
            const scenarios = [
                createTestScenario({ id: 'login-001' }),
                createTestScenario({ id: 'login-002' }),
                createTestScenario({ id: 'login-003' })
            ];
            const run = await executor.executeScenarios(scenarios);
            // Only first scenario should be executed due to stopOnFailure
            expect(run.summary.totalCases).toBe(1);
            await legacyAdapter.cleanup();
        });
    });
});
//# sourceMappingURL=test-executor.test.js.map