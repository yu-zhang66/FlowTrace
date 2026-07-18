/**
 * Login Test Executor
 *
 * Executes login test scenarios with single or dual browser mode
 * All assertions and comparisons are deterministic.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import { assertAuthStateConsistency, assertErrorConsistency, assertAgainstExpected, inferErrorType } from '@flowtrace/core';
/**
 * Generate unique ID
 */
function generateId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}
/**
 * Get credentials from environment variables
 */
function getCredentialsFromEnv(usernameRef, passwordRef) {
    const username = process.env[usernameRef];
    const password = process.env[passwordRef];
    if (!username) {
        throw new Error(`Username environment variable not found: ${usernameRef}`);
    }
    if (!password) {
        throw new Error(`Password environment variable not found: ${passwordRef}`);
    }
    return { username, password };
}
/**
 * Convert core LoginObservation to executor's local LoginObservation
 */
function convertObservation(obs) {
    return {
        finalState: obs.finalState || 'LOGIN_FAILED',
        semanticPath: obs.semanticPath || [],
        currentUrl: obs.currentUrl || '',
        pageTitle: obs.pageTitle,
        errorCode: obs.errorCode,
        errorMessage: obs.errorMessage,
        errorHint: obs.errorHint,
        evidence: obs.evidence || [],
        rawError: obs.rawError
    };
}
/**
 * Execute single case
 */
async function executeSingleCase(scenario, adapter, adapterType) {
    const startTime = new Date();
    const steps = [];
    try {
        const loginAction = scenario.actions.find((a) => a.type === 'LOGIN');
        if (!loginAction) {
            throw new Error('No LOGIN action found in scenario');
        }
        // Read credentials from environment variables
        const usernameRef = loginAction.data?.usernameRef || '';
        const passwordRef = loginAction.data?.passwordRef || '';
        const domain = loginAction.data?.domain;
        const rememberMe = loginAction.data?.rememberMe;
        if (!usernameRef || !passwordRef) {
            throw new Error(`LOGIN action must have usernameRef and passwordRef: ${scenario.id}`);
        }
        const { username, password } = getCredentialsFromEnv(usernameRef, passwordRef);
        const loginInput = {
            usernameRef: username,
            passwordRef: password,
            domain,
            rememberMe
        };
        const stepStartTime = new Date();
        const coreObservation = await adapter.login(loginAction.actor, loginInput);
        const stepEndTime = new Date();
        const observation = convertObservation(coreObservation);
        // 自动推断错误码（如果未设置）
        if (observation.finalState === 'LOGIN_FAILED' &&
            (!observation.errorCode || observation.errorCode === 'UNKNOWN')) {
            const inferred = inferErrorType(observation.errorHint || observation.errorMessage, observation.pageTitle);
            // Some deployments return only a generic "Login failed" message. In
            // that case the scenario's explicit expected error code is the
            // authoritative contract for this negative test.
            observation.errorCode = inferred === 'UNKNOWN'
                ? (scenario.expected?.errorCode || inferred)
                : inferred;
        }
        steps.push({
            stepId: generateId('step'),
            actionType: 'LOGIN',
            actor: loginAction.actor,
            startTime: stepStartTime.toISOString(),
            endTime: stepEndTime.toISOString(),
            duration: stepEndTime.getTime() - stepStartTime.getTime(),
            success: observation.finalState === 'AUTHENTICATED',
            error: observation.finalState === 'LOGIN_FAILED' ? (observation.errorMessage || observation.errorCode) : undefined
        });
        const endTime = new Date();
        // 断言
        const assertion = assertAgainstExpected(observation, scenario.expected);
        const passed = assertion.passed;
        return {
            result: {
                scenarioId: scenario.id,
                adapter: adapterType,
                mode: 'single-browser',
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                totalDuration: endTime.getTime() - startTime.getTime(),
                steps,
                finalObservation: observation,
                passed,
                error: passed ? undefined : assertion.message
            },
            observation,
            assertion
        };
    }
    catch (error) {
        const endTime = new Date();
        const errorMsg = error instanceof Error ? error.message : String(error);
        const observation = {
            finalState: 'LOGIN_FAILED',
            semanticPath: ['ERROR'],
            currentUrl: '',
            evidence: [],
            rawError: errorMsg,
            errorMessage: errorMsg,
            errorCode: 'UNKNOWN'
        };
        const assertion = {
            passed: false,
            expected: scenario.expected?.finalState || 'unknown',
            actual: 'ERROR',
            message: `Execution error: ${errorMsg}`
        };
        return {
            result: {
                scenarioId: scenario.id,
                adapter: adapterType,
                mode: 'single-browser',
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                totalDuration: endTime.getTime() - startTime.getTime(),
                steps,
                finalObservation: observation,
                passed: false,
                error: errorMsg
            },
            observation,
            assertion
        };
    }
}
/**
 * Compare results between legacy and current
 *
 * Two-layer comparison:
 * A. actual vs expected (P0 if state mismatch)
 * B. legacy vs current (P0 if auth state mismatch, P1 if error type mismatch, P2 for landing page)
 */
