import chalk from 'chalk';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
/**
 * Initialize a target project's FlowTrace configuration with the
 * config-driven runtime layout.
 *
 * This command:
 *   - creates `systems/`, `processes/`, `recordings/`, `facts/`,
 *     `scenarios/`, `evidence/`, `executions/` and `reports/`
 *   - does NOT create `.flowtrace/adapters/` (the new runtime is
 *     `builtin` by default and uses no project-local adapter source code)
 *   - emits a generic `flowtrace.yaml` with a `runtime:` block whose
 *     `systems:` mapping declares per-system `baseUrl`, `channel`,
 *     `auth`, `redact` (placeholder values, to be filled in by the
 *     target project owner)
 *   - emits a placeholder `systems/legacy.yaml` and `systems/current.yaml`
 *     so the user has a starting point
 *
 * Business-specific content (URLs, selectors, scenarios, etc.) is NOT
 * generated. It must be provided by the target project owner.
 */
export async function initCommand(options) {
    const projectPath = options.project
        ? resolve(process.cwd(), options.project)
        : resolve(process.cwd());
    console.log(chalk.blue(`\nFlowTrace Initialization`));
    console.log(chalk.gray(`Project: ${projectPath}\n`));
    if (!existsSync(projectPath)) {
        console.error(chalk.red(`Project path does not exist: ${projectPath}`));
        process.exit(1);
    }
    const flowtracePath = join(projectPath, '.flowtrace');
    const configPath = join(flowtracePath, 'flowtrace.yaml');
    const result = {
        success: true,
        projectPath,
        flowtracePath,
        configPath,
        createdFiles: [],
        warnings: [],
    };
    if (existsSync(flowtracePath) && options.force) {
        const { rmSync } = await import('fs');
        rmSync(flowtracePath, { recursive: true, force: true });
    }
    if (existsSync(flowtracePath) && !options.force) {
        console.error(chalk.red(`FlowTrace already initialized at: ${flowtracePath}`));
        console.log(chalk.gray(`Use --force to reinitialize`));
        process.exit(1);
    }
    const directories = [
        'systems',
        'processes',
        'recordings',
        'facts',
        'scenarios',
        'evidence',
        'executions',
        'reports',
    ];
    console.log(chalk.blue('Creating directory structure...'));
    for (const dir of directories) {
        const fullPath = join(flowtracePath, dir);
        if (!existsSync(fullPath)) {
            mkdirSync(fullPath, { recursive: true });
            result.createdFiles.push(dir);
            console.log(chalk.gray(`  + ${dir}/`));
        }
    }
    console.log(chalk.blue('\nGenerating flowtrace.yaml...'));
    const projectName = extractProjectName(projectPath);
    const processId = options.processId || options.process || 'login';
    const config = {
        project: {
            id: sanitizeId(projectName),
            name: projectName,
            sourceRoot: '.',
        },
        execution: {
            mode: 'dual-run',
            allowOnlineWrite: false,
            databaseMode: 'snapshot-only',
            testDataMode: 'masked-or-snapshot',
            failOn: ['P0', 'P1'],
        },
        pilot: {
            process: processId,
            note: 'Initialize with `flowtrace collect` to collect legacy process facts.',
        },
        actions: ['LOGIN'],
        runtime: {
            version: '1',
            adapter: 'builtin',
            systems: {
                legacy: {
                    id: 'legacy',
                    label: 'Legacy system',
                    baseUrl: 'http://localhost:3100',
                    channel: 'http',
                },
                current: {
                    id: 'current',
                    label: 'Current system',
                    baseUrl: 'http://localhost:3200',
                    channel: 'http',
                },
            },
        },
        paths: {
            systems: 'systems',
            processes: 'processes',
            recordings: 'recordings',
            facts: 'facts',
            scenarios: 'scenarios',
            evidence: 'evidence',
            executions: 'executions',
            reports: 'reports',
        },
    };
    writeFileSync(configPath, yaml.dump(config, { indent: 2 }), 'utf-8');
    result.createdFiles.push('flowtrace.yaml');
    console.log(chalk.gray(`  + flowtrace.yaml`));
    // Generic placeholder systems (no business content)
    const legacySystem = {
        id: 'legacy',
        label: 'Legacy system',
        baseUrl: 'http://localhost:3100',
        channel: 'http',
        login: {
            path: '/login',
            fields: {
                TEST_USERNAME: 'username',
                TEST_PASSWORD: 'password',
            },
            submit: 'submit',
        },
        redact: { fields: [], headers: [] },
    };
    const currentSystem = {
        id: 'current',
        label: 'Current system',
        baseUrl: 'http://localhost:3200',
        channel: 'http',
        login: {
            path: '/login',
            fields: {
                TEST_USERNAME: 'username',
                TEST_PASSWORD: 'password',
            },
            submit: 'submit',
        },
        redact: { fields: [], headers: [] },
    };
    writeFileSync(join(flowtracePath, 'systems', 'legacy.yaml'), yaml.dump(legacySystem, { indent: 2 }), 'utf-8');
    writeFileSync(join(flowtracePath, 'systems', 'current.yaml'), yaml.dump(currentSystem, { indent: 2 }), 'utf-8');
    result.createdFiles.push('systems/legacy.yaml');
    result.createdFiles.push('systems/current.yaml');
    console.log(chalk.gray(`  + systems/legacy.yaml`));
    console.log(chalk.gray(`  + systems/current.yaml`));
    // README in scenarios/
    const scenariosReadme = join(flowtracePath, 'scenarios', 'README.md');
    const scenariosReadmeContent = [
        '# Test Scenarios',
        '',
        'This directory contains hand-written test scenarios for the target project.',
        '',
        'Hand-written scenarios are treated as already `CONFIRMED` and may participate',
        'in `flowtrace verify` without an extra promotion step.',
        '',
        '## Structure',
        '',
        '    scenarios/',
        '    ├── README.md',
        '    ├── login-success-001.yaml',
        '    └── purchase-approval/',
        '        └── scn-create-approve.yaml',
        '',
        '## Scenario Format',
        '',
        '```yaml',
        'id: scenario-001',
        'name: Login Success',
        'process: login',
        'enabled: true',
        'severity: P1',
        'tags: [login, smoke]',
        '',
        'actions:',
        '  - type: LOGIN',
        '    actor: test-user',
        '',
        'expected:',
        '  finalState: AUTHENTICATED',
        '  semanticPath:',
        '    - LOGIN',
        '    - AUTHENTICATED',
        '```',
        '',
        '## Imported vs hand-written',
        '',
        'Imported scenarios have `imported: true` and a `status:` of',
        '`AUTO_EXTRACTED` or `REVIEW_REQUIRED`. They are NOT allowed to participate in',
        '`flowtrace verify` until they are promoted to `status: CONFIRMED` via',
        '`flowtrace record-confirm <processId>` or by editing the scenario file.',
    ].join('\n');
    writeFileSync(scenariosReadme, scenariosReadmeContent, 'utf-8');
    result.createdFiles.push('scenarios/README.md');
    console.log(chalk.gray(`  + scenarios/README.md`));
    // README in processes/
    const processesReadme = join(flowtracePath, 'processes', 'README.md');
    const processesReadmeContent = [
        '# Process DSL',
        '',
        'This directory contains declarative process definitions for the target project.',
        '',
        'Each process file is a YAML document that declares:',
        '',
        '  - `id`, `name`, `channel` (http / browser)',
        '  - optional `fsm` (authoritative state machine metadata: states, transitions, roles)',
        '  - `actions[]` (each action contains `id`, optional `actor`, and a list of `steps`)',
        '',
        'Step types:',
        '',
        '  - `goto`         navigate to a `page:` key or raw `url`',
        '  - `fill`         set a form field by selector or selector key',
        '  - `click`        click a selector',
        '  - `select`       pick a select option',
        '  - `upload`       upload a file',
        '  - `wait`         wait for network-idle / selector / url-matches / ms',
        '  - `request`      issue an HTTP request',
        '  - `observe`      read text or attribute into a slot',
        '  - `extract`      capture a slot',
        '  - `assert`       evaluate an assertion (equals / notEquals / matches / exists / notExists)',
        '  - `screenshot`   take a screenshot evidence',
        '  - `conditional`  branch on an assertion',
        '  - `repeat`       repeat a list of steps N times',
        '',
        'See the project documentation for full schema details.',
    ].join('\n');
    writeFileSync(processesReadme, processesReadmeContent, 'utf-8');
    result.createdFiles.push('processes/README.md');
    console.log(chalk.gray(`  + processes/README.md`));
    // .env.example (generic, no real credentials)
    const envExamplePath = join(projectPath, '.env.example');
    const envExampleContent = [
        '# FlowTrace Environment Variables',
        '# Copy this file to .env and fill in your values',
        '',
        '# Legacy System',
        'LEGACY_BASE_URL=https://legacy.example.com',
        '',
        '# Current System',
        'CURRENT_BASE_URL=https://current.example.com',
        '',
        '# Test Credentials',
        'TEST_USERNAME=your-test-username',
        'TEST_PASSWORD=your-test-password',
    ].join('\n');
    writeFileSync(envExamplePath, envExampleContent, 'utf-8');
    result.createdFiles.push('.env.example');
    console.log(chalk.gray(`  + .env.example`));
    // .gitignore update
    const gitignorePath = join(projectPath, '.gitignore');
    let gitignoreContent = '';
    if (existsSync(gitignorePath)) {
        try {
            gitignoreContent = readFileSync(gitignorePath, 'utf-8');
        }
        catch { /* ignore */ }
    }
    const gitignoreEntries = [
        '# FlowTrace',
        '.flowtrace/executions/',
        '.flowtrace/reports/*.json',
        '.flowtrace/reports/*.md',
        '.env',
    ];
    const newEntries = gitignoreEntries.filter((entry) => !gitignoreContent.includes(entry));
    if (newEntries.length > 0) {
        writeFileSync(gitignorePath, gitignoreContent + '\n' + newEntries.join('\n') + '\n', 'utf-8');
        console.log(chalk.gray(`  + .gitignore (updated)`));
    }
    // Done
    console.log(chalk.green(`\nFlowTrace initialized successfully!`));
    console.log(chalk.gray(`\nLocation: ${flowtracePath}`));
    console.log(chalk.gray(`Created ${result.createdFiles.length} files\n`));
    console.log(chalk.blue('Next steps:'));
    console.log(chalk.gray(`  1. Review and update: ${configPath}`));
    console.log(chalk.gray(`  2. Copy .env.example to .env and configure credentials`));
    console.log(chalk.gray(`  3. Edit systems/legacy.yaml and systems/current.yaml with baseUrl, channel, selectors, etc.`));
    console.log(chalk.gray(`  4. Write process DSL under processes/<id>.yaml`));
    console.log(chalk.gray(`  5. Write scenarios under scenarios/<id>.yaml`));
    console.log(chalk.gray(`  6. Run: flowtrace verify`));
}
function extractProjectName(projectPath) {
    const parts = projectPath.split(/[/\\]/);
    return parts[parts.length - 1] || 'untitled-project';
}
function sanitizeId(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
//# sourceMappingURL=init.js.map
