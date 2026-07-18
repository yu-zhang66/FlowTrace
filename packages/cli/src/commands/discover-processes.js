import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve, extname } from 'path';
import { createProvider } from '@flowtrace/ai';
import { loadTargetProjectConfig } from '@flowtrace/core';
/**
 * Collect evidence files from the target project.
 * Searches common patterns for business process evidence.
 */
function collectEvidence(projectPath) {
    const evidencePatterns = [
        // Vue/JavaScript files that may contain process definitions
        'src/**/*.{vue,js,ts}',
        // Documentation files
        'doc/**/*.md',
        // Configuration files
        '**/*config*.{js,ts,yaml,yml}',
        // Router definitions
        '**/router/**/*.{js,ts}',
        // API/controller definitions
        '**/*controller*.{js,ts}',
        '**/api/**/*.{js,ts}'
    ];
    const candidates = [];
    // Search for common evidence files
    const searchInDir = (dir, depth = 0) => {
        if (depth > 5 || !existsSync(dir))
            return;
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dir, entry.name);
                // Skip node_modules, .git, dist, build
                if (entry.name === 'node_modules' || entry.name === '.git' ||
                    entry.name === 'dist' || entry.name === 'build' ||
                    entry.name.startsWith('.')) {
                    continue;
                }
                if (entry.isDirectory()) {
                    searchInDir(fullPath, depth + 1);
                }
                else if (entry.isFile()) {
                    const ext = extname(entry.name).toLowerCase();
                    if (['.vue', '.js', '.ts', '.md', '.yaml', '.yml'].includes(ext)) {
                        // Only include files that might contain business logic
                        const name = entry.name.toLowerCase();
                        if (name.includes('login') || name.includes('auth') ||
                            name.includes('workflow') || name.includes('process') ||
                            name.includes('controller') || name.includes('router') ||
                            name.includes('config')) {
                            candidates.push(fullPath);
                        }
                    }
                }
            }
        }
        catch {
            // Skip directories we can't read
        }
    };
    searchInDir(projectPath);
    // Read and combine evidence
    return candidates.slice(0, 50).map(file => {
        try {
            const content = readFileSync(file, 'utf8').slice(0, 10000);
            const relativePath = file.replace(projectPath + '/', '');
            return `FILE: ${relativePath}\n${content}`;
        }
        catch {
            return '';
        }
    }).filter(Boolean).join('\n\n');
}
/**
 * Discover process candidates from evidence files using heuristics.
 * This is a fallback when AI is not available.
 */