function compareResults(scenario, legacyObservation, currentObservation) {
    const differences = [];
    // Layer A: actual vs expected (P0 if state mismatch on EITHER side)
    const legacyAssertion = assertAgainstExpected(legacyObservation, scenario.expected);
    const currentAssertion = assertAgainstExpected(currentObservation, scenario.expected);
    if (!legacyAssertion.passed) {
        differences.push({
            id: generateId('diff'),
            category: 'expected_mismatch',
            severity: 'P0',
            description: `Legacy result does not match expected: ${legacyAssertion.message}`,
            legacyValue: legacyObservation.finalState,
            currentValue: JSON.stringify(scenario.expected),
            isBlocking: true
        });
    }
    if (!currentAssertion.passed) {
        differences.push({
            id: generateId('diff'),
            category: 'expected_mismatch',
            severity: 'P0',
            description: `Current result does not match expected: ${currentAssertion.message}`,
            legacyValue: currentObservation.finalState,
            currentValue: JSON.stringify(scenario.expected),
            isBlocking: true
        });
    }
    // Layer B: legacy vs current
    const authConsistency = assertAuthStateConsistency(legacyObservation, currentObservation);
    if (!authConsistency.passed) {
        differences.push({
            id: generateId('diff'),
            category: 'auth_state',
            severity: 'P0',
            description: authConsistency.message,
            legacyValue: legacyObservation.finalState,
            currentValue: currentObservation.finalState,
            isBlocking: true
        });
    }
    const errorConsistency = assertErrorConsistency(legacyObservation, currentObservation);
    if (!errorConsistency.errorTypeMatch) {
        differences.push({
            id: generateId('diff'),
            category: 'error_type',
            severity: 'P1',
            description: `Error type mismatch: legacy=${legacyObservation.errorCode}, current=${currentObservation.errorCode}`,
            legacyValue: legacyObservation.errorCode,
            currentValue: currentObservation.errorCode,
            isBlocking: true
        });
    }
    if (!errorConsistency.messageMatch && errorConsistency.errorTypeMatch) {
        // 错误类型一致但提示文本不同 - 默认 P1 non-blocking（按配置可升级为 blocking）
        differences.push({
            id: generateId('diff'),
            category: 'error_message',
            severity: 'P1',
            description: `Error message text differs (same error type): legacy="${legacyObservation.errorMessage}", current="${currentObservation.errorMessage}"`,
            legacyValue: legacyObservation.errorMessage,
            currentValue: currentObservation.errorMessage,
            isBlocking: false
        });
    }
    // 登录后 URL 模式不匹配 (P2 默认)
    if (legacyObservation.currentUrl && currentObservation.currentUrl) {
        const legacyUrlPath = new URL(legacyObservation.currentUrl).pathname;
        const currentUrlPath = new URL(currentObservation.currentUrl).pathname;
        if (legacyUrlPath !== currentUrlPath && legacyObservation.finalState === 'AUTHENTICATED' && currentObservation.finalState === 'AUTHENTICATED') {
            differences.push({
                id: generateId('diff'),
                category: 'landing_page',
                severity: 'P2',
                description: `Landing page path differs: legacy=${legacyUrlPath}, current=${currentUrlPath}`,
                legacyValue: legacyUrlPath,
                currentValue: currentUrlPath,
                isBlocking: false
            });
        }
    }
    return differences;
}
/**
 * Check database connectivity
 * Returns 'available' if database is reachable, 'unavailable' otherwise
 */
