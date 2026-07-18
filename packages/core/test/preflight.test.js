import { describe, expect, it, afterEach } from 'vitest';
import { runLoginPreflight } from '../src/preflight.js';
afterEach(() => {
    delete process.env.TEST_USERNAME;
    delete process.env.TEST_PASSWORD;
});
describe('runLoginPreflight', () => {
    it('reports actionable missing credentials and captcha before browser launch', () => {
        const result = runLoginPreflight({
            projectPath: '/tmp/project', processId: 'user-login', scenariosDir: '/tmp/project/scenarios',
            mode: 'dual-browser',
            legacy: { baseUrl: 'http://legacy', captcha: { enabled: true, strategy: 'test-mode' } },
            current: { baseUrl: 'http://current', captcha: { enabled: true, strategy: 'test-mode', testValue: '1234' } }
        });
        expect(result.ok).toBe(false);
        expect(result.missing).toEqual(expect.arrayContaining([
            '.flowtrace/flowtrace.yaml', 'scenarios directory: /tmp/project/scenarios',
            'legacy.TEST_USERNAME', 'legacy.TEST_PASSWORD', 'legacy.captcha.testValue',
            'current.TEST_USERNAME', 'current.TEST_PASSWORD'
        ]));
        expect(result.warnings).toContain('浏览器尚未启动：前置检查未通过');
    });
    it('passes when dual-browser prerequisites are present', () => {
        process.env.TEST_USERNAME = 'user';
        process.env.TEST_PASSWORD = 'secret';
        const result = runLoginPreflight({
            projectPath: '/Users/fengjue/project/szwl/supply_chain', processId: 'user-login',
            scenariosDir: '/Users/fengjue/project/szwl/supply_chain/.flowtrace/scenarios', mode: 'dual-browser',
            legacy: { baseUrl: 'http://legacy' }, current: { baseUrl: 'http://current' }
        });
        expect(result.ok).toBe(true);
        expect(result.missing).toEqual([]);
    });
});
//# sourceMappingURL=preflight.test.js.map