/**
 * flowtrace test - Unified test execution command
 *
 * Unified test flow: collect → generate-cases → validate-cases → load adapters → execute scenarios → collect evidence → generate reports
 * Supports login tests and financing application tests
 */
import chalk from 'chalk';
import yaml from 'js-yaml';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { loadTargetProjectConfig, getScenariosDir, getExecutionsDir, validateTargetConfig, generateId, runGate, gateForCommand, runLoginPreflight } from '@flowtrace/core';
import { findLoginScenarios, findScenarioById, checkScenarioSecurity, resolveScenarios } from './scenario-resolver.js';
import { createLoginTestExecutor } from './test-executor.js';
/**
 * Initialize execution context and directory structure
 */
function initializeExecutionContext(projectPath, options, targetConfig) {
    const runId = generateId('run');
    const processId = options.process || 'user-login';
    const mode = options.mode === 'dual-browser' ? 'dual-browser' : 'single-browser';
    const isLegacyShadow = options.legacyShadow || false;
    const executionsDir = options.output
        ? resolve(projectPath, options.output)
        : getExecutionsDir(targetConfig);
    const runDir = resolve(executionsDir, runId);
    const evidenceDir = resolve(runDir, 'evidence');
    const casesDir = resolve(runDir, 'cases');
    const reportsDir = resolve(runDir, 'reports');
    mkdirSync(runDir, { recursive: true });
    mkdirSync(evidenceDir, { recursive: true });
    mkdirSync(casesDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });
    const scenariosDir = options.scenarios
        ? resolve(projectPath, options.scenarios)
        : getScenariosDir(targetConfig);
    return {
        runId,
        projectPath,
        processId,
        executionsDir,
        runDir,
        evidenceDir,
        casesDir,
        reportsDir,
        scenariosDir,
        mode,
        isLegacyShadow,
        reuseBaseline: options.reuseBaseline || false,
        reuseCases: options.reuseCases || false
    };
}
/**
 * Step 1: Collect baseline data
 */
async function stepCollectBaseline(ctx) {
    console.log(chalk.blue(`\n[Step 1/7] Collecting baseline data...`));
    if (ctx.reuseBaseline) {
        console.log(chalk.gray(`  Reusing historical baseline (--reuse-baseline)`));
        return { success: true };
    }
    console.log(chalk.gray(`  Baseline collection would happen here for non-login processes`));
    console.log(chalk.green(`  ✓ Baseline collection completed (no-op for login tests)`));
    return { success: true };
}
/**
 * Step 2: Generate test cases (scenarios)
 */
async function stepGenerateCases(ctx, options) {
    console.log(chalk.blue(`\n[Step 2/7] Generating test cases...`));
    if (ctx.reuseCases) {
        console.log(chalk.gray(`  Reusing historical scenarios (--reuse-cases)`));
        const scenarios = await loadHistoricalScenarios(ctx);
        return { success: true, scenarios, resolutionResult: { validScenarios: [], invalidScenarios: [], parseErrors: [] } };
    }
    let resolutionResult;
    if (options.scenario) {
        const scenario = findScenarioById(ctx.scenariosDir, options.scenario);
        if (!scenario) {
            return {
                success: false,
                scenarios: [],
                resolutionResult: { validScenarios: [], invalidScenarios: [], parseErrors: [] },
                error: `Scenario not found: ${options.scenario}`
            };
        }
        resolutionResult = {
            validScenarios: [{ scenario, validationErrors: [], filePath: '' }],
            invalidScenarios: [],
            parseErrors: []
        };
    }
    else {
        const processFilter = ctx.processId;
        resolutionResult = { validScenarios: [], invalidScenarios: [], parseErrors: [] };
        const processScenariosDir = resolve(ctx.scenariosDir, processFilter);
        if (existsSync(processScenariosDir)) {
            resolutionResult = findLoginScenarios(processScenariosDir);
        }
        if (resolutionResult.validScenarios.length === 0) {
            resolutionResult = findLoginScenarios(ctx.scenariosDir);
        }
        if (resolutionResult.validScenarios.length === 0) {
            resolutionResult = resolveScenarios({
                scenariosDir: ctx.scenariosDir,
                filter: { process: processFilter, enabledOnly: true }
            });
        }
    }
    const scenarios = resolutionResult.validScenarios.map(r => r.scenario);
    if (resolutionResult.invalidScenarios.length > 0) {
        console.warn(chalk.yellow(`  Found ${resolutionResult.invalidScenarios.length} invalid scenarios:`));
        for (const inv of resolutionResult.invalidScenarios) {
            console.log(chalk.gray(`    - ${inv.scenario?.id || 'unknown'}: ${inv.errors.join(', ')}`));
        }
    }
    if (scenarios.length === 0) {
        return {
            success: false,
            scenarios: [],
            resolutionResult,
            error: `No valid scenarios found for process: ${ctx.processId}`
        };
    }
    console.log(chalk.green(`  ✓ Found ${scenarios.length} valid scenario(s)`));
    return { success: true, scenarios, resolutionResult };
}
/**
 * Step 3: Validate cases
 */
async function stepValidateCases(ctx, scenarios, resolutionResult) {
    console.log(chalk.blue(`\n[Step 3/7] Validating cases...`));
    const errors = [];
    if (resolutionResult.parseErrors.length > 0) {
        for (const err of resolutionResult.parseErrors) {
            errors.push(`Parse error in ${err.filePath}: ${err.error}`);
        }
    }
    if (resolutionResult.invalidScenarios.length > 0) {
        for (const inv of resolutionResult.invalidScenarios) {
            errors.push(`Invalid scenario ${inv.scenario?.id}: ${inv.errors.join(', ')}`);
        }
    }
    for (const scenario of scenarios) {
        const security = checkScenarioSecurity(scenario);
        if (security.hasIssues) {
            console.warn(chalk.yellow(`  Security warnings for ${scenario.id}:`));
            for (const issue of security.issues) {
                console.log(chalk.gray(`    - ${issue}`));
            }
        }
    }
    if (errors.length > 0) {
        console.error(chalk.red(`  ✗ Case validation failed:`));
        for (const err of errors) {
            console.log(chalk.gray(`    - ${err}`));
        }
        return { success: false, error: errors.join('; ') };
    }
    console.log(chalk.green(`  ✓ All ${scenarios.length} case(s) validated`));
    return { success: true };
}
/**
 * Load historical scenarios from previous runs
 */
