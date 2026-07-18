import * as fs from 'fs';
import * as path from 'path';
import { validateFlowchartDocument } from '@flowtrace/core';
import { TestCaseSchema, validateAccountSwitchStep } from '@flowtrace/core';
import { validateVerificationReport } from '@flowtrace/core';
/**
 * Required titles for flowchart fixtures
 */
const REQUIRED_FLOWCHART_TITLES = [
    '流程基本信息',
    '流程主路径',
    '异常分支'
];
/**
 * Mermaid diagram pattern for validation
 */
const MERMAID_PATTERN = /```mermaid\s*([\s\S]*?)```/g;
const MERMAID_NODE_PATTERN = /\b(N\d+|start|end|condition|parallel|service|user|manual|script|call|subprocess|event|boundary)[\s\S]*?\[[\s\S]*?\]/gi;
const MERMAID_ARROW_PATTERN = /-->/g;
/**
 * Required HTML elements for report fixtures
 */
const REQUIRED_HTML_ELEMENTS = [
    'html',
    'head',
    'body',
    'title'
];
/**
 * Golden Fixture Validator
 *
 * Validates standard deliverables (golden fixtures) including:
 * - Flowchart fixtures (.md with Mermaid diagrams)
 * - Test case fixtures (.md with JSON)
 * - HTML report fixtures (.html)
 */
