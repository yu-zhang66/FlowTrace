/**
 * FlowTrace Coverage Engine
 * 
 * 覆盖率统计引擎：计算测试场景对业务流程的覆盖程度
 * 支持：
 * - 节点覆盖率
 * - 分支覆盖率
 * - 路径覆盖率
 * - 角色覆盖率
 * - 规则覆盖率
 */

import type { Scenario, ScenarioAction } from './models/scenario.js';
import type { ExecutionResult } from './models/execution.js';

/**
 * 覆盖率类型
 */
export type CoverageType =
  | 'node'           // 节点覆盖率
  | 'branch'         // 分支覆盖率
  | 'path'           // 路径覆盖率
  | 'role'           // 角色覆盖率
  | 'rule'           // 规则覆盖率
  | 'boundary';      // 边界覆盖率

/**
 * 覆盖率指标
 */
export interface CoverageMetric {
  type: CoverageType;
  name: string;
  /** 覆盖的项数 */
  covered: number;
  /** 总项数 */
  total: number;
  /** 覆盖率百分比 */
  percentage: number;
  /** 未覆盖的项 */
  uncovered: string[];
  /** 覆盖的项 */
  coveredItems: string[];
}

/**
 * 总体覆盖率报告
 */
export interface CoverageReport {
  /** 流程 ID */
  processId: string;
  /** 报告生成时间 */
  generatedAt: string;
  /** 场景数 */
  scenarioCount: number;
  /** 执行数 */
  executionCount: number;
  /** 各类型覆盖率 */
  metrics: CoverageMetric[];
  /** 总体覆盖率 */
  overallCoverage: number;
  /** 未覆盖的关键路径 */
  criticalPaths: string[];
  /** 覆盖率等级 */
  grade: CoverageGrade;
}

/**
 * 覆盖率等级
 */
export type CoverageGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * 流程节点定义
 */
export interface ProcessNode {
  id: string;
  name: string;
  type: 'start' | 'task' | 'gateway' | 'end' | 'parallel';
  /** 是否关键节点 */
  isCritical?: boolean;
  /** 必需覆盖 */
  isRequired?: boolean;
}

/**
 * 流程分支定义
 */
export interface ProcessBranch {
  id: string;
  name: string;
  fromNode: string;
  toNode: string;
  condition?: string;
  isDefault?: boolean;
}

/**
 * 流程定义
 */
export interface ProcessDefinition {
  processId: string;
  name: string;
  nodes: ProcessNode[];
  branches: ProcessBranch[];
  roles: string[];
}

/**
 * 执行记录
 */
export interface ExecutionRecord {
  scenarioId: string;
  result: ExecutionResult;
  executedNodes: string[];
  executedBranches: string[];
  executedRoles: string[];
}

/**
 * 计算节点覆盖率
 */
export function calculateNodeCoverage(
  executions: ExecutionRecord[],
  process: ProcessDefinition
): CoverageMetric {
  const coveredNodes = new Set<string>();
  
  for (const exec of executions) {
    for (const nodeId of exec.executedNodes) {
      coveredNodes.add(nodeId);
    }
  }

  const allNodes = process.nodes.filter(n => n.type !== 'start');
  const uncovered = allNodes
    .filter(n => !coveredNodes.has(n.id))
    .map(n => n.id);

  const percentage = allNodes.length > 0
    ? Math.round((coveredNodes.size / allNodes.length) * 100)
    : 0;

  return {
    type: 'node',
    name: '节点覆盖率',
    covered: coveredNodes.size,
    total: allNodes.length,
    percentage,
    uncovered,
    coveredItems: Array.from(coveredNodes)
  };
}

/**
 * 计算分支覆盖率
 */
export function calculateBranchCoverage(
  executions: ExecutionRecord[],
  process: ProcessDefinition
): CoverageMetric {
  const coveredBranches = new Set<string>();
  
  for (const exec of executions) {
    for (const branchId of exec.executedBranches) {
      coveredBranches.add(branchId);
    }
  }

  const allBranches = process.branches.filter(b => !b.isDefault);
  const uncovered = allBranches
    .filter(b => !coveredBranches.has(b.id))
    .map(b => b.id);

  const percentage = allBranches.length > 0
    ? Math.round((coveredBranches.size / allBranches.length) * 100)
    : 0;

  return {
    type: 'branch',
    name: '分支覆盖率',
    covered: coveredBranches.size,
    total: allBranches.length,
    percentage,
    uncovered,
    coveredItems: Array.from(coveredBranches)
  };
}

/**
 * 计算角色覆盖率
 */
