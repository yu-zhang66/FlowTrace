import chalk from 'chalk';
import { resolve } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'fs';
import yaml from 'js-yaml';
import { ConfigLoader } from '@flowtrace/core';

interface RenderOptions {
  project?: string;
  type?: string;
  check?: boolean;
}

export async function renderCommand(options: RenderOptions): Promise<void> {
  const projectPath = options.project
    ? resolve(process.cwd(), options.project)
    : resolve(process.cwd());

  const type = options.type || 'all';

  console.log(chalk.blue(`\n📝 FlowTrace Render`));
  console.log(chalk.gray(`Project: ${projectPath}`));
  console.log(chalk.gray(`Type: ${type}\n`));

  const loader = new ConfigLoader(projectPath);

  let config;
  try {
    config = loader.loadProjectConfig();
    console.log(chalk.green(`✓ Loaded project: ${config.project.name}`));
  } catch (error) {
    console.error(chalk.red(`Failed to load project config: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }

  if (options.check) {
    console.log(chalk.blue(`\n🔍 Checking render consistency...\n`));
    const hasDrift = checkRenderDrift(loader, config, type);

    if (hasDrift) {
      console.log(chalk.red(`\n✗ Render drift detected!`));
      console.log(chalk.yellow(`  Run: flowtrace render --project ${projectPath} --type ${type}\n`));
      process.exit(1);
    } else {
      console.log(chalk.green(`\n✓ No render drift detected.\n`));
    }
    return;
  }

  console.log(chalk.blue(`\n📄 Rendering artifacts to Markdown...\n`));

  const baselineDir = loader.getPath(config, 'facts');
  const scenariosDir = loader.getPath(config, 'scenarios');
  const reportsDir = loader.getPath(config, 'reports');

  const outputs: string[] = [];

  if (type === 'all' || type === 'baseline') {
    const baselineMarkdown = renderBaseline(baselineDir);
    if (baselineMarkdown) {
      const outputPath = resolve(projectPath, 'docs', 'baseline.md');
      mkdirSync(resolve(projectPath, 'docs'), { recursive: true });
      writeFileSync(outputPath, baselineMarkdown, 'utf-8');
      outputs.push(outputPath);
      console.log(chalk.green(`  ✓ Baseline: ${outputPath}`));
    }
  }

  if (type === 'all' || type === 'scenarios') {
    const scenariosMarkdown = renderScenarios(scenariosDir);
    if (scenariosMarkdown) {
      const outputPath = resolve(projectPath, 'docs', 'scenarios.md');
      writeFileSync(outputPath, scenariosMarkdown, 'utf-8');
      outputs.push(outputPath);
      console.log(chalk.green(`  ✓ Scenarios: ${outputPath}`));
    }
  }

  if (type === 'all' || type === 'reports') {
    const reportsMarkdown = renderReports(reportsDir);
    if (reportsMarkdown) {
      const outputPath = resolve(projectPath, 'docs', 'reports.md');
      writeFileSync(outputPath, reportsMarkdown, 'utf-8');
      outputs.push(outputPath);
      console.log(chalk.green(`  ✓ Reports: ${outputPath}`));
    }
  }

  if (outputs.length > 0) {
    console.log(chalk.green(`\n✓ Rendered ${outputs.length} Markdown file(s)\n`));
  } else {
    console.log(chalk.yellow(`\n⚠️  No artifacts found to render.\n`));
  }

  return undefined;
}

function checkRenderDrift(loader: ConfigLoader, config: any, type: string): boolean {
  let hasDrift = false;

  if (type === 'all' || type === 'baseline') {
    const baselinePath = resolve(loader.getPath(config, 'facts'), 'baseline.json');
    const markdownPath = resolve(process.cwd(), 'docs', 'baseline.md');

    if (existsSync(baselinePath) && existsSync(markdownPath)) {
      const jsonMtime = statSync(baselinePath).mtimeMs;
      const mdMtime = statSync(markdownPath).mtimeMs;

      if (jsonMtime > mdMtime) {
        console.log(chalk.red(`  ✗ ${baselinePath} is newer than ${markdownPath}`));
        hasDrift = true;
      }
    }
  }

  return hasDrift;
}

function renderBaseline(baselineDir: string): string | null {
  const baselinePath = resolve(baselineDir, 'baseline.json');

  if (!existsSync(baselinePath)) {
    console.log(chalk.gray(`  ⚠️  No baseline found at ${baselinePath}`));
    return null;
  }

  try {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));

    let markdown = `# ${baseline.name}\n\n`;
    markdown += `**Collected at:** ${new Date(baseline.collectedAt).toLocaleString()}\n\n`;
    markdown += `**Process ID:** ${baseline.processId}\n\n`;
    markdown += `**Total Facts:** ${baseline.summary.totalFacts}\n`;
    markdown += `**Confirmed:** ${baseline.summary.confirmedFacts}\n`;
    markdown += `**Pending Review:** ${baseline.summary.pendingFacts}\n\n`;

    markdown += `## Facts by Category\n\n`;
    for (const [category, count] of Object.entries(baseline.summary.byCategory)) {
      markdown += `- **${category}:** ${count}\n`;
    }
    markdown += `\n`;

    markdown += `## Process Definition\n\n`;
    markdown += `\`\`\`mermaid\n`;
    markdown += `graph TD\n`;

    const processFact = baseline.facts.find((f: any) => f.category === 'process_definition');
    if (processFact && processFact.content.nodes) {
      for (const node of processFact.content.nodes) {
        markdown += `    ${node.id}["${node.name}"]\n`;
      }
      if (processFact.content.transitions) {
        for (const trans of processFact.content.transitions) {
          markdown += `    ${trans.from} --> ${trans.to}`;
          if (trans.condition) {
            markdown += ` : ${trans.condition}`;
          }
          markdown += `\n`;
        }
      }
    }

    markdown += `\`\`\`\n\n`;

    markdown += `## Business Rules\n\n`;
    const rules = baseline.facts.filter((f: any) => f.category === 'rule');
    for (const rule of rules) {
      markdown += `### ${rule.name}\n\n`;
      markdown += `${rule.description || 'No description'}\n\n`;
      markdown += `**Rule ID:** ${rule.content.ruleId || 'N/A'}\n`;
      markdown += `**Condition:** ${rule.content.condition || 'N/A'}\n\n`;
      markdown += `\`\`\`json\n${JSON.stringify(rule.content, null, 2)}\n\`\`\`\n\n`;

      if (rule.evidence && rule.evidence.length > 0) {
        markdown += `**Evidence:**\n`;
        for (const ev of rule.evidence) {
          markdown += `- Source: \`${ev.source}\`\n`;
          markdown += `  - Confidence: ${((ev.confidence || 0) * 100).toFixed(0)}%\n`;
          markdown += `  - Line: ${ev.line || 'N/A'}\n`;
        }
        markdown += `\n`;
      }

      markdown += `**Status:** \`${rule.reviewStatus}\`\n\n`;
      markdown += `---\n\n`;
    }

    markdown += `## Roles\n\n`;
    const roles = baseline.facts.filter((f: any) => f.category === 'role');
    for (const role of roles) {
      markdown += `### ${role.name}\n\n`;
      markdown += `${role.description || 'No description'}\n\n`;
      markdown += `**Role ID:** ${role.content.roleId || 'N/A'}\n`;
      markdown += `**Permissions:** ${(role.content.permissions || []).join(', ')}\n\n`;
      markdown += `---\n\n`;
    }

    markdown += `## Data Effects\n\n`;
    const dataEffects = baseline.facts.filter((f: any) => f.category === 'data_effect');
    for (const effect of dataEffects) {
      markdown += `### ${effect.name}\n\n`;
      markdown += `${effect.description || 'No description'}\n\n`;
      markdown += `\`\`\`json\n${JSON.stringify(effect.content, null, 2)}\n\`\`\`\n\n`;
      markdown += `---\n\n`;
    }

    markdown += `## External Calls\n\n`;
    const externalCalls = baseline.facts.filter((f: any) => f.category === 'external_call');
    for (const call of externalCalls) {
      markdown += `### ${call.name}\n\n`;
      markdown += `${call.description || 'No description'}\n\n`;
      markdown += `\`\`\`json\n${JSON.stringify(call.content, null, 2)}\n\`\`\`\n\n`;
      markdown += `---\n\n`;
    }

    return markdown;
  } catch (error) {
    console.error(chalk.red(`Error rendering baseline: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}

function renderScenarios(scenariosDir: string): string | null {
  if (!existsSync(scenariosDir)) {
    return null;
  }

  try {
    let markdown = `# Test Scenarios\n\n`;
    markdown += `Generated at: ${new Date().toLocaleString()}\n\n`;

    const files = readdirSync(scenariosDir);
    const scenarioFiles = files.filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json'));

    if (scenarioFiles.length === 0) {
      return null;
    }

    for (const file of scenarioFiles) {
      const filePath = resolve(scenariosDir, file);
      const content = readFileSync(filePath, 'utf-8');

      let scenarios: any[] = [];
      if (file.endsWith('.json')) {
        scenarios = JSON.parse(content);
        if (!Array.isArray(scenarios)) {
          scenarios = [scenarios];
        }
      } else {
        scenarios = yaml.load(content) as any[];
        if (!Array.isArray(scenarios)) {
          scenarios = [scenarios];
        }
      }

      for (const scenario of scenarios) {
        markdown += `## ${scenario.id}: ${scenario.name}\n\n`;
        markdown += `**Process:** ${scenario.process}\n`;
        markdown += `**Severity:** ${scenario.severity || 'N/A'}\n`;
        markdown += `**Enabled:** ${scenario.enabled !== false ? 'Yes' : 'No'}\n\n`;

        if (scenario.tags && scenario.tags.length > 0) {
          markdown += `**Tags:** ${scenario.tags.join(', ')}\n\n`;
        }

        markdown += `### Input\n\n`;
        markdown += `\`\`\`json\n${JSON.stringify(scenario.input || {}, null, 2)}\n\`\`\`\n\n`;

        markdown += `### Actions\n\n`;
        if (scenario.actions && scenario.actions.length > 0) {
          for (const action of scenario.actions) {
            markdown += `- **${action.type}** by \`${action.actor}\``;
            if (action.data) {
              markdown += ` (${JSON.stringify(action.data)})`;
            }
            markdown += `\n`;
          }
        }
        markdown += `\n`;

        markdown += `### Expected Result\n\n`;
        markdown += `**Final State:** ${scenario.expected?.finalState || 'N/A'}\n\n`;
        if (scenario.expected?.semanticPath) {
          markdown += `**Semantic Path:** \`${scenario.expected.semanticPath.join(' → ')}\`\n\n`;
        }
        if (scenario.expected?.database) {
          markdown += `**Database Changes:**\n`;
          markdown += `\`\`\`json\n${JSON.stringify(scenario.expected.database, null, 2)}\n\`\`\`\n\n`;
        }

        if (scenario.source && scenario.source.length > 0) {
          markdown += `### Source Evidence\n\n`;
          for (const src of scenario.source) {
            markdown += `- ${src}\n`;
          }
          markdown += `\n`;
        }

        markdown += `---\n\n`;
      }
    }

    return markdown;
  } catch (error) {
    console.error(chalk.red(`Error rendering scenarios: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}

function renderReports(reportsDir: string): string | null {
  if (!existsSync(reportsDir)) {
    return null;
  }

  try {
    let markdown = `# Verification Reports\n\n`;
    markdown += `Last updated: ${new Date().toLocaleString()}\n\n`;

    const files = readdirSync(reportsDir);
    const reportFiles = files.filter((f: string) => f.endsWith('.json') && f.startsWith('run-'));

    if (reportFiles.length === 0) {
      return null;
    }

    reportFiles.sort().reverse();

    for (const file of reportFiles.slice(0, 10)) {
      const filePath = resolve(reportsDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const report = JSON.parse(content);

      markdown += `## Run: ${report.id}\n\n`;
      markdown += `**Timestamp:** ${new Date(report.timestamp).toLocaleString()}\n`;
      markdown += `**Project:** ${report.projectId}\n\n`;

      markdown += `### Summary\n\n`;
      markdown += `| Metric | Value |\n`;
      markdown += `|--------|-------|\n`;
      markdown += `| Total | ${report.summary.total} |\n`;
      markdown += `| Passed | ${report.summary.passed} |\n`;
      markdown += `| Failed | ${report.summary.failed} |\n`;
      markdown += `| Pass Rate | ${((report.summary.passed / report.summary.total) * 100).toFixed(1)}% |\n\n`;

      markdown += `### Release Gate\n\n`;
      markdown += report.releaseGate.allowed
        ? `✅ **PASSED**\n\n`
        : `❌ **BLOCKED** by: ${report.releaseGate.blockedBy.join(', ')}\n\n`;

      markdown += `---\n\n`;
    }

    return markdown;
  } catch (error) {
    console.error(chalk.red(`Error rendering reports: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}
