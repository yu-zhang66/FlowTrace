import chalk from 'chalk';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { discoverProjects } from '@flowtrace/core';

interface ListOptions {
  search?: string;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const searchPaths = options.search
    ? options.search.split(',').map(p => resolve(process.cwd(), p.trim()))
    : [resolve(process.cwd())];

  console.log(chalk.blue(`\n📋 FlowTrace Projects`));
  console.log(chalk.gray(`Searching: ${searchPaths.join(', ')}\n`));

  const projects = discoverProjects(searchPaths);

  if (projects.length === 0) {
    console.log(chalk.yellow('No FlowTrace projects found.'));
    console.log(chalk.gray('\nTo add a project, create a flowtrace.yaml configuration file.'));
    return;
  }

  console.log(chalk.green(`Found ${projects.length} project(s):\n`));

  for (const project of projects) {
    console.log(chalk.cyan(`  📁 ${project.name}`));
    console.log(chalk.gray(`     ID: ${project.id}`));
    console.log(chalk.gray(`     Path: ${project.rootPath}`));
    console.log(chalk.gray(`     Config: ${project.configPath}`));
    console.log();
  }

  console.log(chalk.gray('To run FlowTrace commands:'));
  console.log(chalk.gray('  cd <project-path>'));
  console.log(chalk.gray('  flowtrace verify'));

  return undefined;
}