async function loadHistoricalScenarios(ctx) {
    console.log(chalk.gray(`  Loading historical scenarios from previous runs...`));
    const scenarios = [];
    const processScenariosDir = resolve(ctx.scenariosDir, ctx.processId);
    if (!existsSync(processScenariosDir)) {
        console.log(chalk.yellow(`  ⚠ No scenarios directory found: ${processScenariosDir}`));
        return scenarios;
    }
    try {
        const files = readdirSync(processScenariosDir);
        const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const file of yamlFiles) {
            const filePath = resolve(processScenariosDir, file);
            try {
                const content = readFileSync(filePath, 'utf-8');
                const parsed = yaml.load(content);
                if (parsed && typeof parsed === 'object') {
                    const scenario = parsed;
                    if (scenario.id && scenario.name) {
                        scenarios.push(scenario);
                    }
                }
            }
            catch (error) {
                console.warn(chalk.yellow(`  ⚠ Failed to load scenario file ${file}: ${error}`));
            }
        }
        console.log(chalk.green(`  ✓ Loaded ${scenarios.length} historical scenario(s)`));
    }
    catch (error) {
        console.error(chalk.red(`  ✗ Error reading scenarios directory: ${error}`));
    }
    return scenarios;
}
/**
 * Step 4: Load adapters
 */
async function stepLoadAdapters(ctx, loginConfig) {
    console.log(chalk.blue(`\n[Step 4/7] Loading adapters...`));
    try {
        const adapters = await loadAdapters(loginConfig, ctx.projectPath, ctx.isLegacyShadow, ctx.evidenceDir);
        await adapters.legacyAdapter.initialize();
        if (ctx.mode === 'dual-browser' && !ctx.isLegacyShadow) {
            await adapters.currentAdapter.initialize();
        }
        console.log(chalk.green(`  ✓ Adapters initialized`));
        return { success: true, adapters };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`  ✗ Adapter initialization failed: ${errorMsg}`));
        return { success: false, adapters: null, error: errorMsg };
    }
}
/**
 * Step 5: Execute scenarios
 */
async function stepExecuteScenarios(ctx, scenarios, adapters, targetConfig, options) {
    console.log(chalk.blue(`\n[Step 5/7] Executing scenarios...`));
    try {
        const executor = createLoginTestExecutor({
            mode: ctx.mode,
            legacyAdapter: adapters.legacyAdapter,
            currentAdapter: adapters.currentAdapter,
            isLegacyShadow: ctx.isLegacyShadow,
            stopOnFailure: options.stopOnFailure,
            outputDir: ctx.executionsDir,
            runId: ctx.runId
        });
        console.log(chalk.gray(`  Running ${scenarios.length} scenario(s)...\n`));
        const run = await executor.executeScenarios(scenarios);
        run.projectId = targetConfig.project.id;
        run.processId = ctx.processId;
        run.runId = ctx.runId;
        await executor.saveResults(run);
        const passed = run.summary.passedCases;
        const failed = run.summary.failedCases;
        console.log(chalk.green(`\n  ✓ Execution completed: ${passed} passed, ${failed} failed`));
        return { success: true, run };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`  ✗ Execution failed: ${errorMsg}`));
        return { success: false, run: null, error: errorMsg };
    }
}
/**
 * Step 6: Collect evidence
 */
async function stepCollectEvidence(ctx, run) {
    console.log(chalk.blue(`\n[Step 6/7] Collecting evidence...`));
    let hasScreenshots = false;
    if (existsSync(ctx.evidenceDir)) {
        const files = readdirSync(ctx.evidenceDir);
        const screenshots = files.filter(f => f.endsWith('.png'));
        hasScreenshots = screenshots.length > 0;
        console.log(chalk.gray(`  Evidence directory: ${ctx.evidenceDir}`));
        console.log(chalk.gray(`  Screenshots: ${screenshots.length}`));
        console.log(chalk.gray(`  Other files: ${files.length - screenshots.length}`));
    }
    else {
        console.log(chalk.gray(`  No evidence directory found`));
    }
    const caseResults = run?.caseResults || [];
    const casesWithEvidence = caseResults.filter((c) => (c.legacyResult?.finalObservation?.evidence?.length > 0) ||
        (c.currentResult?.finalObservation?.evidence?.length > 0));
    if (casesWithEvidence.length < caseResults.length) {
        const missingCount = caseResults.length - casesWithEvidence.length;
        console.log(chalk.yellow(`  ⚠ ${missingCount} case(s) missing evidence`));
    }
    console.log(chalk.green(`  ✓ Evidence collection completed`));
    return { success: true, hasScreenshots };
}
/**
 * Step 7: Generate reports
 */
async function stepGenerateReports(ctx, run) {
    console.log(chalk.blue(`\n[Step 7/7] Generating reports...`));
    try {
        const { jsonPath, mdPath, htmlPath } = await saveReport(run, ctx.projectPath, ctx.executionsDir);
        console.log(chalk.green(`  ✓ Reports generated`));
        console.log(chalk.gray(`    JSON: ${jsonPath}`));
        console.log(chalk.gray(`    Markdown: ${mdPath}`));
        console.log(chalk.gray(`    HTML: ${htmlPath}`));
        return { success: true, reportPaths: { jsonPath, mdPath, htmlPath } };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`  ✗ Report generation failed: ${errorMsg}`));
        return { success: false, error: errorMsg };
    }
}
/**
 * Main unified test flow orchestrator
 */
