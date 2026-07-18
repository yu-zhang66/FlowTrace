/**
 * FlowTrace Semantic Model
 * 
 * 语义模型：定义业务流程的语义事件和约束
 * 支持：
 * - 语义事件（必经历程、禁止事件）
 * - 并签约束（并行分支、汇聚条件）
 * - 角色语义
 * - 业务不变量
 */

import type { ExecutionResult } from './models/execution.js';

/**
 * 语义事件类型
 */
export type SemanticEventType =
  | 'REQUIRED'    // 必经事件：流程中必须发生的事件
  | 'FORBIDDEN'   // 禁止事件：流程中禁止发生的事件
  | 'PARALLEL'    // 并行事件：可以与其他事件并行发生
  | 'ORDERED';    // 顺序事件：必须按特定顺序发生

/**
 * 语义事件
 */
export interface SemanticEvent {
  /** 事件 ID */
  id: string;
  /** 事件类型 */
  type: SemanticEventType;
  /** 事件名称 */
  name: string;
  /** 关联的动作类型 */
  actionTypes: string[];
  /** 关联的节点 */
  nodeIds?: string[];
  /** 描述 */
  description?: string;
}

/**
 * 汇聚条件类型
 */
export type ConvergenceConditionType =
  | 'ALL_COMPLETED'     // 所有分支都完成
  | 'ANY_COMPLETED'     // 任意分支完成
  | 'N_OF_M_COMPLETED'  // N 个分支完成
  | 'CRITICAL_COMPLETED'; // 关键分支完成

/**
 * 汇聚条件
 */
export interface ConvergenceCondition {
  type: ConvergenceConditionType;
  /** 对于 N_OF_M，需要指定 N */
  n?: number;
  /** 对于 CRITICAL_COMPLETED，需要指定关键分支 ID */
  criticalBranches?: string[];
}

/**
 * 并行分支定义
 */
export interface ParallelBranch {
  id: string;
  name: string;
  /** 分支中的事件序列 */
  events: SemanticEvent[];
  /** 分支是否关键分支 */
  isCritical?: boolean;
}

/**
 * 并签约束
 */
export interface ParallelSigningConstraint {
  /** 约束 ID */
  id: string;
  /** 约束名称 */
  name: string;
  /** 并行分支列表 */
  branches: ParallelBranch[];
  /** 汇聚条件 */
  convergence: ConvergenceCondition;
  /** 是否已启用 */
  enabled: boolean;
  /** 描述 */
  description?: string;
}

/**
 * 串签约束
 */
export interface SequentialSigningConstraint {
  id: string;
  name: string;
  /** 顺序事件列表 */
  events: SemanticEvent[];
  /** 是否严格顺序 */
  strictOrder: boolean;
  /** 允许的跳过事件 */
  skippableEvents?: string[];
}

/**
 * 业务不变量
 */
export interface BusinessInvariant {
  id: string;
  name: string;
  /** 约束表达式（形式化语言） */
  expression: string;
  /** 描述 */
  description: string;
}

/**
 * 语义流程模型
 */
export interface SemanticProcessModel {
  processId: string;
  /** 流程名称 */
  name: string;
  /** 语义事件 */
  events: SemanticEvent[];
  /** 并签约束（如果有） */
  parallelSigning?: ParallelSigningConstraint;
  /** 串签约束 */
  sequentialSigning?: SequentialSigningConstraint;
  /** 业务不变量 */
  invariants: BusinessInvariant[];
  /** 角色定义 */
  roles: RoleDefinition[];
}

/**
 * 角色定义
 */
export interface RoleDefinition {
  id: string;
  name: string;
  /** 可以执行的动作 */
  allowedActions: string[];
  /** 默认执行人 */
  defaultActor?: string;
}

/**
 * 语义路径元素
 */
export interface SemanticPathElement {
  /** 事件 ID */
  eventId: string;
  /** 动作类型 */
  actionType: string;
  /** 时间戳 */
  timestamp?: string;
  /** 执行人 */
  actor?: string;
  /** 所在分支（如果是并行） */
  branchId?: string;
}

/**
 * 语义比较结果
 */
export interface SemanticComparisonResult {
  /** 是否等价 */
  equivalent: boolean;
  /** 缺失事件 */
  missingEvents: string[];
  /** 额外事件 */
  extraEvents: string[];
  /** 顺序差异 */
  orderDifferences: OrderDifference[];
  /** 并签差异 */
  parallelDifferences: ParallelDifference[];
  /** 约束违反 */
  constraintViolations: ConstraintViolation[];
}

