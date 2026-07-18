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
/**
 * 创建必经事件
 */
export function createRequiredEvent(id, name, actionTypes, options) {
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
export function createForbiddenEvent(id, name, actionTypes, options) {
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
export function createParallelEvent(id, name, actionTypes, options) {
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
export function createParallelSigningConstraint(id, name, branches, convergence, options) {
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
export function createSemanticModelFromProcess(processId, name, processDefinition) {
    const events = [];
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
export function validateAgainstSemanticModel(executionPath, model) {
    const result = {
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
function checkSequentialOrder(path, constraint) {
    const differences = [];
    // 构建事件索引映射
    const eventIndices = new Map();
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
function checkParallelConstraint(path, constraint) {
    const differences = [];
    // 检查汇聚条件
    const branchStatuses = constraint.branches.map(branch => {
        const executedEvents = path.filter(e => branch.events.some(be => be.id === e.eventId));
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
function findEventIndex(path, eventId) {
    return path.findIndex(e => e.eventId === eventId);
}
/**
 * 检查一组事件是否并行执行
 */
function checkIfParallel(path, events) {
    if (events.length < 2)
        return true;
    const eventIds = new Set(events.map(e => e.id));
    const relevantElements = path.filter(e => eventIds.has(e.eventId));
    if (relevantElements.length < 2)
        return true;
    // 检查时间戳是否接近（并行执行的特征）
    // 这里简化处理，实际应该检查时间戳差异
    return false; // 简化：默认不是并行
}
//# sourceMappingURL=semantic-model.js.map