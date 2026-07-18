import { z } from 'zod';

/**
 * FlowChart Schema - 流程采集成果物 Schema
 * 
 * 用于描述从业务流程中采集的结构化流程图信息，包括节点、边、角色、
 * 前端页面、后端服务、数据库表等完整的流程元数据。
 */

// ============================================================
// Constants
// ============================================================

/**
 * 需要确认的项目标记
 */
export const PENDING_CONFIRMATION = 'PENDING_CONFIRMATION';

/**
 * 未确认的项目标记
 */
export const UNCONFIRMED = 'UNCONFIRMED';

// ============================================================
// Node Types
// ============================================================

/**
 * 流程节点类型枚举
 */
export const FlowchartNodeType = z.enum([
  'START',
  'END',
  'TASK',
  'APPROVAL',
  'CONDITION',
  'PARALLEL',
  'SUBPROCESS',
  'SERVICE_TASK',
  'USER_TASK',
  'MANUAL_TASK',
  'SCRIPT_TASK',
  'CALL_ACTIVITY',
  'GATEWAY',
  'EVENT',
  'BOUNDARY_EVENT'
]);
export type FlowchartNodeType = z.infer<typeof FlowchartNodeType>;

/**
 * 节点来源状态
 */
export const SourceStatus = z.enum([
  'CONFIRMED',
  'PENDING_CONFIRMATION',
  'UNCONFIRMED',
  'DERIVED'
]);
export type SourceStatus = z.infer<typeof SourceStatus>;

// ============================================================
// Evidence Types
// ============================================================

/**
 * 证据来源类型
 */
export const FlowchartEvidenceSourceType = z.enum([
  'source_code',
  'database',
  'page_recording',
  'runtime_trace',
  'api_documentation',
  'user_interview',
  'document',
  'ai_inferred'
]);
export type FlowchartEvidenceSourceType = z.infer<typeof FlowchartEvidenceSourceType>;

/**
 * 证据类型
 */
export const FlowchartEvidenceType = z.enum([
  'code_snippet',
  'database_schema',
  'api_endpoint',
  'ui_element',
  'business_rule',
  'state_transition',
  'user_action',
  'system_event',
  'document_reference',
  'screenshot',
  'conversation_log',
  'configuration'
]);
export type FlowchartEvidenceType = z.infer<typeof FlowchartEvidenceType>;

/**
 * 流程图证据 Schema
 * 用于记录流程中各个元素的证据来源
 */
export const FlowchartEvidenceSchema = z.object({
  /** 证据唯一标识 */
  id: z.string().min(1),
  /** 证据类型 */
  type: FlowchartEvidenceType,
  /** 证据来源类型 */
  sourceType: FlowchartEvidenceSourceType,
  /** 证据来源文件路径（当 sourceType 为 source_code 时） */
  filePath: z.string().optional(),
  /** 证据相关的代码行号范围（当 sourceType 为 source_code 时） */
  lineNumbers: z.array(z.number()).optional(),
  /** API 路径（当 sourceType 为 api_documentation 或 runtime_trace 时） */
  apiPath: z.string().optional(),
  /** 数据库表名（当 sourceType 为 database 时） */
  tableName: z.string().optional(),
  /** 相关字段名列表 */
  fieldNames: z.array(z.string()).optional(),
  /** 证据置信度（0-1） */
  confidence: z.number().min(0).max(1),
  /** 证据是否已确认 */
  confirmed: z.boolean(),
  /** 证据描述 */
  description: z.string().optional(),
  /** 证据创建时间 */
  createdAt: z.string().datetime().optional(),
  /** 附加元数据 */
  metadata: z.record(z.unknown()).optional()
});
export type FlowchartEvidence = z.infer<typeof FlowchartEvidenceSchema>;

// ============================================================
// Node Definition
// ============================================================

/**
 * 流程图节点 Schema
 * 表示流程图中的一个节点（活动、审批、事件等）
 */
