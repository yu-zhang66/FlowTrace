#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { statusCommand } from './commands/status.js';
import { recordConfirmCommand } from './commands/record-confirm.js';
import { collectCommand } from './commands/collect.js';
import { generateCasesCommand } from './commands/generate-cases.js';
import { validateCasesCommand } from './commands/validate-cases.js';
import { verifyCommand } from './commands/verify.js';
import { renderCommand } from './commands/render.js';
import { reportCommand } from './commands/report.js';
import { listCommand } from './commands/list.js';
import { discoverProcessesCommand } from './commands/discover-processes.js';
import { validateProcessesCommand } from './commands/validate-processes.js';
import { pipelineCommand } from './commands/pipeline.js';
import { testCommand } from './commands/test/test.js';
import { importRecordingCommand } from './commands/import-recording.js';
import { recordCommand } from './commands/record.js';
import { normalizeCasesCommand } from './commands/normalize-cases.js';
import { dualRunCommand } from './commands/dual-run.js';

const program = new Command();

/** Commander option collector: pushes each occurrence into an array. */
function collectValue(value: string, previous: string[]): string[] {
  previous = previous ?? [];
  previous.push(value);
  return previous;
}

program
  .command('pipeline')
  .description('Run the complete FlowTrace MVP pipeline')
  .option('-p, --project <path>', 'Project root path')
  .option('--process <id>', 'Process ID')
  .option('--ai', 'Enable AI enhancement when configured', false)
  .option('--resume', 'Resume with a new orchestration run using the same task ID', false)
  .option('--confirm', 'Confirm unresolved process evidence and continue the pipeline', false)
  .action(pipelineCommand);

program
  .name('flowtrace')
  .description('FlowTrace - Legacy process baseline collection and dual-run verification')
  .version('0.1.0');

program
  .command('status')
  .description('Show project and process status with structured output')
  .option('-p, --project <path>', 'Project root path')
  .option('--process <id>', 'Explicit process ID')
  .option('--query <text>', 'Natural-language process query')
  .option('--human', 'Human-readable output in addition to structured JSON', false)
  .action(statusCommand);

program
  .command('record-confirm [processId]')
  .description('Mark a process recording as confirmed (test utility; page recorder not yet implemented)')
  .option('-p, --project <path>', 'Project root path')
  .option('--artifact <path>', 'Recording artifact path or URI')
  .option('--by <name>', 'Confirmer name (defaults to $USER)', 'manual')
  .action((processIdArg, opts) =>
    recordConfirmCommand({ ...opts, process: opts.process ?? processIdArg })
  );

program
  .command('init')
  .description('Initialize FlowTrace configuration for a target project')
  .option('-p, --project <path>', 'Project root path')
  .option('-n, --process <id>', 'Process ID to track', 'demo-process')
  .option('-f, --force', 'Force re-initialization')
  .action(initCommand);

program
  .command('collect')
  .description('Collect legacy process baseline facts')
  .option('-p, --project <path>', 'Project root path')
  .option('--process <id>', 'Process ID to collect')
  .option('-o, --output <path>', 'Output directory (defaults to config)')
  .option('-s, --source <path>', 'Source root directory')
  .option('--[no-]scan-source', 'Scan source code', true)
  .option('--scan-database', 'Scan database (requires config)', false)
  .option('-c, --collector <type>', 'Collector type: demo, source, database, auto', 'auto')
  .option('--demo', 'Use demo collector (for testing)', false)
  .action(collectCommand);

program
  .command('discover-processes')
  .description('Discover business process candidates from project evidence, optionally with AI')
  .option('-p, --project <path>', 'Project root path')
  .option('--ai', 'Use configured AI provider', false)
  .action(discoverProcessesCommand);

program
  .command('validate-processes')
  .description('Validate discovered process evidence and structure')
  .option('-p, --project <path>', 'Project root path')
  .action(validateProcessesCommand);

program
  .command('generate-cases')
  .description('Generate test scenarios using AI')
  .option('-p, --project <path>', 'Project root path')
  .option('--process <id>', 'Process ID to generate cases for')
  .option('-f, --facts <path>', 'Facts directory (defaults to the target .flowtrace/facts)')
  .option('-o, --output <path>', 'Output directory (defaults to .flowtrace/scenarios)')
  .option('--ai', 'Use AI for generation', false)
  .option('--provider <name>', 'AI provider name')
  .option('--count <number>', 'Requested number of generated scenarios')
  .action(generateCasesCommand);