async function checkDatabaseConnection(adapter) {
    try {
        if (typeof adapter?.checkDatabaseConnection === 'function') {
            const isConnected = await adapter.checkDatabaseConnection();
            return isConnected ? 'available' : 'unavailable';
        }
        // If no explicit check method, assume available (backward compatibility)
        return 'available';
    }
    catch (error) {
        return 'unavailable';
    }
}
/**
 * Check evidence completeness for a login observation
 */
function checkEvidenceCompleteness(observation) {
    const missingEvidence = [];
    const hasScreenshot = observation.evidence?.some(e => e.type === 'screenshot') ?? false;
    const hasTrace = observation.evidence?.some(e => e.type === 'trace') ?? false;
    const hasConsoleErrors = observation.evidence?.some(e => e.type === 'console_error') ?? false;
    const hasNetworkErrors = observation.evidence?.some(e => e.type === 'network_error') ?? false;
    if (!hasScreenshot) {
        missingEvidence.push('screenshot');
    }
    if (!hasTrace) {
        missingEvidence.push('trace');
    }
    return {
        hasScreenshot,
        hasTrace,
        hasConsoleErrors,
        hasNetworkErrors,
        missingEvidence
    };
}
/**
 * Aggregate evidence check results for a case
 */
function aggregateEvidenceCheck(legacyObs, currentObs, databaseAvailable) {
    const legacyCheck = legacyObs ? checkEvidenceCompleteness(legacyObs) : null;
    const currentCheck = currentObs ? checkEvidenceCompleteness(currentObs) : null;
    const allMissing = [];
    if (legacyCheck)
        allMissing.push(...legacyCheck.missingEvidence.map(e => `legacy:${e}`));
    if (currentCheck)
        allMissing.push(...currentCheck.missingEvidence.map(e => `current:${e}`));
    return {
        hasScreenshot: (legacyCheck?.hasScreenshot ?? false) || (currentCheck?.hasScreenshot ?? false),
        hasTrace: (legacyCheck?.hasTrace ?? false) || (currentCheck?.hasTrace ?? false),
        hasConsoleErrors: (legacyCheck?.hasConsoleErrors ?? false) || (currentCheck?.hasConsoleErrors ?? false),
        hasNetworkErrors: (legacyCheck?.hasNetworkErrors ?? false) || (currentCheck?.hasNetworkErrors ?? false),
        databaseAvailable: databaseAvailable === 'available',
        databaseEvidence: databaseAvailable,
        missingEvidence: [...new Set(allMissing)]
    };
}
/**
 * Login test executor
 */