export class GoldenFixtureValidator {
    fixturesDir;
    strictMode;
    constructor(options) {
        this.fixturesDir = options.fixturesDir;
        this.strictMode = options.strictMode ?? false;
    }
    /**
     * Validate a flowchart fixture
     */
    validateFlowchartFixture(fixturePath) {
        const errors = [];
        const warnings = [];
        const fullPath = path.isAbsolute(fixturePath)
            ? fixturePath
            : path.join(this.fixturesDir, fixturePath);
        if (!fs.existsSync(fullPath)) {
            return {
                valid: false,
                fixturePath,
                fixtureType: 'flowchart',
                errors: [{
                        code: 'FILE_NOT_FOUND',
                        message: `Fixture file not found: ${fullPath}`,
                        severity: 'error'
                    }],
                warnings: []
            };
        }
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        // 1. Check required titles
        for (const title of REQUIRED_FLOWCHART_TITLES) {
            const titleRegex = new RegExp(`^#{1,3}\\s+.*${title}.*$`, 'm');
            if (!titleRegex.test(content)) {
                errors.push({
                    code: 'MISSING_REQUIRED_TITLE',
                    message: `Missing required title section: "${title}"`,
                    location: { path: fixturePath },
                    severity: 'error'
                });
            }
        }
        // 2. Validate Mermaid diagrams
        const mermaidMatches = [...content.matchAll(MERMAID_PATTERN)];
        if (mermaidMatches.length === 0) {
            errors.push({
                code: 'NO_MERMAID_DIAGRAM',
                message: 'No Mermaid diagram found in flowchart fixture',
                location: { path: fixturePath },
                severity: 'error'
            });
        }
        else {
            for (let i = 0; i < mermaidMatches.length; i++) {
                const diagramContent = mermaidMatches[i][1];
                this.validateMermaidSyntax(diagramContent, `mermaid[${i}]`, fixturePath, errors, warnings);
            }
        }
        // 3. Check for evidence associations (nodes with evidence)
        const hasEvidenceSection = /evidence|证据/g.test(content);
        if (!hasEvidenceSection) {
            warnings.push({
                code: 'NO_EVIDENCE_SECTION',
                message: 'No evidence section found in flowchart',
                location: { path: fixturePath },
                severity: 'warning'
            });
        }
        // 4. Check for database tables section
        const hasDatabaseTables = /database|数据库表|table/g.test(content);
        if (!hasDatabaseTables) {
            warnings.push({
                code: 'NO_DATABASE_TABLES',
                message: 'No database tables section found in flowchart',
                location: { path: fixturePath },
                severity: 'warning'
            });
        }
        // 5. Try to parse as JSON flowchart document
        const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                const jsonData = JSON.parse(jsonMatch[1]);
                const validation = validateFlowchartDocument(jsonData);
                if (!validation.valid && validation.errors) {
                    for (const error of validation.errors) {
                        errors.push({
                            code: 'SCHEMA_VALIDATION_ERROR',
                            message: error,
                            location: { path: fixturePath },
                            severity: 'error'
                        });
                    }
                }
            }
            catch (e) {
                errors.push({
                    code: 'JSON_PARSE_ERROR',
                    message: `Failed to parse JSON section: ${e.message}`,
                    location: { path: fixturePath },
                    severity: 'error'
                });
            }
        }
        return {
            valid: errors.length === 0,
            fixturePath,
            fixtureType: 'flowchart',
            errors,
            warnings
        };
    }
    /**
     * Validate Mermaid syntax
     */
    validateMermaidSyntax(content, diagramId, fixturePath, errors, warnings) {
        // Check for balanced flowchart structure
        const hasFlowchartStart = /flowchart\s+(LR|RL|TD|BT)/i.test(content);
        if (!hasFlowchartStart) {
            warnings.push({
                code: 'INVALID_MERMAID_TYPE',
                message: `Diagram ${diagramId} does not have a valid flowchart declaration`,
                location: { path: fixturePath },
                severity: 'warning'
            });
        }
        // Check for nodes
        const nodeMatches = content.match(MERMAID_NODE_PATTERN);
        if (!nodeMatches || nodeMatches.length === 0) {
            errors.push({
                code: 'NO_NODES',
                message: `Diagram ${diagramId} has no nodes`,
                location: { path: fixturePath },
                severity: 'error'
            });
        }
        // Check for arrows (edges)
        const arrowMatches = content.match(MERMAID_ARROW_PATTERN);
        if (!arrowMatches || arrowMatches.length === 0) {
            warnings.push({
                code: 'NO_EDGES',
                message: `Diagram ${diagramId} has no edges/arrows`,
                location: { path: fixturePath },
                severity: 'warning'
            });
        }
        // Check for balanced brackets
        const openBrackets = (content.match(/\[/g) || []).length;
        const closeBrackets = (content.match(/\]/g) || []).length;
        if (openBrackets !== closeBrackets) {
            errors.push({
                code: 'UNBALANCED_BRACKETS',
                message: `Diagram ${diagramId} has unbalanced brackets: ${openBrackets} '[' vs ${closeBrackets} ']'`,
                location: { path: fixturePath },
                severity: 'error'
            });
        }
    }
    /**
     * Validate a test case fixture
     */
    validateTestCaseFixture(fixturePath) {
        const errors = [];
        const warnings = [];
        const fullPath = path.isAbsolute(fixturePath)
            ? fixturePath
            : path.join(this.fixturesDir, fixturePath);
        if (!fs.existsSync(fullPath)) {
            return {
                valid: false,
                fixturePath,
                fixtureType: 'testCase',
                errors: [{
                        code: 'FILE_NOT_FOUND',
                        message: `Fixture file not found: ${fullPath}`,
                        severity: 'error'
                    }],
                warnings: []
            };
        }
        const content = fs.readFileSync(fullPath, 'utf-8');
        // Try to find JSON test case data
        const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
        if (!jsonMatch) {
            errors.push({
                code: 'NO_JSON_CONTENT',
                message: 'No JSON content found in test case fixture',
                location: { path: fixturePath },
                severity: 'error'
            });
            return {
                valid: false,
                fixturePath,
                fixtureType: 'testCase',
                errors,
                warnings
            };
        }
        try {
            const testCaseData = JSON.parse(jsonMatch[1]);
            // 1. Validate JSON schema
            const schemaResult = TestCaseSchema.safeParse(testCaseData);
            if (!schemaResult.success) {
                for (const issue of schemaResult.error.issues) {
                    errors.push({
                        code: 'SCHEMA_VALIDATION_ERROR',
                        message: `${issue.path.join('.')}: ${issue.message}`,
                        location: { path: fixturePath },
                        severity: 'error'
                    });
                }
                return {
                    valid: false,
                    fixturePath,
                    fixtureType: 'testCase',
                    errors,
                    warnings
                };
            }
            const testCase = schemaResult.data;
            // 2. Check each step has atomic steps
            if (!testCase.steps || testCase.steps.length === 0) {
                errors.push({
                    code: 'NO_STEPS',
                    message: 'Test case has no steps',
                    location: { path: fixturePath },
                    severity: 'error'
                });
            }
            // 3. Check each step has account and operation
            for (let i = 0; i < testCase.steps.length; i++) {
                const step = testCase.steps[i];
                // Skip account switch steps - they have different structure
                if ('type' in step && step.type === 'ACCOUNT_SWITCH') {
                    // Validate account switch completeness (15 steps)
                    const switchErrors = validateAccountSwitchStep(step);
                    for (const error of switchErrors) {
                        errors.push({
                            code: 'ACCOUNT_SWITCH_INCOMPLETE',
                            message: `Step ${step.stepId}: ${error}`,
                            location: { path: fixturePath },
                            severity: 'error'
                        });
                    }
                    continue;
                }
                const testStep = step;
                // Check account
                if (!testStep.accountRef) {
                    errors.push({
                        code: 'MISSING_ACCOUNT',
                        message: `Step "${testStep.stepId}" (${testStep.name}) has no account reference`,
                        location: { path: fixturePath },
                        severity: 'error'
                    });
                }
                // Check operation
                if (!testStep.operation) {
                    errors.push({
                        code: 'MISSING_OPERATION',
                        message: `Step "${testStep.stepId}" (${testStep.name}) has no operation`,
                        location: { path: fixturePath },
                        severity: 'error'
                    });
                }
                // 4. Check each step has expected result
                const hasExpectedResult = testStep.expectedUiResult || testStep.expectedApiResult;
                if (!hasExpectedResult) {
                    errors.push({
                        code: 'MISSING_EXPECTED_RESULT',
                        message: `Step "${testStep.stepId}" (${testStep.name}) has no expected result`,
                        location: { path: fixturePath },
                        severity: 'error'
                    });
                }
                // 5. Check database assertions have table and field
                if (testStep.databaseAssertions) {
                    for (const assertion of testStep.databaseAssertions) {
                        if (!assertion.tableName) {
                            errors.push({
                                code: 'MISSING_TABLE_NAME',
                                message: `Step "${testStep.stepId}" has database assertion without table name`,
                                location: { path: fixturePath },
                                severity: 'error'
                            });
                        }
                        if (!assertion.assertions || assertion.assertions.length === 0) {
                            errors.push({
                                code: 'MISSING_FIELD_ASSERTIONS',
                                message: `Step "${testStep.stepId}" has database assertion without field assertions`,
                                location: { path: fixturePath },
                                severity: 'error'
                            });
                        }
                        for (const fieldAssert of assertion.assertions || []) {
                            if (!fieldAssert.field) {
                                errors.push({
                                    code: 'MISSING_FIELD',
                                    message: `Step "${testStep.stepId}" has database assertion without field`,
                                    location: { path: fixturePath },
                                    severity: 'error'
                                });
                            }
                        }
                    }
                }
            }
        }
        catch (e) {
            errors.push({
                code: 'JSON_PARSE_ERROR',
                message: `Failed to parse JSON: ${e.message}`,
                location: { path: fixturePath },
                severity: 'error'
            });
        }
        return {
            valid: errors.length === 0,
            fixturePath,
            fixtureType: 'testCase',
            errors,
            warnings
        };
    }
    /**
     * Validate an HTML report fixture
     */
    validateReportFixture(fixturePath) {
        const errors = [];
        const warnings = [];
        const fullPath = path.isAbsolute(fixturePath)
            ? fixturePath
            : path.join(this.fixturesDir, fixturePath);
        if (!fs.existsSync(fullPath)) {
            return {
                valid: false,
                fixturePath,
                fixtureType: 'report',
                errors: [{
                        code: 'FILE_NOT_FOUND',
                        message: `Fixture file not found: ${fullPath}`,
                        severity: 'error'
                    }],
                warnings: []
            };
        }
        const content = fs.readFileSync(fullPath, 'utf-8');
        // 1. Check if it can be opened offline (basic HTML structure)
        const hasHtmlTag = /<html[\s\S]*?>/i.test(content);
        const hasHeadTag = /<head[\s\S]*?>/i.test(content);
        const hasBodyTag = /<body[\s\S]*?>/i.test(content);
        if (!hasHtmlTag || !hasHeadTag || !hasBodyTag) {
            errors.push({
                code: 'INVALID_HTML_STRUCTURE',
                message: 'HTML report is missing required structural elements',
                location: { path: fixturePath },
                severity: 'error'
            });
        }
        // 2. Check for required elements
        for (const element of REQUIRED_HTML_ELEMENTS) {
            const elementRegex = new RegExp(`<${element}[\\s\\S]*?>`, 'i');
            if (!elementRegex.test(content)) {
                warnings.push({
                    code: 'MISSING_ELEMENT',
                    message: `HTML report is missing element: <${element}>`,
                    location: { path: fixturePath },
                    severity: 'warning'
                });
            }
        }
        // 3. Check for images
        const imagePattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        const images = [...content.matchAll(imagePattern)];
        for (const img of images) {
            const src = img[1];
            // Check if it's an external URL or local file reference
            if (src.startsWith('http') || src.startsWith('//')) {
                warnings.push({
                    code: 'EXTERNAL_IMAGE',
                    message: `HTML report contains external image reference: ${src}`,
                    location: { path: fixturePath },
                    severity: 'warning'
                });
            }
        }
        // 4. Check for trace links
        const tracePattern = /(trace|链路|追踪)[^\n]*(https?:\/\/[^\s"'<>]+)/gi;
        const traces = [...content.matchAll(tracePattern)];
        for (const trace of traces) {
            const url = trace[2];
            if (url.startsWith('http') || url.startsWith('//')) {
                warnings.push({
                    code: 'EXTERNAL_TRACE',
                    message: `HTML report contains external trace link: ${url}`,
                    location: { path: fixturePath },
                    severity: 'warning'
                });
            }
        }
        // 5. Check for report links
        const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
        const links = [...content.matchAll(linkPattern)];
        for (const link of links) {
            const href = link[1];
            // Check for relative paths that might not work offline
            if (!href.startsWith('#') && !href.startsWith('http') && !href.startsWith('//') && href !== '') {
                // It's a relative link - check if it might be a report link
                if (href.endsWith('.html') || href.endsWith('.md') || href.includes('report')) {
                    warnings.push({
                        code: 'RELATIVE_REPORT_LINK',
                        message: `HTML report contains relative link that may not work offline: ${href}`,
                        location: { path: fixturePath },
                        severity: 'warning'
                    });
                }
            }
        }
        // 6. Try to find and validate JSON report data embedded in HTML
        const jsonMatch = content.match(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
        if (jsonMatch) {
            try {
                const jsonData = JSON.parse(jsonMatch[1]);
                const validation = validateVerificationReport(jsonData);
                if (!validation.valid && validation.errors) {
                    for (const error of validation.errors) {
                        errors.push({
                            code: 'SCHEMA_VALIDATION_ERROR',
                            message: `Report data: ${error}`,
                            location: { path: fixturePath },
                            severity: 'error'
                        });
                    }
                }
                // 7. Validate Release Gate consistency with execution results
                if (validation.valid) {
                    const report = jsonData;
                    this.validateReleaseGateConsistency(report, fixturePath, errors, warnings);
                }
            }
            catch (e) {
                // JSON might not be valid - this is OK for HTML reports that embed data differently
            }
        }
        // 8. Check for inline scripts that might contain report data
        const inlineDataPattern = /window\.\w+\s*=\s*(\{[\s\S]*?\});?/g;
        const inlineData = [...content.matchAll(inlineDataPattern)];
        for (const data of inlineData) {
            try {
                // Check if it's valid JSON
                JSON.parse(data[1]);
            }
            catch {
                // Not JSON - might be other data
            }
        }
        return {
            valid: errors.length === 0,
            fixturePath,
            fixtureType: 'report',
            errors,
            warnings
        };
    }
    /**
     * Validate Release Gate consistency with execution results
     */
    validateReleaseGateConsistency(report, fixturePath, errors, warnings) {
        // Count actual pass/fail from case results
        let actualPassed = 0;
        let actualFailed = 0;
        for (const result of report.caseResults) {
            if (result.status === 'PASS') {
                actualPassed++;
            }
            else if (result.status === 'FAIL') {
                actualFailed++;
            }
        }
        // Check if Release Gate status matches actual results
        const releaseGateStatus = report.releaseGate.status;
        if (releaseGateStatus === 'PASS' && actualFailed > 0) {
            errors.push({
                code: 'RELEASE_GATE_INCONSISTENT',
                message: `Release Gate is PASS but there are ${actualFailed} failed case(s)`,
                location: { path: fixturePath },
                severity: 'error'
            });
        }
        if (releaseGateStatus === 'FAIL' && actualFailed === 0) {
            errors.push({
                code: 'RELEASE_GATE_INCONSISTENT',
                message: 'Release Gate is FAIL but all cases passed',
                location: { path: fixturePath },
                severity: 'error'
            });
        }
        // Check if blockingDifferences match the failures
        const blockingCount = report.releaseGate.blockingDifferences?.length || 0;
        if (releaseGateStatus === 'FAIL' && blockingCount === 0) {
            errors.push({
                code: 'MISSING_BLOCKING_DIFFERENCES',
                message: 'Release Gate is FAIL but no blocking differences are documented',
                location: { path: fixturePath },
                severity: 'error'
            });
        }
        if (releaseGateStatus === 'PASS' && blockingCount > 0) {
            errors.push({
                code: 'UNEXPECTED_BLOCKING_DIFFERENCES',
                message: `Release Gate is PASS but has ${blockingCount} blocking difference(s)`,
                location: { path: fixturePath },
                severity: 'error'
            });
        }
        // Check pass rate calculation
        if (report.releaseGate.passRate !== undefined) {
            const expectedPassRate = report.totalCases > 0
                ? (actualPassed / report.totalCases) * 100
                : 0;
            const passRateDiff = Math.abs(report.releaseGate.passRate - expectedPassRate);
            if (passRateDiff > 0.01) { // Allow 0.01% tolerance for floating point
                warnings.push({
                    code: 'PASS_RATE_MISMATCH',
                    message: `Release Gate passRate (${report.releaseGate.passRate}%) differs from calculated rate (${expectedPassRate.toFixed(2)}%)`,
                    location: { path: fixturePath },
                    severity: 'warning'
                });
            }
        }
    }
    /**
     * Validate all fixtures in the fixtures directory
     */
    validateAll() {
        const flowchartResults = [];
        const testCaseResults = [];
        const reportResults = [];
        if (!fs.existsSync(this.fixturesDir)) {
            return {
                flowchartResults,
                testCaseResults,
                reportResults,
                summary: {
                    total: 0,
                    passed: 0,
                    failed: 0,
                    warnings: 0
                }
            };
        }
        const files = fs.readdirSync(this.fixturesDir);
        for (const file of files) {
            const fullPath = path.join(this.fixturesDir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                continue;
            }
            if (file.endsWith('-flowchart.md')) {
                flowchartResults.push(this.validateFlowchartFixture(file));
            }
            else if (file.endsWith('.md') && !file.includes('flowchart')) {
                // Test case files are typically .md with embedded JSON
                testCaseResults.push(this.validateTestCaseFixture(file));
            }
            else if (file.endsWith('.html')) {
                reportResults.push(this.validateReportFixture(file));
            }
        }
        const allResults = [...flowchartResults, ...testCaseResults, ...reportResults];
        let totalWarnings = 0;
        for (const result of allResults) {
            totalWarnings += result.warnings.length;
        }
        return {
            flowchartResults,
            testCaseResults,
            reportResults,
            summary: {
                total: allResults.length,
                passed: allResults.filter(r => r.valid).length,
                failed: allResults.filter(r => !r.valid).length,
                warnings: totalWarnings
            }
        };
    }
}
/**
 * Create a Golden Fixture Validator instance
 */
export function createGoldenFixtureValidator(options) {
    return new GoldenFixtureValidator(options);
}
//# sourceMappingURL=golden-fixture-validator.js.map