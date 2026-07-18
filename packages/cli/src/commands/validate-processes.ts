import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { loadTargetProjectConfig } from '@flowtrace/core';

interface Options { project?: string; }

export async function validateProcessesCommand(options: Options): Promise<void> {
  const projectPath = resolve(process.cwd(), options.project || '.');
  const config = loadTargetProjectConfig(projectPath);
  const dir = join(projectPath, '.flowtrace', 'processes');
  const inventoryPath = join(dir, 'inventory.json');
  if (!existsSync(inventoryPath)) throw new Error(`Missing process inventory: ${inventoryPath}`);
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const results = (inventory.processes || []).map((process: any) => validateProcess(process, projectPath));
  const passed = results.filter((r: any) => r.status === 'passed').length;
  const failed = results.length - passed;
  const output = { projectId: config.project.id, validatedAt: new Date().toISOString(), total: results.length, passed, failed, results, canGenerateCases: failed === 0 && results.length > 0, approvedProcessIds: results.filter((r: any) => r.status === 'passed').map((r: any) => r.processId) };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'validation.json'), JSON.stringify(output, null, 2));
  writeFileSync(join(dir, 'validation.md'), renderMarkdown(output));
  console.log(`Process validation: ${passed}/${results.length} passed`);
  if (failed > 0) throw new Error(`Process validation failed: ${failed} process(es) blocked`);
}

function validateProcess(process: any, projectPath: string): any {
  const errors: string[] = [];
  if (!process.processId || !/^[a-z0-9][a-z0-9-]+$/.test(process.processId)) errors.push('invalid processId');
  if (!process.name) errors.push('missing name');
  if (!Array.isArray(process.evidence) || process.evidence.length === 0) errors.push('missing evidence');
  for (const evidence of process.evidence || []) {
    const normalized = evidence.replace(/^\//, '');
    if (!existsSync(join(projectPath, normalized)) && !existsSync(join(projectPath, evidence))) errors.push(`evidence not found: ${evidence}`);
  }
  if (process.nodes && !Array.isArray(process.nodes)) errors.push('nodes must be an array');
  if (process.transitions && !Array.isArray(process.transitions)) errors.push('transitions must be an array');
  for (const edge of process.transitions || []) {
    const ids = new Set((process.nodes || []).map((n: any) => n.id));
    if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push(`transition references unknown node: ${edge.from}->${edge.to}`);
  }
  return { processId: process.processId, name: process.name, status: errors.length ? 'blocked' : 'passed', errors, evidence: process.evidence || [], confidence: process.confidence };
}

function renderMarkdown(output: any): string {
  const lines = ['# 流程发现校验', '', `总数：${output.total}`, `通过：${output.passed}`, `失败：${output.failed}`, '', '| 流程 ID | 状态 | 置信度 | 错误 |', '|---|---|---:|---|'];
  for (const result of output.results) lines.push(`| ${result.processId} | ${result.status} | ${result.confidence ?? '-'} | ${result.errors.join('; ') || '-'} |`);
  return `${lines.join('\n')}\n`;
}