/**
 * 顺序差异
 */
export interface OrderDifference {
  event1: string;
  event2: string;
  expectedOrder: 'before' | 'after';
  actualOrder: 'before' | 'after';
  severity: 'P0' | 'P1' | 'P2';
}

/**
 * 并签差异
 */
export interface ParallelDifference {
  /** 分支 ID */
  branchId: string;
  /** 预期状态 */
  expected: 'parallel' | 'sequential' | 'not_executed';
  /** 实际状态 */
  actual: 'parallel' | 'sequential' | 'not_executed';
  /** 描述 */
  description: string;
  severity: 'P0' | 'P1' | 'P2';
}

/**
 * 约束违反
 */
export interface ConstraintViolation {
  constraintId: string;
  constraintType: 'required' | 'forbidden' | 'parallel' | 'sequential' | 'invariant';
  description: string;
  severity: 'P0' | 'P1' | 'P2';
}

/**
 * 创建必经事件
 */
export function createRequiredEvent(
  id: string,
  name: string,
  actionTypes: string[],
  options?: { nodeIds?: string[]; description?: string }
): SemanticEvent {
  return {
    id,
    type: 'REQUIRED',
    name,
    actionTypes,
    nodeIds: options?.nodeIds,
    description: options?.description
  };
}

/**
 * 创建禁止事件
 */
export function createForbiddenEvent(
  id: string,
  name: string,
  actionTypes: string[],
  options?: { nodeIds?: string[]; description?: string }
): SemanticEvent {
  return {
    id,
    type: 'FORBIDDEN',
    name,
    actionTypes,
    nodeIds: options?.nodeIds,
    description: options?.description
  };
}

/**
 * 创建并行事件
 */
export function createParallelEvent(
  id: string,
  name: string,
  actionTypes: string[],
  options?: { nodeIds?: string[]; description?: string }
): SemanticEvent {
  return {
    id,
    type: 'PARALLEL',
    name,
    actionTypes,
    nodeIds: options?.nodeIds,
    description: options?.description
  };
}

/**
 * 创建串签改并签约束
 */
export function createParallelSigningConstraint(
  id: string,
  name: string,
  branches: ParallelBranch[],
  convergence: ConvergenceCondition,
  options?: { enabled?: boolean; description?: string }
): ParallelSigningConstraint {
  return {
    id,
    name,
    branches,
    convergence,
    enabled: options?.enabled ?? false,
    description: options?.description
  };
}

/**
 * 从流程定义创建语义模型
 */
export function createSemanticModelFromProcess(
  processId: string,
  name: string,
  processDefinition: {
    nodes?: Array<{ id: string; name: string; type: string }>;
    transitions?: Array<{ from: string; to: string; event?: string }>;
    actions?: string[];
  }
): SemanticProcessModel {
  const events: SemanticEvent[] = [];
  
  // 从节点创建事件
  if (processDefinition.nodes) {
    for (const node of processDefinition.nodes) {
      if (node.type === 'task' || node.type === 'start' || node.type === 'end') {
        events.push({
          id: node.id,
          type: node.type === 'start' || node.type === 'end' ? 'REQUIRED' : 'ORDERED',
          name: node.name,
          actionTypes: [node.id],
          nodeIds: [node.id],
          description: `${node.type} node: ${node.name}`
        });
      }
    }
  }

  return {
    processId,
    name,
    events,
    invariants: [],
    roles: []
  };
}

/**
 * 验证执行结果是否满足语义模型
 */
export function validateAgainstSemanticModel(
  executionPath: SemanticPathElement[],
  model: SemanticProcessModel
): SemanticComparisonResult {
  const result: SemanticComparisonResult = {
    equivalent: true,
    missingEvents: [],
    extraEvents: [],
    orderDifferences: [],
    parallelDifferences: [],
    constraintViolations: []
  };

  const executedEventIds = new Set(executionPath.map(e => e.eventId));

  // 检查必经事件
  const requiredEvents = model.events.filter(e => e.type === 'REQUIRED' || e.type === 'ORDERED');
  for (const event of requiredEvents) {
    if (!executedEventIds.has(event.id)) {
      result.missingEvents.push(event.id);
      result.equivalent = false;
      result.constraintViolations.push({
        constraintId: event.id,
        constraintType: 'required',
        description: `Required event ${event.name} was not executed`,
        severity: 'P0'
      });
    }
  }

  // 检查禁止事件
  const forbiddenEvents = model.events.filter(e => e.type === 'FORBIDDEN');
  for (const event of forbiddenEvents) {
    if (executedEventIds.has(event.id)) {
      result.extraEvents.push(event.id);
      result.equivalent = false;
      result.constraintViolations.push({
        constraintId: event.id,
        constraintType: 'forbidden',
        description: `Forbidden event ${event.name} was executed`,
        severity: 'P0'
      });
    }
  }

  // 检查串签顺序约束
  if (model.sequentialSigning) {
    const orderResult = checkSequentialOrder(executionPath, model.sequentialSigning);
    result.orderDifferences.push(...orderResult);
    if (orderResult.length > 0) {
      result.equivalent = false;
    }
  }

  // 检查并签约束
  if (model.parallelSigning?.enabled) {
    const parallelResult = checkParallelConstraint(executionPath, model.parallelSigning);
    result.parallelDifferences.push(...parallelResult);
    if (parallelResult.length > 0) {
      result.equivalent = false;
    }
  }

  return result;
}