export function calculateRoleCoverage(
  executions: ExecutionRecord[],
  process: ProcessDefinition
): CoverageMetric {
  const coveredRoles = new Set<string>();
  
  for (const exec of executions) {
    for (const role of exec.executedRoles) {
      coveredRoles.add(role);
    }
  }

  const uncovered = process.roles
    .filter(r => !coveredRoles.has(r))
    .map(r => r);

  const percentage = process.roles.length > 0
    ? Math.round((coveredRoles.size / process.roles.length) * 100)
    : 0;

  return {
    type: 'role',
    name: '角色覆盖率',
    covered: coveredRoles.size,
    total: process.roles.length,
    percentage,
    uncovered,
    coveredItems: Array.from(coveredRoles)
  };
}

/**
 * 计算路径覆盖率
 */
export function calculatePathCoverage(
  executions: ExecutionRecord[],
  process: ProcessDefinition,
  maxPathLength: number = 10
): CoverageMetric {
  const executedPaths = new Set<string>();
  
  for (const exec of executions) {
    // 将执行路径转换为字符串
    const pathKey = exec.executedNodes.join('->');
    executedPaths.add(pathKey);
  }

  // 估算可能路径数（简化计算）
  // 实际应该根据流程定义计算
  const gatewayCount = process.nodes.filter(n => n.type === 'gateway').length;
  const estimatedTotalPaths = Math.pow(2, gatewayCount); // 每网关2个分支
  const cappedTotal = Math.min(estimatedTotalPaths, 100); // 上限100

  const uncovered: string[] = []; // 路径难以列举，简化为空

  return {
    type: 'path',
    name: '路径覆盖率',
    covered: executedPaths.size,
    total: cappedTotal,
    percentage: cappedTotal > 0 ? Math.min(100, Math.round((executedPaths.size / cappedTotal) * 100)) : 0,
    uncovered,
    coveredItems: Array.from(executedPaths)
  };
}

/**
 * 计算边界覆盖率
 */
export function calculateBoundaryCoverage(
  executions: ExecutionRecord[],
  boundaryCases: BoundaryCase[] = []
): CoverageMetric {
  const coveredBoundaries = new Set<string>();
  
  for (const exec of executions) {
    // 检查边界条件覆盖
    for (const bc of boundaryCases) {
      if (matchesBoundaryCase(exec.result, bc)) {
        coveredBoundaries.add(bc.id);
      }
    }
  }

  const uncovered = boundaryCases
    .filter(bc => !coveredBoundaries.has(bc.id))
    .map(bc => bc.id);

  const percentage = boundaryCases.length > 0
    ? Math.round((coveredBoundaries.size / boundaryCases.length) * 100)
    : 0;

  return {
    type: 'boundary',
    name: '边界覆盖率',
    covered: coveredBoundaries.size,
    total: boundaryCases.length,
    percentage,
    uncovered,
    coveredItems: Array.from(coveredBoundaries)
  };
}

/**
 * 边界测试用例
 */
export interface BoundaryCase {
  id: string;
  name: string;
  description: string;
  /** 变量名 */
  variable: string;
  /** 测试值 */
  value: any;
  /** 条件 */
  condition: 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge' | 'in' | 'not_in';
}

/**
 * 匹配边界条件
 */
function matchesBoundaryCase(result: ExecutionResult, bc: BoundaryCase): boolean {
  const businessData = result.businessData || {};
  const actualValue = businessData[bc.variable];
  const compareValue = bc.value as number;

  switch (bc.condition) {
    case 'eq': return actualValue === bc.value;
    case 'ne': return actualValue !== bc.value;
    case 'lt': return typeof actualValue === 'number' && actualValue < compareValue;
    case 'gt': return typeof actualValue === 'number' && actualValue > compareValue;
    case 'le': return typeof actualValue === 'number' && actualValue <= compareValue;
    case 'ge': return typeof actualValue === 'number' && actualValue >= compareValue;
    case 'in': return Array.isArray(bc.value) && bc.value.includes(actualValue);
    case 'not_in': return Array.isArray(bc.value) && !bc.value.includes(actualValue);
    default: return false;
  }
}

/**
 * 计算总体覆盖率
 */
export function calculateOverallCoverage(metrics: CoverageMetric[]): number {
  if (metrics.length === 0) return 0;
  
  const total = metrics.reduce((sum, m) => sum + m.percentage, 0);
  return Math.round(total / metrics.length);
}

/**
 * 确定覆盖率等级
 */
export function determineGrade(coverage: number): CoverageGrade {
  if (coverage >= 90) return 'A';
  if (coverage >= 80) return 'B';
  if (coverage >= 70) return 'C';
  if (coverage >= 60) return 'D';
  return 'F';
}