function discoverCandidatesFromEvidence(evidence) {
    const result = [];
    // Look for login/auth related patterns
    const hasLogin = /\b(login|auth|signin|sign-in)\b/i.test(evidence);
    if (hasLogin) {
        result.push({
            processId: 'login',
            name: 'Login Process',
            confidence: 0.7,
            status: 'candidate',
            evidence: ['login-related files found'],
            nodes: [],
            transitions: []
        });
    }
    // Look for workflow/process patterns
    const hasWorkflow = /\b(workflow|process|approval|submit|approve)\b/i.test(evidence);
    if (hasWorkflow) {
        result.push({
            processId: 'business-workflow',
            name: 'Business Workflow',
            confidence: 0.6,
            status: 'candidate',
            evidence: ['workflow-related files found'],
            nodes: [],
            transitions: []
        });
    }
    return result;
}
export async function discoverProcessesCommand(options) {
    const projectPath = resolve(process.cwd(), options.project || '.');
    // Validate target project configuration
    if (!existsSync(join(projectPath, '.flowtrace'))) {
        console.error(chalk.red(`\nError: .flowtrace directory not found in ${projectPath}`));
        console.log(chalk.gray(`   Run: flowtrace init --project ${projectPath}`));
        process.exit(1);
    }
    const config = loadTargetProjectConfig(projectPath);
    const root = join(projectPath, '.flowtrace');
    const out = join(root, 'processes');
    mkdirSync(out, { recursive: true });
    const evidence = collectEvidence(projectPath);
    let processes = [];
    let mode = 'source-evidence-candidate';
    // Try AI-assisted discovery if configured
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (options.ai || process.env.FLOWTRACE_AI_BASE_URL || deepseekKey) {
        try {
            const provider = createProvider('openai', {
                baseUrl: process.env.FLOWTRACE_AI_BASE_URL || (deepseekKey ? 'https://api.deepseek.com' : 'https://api.openai.com/v1'),
                apiKey: deepseekKey || process.env.FLOWTRACE_AI_API_KEY,
                model: process.env.FLOWTRACE_AI_MODEL || (deepseekKey ? 'deepseek-v4-pro' : 'gpt-4o-mini')
            });
            await provider.initialize();
            processes = await provider.completeJSON({
                system: 'You discover business processes conservatively. Never invent steps. Every process and every node must cite one or more evidence paths from the supplied evidence. Return only JSON.',
                prompt: `Discover business processes from this project evidence. Output an array of objects with processId, name, confidence, evidence, nodes[{id,name,type,actor}], transitions[{from,to,event}], and status. Only include processes supported by evidence. Evidence:\n${evidence}`,
                temperature: 0.1,
                maxTokens: 12000
            });
            mode = 'ai-assisted';
        }
        catch (error) {
            console.warn(chalk.yellow(`AI discovery failed, falling back to heuristic discovery: ${error instanceof Error ? error.message : String(error)}`));
            processes = discoverCandidatesFromEvidence(evidence);
        }
    }
    else {
        processes = discoverCandidatesFromEvidence(evidence);
    }
    const inventory = {
        projectId: config.project.id,
        projectName: config.project.name,
        discoveryMode: mode,
        discoveredAt: new Date().toISOString(),
        evidenceFiles: evidence.split('\n').filter(Boolean).slice(0, 100),
        processes
    };
    writeFileSync(join(out, 'inventory.json'), JSON.stringify(inventory, null, 2));
    writeFileSync(join(out, 'inventory.md'), renderInventory(inventory));
    for (const process of processes) {
        writeFileSync(join(out, `${process.processId}.json`), JSON.stringify(process, null, 2));
        writeFileSync(join(out, `${process.processId}-flowchart.md`), renderProcess(process));
    }
    console.log(chalk.green(`\nDiscovered ${processes.length} process candidate(s)`));
    console.log(chalk.gray(`Discovery mode: ${mode}`));
    console.log(chalk.gray(`Machine inventory: ${join(out, 'inventory.json')}`));
    console.log(chalk.gray(`Human inventory: ${join(out, 'inventory.md')}`));
}
function renderInventory(inventory) {
    const lines = [
        `# Process Discovery Inventory`,
        ``,
        `Project: ${inventory.projectName}`,
        `Discovery Mode: ${inventory.discoveryMode}`,
        `Discovered At: ${inventory.discoveredAt}`,
        ``,
        '## Process Candidates',
        ``
    ];
    if (inventory.processes.length === 0) {
        lines.push('No process candidates found.');
        lines.push('');
        lines.push('To add processes:');
        lines.push('1. Add process-related files to your project');
        lines.push('2. Ensure files contain business logic (controllers, routers, etc.)');
        lines.push('3. Run `flowtrace discover-processes --ai` for AI-assisted discovery');
    }
    else {
        lines.push('| Process ID | Name | Confidence | Status |');
        lines.push('|---|---|---:|---|');
        for (const p of inventory.processes) {
            lines.push(`| ${p.processId} | ${p.name} | ${p.confidence ?? '-'} | ${p.status} |`);
        }
    }
    return lines.join('\n') + '\n';
}
function renderProcess(process) {
    const lines = [
        `# ${process.name}`,
        ``,
        `Process ID: ${process.processId}`,
        `Status: ${process.status || 'candidate'}`,
        `Confidence: ${process.confidence ?? '-'}`,
        ``
    ];
    if (process.nodes && process.nodes.length > 0) {
        lines.push('## Nodes');
        lines.push('');
        for (const node of process.nodes) {
            lines.push(`- ${node.id || node.name}: ${node.description || ''}`);
        }
        lines.push('');
    }
    if (process.transitions && process.transitions.length > 0) {
        lines.push('## Transitions');
        lines.push('');
        for (const transition of process.transitions) {
            lines.push(`- ${transition.from} -> ${transition.to}`);
        }
        lines.push('');
    }
    return lines.join('\n') + '\n';
}
//# sourceMappingURL=discover-processes.js.map