/**
 * 检查顺序约束
 */
function checkSequentialOrder(
  path: SemanticPathElement[],
  constraint: SequentialSigningConstraint
): OrderDifference[] {
  const differences: OrderDifference[] = [];
  
  // 构建事件索引映射
  const eventIndices = new Map<string, number>();
  path.forEach((element, index) => {
    eventIndices.set(element.eventId, index);
  });

  // 检查顺序对
  for (let i = 0; i < constraint.events.length - 1; i++) {
    const event1 = constraint.events[i];
    const event2 = constraint.events[i + 1];

    const index1 = findEventIndex(path, event1.id);
    const index2 = findEventIndex(path, event2.id);

    if (index1 !== -1 && index2 !== -1) {
      if (index1 > index2 && constraint.strictOrder) {
        differences.push({
          event1: event1.id,
          event2: event2.id,
          expectedOrder: 'before',
          actualOrder: 'after',
          severity: 'P1'
        });
      }
    }
  }

  return differences;
}

/**
 * 检查并签约束
 */
function checkParallelConstraint(
  path: SemanticPathElement[],
  constraint: ParallelSigningConstraint
): ParallelDifference[] {
  const differences: ParallelDifference[] = [];

  // 检查汇聚条件
  const branchStatuses = constraint.branches.map(branch => {
    const executedEvents = path.filter(e => 
      branch.events.some(be => be.id === e.eventId)
    );
    return {
      branchId: branch.id,
      isExecuted: executedEvents.length > 0,
      isParallel: checkIfParallel(path, branch.events),
      eventCount: executedEvents.length
    };
  });

  // 根据汇聚条件检查
  switch (constraint.convergence.type) {
    case 'ALL_COMPLETED':
      const allExecuted = branchStatuses.every(b => b.isExecuted);
      if (!allExecuted) {
        const missingBranches = branchStatuses
          .filter(b => !b.isExecuted)
          .map(b => b.branchId);
        differences.push({
          branchId: missingBranches.join(','),
          expected: 'parallel',
          actual: 'not_executed',
          description: `All branches should execute, missing: ${missingBranches.join(', ')}`,
          severity: 'P0'
        });
      }
      break;

    case 'ANY_COMPLETED':
      const anyExecuted = branchStatuses.some(b => b.isExecuted);
      if (!anyExecuted) {
        differences.push({
          branchId: constraint.branches.map(b => b.id).join('|'),
          expected: 'parallel',
          actual: 'not_executed',
          description: 'At least one branch should execute',
          severity: 'P0'
        });
      }
      break;

    case 'N_OF_M_COMPLETED':
      const n = constraint.convergence.n || 1;
      const executedCount = branchStatuses.filter(b => b.isExecuted).length;
      if (executedCount < n) {
        differences.push({
          branchId: 'multiple',
          expected: 'parallel',
          actual: 'not_executed',
          description: `Expected ${n} branches to complete, only ${executedCount} executed`,
          severity: 'P0'
        });
      }
      break;
  }

  return differences;
}

/**
 * 查找事件在路径中的索引
 */
function findEventIndex(path: SemanticPathElement[], eventId: string): number {
  return path.findIndex(e => e.eventId === eventId);
}

/**
 * 检查一组事件是否并行执行
 */
function checkIfParallel(path: SemanticPathElement[], events: SemanticEvent[]): boolean {
  if (events.length < 2) return true;

  const eventIds = new Set(events.map(e => e.id));
  const relevantElements = path.filter(e => eventIds.has(e.eventId));

  if (relevantElements.length < 2) return true;

  // 检查时间戳是否接近（并行执行的特征）
  // 这里简化处理，实际应该检查时间戳差异
  return false; // 简化：默认不是并行
}