program
  .command('normalize-cases')
  .description('Normalize recorded evidence into disabled, reviewable scenario candidates')
  .option('-p, --project <path>', 'Target project root')
  .option('--process <id>', 'Process ID')
  .option('-i, --input <path>', 'Raw recording JSON (defaults to all recordings)')
  .option('-o, --output <path>', 'Scenario output under .flowtrace/scenarios')
  .action(normalizeCasesCommand);

program
  .command('validate-cases')
  .description('Validate test scenarios against schema and evidence')
  .option('-p, --project <path>', 'Project root path')
  .option('-s, --scenarios <path>', 'Scenarios directory (defaults to config)')
  .action(validateCasesCommand);

program
  .command('verify')
  .description('Run verification (dual-run by default; single-side with --system)')
  .option('-p, --project <path>', 'Project root path')
  .option('-s, --scenarios <path>', 'Scenarios directory (defaults to config)')
  .option('-o, --output <path>', 'Output directory (defaults to config)')
  .option('-x, --system <id>', 'Run only the given system id (single-side). Repeatable, e.g. -x current', collectValue, [])
  .option('-w, --process <id>', 'Run only the given process id. Repeatable, e.g. -w smoke', collectValue, [])
  .option('--stop-on-failure', 'Stop execution immediately when any scenario fails', false)
  .action(verifyCommand);

program
  .command('dual-run')
  .description('Execute one confirmed scenario in isolated legacy/current Playwright contexts')
  .option('-p, --project <path>', 'Target project root')
  .requiredOption('-s, --scenario <path>', 'Confirmed/enabled scenario YAML')
  .option('--legacy-shadow', 'Label legacy-shadow as harness validation only', false)
  .action(dualRunCommand);

program
  .command('test')
  .description('Run login test scenarios')
  .option('-p, --project <path>', 'Project root path')
  .option('--process <id>', 'Process ID to test (default: login)')
  .option('-s, --scenario <id>', 'Specific scenario ID to run')
  .option('-m, --mode <mode>', 'Test mode: single-browser or dual-browser', 'single-browser')
  .option('--scenarios <path>', 'Scenarios directory')
  .option('-o, --output <path>', 'Output directory')
  .option('--legacy-base-url <url>', 'Legacy system base URL')
  .option('--current-base-url <url>', 'Current system base URL')
  .option('--legacy-shadow', 'Use legacy adapter for current (testing harness only)', false)
  .option('--stop-on-failure', 'Stop on first failure')
  .option('--reuse-baseline', 'Reuse existing baseline instead of collecting new one', false)
  .option('--reuse-cases', 'Reuse existing test cases instead of generating new ones', false)
  .action(testCommand);

program
  .command('import-recording')
  .description('Import a Playwright recording into a FlowTrace scenario draft')
  .option('-p, --project <path>', 'Project root path')
  .option('--process <id>', 'Process ID')
  .requiredOption('-i, --input <path>', 'Playwright recording spec path')
  .option('-o, --output <path>', 'Scenario YAML output path')
  .option('--mapping <path>', 'Browser action mapping YAML path')
  .action(importRecordingCommand);

program
  .command('record')
  .description('Record a browser workflow using Playwright Codegen')
  .option('-p, --project <path>', 'Project root path')
  .option('--process <id>', 'Process ID')
  .option('--url <url>', 'Starting URL')
  .option('-o, --output <path>', 'Output Playwright spec path')
  .option('--auth <path>', 'Output Playwright storage state path')
  .action(recordCommand);

program
  .command('render')
  .description('Render JSON/YAML artifacts to Markdown')
  .option('-p, --project <path>', 'Project root path')
  .option('-t, --type <type>', 'Type to render: all, baseline, scenarios, reports')
  .option('-c, --check', 'Check if renders are up-to-date (CI mode)')
  .action(renderCommand);

program
  .command('report')
  .description('Generate verification report')
  .option('-p, --project <path>', 'Project root path')
  .option('-r, --run <id>', 'Verification run ID')
  .option('-f, --format <format>', 'Report format: json, markdown, html', 'markdown')
  .option('-o, --output <path>', 'Output file path')
  .action(reportCommand);

program
  .command('list')
  .description('List available projects and configurations')
  .option('-s, --search <paths>', 'Paths to search (comma-separated)')
  .action(listCommand);

program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log(chalk.yellow('See --help for a list of available commands.'));
  process.exit(1);
});

program.parse();