export const FlowchartNodeSchema = z.object({
  /** 节点唯一标识 */
  id: z.string().min(1),
  /** 节点名称 */
  name: z.string().min(1),
  /** 节点类型 */
  type: FlowchartNodeType,
  /** 节点参与者的角色列表 */
  actors: z.array(z.string()).optional(),
  /** 节点关联的证据 ID 列表 */
  evidence: z.array(z.string()).optional(),
  /** 证据来源状态 */
  sourceStatus: SourceStatus,
  /** 节点描述 */
  description: z.string().optional(),
  /** 节点的输入参数 */
  inputParameters: z.record(z.unknown()).optional(),
  /** 节点的输出结果 */
  outputParameters: z.record(z.unknown()).optional(),
  /** 节点的配置项 */
  configurations: z.record(z.unknown()).optional(),
  /** 前端页面标识（当节点关联 UI 时） */
  frontEndPage: z.string().optional(),
  /** 后端服务标识（当节点关联服务时） */
  backEndService: z.string().optional(),
  /** 数据库操作标识 */
  databaseOperation: z.string().optional(),
  /** 节点的业务状态 */
  businessState: z.string().optional(),
  /** 节点的工作流状态 */
  workflowState: z.string().optional(),
  /** 节点的时限配置 */
  timeLimit: z.object({
    duration: z.number(),
    unit: z.enum(['seconds', 'minutes', 'hours', 'days'])
  }).optional(),
  /** 子节点 ID 列表（当节点为子流程时） */
  subProcessNodes: z.array(z.string()).optional(),
  /** 边界事件列表 */
  boundaryEvents: z.array(z.string()).optional()
});
export type FlowchartNode = z.infer<typeof FlowchartNodeSchema>;

// ============================================================
// Edge Definition
// ============================================================

/**
 * 流程图边 Schema
 * 表示流程图中节点之间的连接（流转、条件、分支等）
 */
export const FlowchartEdgeSchema = z.object({
  /** 起始节点 ID */
  from: z.string().min(1),
  /** 目标节点 ID */
  to: z.string().min(1),
  /** 流转条件表达式 */
  condition: z.string().optional(),
  /** 触发的事件 */
  event: z.string().optional(),
  /** 边关联的证据 ID 列表 */
  evidence: z.array(z.string()).optional(),
  /** 边的唯一标识（可选，用于区分同一对节点间的多条边） */
  id: z.string().optional(),
  /** 边的标签 */
  label: z.string().optional(),
  /** 是否为默认流转路径 */
  isDefault: z.boolean().optional(),
  /** 流转类型 */
  flowType: z.enum(['sequence', 'conditional', 'parallel', 'inclusive', 'exclusive']).optional(),
  /** 证据来源状态 */
  sourceStatus: SourceStatus,
  /** 边的描述 */
  description: z.string().optional()
});
export type FlowchartEdge = z.infer<typeof FlowchartEdgeSchema>;

// ============================================================
// Metadata
// ============================================================

/**
 * 流程图元数据 Schema
 * 包含流程的基本信息和采集信息
 */
export const FlowchartMetadataSchema = z.object({
  /** 流程名称 */
  name: z.string().min(1),
  /** 流程编码 */
  processCode: z.string().min(1),
  /** 流程采集时间 */
  collectedAt: z.string().datetime(),
  /** 采集器版本 */
  collectorVersion: z.string().optional(),
  /** 流程描述 */
  description: z.string().optional(),
  /** 流程分类 */
  category: z.string().optional(),
  /** 流程版本 */
  version: z.string().optional(),
  /** 流程负责人 */
  owner: z.string().optional(),
  /** 业务流程编号 */
  businessProcessId: z.string().optional()
});
export type FlowchartMetadata = z.infer<typeof FlowchartMetadataSchema>;

// ============================================================
// Exception Branches
// ============================================================

/**
 * 例外分支 Schema
 * 描述流程中的异常分支、替代路径等
 */
export const ExceptionBranchSchema = z.object({
  /** 分支唯一标识 */
  id: z.string().min(1),
  /** 分支名称 */
  name: z.string().min(1),
  /** 分支描述 */
  description: z.string().optional(),
  /** 分支类型 */
  type: z.enum([
    'error_handling',
    'alternative_path',
    'compensation',
    'escalation',
    'termination',
    'suspension',
    'retry'
  ]),
  /** 触发条件 */
  triggerCondition: z.string().optional(),
  /** 起始节点 ID */
  startNodeId: z.string(),
  /** 结束节点 ID */
  endNodeId: z.string(),
  /** 关联的正常流程节点 ID */
  relatedMainNodeIds: z.array(z.string()).optional(),
  /** 证据 ID 列表 */
  evidence: z.array(z.string()).optional(),
  /** 来源状态 */
  sourceStatus: SourceStatus
});
export type ExceptionBranch = z.infer<typeof ExceptionBranchSchema>;

// ============================================================
// Complete Flowchart Document
// ============================================================

/**
 * 流程图成果物 Schema
 * 完整的流程采集成果物，包含所有元数据、节点、边、角色等信息
 */