/**
 * 生成完整覆盖率报告
 */
export function generateCoverageReport(
  processId: string,
  scenarios: Scenario[],
  executions: ExecutionRecord[],
  process: ProcessDefinition,
  boundaryCases?: BoundaryCase[]
): CoverageReport {
  // 计算各类型覆盖率
  const nodeCoverage = calculateNodeCoverage(executions, process);
  const branchCoverage = calculateBranchCoverage(executions, process);
  const roleCoverage = calculateRoleCoverage(executions, process);
  const pathCoverage = calculatePathCoverage(executions, process);
  const boundaryCoverage = calculateBoundaryCoverage(executions, boundaryCases || []);

  const metrics: CoverageMetric[] = [
    nodeCoverage,
    branchCoverage,
    roleCoverage,
    pathCoverage,
    boundaryCoverage
  ];

  // 计算总体覆盖率
  const overallCoverage = calculateOverallCoverage(metrics);

  // 找出未覆盖的关键路径
  const criticalPaths = process.nodes
    .filter(n => n.isCritical && !nodeCoverage.coveredItems.includes(n.id))
    .map(n => n.id);

  return {
    processId,
    generatedAt: new Date().toISOString(),
    scenarioCount: scenarios.length,
    executionCount: executions.length,
    metrics,
    overallCoverage,
    criticalPaths,
    grade: determineGrade(overallCoverage)
  };
}

/**
 * 从执行结果提取节点执行信息
 */
export function extractExecutedNodes(result: ExecutionResult): string[] {
  const nodes: string[] = [];
  
  // 从 semanticPath 推断节点
  for (const pathElement of result.semanticPath || []) {
    // 路径元素可能是事件名称或节点ID
    nodes.push(pathElement);
  }
  
  // 从 businessData 中提取节点信息
  if (result.businessData?.currentNode) {
    nodes.push(result.businessData.currentNode as string);
  }
  
  return [...new Set(nodes)];
}

/**
 * 从执行结果提取分支执行信息
 */
export function extractExecutedBranches(result: ExecutionResult): string[] {
  const branches: string[] = [];
  
  // 从 semanticPath 推断分支
  for (const pathElement of result.semanticPath || []) {
    // 检查是否有分支标记
    if (pathElement.includes('->')) {
      const parts = pathElement.split('->');
      if (parts.length >= 2) {
        branches.push(`${parts[0]}->${parts[1]}`);
      }
    }
  }
  
  return [...new Set(branches)];
}

/**
 * 从场景提取角色信息
 */
export function extractExecutedRoles(scenario: Scenario): string[] {
  const roles: string[] = [];
  
  for (const action of scenario.actions) {
    roles.push(action.actor);
  }
  
  return [...new Set(roles)];
}

/**
 * 从执行结果创建记录
 */
export function createExecutionRecord(
  scenario: Scenario,
  result: ExecutionResult
): ExecutionRecord {
  return {
    scenarioId: scenario.id,
    result,
    executedNodes: extractExecutedNodes(result),
    executedBranches: extractExecutedBranches(result),
    executedRoles: extractExecutedRoles(scenario)
  };
}

/**
 * 生成覆盖率报告 Markdown
 */
export function generateCoverageMarkdown(report: CoverageReport): string {
  let md = `# 覆盖率报告

## 基本信息

- **流程**: ${report.processId}
- **生成时间**: ${new Date(report.generatedAt).toLocaleString('zh-CN')}
- **场景数**: ${report.scenarioCount}
- **执行数**: ${report.executionCount}

## 覆盖率等级

**${report.grade}** (${report.overallCoverage}%)

## 各类型覆盖率

| 类型 | 覆盖数 | 总数 | 覆盖率 |
|------|--------|------|--------|
`;

  for (const metric of report.metrics) {
    const status = metric.percentage >= 80 ? '✅' : metric.percentage >= 60 ? '⚠️' : '❌';
    md += `| ${metric.name} | ${metric.covered} | ${metric.total} | ${status} ${metric.percentage}% |\n`;
  }

  md += `
## 未覆盖项

`;

  for (const metric of report.metrics) {
    if (metric.uncovered.length > 0) {
      md += `### ${metric.name}\n\n`;
      for (const item of metric.uncovered) {
        md += `- ${item}\n`;
      }
      md += '\n';
    }
  }

  if (report.criticalPaths.length > 0) {
    md += `
## 未覆盖的关键路径

`;
    for (const path of report.criticalPaths) {
      md += `- ${path}\n`;
    }
  }

  md += `
---

*此报告由 FlowTrace 自动生成*
`;

  return md;
}
