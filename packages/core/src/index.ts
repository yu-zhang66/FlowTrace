// Core exports
export * from './models/index.js';
export * from './config.js';
export * from './collector.js';
export * from './collector-loader.js';
export { 
  loadTargetProjectConfig, 
  validateTargetConfig, 
  resolveTargetPath,
  getFactsDir,
  getScenariosDir,
  getSemanticDir,
  getReportsDir,
  getExecutionsDir,
  getSourceRoot
} from './target-config.js';
export type {
  TargetProjectConfig,
  CollectorConfig as TargetCollectorConfig
} from './target-config.js';
export {
  resolveProcess,
  loadProcessMetadata,
  listProcessCandidates
} from './process-resolver.js';
export {
  computeStatus,
  summarizeStatus,
  statusFromError
} from './project-status.js';
export {
  runGate,
  gateForCommand
} from './command-gate.js';
export type { GateRequirement } from './command-gate.js';
export {
  readRecordingState,
  writeRecordingState,
  clearRecordingState,
  createConfirmedState,
  createRecordedState,
  createNotRecordedState
} from './recording-state.js';
export type { RecordingState } from './recording-state.js';
export {
  ensureReportCompleteness,
  createErrorVerificationRun
} from './report-gate.js';
export type { ReportCompletenessResult } from './report-gate.js';
export * from './coverage-engine.js';
export * from './recording-parser.js';
export {
  createRequiredEvent,
  createForbiddenEvent,
  createParallelEvent,
  createParallelSigningConstraint,
  createSemanticModelFromProcess,
  validateAgainstSemanticModel
} from './semantic-model.js';
export type {
  ConvergenceConditionType,
  ConvergenceCondition,
  ParallelBranch,
  ParallelSigningConstraint,
  SequentialSigningConstraint,
  BusinessInvariant,
  SemanticProcessModel,
  RoleDefinition,
  SemanticPathElement,
  SemanticComparisonResult,
  OrderDifference,
  ParallelDifference,
  ConstraintViolation
} from './semantic-model.js';
export { generateId } from './config.js';
export {
  ConfigChecker,
  createConfigChecker,
  quickConfigCheck,
  checkConfig
} from './config-checker.js';
export { runLoginPreflight } from './preflight.js';
export type { PreflightOptions, PreflightResult, PreflightTarget } from './preflight.js';
export type {
  ConfigCheckOptions,
  ConfigCheckResult,
  ConfigCheckResultType,
  P0ConfigKey,
  P1ConfigKey,
  P2ConfigKey
} from './config-checker.js';
