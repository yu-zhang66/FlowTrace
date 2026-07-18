export * from './fact.js';
export * from './scenario.js';
export * from './execution.js';
export * from './difference.js';
export * from './browser.js';
export * from './enhanced-scenario.js';
export * from './semantic.js';
export * from './api-execution.js';
export * from './login-execution.js';
export * from './recording.js';
export * from './command-result.js';
export {
  ScenarioResultSchema,
  type ScenarioResult,
  VerificationSummarySchema,
  type VerificationSummary,
  ReleaseGateSchema,
  type ReleaseGate as VerificationReleaseGate,
  VerificationRunSchema,
  type VerificationRun,
  type ReportOptions
} from './report.js';
export {
  ProcessEvidenceModel,
  type ProcessEvidence,
  type ProcessNodeEvidence,
  type ProcessTransitionEvidence,
  type EvidenceSourceType,
  type PipelineStage,
  type PipelineStageStatus,
  type PipelineStageRecord,
  type PipelineState,
  type RemediationItem
} from './process-evidence.js';
export {
  ProjectConfigSchema,
  type ProjectConfig,
  type DiscoveredProject
} from './config.js';

// ============================================================
// Flowchart Models (Flow Collection Artifact)
// ============================================================
export {
  PENDING_CONFIRMATION,
  UNCONFIRMED,
  FlowchartNodeType,
  SourceStatus,
  FlowchartEvidenceSourceType,
  FlowchartEvidenceType,
  FlowchartEvidenceSchema,
  type FlowchartEvidence,
  FlowchartNodeSchema,
  type FlowchartNode,
  FlowchartEdgeSchema,
  type FlowchartEdge,
  FlowchartMetadataSchema,
  type FlowchartMetadata,
  ExceptionBranchSchema,
  type ExceptionBranch,
  FlowchartDocumentSchema,
  type FlowchartDocument,
  validateNodeReferences,
  validateEvidenceReferences,
  validateFlowchartDocument
} from './flowchart.js';

// ============================================================
// Test Case Models (Test Case Artifact)
// ============================================================
export {
  PENDING_CONFIRMATION as TEST_CASE_PENDING_CONFIRMATION,
  UNCONFIRMED as TEST_CASE_UNCONFIRMED,
  CaseType,
  AccountType,
  TestEvidenceType,
  FailurePolicy,
  AccountSwitchStepSchema,
  type AccountSwitchStep,
  TestCaseStepSchema,
  type TestCaseStep,
  RequiredEnterpriseSchema,
  type RequiredEnterprise,
  RequiredCreditSchema,
  type RequiredCredit,
  ExpectedBusinessStateSchema,
  type ExpectedBusinessState,
  ExpectedFlowStateSchema,
  type ExpectedFlowState,
  ExpectedApprovalHistorySchema,
  type ExpectedApprovalHistory,
  ExpectedPostFlowSchema,
  type ExpectedPostFlow,
  DataCleanupStrategySchema,
  type DataCleanupStrategy,
  WorkflowNodeStatusSchema,
  type WorkflowNodeStatus,
  TestCaseSchema,
  type TestCase,
  validateStepReferences,
  validateAccountSwitchStep,
  validateTestCase
} from './test-case.js';

// ============================================================
// Verification Report Models (Test Report Artifact)
// ============================================================
export {
  ExecutionMode,
  AdapterMode,
  ConfigCheckStatus,
  MissingConfigItemSchema,
  type MissingConfigItem,
  ConfigWarningSchema,
  type ConfigWarning,
  ConfigCheckResultSchema,
  type ConfigCheckResult,
  StepResultStatus,
  StepResultSchema,
  type StepResult,
  AccountSwitchTimelineSchema,
  type AccountSwitchTimeline,
  ScreenshotMetadataSchema,
  type ScreenshotMetadata,
  BrowserTraceSchema,
  type BrowserTrace,
  ApiSummarySchema,
  type ApiSummary,
  DatabaseBeforeAfterSchema,
  type DatabaseBeforeAfter,
  CaseResultStatus,
  MissingConfigDetailsSchema,
  type MissingConfigDetails,
  CaseResultSchema,
  type CaseResult,
  ReleaseGateStatusSchema,
  type ReleaseGateStatus,
  VerificationReportMetadataSchema,
  type VerificationReportMetadata,
  LegacyShadowWarningSchema,
  type LegacyShadowWarning,
  VerificationReportSchema,
  type VerificationReport,
  validateReportStatistics,
  validateReleaseGateBlockers,
  validateVerificationReport
} from './verification-report.js';