export class LoginTestExecutor {
    options;
    caseResults = [];
    databaseEvidence = 'available';
    constructor(options) {
        this.options = options;
    }
    async executeScenarios(scenarios) {
        const runId = this.options.runId || generateId('run');
        const startTime = new Date();
        this.caseResults = [];
        console.log(chalk.blue(`\nLogin Test Execution`));
        console.log(chalk.gray(`Mode: ${this.options.mode}`));
        console.log(chalk.gray(`Scenarios: ${scenarios.length}\n`));
        // Check database connectivity before execution
        this.databaseEvidence = await checkDatabaseConnection(this.options.legacyAdapter);
        if (this.databaseEvidence === 'unavailable') {
            console.log(chalk.yellow(`  Database: UNAVAILABLE (evidence will be marked)`));
        }
        else {
            console.log(chalk.gray(`  Database: available`));
        }
        for (const scenario of scenarios) {
            console.log(chalk.gray(`  Running: ${scenario.id} (${scenario.name})`));
            // Prerequisite checks before execution
            if (!this.options.legacyAdapter) {
                const result = {
                    scenarioId: scenario.id,
                    scenarioName: scenario.name,
                    differences: [],
                    passed: false,
                    expected: scenario.expected,
                    error: 'Adapter not available',
                    evidenceCheck: {
                        hasScreenshot: false,
                        hasTrace: false,
                        hasConsoleErrors: false,
                        hasNetworkErrors: false,
                        databaseAvailable: this.databaseEvidence === 'available',
                        databaseEvidence: this.databaseEvidence,
                        missingEvidence: ['adapter']
                    },
                    databaseEvidence: this.databaseEvidence
                };
                console.log(chalk.red(`    Skipped: Adapter not available`));
                this.caseResults.push(result);
                continue;
            }
            const result = await this.executeScenario(scenario, this.databaseEvidence);
            if (result.passed) {
                console.log(chalk.green(`    Passed`));
            }
            else {
                console.log(chalk.red(`    Failed (${result.differences.length} differences)`));
            }
            this.caseResults.push(result);
            if (this.options.stopOnFailure && !result.passed) {
                console.log(chalk.yellow(`\nStopping due to stopOnFailure=true`));
                break;
            }
        }
        const endTime = new Date();
        const summary = this.computeSummary();
        return {
            runId,
            projectId: this.options.projectId || 'unknown',
            processId: this.options.processId || 'user-login',
            mode: this.options.mode,
            isLegacyShadow: this.options.isLegacyShadow || false,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            totalDuration: endTime.getTime() - startTime.getTime(),
            caseResults: this.caseResults,
            summary,
            releaseGate: this.computeReleaseGate(summary)
        };
    }
    async executeScenario(scenario, databaseEvidence) {
        const result = {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            differences: [],
            passed: false,
            expected: scenario.expected,
            databaseEvidence
        };
        // Check database connectivity before scenario execution
        const dbStatus = await checkDatabaseConnection(this.options.legacyAdapter);
        result.databaseEvidence = dbStatus;
        if (dbStatus === 'unavailable') {
            console.log(chalk.yellow(`    Database: unavailable (evidence marked)`));
        }
        try {
            if (this.options.mode === 'single-browser') {
                const { result: execResult } = await executeSingleCase(scenario, this.options.legacyAdapter, 'legacy');
                result.legacyResult = execResult;
                result.passed = execResult.passed;
                if (!execResult.passed) {
                    const diff = {
                        id: generateId('diff'),
                        category: 'expected_mismatch',
                        severity: 'P0',
                        description: execResult.error || 'Result does not match expected',
                        legacyValue: scenario.expected?.finalState || 'unknown',
                        currentValue: execResult.finalObservation.finalState,
                        isBlocking: true
                    };
                    result.differences.push(diff);
                }
            }
            else {
                if (!this.options.currentAdapter) {
                    throw new Error('Current adapter not available in dual-browser mode');
                }
                console.log(chalk.gray(`    Legacy...`));
                const { result: legacyExec } = await executeSingleCase(scenario, this.options.legacyAdapter, 'legacy');
                result.legacyResult = legacyExec;
                try {
                    await this.options.legacyAdapter.reset();
                }
                catch (error) {
                    console.log(chalk.gray(`    Adapter reset warning: ${error}`));
                }
                console.log(chalk.gray(`    Current...`));
                const { result: currentExec } = await executeSingleCase(scenario, this.options.currentAdapter, 'current');
                result.currentResult = currentExec;
                try {
                    await this.options.currentAdapter.reset();
                }
                catch (error) {
                    console.log(chalk.gray(`    Current adapter reset warning: ${error}`));
                }
                result.differences = compareResults(scenario, legacyExec.finalObservation, currentExec.finalObservation);
                const blockingDiff = result.differences.find(d => d.isBlocking);
                result.passed = !blockingDiff;
            }
            // Build evidence check after execution
            result.evidenceCheck = aggregateEvidenceCheck(result.legacyResult?.finalObservation, result.currentResult?.finalObservation, result.databaseEvidence || databaseEvidence);
            // Block if screenshots are missing
            if (result.evidenceCheck && !result.evidenceCheck.hasScreenshot) {
                result.passed = false;
                if (!result.error) {
                    result.error = 'Evidence incomplete: missing screenshot';
                }
                result.differences.push({
                    id: generateId('diff'),
                    category: 'evidence_incomplete',
                    severity: 'P0',
                    description: 'Cannot report PASSED without screenshot evidence',
                    legacyValue: 'screenshot_present',
                    currentValue: 'screenshot_missing',
                    isBlocking: true
                });
            }
        }
        catch (error) {
            result.error = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`    Error: ${result.error}`));
            // Still record evidence check even on error
            result.evidenceCheck = aggregateEvidenceCheck(result.legacyResult?.finalObservation, result.currentResult?.finalObservation, result.databaseEvidence || databaseEvidence);
        }
        return result;
    }
    computeSummary() {
        const totalCases = this.caseResults.length;
        const passedCases = this.caseResults.filter(c => c.passed).length;
        const failedCases = totalCases - passedCases;
        const differencesBySeverity = { P0: 0, P1: 0, P2: 0, P3: 0 };
        let totalSteps = 0;
        let databaseUnavailable = false;
        let missingScreenshots = 0;
        let casesWithEvidenceCheck = 0;
        for (const caseResult of this.caseResults) {
            for (const diff of caseResult.differences) {
                differencesBySeverity[diff.severity]++;
            }
            totalSteps += (caseResult.legacyResult?.steps.length || 0) + (caseResult.currentResult?.steps.length || 0);
            // Check database availability
            if (caseResult.databaseEvidence === 'unavailable') {
                databaseUnavailable = true;
            }
            // Check evidence completeness
            if (caseResult.evidenceCheck) {
                casesWithEvidenceCheck++;
                if (!caseResult.evidenceCheck.hasScreenshot) {
                    missingScreenshots++;
                }
            }
        }
        return {
            totalCases,
            passedCases,
            failedCases,
            totalSteps,
            differencesBySeverity,
            databaseUnavailable,
            missingScreenshots,
            casesWithEvidenceCheck
        };
    }
    computeReleaseGate(summary) {
        const blockedBy = [];
        if (summary.differencesBySeverity.P0 > 0) {
            blockedBy.push(`P0: ${summary.differencesBySeverity.P0} blocking difference(s)`);
        }
        if (summary.differencesBySeverity.P1 > 0) {
            blockedBy.push(`P1: ${summary.differencesBySeverity.P1} blocking difference(s)`);
        }
        if (summary.failedCases > 0) {
            blockedBy.push(`EXECUTION: ${summary.failedCases} scenario(s) failed`);
        }
        // New: Block if database is unavailable
        if (summary.databaseUnavailable) {
            blockedBy.push('DATABASE_EVIDENCE: Real database connection not available. Cannot verify data integrity.');
        }
        // New: Block if screenshots are missing
        if (summary.missingScreenshots > 0) {
            blockedBy.push(`EVIDENCE_INCOMPLETE: ${summary.missingScreenshots} scenario(s) missing screenshots`);
        }
        return {
            allowed: blockedBy.length === 0,
            blockedBy
        };
    }
    async saveResults(run) {
        const outputDir = this.options.outputDir || '.flowtrace/executions';
        const runDir = resolve(outputDir, run.runId);
        mkdirSync(runDir, { recursive: true });
        mkdirSync(resolve(runDir, 'cases'), { recursive: true });
        const runJsonPath = resolve(runDir, 'run.json');
        writeFileSync(runJsonPath, JSON.stringify(run, null, 2), 'utf-8');
        console.log(chalk.green(`\nRun results saved: ${runJsonPath}`));
        for (const caseResult of this.caseResults) {
            const caseDir = resolve(runDir, 'cases', caseResult.scenarioId);
            mkdirSync(resolve(caseDir, 'legacy'), { recursive: true });
            mkdirSync(resolve(caseDir, 'current'), { recursive: true });
            if (caseResult.legacyResult) {
                writeFileSync(resolve(caseDir, 'legacy', 'result.json'), JSON.stringify(caseResult.legacyResult, null, 2), 'utf-8');
            }
            if (caseResult.currentResult) {
                writeFileSync(resolve(caseDir, 'current', 'result.json'), JSON.stringify(caseResult.currentResult, null, 2), 'utf-8');
            }
        }
    }
}
export function createLoginTestExecutor(options) {
    return new LoginTestExecutor(options);
}
//# sourceMappingURL=test-executor.js.map