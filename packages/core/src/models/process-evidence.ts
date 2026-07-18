export type EvidenceSourceType = 'source' | 'database' | 'page-recording' | 'runtime' | 'document' | 'ai';
export type PipelineStage = 'collect' | 'enhance' | 'confirm' | 'generate-cases' | 'validate-cases' | 'execute' | 'verify' | 'report' | 'analyze' | 'remediate';
export type PipelineStageStatus = 'pending' | 'running' | 'passed' | 'blocked' | 'waiting-confirmation' | 'failed';

export interface ProcessEvidence {
  id: string;
  type: EvidenceSourceType;
  path?: string;
  summary: string;
  extractedAt: string;
  confidence: number;
  data?: Record<string, unknown>;
}

export interface ProcessNodeEvidence {
  id: string;
  name: string;
  type: string;
  actors: string[];
  evidenceIds: string[];
  confidence: number;
  confirmed: boolean;
}

export interface ProcessTransitionEvidence {
  from: string;
  to: string;
  event: string;
  condition?: string;
  evidenceIds: string[];
  confidence: number;
  confirmed: boolean;
}

export interface ProcessEvidenceModel {
  schemaVersion: '1.0';
  taskId: string;
  projectId: string;
  processId: string;
  processName: string;
  collectedAt: string;
  sources: ProcessEvidence[];
  nodes: ProcessNodeEvidence[];
  transitions: ProcessTransitionEvidence[];
  unresolvedQuestions: string[];
  confidence: number;
  status: 'collected' | 'enhanced' | 'confirmed' | 'blocked';
}

export interface PipelineStageRecord {
  stage: PipelineStage;
  status: PipelineStageStatus;
  startedAt?: string;
  completedAt?: string;
  artifact?: string;
  message?: string;
}

export interface PipelineState {
  schemaVersion: '1.0';
  taskId: string;
  projectId: string;
  processId: string;
  createdAt: string;
  updatedAt: string;
  currentStage: PipelineStage;
  stages: PipelineStageRecord[];
}

export interface RemediationItem {
  id: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  description: string;
  relatedScenarioIds: string[];
  relatedNodeIds: string[];
  status: 'open' | 'in-progress' | 'resolved' | 'verified';
}