async function runUnifiedTestFlow(options, projectPath, targetConfig, loginConfig) {
    const flowSteps = [
        { name: 'Collect Baseline', status: 'pending' },
        { name: 'Generate Cases', status: 'pending' },
        { name: 'Validate Cases', status: 'pending' },
        { name: 'Load Adapters', status: 'pending' },
        { name: 'Execute Scenarios', status: 'pending' },
        { name: 'Collect Evidence', status: 'pending' },
        { name: 'Generate Reports', status: 'pending' }
    ];
    const ctx = initializeExecutionContext(projectPath, options, targetConfig);
    let scenarios = [];
    let resolutionResult = { validScenarios: [], invalidScenarios: [], parseErrors: [] };
    let adapters = null;
    let run = null;
    let success = true;
    let flowError;
    console.log(chalk.blue(`\n=== FlowTrace Unified Test Flow ===`));
    console.log(chalk.gray(`Process: ${ctx.processId}`));
    console.log(chalk.gray(`Run ID: ${ctx.runId}`));
    console.log(chalk.gray(`Mode: ${ctx.mode}`));
    console.log(chalk.gray(`Output: ${ctx.runDir}`));
    console.log();
    // Step 1: Collect Baseline
    flowSteps[0].status = 'running';
    const baselineResult = await stepCollectBaseline(ctx);
    flowSteps[0].status = baselineResult.success ? 'completed' : 'failed';
    if (!baselineResult.success) {
        flowError = baselineResult.error;
        success = false;
    }
    // Step 2: Generate Cases
    if (success) {
        flowSteps[1].status = 'running';
        const casesResult = await stepGenerateCases(ctx, options);
        flowSteps[1].status = casesResult.success ? 'completed' : 'failed';
        if (casesResult.success) {
            scenarios = casesResult.scenarios;
            resolutionResult = casesResult.resolutionResult;
        }
        else {
            flowError = casesResult.error;
            success = false;
        }
    }
    // Step 3: Validate Cases
    if (success) {
        flowSteps[2].status = 'running';
        const validationResult = await stepValidateCases(ctx, scenarios, resolutionResult);
        flowSteps[2].status = validationResult.success ? 'completed' : 'failed';
        if (!validationResult.success) {
            flowError = validationResult.error;
            success = false;
        }
    }
    // Step 4: Load Adapters
    if (success) {
        flowSteps[3].status = 'running';
        const adapterResult = await stepLoadAdapters(ctx, loginConfig);
        flowSteps[3].status = adapterResult.success ? 'completed' : 'failed';
        if (adapterResult.success) {
            adapters = adapterResult.adapters;
        }
        else {
            flowError = adapterResult.error;
            success = false;
        }
    }
    // Step 5: Execute Scenarios
    if (success) {
        flowSteps[4].status = 'running';
        const execResult = await stepExecuteScenarios(ctx, scenarios, adapters, targetConfig, options);
        flowSteps[4].status = execResult.success ? 'completed' : 'failed';
        if (execResult.success) {
            run = execResult.run;
        }
        else {
            flowError = execResult.error;
            success = false;
        }
    }
    // Step 6: Collect Evidence
    if (success && run) {
        flowSteps[5].status = 'running';
        const evidenceResult = await stepCollectEvidence(ctx, run);
        flowSteps[5].status = evidenceResult.success ? 'completed' : 'failed';
        if (!evidenceResult.hasScreenshots) {
            console.log(chalk.yellow(`\n⚠ Warning: No screenshots collected`));
        }
    }
    else if (success) {
        flowSteps[5].status = 'skipped';
    }
    // Step 7: Generate Reports
    if (success && run) {
        flowSteps[6].status = 'running';
        const reportResult = await stepGenerateReports(ctx, run);
        flowSteps[6].status = reportResult.success ? 'completed' : 'failed';
        if (!reportResult.success) {
            flowError = reportResult.error;
            success = false;
        }
    }
    else if (success) {
        flowSteps[6].status = 'skipped';
    }
    return {
        success,
        steps: flowSteps,
        runId: ctx.runId,
        processId: ctx.processId,
        scenarios,
        results: run
    };
}
function loadLoginTestConfig(projectPath, options, targetConfig) {
    const configuredPath = targetConfig?.loginTest?.configFile;
    const candidatePaths = [];
    if (configuredPath) {
        candidatePaths.push(resolve(projectPath, configuredPath));
    }
    candidatePaths.push(resolve(projectPath, '.flowtrace', 'login-test-config.json'));
    const processId = options.process || 'user-login';
    candidatePaths.push(resolve(projectPath, '.flowtrace', 'scenarios', processId, 'login-test-config.json'));
    for (const configPath of candidatePaths) {
        if (existsSync(configPath)) {
            try {
                const content = readFileSync(configPath, 'utf-8');
                const parsed = JSON.parse(content);
                const config = parsed.loginTest ? parsed.loginTest : parsed;
                return config;
            }
            catch (error) {
                console.warn(`Failed to load login test config from ${configPath}: ${error}`);
            }
        }
    }
    const legacyBaseUrl = options.legacyBaseUrl || process.env.LEGACY_BASE_URL;
    const currentBaseUrl = options.currentBaseUrl || process.env.CURRENT_BASE_URL;
    if (!legacyBaseUrl) {
        console.error(chalk.red(`\nError: Legacy base URL not configured`));
        console.log(chalk.gray(`   Set --legacy-base-url or LEGACY_BASE_URL environment variable`));
        console.log(chalk.gray(`   Or create .flowtrace/login-test-config.json in ${projectPath}`));
        return null;
    }
    if (!currentBaseUrl && options.mode === 'dual-browser') {
        console.error(chalk.red(`\nError: Current base URL not configured`));
        console.log(chalk.gray(`   Set --current-base-url or CURRENT_BASE_URL environment variable`));
        console.log(chalk.gray(`   Or create .flowtrace/login-test-config.json in ${projectPath}`));
        return null;
    }
    return {
        legacy: {
            baseUrl: legacyBaseUrl,
            loginUrl: process.env.LEGACY_LOGIN_URL || undefined,
            usernameEnv: 'TEST_USERNAME',
            passwordEnv: 'TEST_PASSWORD'
        },
        current: {
            baseUrl: currentBaseUrl || legacyBaseUrl,
            loginUrl: process.env.CURRENT_LOGIN_URL || undefined,
            usernameEnv: 'TEST_USERNAME',
            passwordEnv: 'TEST_PASSWORD'
        }
    };
}
function checkConfigurationExists(projectPath) {
    const issues = [];
    const flowtraceDir = resolve(projectPath, '.flowtrace');
    if (!existsSync(flowtraceDir)) {
        issues.push('Missing .flowtrace directory');
        return issues;
    }
    const configPath = resolve(flowtraceDir, 'flowtrace.yaml');
    if (!existsSync(configPath)) {
        issues.push('Missing .flowtrace/flowtrace.yaml');
    }
    return issues;
}
function printInitHint(projectPath) {
    console.log(chalk.yellow(`\nTo initialize FlowTrace for this project, run:`));
    console.log(chalk.cyan(`   flowtrace init --project ${projectPath}`));
}
async function loadAdapters(config, projectPath, isLegacyShadow, evidenceDir) {
    const { LoginAdapterLoader } = await import('@flowtrace/adapter');
    const legacyCfg = (config.legacy || {});
    const legacySelectors = legacyCfg.selectors || {
        username: legacyCfg.usernameSelector,
        password: legacyCfg.passwordSelector,
        submit: legacyCfg.submitSelector,
        error: legacyCfg.errorSelector,
    };
    const legacyCaptcha = legacyCfg.captcha || {
        enabled: legacyCfg.captchaEnabled,
        selector: legacyCfg.captchaSelector,
        inputSelector: legacyCfg.captchaInputSelector,
        strategy: legacyCfg.captchaStrategy,
        testValue: legacyCfg.captchaTestValue,
        maxRetries: legacyCfg.maxCaptchaRetries,
    };
    const adapterConfig = {
        legacyBaseUrl: legacyCfg.baseUrl,
        currentBaseUrl: config.current?.baseUrl,
        credentials: {
            usernameEnvVar: legacyCfg.usernameEnv,
            passwordEnvVar: legacyCfg.passwordEnv
        },
        selectors: legacySelectors.username ? legacySelectors : {
            username: 'input[placeholder="用户名"]',
            password: 'input[placeholder="密码"]',
            submit: 'button.ant-btn-primary',
            error: '.error-message, [role="alert"]'
        },
        successValidation: {
            urlPattern: legacyCfg.successUrlPattern || '/(dashboard|home|welcome|index)/i',
            titlePattern: legacyCfg.successTitlePattern || '/(Dashboard|Home|Welcome|首页)/i'
        },
        captcha: legacyCaptcha.selector ? legacyCaptcha : {
            enabled: true,
            selector: 'img.wfull.h40.cpt',
            inputSelector: 'input[placeholder="请输入验证码"]',
            strategy: 'test-mode',
            testValue: legacyCfg.captchaTestValue,
            maxRetries: 3
        },
        timeouts: {
            navigation: legacyCfg.navigationTimeout || 30000,
            action: legacyCfg.actionTimeout || 10000
        },
        evidence: {
            dir: evidenceDir || resolve(projectPath, '.flowtrace', 'evidence'),
            screenshot: legacyCfg.screenshotStrategy || 'always',
            trace: legacyCfg.traceEnabled ?? true
        }
    };
    const loader = new LoginAdapterLoader();
    try {
        await loader.initialize(adapterConfig, isLegacyShadow);
    }
    catch (error) {
        console.error(chalk.red(`Failed to initialize adapters: ${error}`));
        throw error;
    }
    const legacyAdapter = loader.getLegacyAdapter();
    const currentAdapter = loader.getCurrentAdapter();
    if (!legacyAdapter) {
        throw new Error('Failed to initialize legacy adapter');
    }
    return {
        legacyAdapter,
        currentAdapter: currentAdapter || legacyAdapter,
        cleanup: async () => {
            try {
                await loader.cleanup();
            }
            catch (error) {
                console.error(`Error during adapter cleanup: ${error}`);
            }
        }
    };
}
function generateMarkdownReport(run, projectPath) {
    const lines = [];
    lines.push(`# ${run.processId} Test Report`);
    lines.push(``);
    lines.push(`## Summary`);
    lines.push(``);
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Run ID | ${run.runId} |`);
    lines.push(`| Project | ${run.projectId} |`);
    lines.push(`| Process | ${run.processId} |`);
    lines.push(`| Mode | ${run.mode} |`);
    lines.push(`| Total Cases | ${run.summary.totalCases} |`);
    lines.push(`| Passed | ${run.summary.passedCases} |`);
    lines.push(`| Failed | ${run.summary.failedCases} |`);
    lines.push(`| Duration | ${(run.totalDuration / 1000).toFixed(2)}s |`);
    lines.push(`| Start Time | ${run.startTime} |`);
    lines.push(`| End Time | ${run.endTime} |`);
    lines.push(``);
    lines.push(`## Release Gate`);
    lines.push(``);
    lines.push(`**Status:** ${run.releaseGate.allowed ? '✅ ALLOWED' : '❌ BLOCKED'}`);
    lines.push(``);
    if (run.releaseGate.blockedBy.length > 0) {
        lines.push(`**Blocked by:**`);
        for (const block of run.releaseGate.blockedBy) {
            lines.push(`- ${block}`);
        }
        lines.push(``);
    }
    lines.push(`## Differences by Severity`);
    lines.push(``);
    lines.push(`| Severity | Count |`);
    lines.push(`|----------|-------|`);
    lines.push(`| P0 | ${run.summary.differencesBySeverity.P0 || 0} |`);
    lines.push(`| P1 | ${run.summary.differencesBySeverity.P1 || 0} |`);
    lines.push(`| P2 | ${run.summary.differencesBySeverity.P2 || 0} |`);
    lines.push(`| P3 | ${run.summary.differencesBySeverity.P3 || 0} |`);
    lines.push(``);
    lines.push(`## Case Results`);
    lines.push(``);
    const evidenceDir = resolve(projectPath, '.flowtrace', 'executions', run.runId, 'evidence');
    const runScreenshots = existsSync(evidenceDir)
        ? readdirSync(evidenceDir).filter(name => name.endsWith('.png')).sort()
        : [];
    lines.push(`## Test Screenshots`);
    lines.push(``);
    if (runScreenshots.length === 0) {
        lines.push(`No screenshots were captured.`);
    }
    else {
        for (const name of runScreenshots) {
            lines.push(`### ${name}`);
            lines.push(``);
            lines.push(`![${name}](../evidence/${name})`);
            lines.push(``);
        }
    }
    lines.push(``);
    for (const caseResult of run.caseResults) {
        const status = caseResult.passed ? '✅ PASSED' : '❌ FAILED';
        lines.push(`### ${caseResult.scenarioId}: ${caseResult.scenarioName} ${status}`);
        lines.push(``);
        if (caseResult.legacyResult) {
            lines.push(`**Legacy Result:**`);
            lines.push(`- Final State: ${caseResult.legacyResult.finalObservation.finalState}`);
            lines.push(`- Error Code: ${caseResult.legacyResult.finalObservation.errorCode || 'N/A'}`);
            lines.push(`- Error Message: ${caseResult.legacyResult.finalObservation.errorMessage || 'N/A'}`);
            lines.push(`- URL: ${caseResult.legacyResult.finalObservation.currentUrl}`);
            lines.push(``);
        }
        if (caseResult.currentResult) {
            lines.push(`**Current Result:**`);
            lines.push(`- Final State: ${caseResult.currentResult.finalObservation.finalState}`);
            lines.push(`- Error Code: ${caseResult.currentResult.finalObservation.errorCode || 'N/A'}`);
            lines.push(`- Error Message: ${caseResult.currentResult.finalObservation.errorMessage || 'N/A'}`);
            lines.push(`- URL: ${caseResult.currentResult.finalObservation.currentUrl}`);
            lines.push(``);
        }
        const evidence = [
            ...(caseResult.legacyResult?.finalObservation?.evidence || []),
            ...(caseResult.currentResult?.finalObservation?.evidence || [])
        ].filter((item) => item.type === 'screenshot');
        if (evidence.length > 0) {
            lines.push(`**Screenshots:**`);
            for (const item of evidence) {
                const absolute = resolve(projectPath, item.path);
                const relative = absolute.startsWith(resolve(projectPath, '.flowtrace'))
                    ? absolute.slice(resolve(projectPath, '.flowtrace').length + 1)
                    : absolute;
                lines.push(`- ${item.description || 'Screenshot'}: ![${item.description || 'Screenshot'}](../${relative})`);
            }
            lines.push(``);
        }
        else {
            lines.push(`**Screenshots:** None captured`);
            lines.push(``);
        }
        if (caseResult.differences.length > 0) {
            lines.push(`**Differences:**`);
            for (const diff of caseResult.differences) {
                const blocking = diff.isBlocking ? '🔴 BLOCKING' : '🟡 NON-BLOCKING';
                lines.push(`- [${diff.severity}] ${diff.category}: ${diff.description} ${blocking}`);
            }
            lines.push(``);
        }
        if (caseResult.error) {
            lines.push(`**Error:** ${caseResult.error}`);
            lines.push(``);
        }
        lines.push(`---`);
        lines.push(``);
    }
    if (run.isLegacyShadow) {
        lines.push(`## ⚠️ Legacy-Shadow Mode Warning`);
        lines.push(``);
        lines.push(`This run was executed in legacy-shadow mode, where the current adapter reuses the legacy adapter.`);
        lines.push(`Results from this mode validate the test harness only and do NOT prove real flow equivalence.`);
        lines.push(``);
    }
    return lines.join('\n');
}
export async function saveReport(run, projectPath, executionsDir) {
    const runDir = resolve(executionsDir || resolve(projectPath, '.flowtrace', 'executions'), run.runId);
    const reportsDir = resolve(runDir, 'reports');
    if (!existsSync(reportsDir)) {
        mkdirSync(reportsDir, { recursive: true });
    }
    // Unified report naming: always use login-report- prefix for consistency
    const baseName = `login-report-${run.runId}`;
    // Report title based on process type
    const processId = run.processId || 'test';
    const reportTitle = processId === 'financing-application'
        ? 'FlowTrace 融资申请测试报告'
        : processId === 'user-login' || processId === 'login'
            ? 'FlowTrace 登录测试报告'
            : `FlowTrace ${processId} 测试报告`;
    // System label based on process type
    const legacySystemLabel = processId === 'financing-application' ? 'legacy-system' : 'legacy-zgweb';
    const currentSystemLabel = processId === 'financing-application' ? 'current-system' : 'current-zgweb';
    const jsonPath = resolve(reportsDir, `${baseName}.json`);
    writeFileSync(jsonPath, JSON.stringify(run, null, 2), 'utf-8');
    console.log(chalk.green(`JSON report saved: ${jsonPath}`));
    const mdPath = resolve(reportsDir, `${baseName}.md`);
    const mdContent = generateMarkdownReport(run, projectPath);
    writeFileSync(mdPath, mdContent, 'utf-8');
    console.log(chalk.green(`Markdown report saved: ${mdPath}`));
    const htmlEscape = (value) => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    // Financing-specific success states
    const financingSuccessStates = ['APPROVED', 'SUBMITTED', 'COMPLETED', 'AUTHENTICATED'];
    const isSuccessState = (state) => financingSuccessStates.includes(state);
    const caseSectionsHtml = run.caseResults.map((item) => {
        const expected = item.expected ? htmlEscape(JSON.stringify(item.expected)) : '<em>(none)</em>';
        const status = item.passed ? '<span class="ok">PASSED</span>' : '<span class="bad">FAILED</span>';
        const legacyObs = item.legacyResult?.finalObservation;
        const currentObs = item.currentResult?.finalObservation;
        const renderObs = (label, badgeClass, obs, ev) => {
            if (!obs)
                return '';
            const stateBadge = isSuccessState(obs.finalState)
                ? `<span class="${badgeClass}">${obs.finalState}</span>`
                : `<span class="bad">${obs.finalState}</span>`;
            const errBlock = obs.errorMessage
                ? `<div class="err"><b>${obs.errorCode || 'ERROR'}:</b> <code>${htmlEscape(obs.errorMessage)}</code></div>`
                : '';
            const urlBlock = obs.currentUrl
                ? `<div class="meta"><b>URL:</b> <code>${htmlEscape(obs.currentUrl)}</code> · <b>Title:</b> ${htmlEscape(obs.pageTitle || '')}</div>`
                : '';
            const sysLabel = label === 'Legacy' ? legacySystemLabel : currentSystemLabel;
            const sysColor = label === 'Legacy' ? '#2563eb' : '#7c3aed';
            const screenshots = ev.filter((e) => e.type === 'screenshot');
            const imgsHtml = screenshots.length === 0
                ? '<p class="muted">No screenshot captured for this system.</p>'
                : screenshots.map((e) => {
                    const abs = e.path;
                    const fileName = abs.split('/').pop();
                    const relSrc = `../evidence/${encodeURIComponent(fileName)}`;
                    const desc = htmlEscape(e.description || '');
                    const ts = htmlEscape(e.timestamp || '');
                    return `<figure class="shot">
              <figcaption>
                <span class="sys-tag" style="background:${sysColor}">${label}</span>
                <span class="shot-desc">${desc}</span>
                <span class="shot-time">${ts}</span>
              </figcaption>
              <a href="${relSrc}" target="_blank"><img src="${relSrc}" alt="${htmlEscape(fileName || '')}"></a>
              <div class="shot-name">${htmlEscape(fileName || '')}</div>
            </figure>`;
                }).join('');
            return `
        <div class="system">
          <h4>${sysLabel} (${label} system)</h4>
          <div class="meta"><b>Final State:</b> ${stateBadge}</div>
          ${urlBlock}
          ${errBlock}
          <div class="shots-grid">${imgsHtml}</div>
        </div>`;
        };
        const diffHtml = (item.differences && item.differences.length > 0)
            ? `<table class="diffs"><tr><th>Severity</th><th>Category</th><th>Description</th></tr>
         ${item.differences.map((d) => `<tr>
           <td class="${d.isBlocking ? 'bad' : 'warn'}">${d.severity}${d.isBlocking ? ' (blocking)' : ''}</td>
           <td>${htmlEscape(d.category)}</td>
           <td>${htmlEscape(d.description)}</td>
         </tr>`).join('')}</table>`
            : '<p class="muted">No differences recorded.</p>';
        return `
    <div class="case-block ${item.passed ? 'case-pass' : 'case-fail'}">
      <div class="case-header">
        <div>
          <h3>${htmlEscape(item.scenarioId)}: ${htmlEscape(item.scenarioName)}</h3>
          <div class="meta"><b>Expected:</b> <code>${expected}</code></div>
        </div>
        <div class="case-status">${status}</div>
      </div>
      <div class="case-systems">
        ${renderObs('Legacy', 'ok', legacyObs, item.legacyResult?.finalObservation?.evidence || [])}
        ${renderObs('Current', 'ok', currentObs, item.currentResult?.finalObservation?.evidence || [])}
      </div>
      <h4>Differences</h4>
      ${diffHtml}
    </div>`;
    }).join('\n');
    const htmlPath = resolve(reportsDir, `${baseName}.html`);
    const htmlContent = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${reportTitle} - ${htmlEscape(run.runId)}</title>
<style>
body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:1200px;margin:32px auto;padding:0 20px;color:#1f2937;background:#f9fafb}
h1{margin-bottom:24px}
h3{margin:0 0 4px}
table{border-collapse:collapse;width:100%;margin:12px 0}
td,th{border:1px solid #d1d5db;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f3f4f6;font-weight:600}
.ok{color:#087f5b;font-weight:600}
.bad{color:#c92a2a;font-weight:600}
.warn{color:#b45309;font-weight:600}
.muted{color:#6b7280;font-style:italic}
.meta{font-size:13px;color:#374151;margin:4px 0}
.meta code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12px}
code{background:#f3f4f6;padding:2px 5px;border-radius:4px;font-size:12px}
.err{background:#fef2f2;border-left:3px solid #ef4444;padding:8px 12px;margin:6px 0;border-radius:4px;font-size:12px}
.err code{background:transparent;padding:0;color:#991b1b}
.case-block{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin:20px 0;box-shadow:0 1px 2px rgba(0,0,0,0.04)}
.case-block.case-pass{border-left:4px solid #087f5b}
.case-block.case-fail{border-left:4px solid #c92a2a}
.case-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #e5e7eb}
.case-status{font-size:18px;font-weight:700;padding:4px 12px;border-radius:6px}
.case-pass .case-status{background:#d1fae5;color:#065f46}
.case-fail .case-status{background:#fee2e2;color:#991b1b}
.case-systems{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0}
.system{background:#fafafa;border:1px solid #e5e7eb;border-radius:6px;padding:14px}
.system h4{margin:0 0 8px;font-size:13px;color:#374151;text-transform:uppercase;letter-spacing:0.05em}
.shots-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px}
.shot{margin:0;padding:8px;border:1px solid #d1d5db;border-radius:6px;background:#fff}
.shot img{display:block;width:100%;height:auto;margin-top:6px;border-radius:4px;cursor:zoom-in}
.shot figcaption{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px}
.sys-tag{display:inline-block;padding:2px 7px;border-radius:3px;color:#fff;font-weight:600;font-size:10px;text-transform:uppercase}
.shot-desc{flex:1;color:#4b5563}
.shot-time{color:#9ca3af;font-family:monospace;font-size:10px}
.shot-name{font-family:monospace;font-size:10px;color:#6b7280;margin-top:4px;word-break:break-all}
.diffs{font-size:12px}
</style></head>
<body>
<h1>${reportTitle}</h1>
<table>
<tr><th>项目</th><td>${htmlEscape(run.projectId)}</td></tr>
<tr><th>流程</th><td>${htmlEscape(run.processId)}</td></tr>
<tr><th>模式</th><td>${htmlEscape(run.mode)}</td></tr>
<tr><th>案例总数</th><td>${run.summary.totalCases}</td></tr>
<tr><th>通过</th><td class="ok">${run.summary.passedCases}</td></tr>
<tr><th>失败</th><td class="bad">${run.summary.failedCases}</td></tr>
<tr><th>Release Gate</th><td class="${run.releaseGate.allowed ? 'ok' : 'bad'}">${run.releaseGate.allowed ? 'ALLOWED' : 'BLOCKED'}</td></tr>
</table>
<h2>案例结果与截图</h2>
<p class="muted">每个案例展示预期、双侧系统 (legacy / current) 实际状态、差异及对应截图。</p>
${caseSectionsHtml}
</body></html>`;
    writeFileSync(htmlPath, htmlContent, 'utf-8');
    console.log(chalk.green(`HTML report saved: ${htmlPath}`));
    const manifest = {
        runId: run.runId,
        processId: run.processId,
        projectId: run.projectId,
        startTime: run.startTime,
        endTime: run.endTime,
        status: run.releaseGate?.allowed ? 'passed' : 'blocked',
        artifactRoot: runDir,
        paths: {
            manifest: resolve(runDir, 'manifest.json'),
            run: resolve(runDir, 'run.json'),
            reports: { json: jsonPath, markdown: mdPath, html: htmlPath },
            evidence: resolve(runDir, 'evidence'),
            cases: resolve(runDir, 'cases')
        }
    };
    writeFileSync(resolve(runDir, 'run.json'), JSON.stringify(run, null, 2), 'utf-8');
    writeFileSync(resolve(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    return { jsonPath, mdPath, htmlPath };
}
function projectUsesBuiltinRuntime(projectPath) {
    const configPath = resolve(projectPath, '.flowtrace', 'flowtrace.yaml');
    if (!existsSync(configPath))
        return false;
    try {
        const raw = yaml.load(readFileSync(configPath, 'utf8'));
        return raw?.runtime?.adapter === 'builtin';
    }
    catch {
        return false;
    }
}
export async function testCommand(options) {
    const projectPath = options.project
        ? resolve(process.cwd(), options.project)
        : resolve(process.cwd());
    // Builtin projects use the config-driven dual-run verifier. Do not send
    // them through the legacy login/CAPTCHA gate used by `flowtrace test`.
    if (projectUsesBuiltinRuntime(projectPath)) {
        const { verifyBuiltinCommand } = await import('../verify-builtin.js');
        await verifyBuiltinCommand({ project: projectPath, output: options.output });
        return;
    }
    // --- Gate check ---
    const requirements = gateForCommand('test');
    const flowtraceRoot = join(projectPath, '.flowtrace');
    const gateResult = runGate({
        projectRoot: projectPath,
        flowtraceRoot,
        requirements,
        explicitProcessId: options.process ?? null,
        query: null
    });
    if (!gateResult.ok) {
        if (options.human) {
            console.error(chalk.red(`\n✗ Gate check failed: ${gateResult.code}`));
            if (gateResult.missing.length > 0) {
                console.log(chalk.yellow(`  Missing: ${gateResult.missing.join(', ')}`));
            }
            for (const remediation of gateResult.remediation) {
                console.log(chalk.gray(`   ${remediation}`));
            }
        }
        else {
            console.error(JSON.stringify(gateResult));
        }
        process.exit(2);
        return;
    }
    console.log(chalk.blue(`\nFlowTrace Test Command`));
    console.log(chalk.gray(`Project: ${projectPath}\n`));
    if (!existsSync(projectPath)) {
        console.error(chalk.red(`Project path does not exist: ${projectPath}`));
        process.exit(1);
    }
    const configIssues = checkConfigurationExists(projectPath);
    if (configIssues.length > 0) {
        console.error(chalk.red(`\nConfiguration check failed:`));
        for (const issue of configIssues) {
            console.log(chalk.gray(`   - ${issue}`));
        }
        printInitHint(projectPath);
        process.exit(1);
    }
    let targetConfig;
    try {
        targetConfig = loadTargetProjectConfig(projectPath);
        const errors = validateTargetConfig(targetConfig);
        if (errors.length > 0) {
            console.warn(chalk.yellow(`Config validation warnings:`));
            errors.forEach((e) => console.log(chalk.gray(`   - ${e}`)));
        }
        console.log(chalk.green(`Loaded project: ${targetConfig.project.name}`));
    }
    catch (error) {
        console.error(chalk.red(`Failed to load project config: ${error instanceof Error ? error.message : String(error)}`));
        printInitHint(projectPath);
        process.exit(1);
    }
    // Check baseline existence - required unless --reuse-baseline or --reuse-cases is specified
    const processId = options.process || 'user-login';
    const baselineDir = resolve(projectPath, '.flowtrace', 'facts', processId);
    const scenariosDir = options.scenarios
        ? resolve(projectPath, options.scenarios)
        : getScenariosDir(targetConfig);
    if (!existsSync(baselineDir) && !options.reuseBaseline && !options.reuseCases) {
        console.log(chalk.yellow(`\nNo baseline found for process: ${processId}`));
        console.log(chalk.cyan(`\nRun: flowtrace collect --process ${processId}`));
        console.log(chalk.gray(`   Or use --reuse-baseline / --reuse-cases if you have cached data`));
        process.exit(1);
    }
    if (options.reuseBaseline || options.reuseCases) {
        const reuseMode = options.reuseCases ? 'cases' : 'baseline';
        console.log(chalk.gray(`Reusing cached ${reuseMode} from previous runs`));
    }
    const loginConfig = loadLoginTestConfig(projectPath, options, targetConfig);
    if (!loginConfig) {
        console.error(chalk.red(`\nLogin test configuration not found`));
        process.exit(1);
    }
    // Project config is the primary source for local test credentials; env vars override it.
    for (const target of [loginConfig.legacy, loginConfig.current]) {
        if (target?.username && target.usernameEnv && !process.env[target.usernameEnv])
            process.env[target.usernameEnv] = target.username;
        if (target?.password && target.passwordEnv && !process.env[target.passwordEnv])
            process.env[target.passwordEnv] = target.password;
    }
    for (const [key, value] of Object.entries(loginConfig.credentials || {})) {
        if (typeof value === 'string' && !process.env[key])
            process.env[key] = value;
    }
    if (!process.env.FLOWTRACE_TEST_MODE &&
        [loginConfig.legacy, loginConfig.current].some(target => target?.captchaStrategy === 'test-mode' || target?.captcha?.strategy === 'test-mode')) {
        process.env.FLOWTRACE_TEST_MODE = 'true';
    }
    if (options.legacyShadow) {
        console.log(chalk.yellow(`\nLegacy-Shadow Mode: current adapter reuses legacy`));
        console.log(chalk.gray(`   Note: This validates the harness only, not real flow equivalence.\n`));
    }
    // Run preflight check before unified flow
    const mode = options.mode === 'dual-browser' ? 'dual-browser' : 'single-browser';
    const preflight = runLoginPreflight({
        projectPath,
        processId,
        scenariosDir,
        mode,
        legacy: loginConfig.legacy,
        current: loginConfig.current
    });
    if (!preflight.ok) {
        console.error(chalk.red('\n✗ Preflight check failed; browser launch was skipped.'));
        preflight.missing.forEach(item => console.log(chalk.gray(`   - ${item}`)));
        preflight.warnings.forEach(item => console.log(chalk.yellow(`   ! ${item}`)));
        preflight.remediation.forEach(item => console.log(chalk.cyan(`   → ${item}`)));
        process.exit(2);
    }
    // Run unified test flow
    const flowResult = await runUnifiedTestFlow(options, projectPath, targetConfig, loginConfig);
    // Print flow summary
    console.log(chalk.blue(`\n=== Test Flow Summary ===`));
    for (const step of flowResult.steps) {
        const icon = step.status === 'completed' ? '✓' : step.status === 'running' ? '▶' : step.status === 'failed' ? '✗' : step.status === 'skipped' ? '○' : ' ';
        const color = step.status === 'completed' ? chalk.green : step.status === 'failed' ? chalk.red : step.status === 'skipped' ? chalk.gray : chalk.blue;
        console.log(color(`  ${icon} ${step.name}`));
    }
    console.log();
    if (!flowResult.success) {
        console.error(chalk.red(`\n✗ Test flow failed: ${flowResult.steps.find(s => s.status === 'failed')?.error || 'Unknown error'}`));
        process.exit(1);
        return;
    }
    const run = flowResult.results;
    // Print summary
    console.log(chalk.blue(`=== Test Summary ===`));
    console.log(chalk.gray(`Total: ${run.summary.totalCases}`));
    console.log(chalk.green(`Passed: ${run.summary.passedCases}`));
    if (run.summary.failedCases > 0) {
        console.log(chalk.red(`Failed: ${run.summary.failedCases}`));
    }
    console.log(chalk.gray(`Duration: ${(run.totalDuration / 1000).toFixed(2)}s`));
    console.log();
    if (run.summary.differencesBySeverity.P0 > 0) {
        console.log(chalk.red(`🔴 P0 Differences: ${run.summary.differencesBySeverity.P0}`));
    }
    if (run.summary.differencesBySeverity.P1 > 0) {
        console.log(chalk.red(`🟠 P1 Differences: ${run.summary.differencesBySeverity.P1}`));
    }
    if (run.summary.differencesBySeverity.P2 > 0) {
        console.log(chalk.yellow(`🟡 P2 Differences: ${run.summary.differencesBySeverity.P2}`));
    }
    if (run.summary.differencesBySeverity.P3 > 0) {
        console.log(chalk.gray(`⚪ P3 Differences: ${run.summary.differencesBySeverity.P3}`));
    }
    console.log();
    // Print release gate
    if (run.releaseGate.allowed) {
        console.log(chalk.green(`✅ Release Gate: ALLOWED`));
    }
    else {
        console.log(chalk.red(`❌ Release Gate: BLOCKED`));
        for (const block of run.releaseGate.blockedBy) {
            console.log(chalk.gray(`   - ${block}`));
        }
    }
    console.log();
    // Print report paths (using unified naming convention)
    const reportBaseName = `login-report-${run.runId}`;
    console.log(chalk.blue(`Reports:`));
    console.log(chalk.gray(`  JSON: ${resolve(flowResult.results?.runDir || '', 'reports', `${reportBaseName}.json`)}`));
    console.log(chalk.gray(`  Markdown: ${resolve(flowResult.results?.runDir || '', 'reports', `${reportBaseName}.md`)}`));
    console.log(chalk.gray(`  HTML: ${resolve(flowResult.results?.runDir || '', 'reports', `${reportBaseName}.html`)}`));
    console.log();
    // Exit with appropriate code
    if (!run.releaseGate.allowed) {
        console.log(chalk.red(`\n❌ Tests blocked by release gate`));
        process.exit(1);
    }
    else if (run.summary.failedCases > 0) {
        console.log(chalk.red(`\n⚠️ Some tests failed`));
        process.exit(1);
    }
    else {
        console.log(chalk.green(`\n✅ All tests passed!`));
        process.exit(0);
    }
}
//# sourceMappingURL=test.js.map
