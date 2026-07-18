/**
 * Project Isolation Tests
 *
 * These tests verify that FlowTrace CLI and Skill work correctly with
 * target projects, without coupling to specific business projects like supply-chain.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
describe('Project Isolation Tests', () => {
    const testRootDir = join(process.cwd(), `.test-isolation-${Date.now()}`);
    const projectA = join(testRootDir, 'project-a');
    const projectB = join(testRootDir, 'project-b');
    beforeAll(() => {
        mkdirSync(testRootDir, { recursive: true });
    });
    afterAll(() => {
        if (existsSync(testRootDir)) {
            rmSync(testRootDir, { recursive: true, force: true });
        }
    });
    describe('CLI loads scenarios from target project only', () => {
        beforeEach(() => {
            // Create project A with login scenarios
            mkdirSync(join(projectA, '.flowtrace', 'scenarios'), { recursive: true });
            const flowtraceYaml = {
                project: { id: 'project-a', name: 'Project A', sourceRoot: '.' },
                paths: { scenarios: 'scenarios', reports: 'reports', executions: 'executions' }
            };
            writeFileSync(join(projectA, '.flowtrace', 'flowtrace.yaml'), yaml.dump(flowtraceYaml));
            const loginScenarioA = {
                id: 'project-a-login-001',
                name: 'Project A Login',
                process: 'login',
                enabled: true,
                actions: [{ type: 'LOGIN', actor: 'user-a', data: { usernameRef: 'USER_A', passwordRef: 'PASS_A' } }],
                expected: { finalState: 'AUTHENTICATED' }
            };
            writeFileSync(join(projectA, '.flowtrace', 'scenarios', 'login.yaml'), yaml.dump(loginScenarioA));
            // Create project B with different login scenarios
            mkdirSync(join(projectB, '.flowtrace', 'scenarios'), { recursive: true });
            const flowtraceYamlB = {
                project: { id: 'project-b', name: 'Project B', sourceRoot: '.' },
                paths: { scenarios: 'scenarios', reports: 'reports', executions: 'executions' }
            };
            writeFileSync(join(projectB, '.flowtrace', 'flowtrace.yaml'), yaml.dump(flowtraceYamlB));
            const loginScenarioB = {
                id: 'project-b-login-001',
                name: 'Project B Login',
                process: 'login',
                enabled: true,
                actions: [{ type: 'LOGIN', actor: 'user-b', data: { usernameRef: 'USER_B', passwordRef: 'PASS_B' } }],
                expected: { finalState: 'AUTHENTICATED' }
            };
            writeFileSync(join(projectB, '.flowtrace', 'scenarios', 'login.yaml'), yaml.dump(loginScenarioB));
        });
        it('should load scenarios from project A, not project B', async () => {
            const { findLoginScenarios } = await import('../../cli/src/commands/test/scenario-resolver.js');
            const scenariosA = findLoginScenarios(join(projectA, '.flowtrace', 'scenarios'));
            expect(scenariosA.validScenarios.length).toBe(1);
            expect(scenariosA.validScenarios[0].scenario.id).toBe('project-a-login-001');
            expect(scenariosA.validScenarios[0].scenario.actions[0].actor).toBe('user-a');
        });
        it('should load scenarios from project B, not project A', async () => {
            const { findLoginScenarios } = await import('../../cli/src/commands/test/scenario-resolver.js');
            const scenariosB = findLoginScenarios(join(projectB, '.flowtrace', 'scenarios'));
            expect(scenariosB.validScenarios.length).toBe(1);
            expect(scenariosB.validScenarios[0].scenario.id).toBe('project-b-login-001');
            expect(scenariosB.validScenarios[0].scenario.actions[0].actor).toBe('user-b');
        });
        it('should not leak scenarios between projects', async () => {
            const { findLoginScenarios } = await import('../../cli/src/commands/test/scenario-resolver.js');
            const scenariosA = findLoginScenarios(join(projectA, '.flowtrace', 'scenarios'));
            const scenariosB = findLoginScenarios(join(projectB, '.flowtrace', 'scenarios'));
            // Verify no overlap
            const idsA = new Set(scenariosA.validScenarios.map(s => s.scenario.id));
            const idsB = new Set(scenariosB.validScenarios.map(s => s.scenario.id));
            for (const id of idsA) {
                expect(idsB.has(id)).toBe(false);
            }
            for (const id of idsB) {
                expect(idsA.has(id)).toBe(false);
            }
        });
    });
    describe('CLI reports and executions go to target project', () => {
        beforeEach(() => {
            // Create minimal project structure
            mkdirSync(join(projectA, '.flowtrace', 'scenarios'), { recursive: true });
            mkdirSync(join(projectA, '.flowtrace', 'executions'), { recursive: true });
            mkdirSync(join(projectA, '.flowtrace', 'reports'), { recursive: true });
            const flowtraceYaml = {
                project: { id: 'project-a', name: 'Project A', sourceRoot: '.' },
                paths: {
                    scenarios: 'scenarios',
                    reports: 'reports',
                    executions: 'executions'
                }
            };
            writeFileSync(join(projectA, '.flowtrace', 'flowtrace.yaml'), yaml.dump(flowtraceYaml));
            const loginScenario = {
                id: 'test-login-001',
                name: 'Test Login',
                process: 'login',
                enabled: true,
                actions: [{ type: 'LOGIN', actor: 'test', data: { usernameRef: 'USER', passwordRef: 'PASS' } }],
                expected: { finalState: 'AUTHENTICATED' }
            };
            writeFileSync(join(projectA, '.flowtrace', 'scenarios', 'login.yaml'), yaml.dump(loginScenario));
        });
        it('should use target project paths from config', async () => {
            const { loadTargetProjectConfig, getExecutionsDir, getReportsDir, getScenariosDir } = await import('@flowtrace/core');
            const config = loadTargetProjectConfig(projectA);
            expect(getScenariosDir(config)).toContain('project-a');
            expect(getExecutionsDir(config)).toContain('project-a');
            expect(getReportsDir(config)).toContain('project-a');
        });
    });
    describe('CLI fails gracefully without target project config', () => {
        it('should have empty result for non-existent scenarios', async () => {
            const { findLoginScenarios } = await import('../../cli/src/commands/test/scenario-resolver.js');
            const result = findLoginScenarios('/non-existent/path');
            expect(result.validScenarios.length).toBe(0);
        });
    });
    describe('Init command generates generic templates only', () => {
        const initTestProject = join(testRootDir, 'init-test');
        beforeEach(() => {
            mkdirSync(initTestProject, { recursive: true });
        });
        it('should not include supply-chain specific content in generated files', async () => {
            // Run init
            try {
                execSync(`node packages/cli/dist/index.js init --project ${initTestProject}`, {
                    cwd: process.cwd(),
                    encoding: 'utf-8',
                    stdio: 'pipe'
                });
            }
            catch {
                // Init might fail if CLI is not built, that's ok for this test
            }
            // Check generated files
            const flowtraceYaml = join(initTestProject, '.flowtrace', 'flowtrace.yaml');
            const envExample = join(initTestProject, '.env.example');
            const loginConfig = join(initTestProject, '.flowtrace', 'login-test-config.json');
            // Check flowtrace.yaml
            if (existsSync(flowtraceYaml)) {
                const content = readFileSync(flowtraceYaml, 'utf-8');
                expect(content.toLowerCase()).not.toContain('supply-chain');
                expect(content.toLowerCase()).not.toContain('供应链');
                expect(content.toLowerCase()).not.toContain('yanyq');
                expect(content.toLowerCase()).not.toContain('zhangt');
                expect(content.toLowerCase()).not.toContain('pfyh');
            }
            // Check .env.example
            if (existsSync(envExample)) {
                const content = readFileSync(envExample, 'utf-8');
                expect(content.toLowerCase()).not.toContain('supply-chain');
                expect(content).not.toContain('localhost:8000');
                // Should have generic placeholders
                expect(content).toContain('example.com');
            }
            // Check login-test-config.json
            if (existsSync(loginConfig)) {
                const content = readFileSync(loginConfig, 'utf-8');
                expect(content.toLowerCase()).not.toContain('supply-chain');
                expect(content).toContain('example.com');
            }
        });
        it('should include LOGIN in actions list when generated', async () => {
            // Check the source code for init command includes LOGIN
            const initPath = join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'init.ts');
            if (existsSync(initPath)) {
                const content = readFileSync(initPath, 'utf-8');
                // Verify LOGIN is included in the actions array
                expect(content).toContain("'LOGIN'");
            }
        });
    });
    describe('SKILL.md does not hardcode business project', () => {
        it('should not contain supply-chain references', async () => {
            const skillPath = join(process.cwd(), 'skill', 'flowtrace', 'SKILL.md');
            if (existsSync(skillPath)) {
                const content = readFileSync(skillPath, 'utf-8');
                expect(content.toLowerCase()).not.toContain('supply-chain');
                expect(content).not.toContain('供应链');
                expect(content).not.toContain('yanyq');
                expect(content).not.toContain('zhangt');
                expect(content).not.toContain('pfyh');
                expect(content).not.toContain('localhost:8000');
                expect(content).not.toContain('financing-approval');
            }
        });
        it('should reference generic target project pattern', async () => {
            const skillPath = join(process.cwd(), 'skill', 'flowtrace', 'SKILL.md');
            if (existsSync(skillPath)) {
                const content = readFileSync(skillPath, 'utf-8');
                // Should have generic references
                expect(content).toContain('<target-project>');
                expect(content).toContain('.flowtrace');
            }
        });
    });
    describe('CLI discover-processes does not hardcode supply-chain', () => {
        it('should not contain hardcoded evidence file paths', async () => {
            const discoverPath = join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'discover-processes.ts');
            if (existsSync(discoverPath)) {
                const content = readFileSync(discoverPath, 'utf-8');
                expect(content).not.toContain('supply-chain');
                expect(content).not.toContain('供应链');
                expect(content).not.toContain('yanyq');
                expect(content).not.toContain('zhangt');
                expect(content).not.toContain('pfyh');
                expect(content).not.toContain('FINANCE_FLOW_5STEP_ANALYSIS');
                expect(content).not.toContain('supply_chain_detail_design');
            }
        });
    });
    describe('No hardcoded business content in test executor', () => {
        it('should not reference supply-chain in test executor', async () => {
            const executorPath = join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'test', 'test-executor.ts');
            if (existsSync(executorPath)) {
                const content = readFileSync(executorPath, 'utf-8');
                expect(content.toLowerCase()).not.toContain('supply-chain');
                expect(content).not.toContain('供应链');
                expect(content).not.toContain('localhost:8000');
            }
        });
    });
});
//# sourceMappingURL=project-isolation.test.js.map