export const FlowchartDocumentSchema = z.object({
  /** Schema 版本号 */
  schemaVersion: z.string().default('1.0'),
  /** 流程元数据 */
  metadata: FlowchartMetadataSchema,
  /** 主流程路径节点 ID 列表（按顺序） */
  mainPath: z.array(z.string()).min(1),
  /** 例外分支列表 */
  exceptionBranches: z.array(ExceptionBranchSchema).optional(),
  /** 流程角色列表 */
  roles: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    permissions: z.array(z.string()).optional()
  })).optional(),
  /** 前端页面列表 */
  frontEndPages: z.array(z.object({
    pageId: z.string(),
    pageName: z.string(),
    route: z.string().optional(),
    relatedNodes: z.array(z.string())
  })).optional(),
  /** 后端服务列表 */
  backEndServices: z.array(z.object({
    serviceId: z.string(),
    serviceName: z.string(),
    endpoint: z.string().optional(),
    relatedNodes: z.array(z.string())
  })).optional(),
  /** 数据库表列表 */
  databaseTables: z.array(z.object({
    tableName: z.string(),
    tableComment: z.string().optional(),
    relatedNodes: z.array(z.string()),
    relatedOperations: z.array(z.enum(['create', 'read', 'update', 'delete', 'query']))
  })).optional(),
  /** 业务状态机定义 */
  businessStateMachine: z.object({
    states: z.array(z.string()),
    initialState: z.string(),
    finalStates: z.array(z.string()),
    transitions: z.array(z.object({
      from: z.string(),
      to: z.string(),
      event: z.string().optional(),
      condition: z.string().optional()
    }))
  }).optional(),
  /** 工作流状态机定义 */
  workflowStateMachine: z.object({
    states: z.array(z.string()),
    initialState: z.string(),
    finalStates: z.array(z.string()),
    transitions: z.array(z.object({
      from: z.string(),
      to: z.string(),
      event: z.string().optional(),
      condition: z.string().optional()
    }))
  }).optional(),
  /** 未确认项目列表 */
  unconfirmedItems: z.array(z.object({
    itemId: z.string(),
    itemType: z.enum(['node', 'edge', 'condition', 'actor', 'data']),
    description: z.string(),
    relatedNodeIds: z.array(z.string()).optional(),
    priority: z.enum(['high', 'medium', 'low']).optional()
  })).optional(),
  /** 缺失配置项列表 */
  missingConfigs: z.array(z.object({
    configKey: z.string(),
    configType: z.enum(['environment', 'credential', 'feature_flag', 'feature', 'integration']),
    description: z.string(),
    requiredForNodes: z.array(z.string()).optional()
  })).optional(),
  /** 所有节点定义 */
  nodes: z.array(FlowchartNodeSchema),
  /** 所有边定义 */
  edges: z.array(FlowchartEdgeSchema),
  /** 所有证据定义 */
  evidence: z.record(FlowchartEvidenceSchema)
});
export type FlowchartDocument = z.infer<typeof FlowchartDocumentSchema>;

// ============================================================
// Validation Functions
// ============================================================

/**
 * 验证流程图中所有节点 ID 都存在
 */
export function validateNodeReferences(document: FlowchartDocument): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(document.nodes.map(n => n.id));
  
  for (const nodeId of document.mainPath) {
    if (!nodeIds.has(nodeId)) {
      errors.push(`mainPath references undefined node: ${nodeId}`);
    }
  }
  
  for (const edge of document.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`edge from "${edge.from}" references undefined node`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`edge to "${edge.to}" references undefined node`);
    }
  }
  
  for (const exception of document.exceptionBranches || []) {
    if (!nodeIds.has(exception.startNodeId)) {
      errors.push(`exception branch "${exception.id}" startNodeId references undefined node`);
    }
    if (!nodeIds.has(exception.endNodeId)) {
      errors.push(`exception branch "${exception.id}" endNodeId references undefined node`);
    }
  }
  
  return errors;
}

/**
 * 验证证据引用
 */
export function validateEvidenceReferences(document: FlowchartDocument): string[] {
  const errors: string[] = [];
  const evidenceIds = new Set(Object.keys(document.evidence));
  
  for (const node of document.nodes) {
    for (const evidenceId of node.evidence || []) {
      if (!evidenceIds.has(evidenceId)) {
        errors.push(`node "${node.id}" references undefined evidence: ${evidenceId}`);
      }
    }
  }
  
  for (const edge of document.edges) {
    for (const evidenceId of edge.evidence || []) {
      if (!evidenceIds.has(evidenceId)) {
        errors.push(`edge "${edge.from}" -> "${edge.to}" references undefined evidence: ${evidenceId}`);
      }
    }
  }
  
  return errors;
}

/**
 * 验证流程图完整性
 */
export function validateFlowchartDocument(data: unknown): { 
  valid: boolean; 
  errors?: string[] 
} {
  const result = FlowchartDocumentSchema.safeParse(data);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
    };
  }
  
  const document = result.data;
  const errors: string[] = [];
  
  errors.push(...validateNodeReferences(document));
  errors.push(...validateEvidenceReferences(document));
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true };
}
