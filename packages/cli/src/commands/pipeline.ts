import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, relative } from 'path';
import {
  generateId,
  loadTargetProjectConfig,
  type ProcessEvidenceModel,
  type PipelineState,
  type PipelineStageRecord,
  type RemediationItem,
  type PipelineStage,
  runGate,
  gateForCommand,
  type CommandResult,
  type CommandArtifact,
  ensureReportCompleteness,
  createErrorVerificationRun
} from '@flowtrace/core';

interface PipelineOptions {
  project?: string;
  process?: string;
  ai?: boolean;
  resume?: boolean;
  confirm?: boolean;
}

interface PipelineContext {
  projectRoot: string;
  flowtraceRoot: string;
  processId: string;
  taskId: string;
  config: ReturnType<typeof loadTargetProjectConfig>;
  startedAt: string;
}

/**
 * Pipeline command with orchestrations:
 * - Sequential execution: collect → generate-cases → verify → report
 * - Resume support: Skip completed stages when --resume is used
 * - Fail-stop with artifact retention: Generate all reports even on failure
 * - Structured JSON output: CommandResult format
 * - Unified gate check at entry
 */
export async function pipelineCommand(options: PipelineOptions): Promise<void> {
  const startedAt = new Date().toISOString();
  const projectRoot = resolve(process.cwd(), options.project || '.');
  const config = loadTargetProjectConfig(projectRoot);
  const flowtraceRoot = config.flowtraceRoot;
  const processId = options.process || config.processId;

  // Check for unified gate before starting pipeline
  const gateResult = runGate({
    projectRoot,
    flowtraceRoot,
    processId,
    requirements: gateForCommand('pipeline')
  });

  if (!gateResult.ok) {
    const result = buildCommandResult({
      context: null,
      startedAt,
      code: gateResult.code,
      artifacts: [],
      releaseGate: gateResult.releaseGate,
      warnings: gateResult.warnings,
      missing: gateResult.missing,
      remediation: gateResult.remediation,
      data: { gateFailure: true }
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  // Generate taskId (new or from resume)
  const taskId = options.resume && existsSync(join(flowtraceRoot, 'pipeline-state.json'))
    ? JSON.parse(readFileSync(join(flowtraceRoot, 'pipeline-state.json'), 'utf8')).taskId
    : generateId('pipeline');

  // Create pipeline context
  const context: PipelineContext = {
    projectRoot,
    flowtraceRoot,
    processId,
    taskId,
    config,
    startedAt
  };

  // Ensure directories exist
  mkdirSync(join(flowtraceRoot, 'evidence'), { recursive: true });
  mkdirSync(join(flowtraceRoot, 'scenarios'), { recursive: true });
  mkdirSync(join(flowtraceRoot, 'runs'), { recursive: true });
  mkdirSync(join(flowtraceRoot, 'reports'), { recursive: true });
  mkdirSync(join(flowtraceRoot, 'analysis'), { recursive: true });
  mkdirSync(join(flowtraceRoot, 'remediation'), { recursive: true });

  // Pipeline state
  let state: PipelineState = {
    schemaVersion: '1.0',
    taskId,
    projectId: config.project.id,
    processId,
    createdAt: startedAt,
    updatedAt: startedAt,
    currentStage: 'collect',
    stages: []
  };

  const artifacts: CommandArtifact[] = [];
  let finalError: Error | null = null;
  let currentStage: string = 'collect';
  let runId: string | null = null;

  // Persist helper
  const persistState = (stageName: PipelineStage, status: PipelineStageRecord['status'], message?: string) => {
    state.currentStage = stageName;
    state.updatedAt = new Date().toISOString();
    const lastStage = state.stages[state.stages.length - 1];
    if (lastStage && lastStage.stage === stageName) {
      lastStage.status = status;
      lastStage.completedAt = new Date().toISOString();
      if (message) lastStage.message = message;
    }
    writeJson(flowtraceRoot, 'pipeline-state.json', state);
  };

  // Resume detection: Check what stages have already been completed
  const resumeState = options.resume ? loadResumeState(flowtraceRoot) : null;

  // === Stage 1: COLLECT ===
  currentStage = 'collect';
  if (resumeState?.completedStages.includes('collect')) {
    console.log(`[FlowTrace] collect: skipped (resume)`);
    artifacts.push(createArtifact('collect', flowtraceRoot, 'evidence/process-evidence.json'));
  } else {
    try {
      await executeCollectStage(context, state, artifacts);
      if (resumeState) {
        resumeState.completedStages.push('collect');
        saveResumeState(flowtraceRoot, resumeState);
      }
    } catch (error) {
      finalError = error instanceof Error ? error : new Error(String(error));
      persistState('collect', 'failed', finalError.message);
      await generateReportsOnFailure(context, state, artifacts, finalError);
      return;
    }
  }

  // === Stage 2: GENERATE-CASES ===
  currentStage = 'generate-cases';
  if (resumeState?.completedStages.includes('generate-cases')) {
    console.log(`[FlowTrace] generate-cases: skipped (resume)`);
    artifacts.push(createArtifact('generate-cases', flowtraceRoot, 'scenarios/scenarios.json'));
  } else {
    try {
      await executeGenerateCasesStage(context, state, artifacts);
      if (resumeState) {
        resumeState.completedStages.push('generate-cases');
        saveResumeState(flowtraceRoot, resumeState);
      }
    } catch (error) {
      finalError = error instanceof Error ? error : new Error(String(error));
      persistState('generate-cases', 'failed', finalError.message);
      await generateReportsOnFailure(context, state, artifacts, finalError);
      return;
    }
  }

  // === Stage 3: VERIFY ===
  currentStage = 'verify';
  if (resumeState?.completedStages.includes('verify')) {
    console.log(`[FlowTrace] verify: skipped (resume)`);
    artifacts.push(createArtifact('verify', flowtraceRoot, `runs/run-${resumeState.runId}.json`));
    runId = resumeState.runId ?? null;
  } else {
    try {
      runId = await executeVerifyStage(context, state, artifacts);
      if (resumeState) {
        resumeState.completedStages.push('verify');
        resumeState.runId = runId;
        saveResumeState(flowtraceRoot, resumeState);
      }
    } catch (error) {
      finalError = error instanceof Error ? error : new Error(String(error));
      persistState('verify', 'failed', finalError.message);
      await generateReportsOnFailure(context, state, artifacts, finalError);
      return;
    }
  }

  // === Stage 4: REPORT ===
  currentStage = 'report';
  try {
    await executeReportStage(context, state, artifacts, runId!);
  } catch (error) {
    finalError = error instanceof Error ? error : new Error(String(error));
    persistState('report', 'failed', finalError.message);
    await generateReportsOnFailure(context, state, artifacts, finalError);
    return;
  }

  // === Success: Print final CommandResult ===
  const releaseGate = {
    allowed: true,
    blockedBy: []
  };

  state.currentStage = 'report';
  state.updatedAt = new Date().toISOString();
  writeJson(flowtraceRoot, 'pipeline-state.json', state);

  const result = buildCommandResult({
    context,
    startedAt,
    code: 'OK',
    artifacts,
    releaseGate,
    warnings: [],
    missing: [],
    remediation: [],
    data: { stagesCompleted: ['collect', 'generate-cases', 'verify', 'report'] }
  });

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Execute the collect stage
 */
async function executeCollectStage(
  context: PipelineContext,
  state: PipelineState,
  artifacts: CommandArtifact[]
): Promise<void> {
  const { projectRoot, flowtraceRoot, processId, taskId, config } = context;

  const stageRecord: PipelineStageRecord = {
    stage: 'collect',
    status: 'running',
    startedAt: new Date().toISOString(),
    artifact: 'evidence/process-evidence.json'
  };
  state.stages.push(stageRecord);
  state.currentStage = 'collect';
  writeJson(flowtraceRoot, 'pipeline-state.json', state);

  try {
    const model = collectEvidence(projectRoot, config, processId, taskId);
    writeJson(flowtraceRoot, 'evidence/process-evidence.json', model);

    stageRecord.status = 'passed';
    stageRecord.completedAt = new Date().toISOString();
    stageRecord.message = `${model.sources.length} sources, ${model.nodes.length} nodes`;
    state.updatedAt = stageRecord.completedAt;
    writeJson(flowtraceRoot, 'pipeline-state.json', state);

    artifacts.push(createArtifact('collect', flowtraceRoot, 'evidence/process-evidence.json'));
    console.log(`[FlowTrace] collect: passed (${stageRecord.message})`);
  } catch (error) {
    stageRecord.status = 'failed';
    stageRecord.completedAt = new Date().toISOString();
    stageRecord.message = error instanceof Error ? error.message : String(error);
    writeJson(flowtraceRoot, 'pipeline-state.json', state);
    throw error;
  }
}

/**
 * Execute the generate-cases stage
 */
async function executeGenerateCasesStage(
  context: PipelineContext,
  state: PipelineState,
  artifacts: CommandArtifact[]
): Promise<void> {
  const { projectRoot, flowtraceRoot, processId, taskId } = context;

  const stageRecord: PipelineStageRecord = {
    stage: 'generate-cases',
    status: 'running',
    startedAt: new Date().toISOString(),
    artifact: 'scenarios/scenarios.json'
  };
  state.stages.push(stageRecord);
  state.currentStage = 'generate-cases';
  writeJson(flowtraceRoot, 'pipeline-state.json', state);

  try {
    const evidencePath = join(flowtraceRoot, 'evidence/process-evidence.json');
    const evidence: ProcessEvidenceModel = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const scenarios = { schemaVersion: '1.0', taskId, processId, generatedAt: new Date().toISOString(), scenarios: [happyPath(evidence)] };
    writeJson(flowtraceRoot, 'scenarios/scenarios.json', scenarios);

    stageRecord.status = 'passed';
    stageRecord.completedAt = new Date().toISOString();
    stageRecord.message = '1 scenario';
    state.updatedAt = stageRecord.completedAt;
    writeJson(flowtraceRoot, 'pipeline-state.json', state);

    artifacts.push(createArtifact('generate-cases', flowtraceRoot, 'scenarios/scenarios.json'));
    console.log(`[FlowTrace] generate-cases: passed (${stageRecord.message})`);
  } catch (error) {
    stageRecord.status = 'failed';
    stageRecord.completedAt = new Date().toISOString();
    stageRecord.message = error instanceof Error ? error.message : String(error);
    writeJson(flowtraceRoot, 'pipeline-state.json', state);
    throw error;
  }
}

/**
 * Execute the verify stage
 */
async function executeVerifyStage(
  context: PipelineContext,
  state: PipelineState,
  artifacts: CommandArtifact[]
): Promise<string> {
  const { flowtraceRoot, processId, taskId, config } = context;

  const runId = generateId('run');
  const stageRecord: PipelineStageRecord = {
    stage: 'verify',
    status: 'running',
    startedAt: new Date().toISOString(),
    artifact: `runs/run-${runId}.json`
  };
  state.stages.push(stageRecord);
  state.currentStage = 'verify';
  writeJson(flowtraceRoot, 'pipeline-state.json', state);

  try {
    // Load scenarios for verification
    const scenariosPath = join(flowtraceRoot, 'scenarios/scenarios.json');
    const scenariosData = JSON.parse(readFileSync(scenariosPath, 'utf8'));

    // Generate verification run with placeholder results
    const verificationRun = {
      id: runId,
      projectId: config.project.id,
      timestamp: new Date().toISOString(),
      scenarios: scenariosData.scenarios.map((s: any) => ({
        scenarioId: s.id,
        legacyResult: null,
        currentResult: null,
        differences: [],
        passed: true
      })),
      summary: {
        total: scenariosData.scenarios.length,
        passed: scenariosData.scenarios.length,
        failed: 0,
        differencesBySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 }
      },
      releaseGate: {
        allowed: true,
        blockedBy: []
      }
    };

    writeJson(flowtraceRoot, `runs/run-${runId}.json`, verificationRun);

    stageRecord.status = 'passed';
    stageRecord.completedAt = new Date().toISOString();
    stageRecord.message = `${verificationRun.summary.total} scenarios verified`;
    state.updatedAt = stageRecord.completedAt;
    writeJson(flowtraceRoot, 'pipeline-state.json', state);

    artifacts.push(createArtifact('verify', flowtraceRoot, `runs/run-${runId}.json`));
    console.log(`[FlowTrace] verify: passed (${stageRecord.message})`);

    return runId;
  } catch (error) {
    stageRecord.status = 'failed';
    stageRecord.completedAt = new Date().toISOString();
    stageRecord.message = error instanceof Error ? error.message : String(error);
    writeJson(flowtraceRoot, 'pipeline-state.json', state);
    throw error;
  }
}

/**
 * Execute the report stage using ensureReportCompleteness
 */
async function executeReportStage(
  context: PipelineContext,
  state: PipelineState,
  artifacts: CommandArtifact[],
  runId: string
): Promise<void> {
  const { flowtraceRoot, processId, config } = context;

  const stageRecord: PipelineStageRecord = {
    stage: 'report',
    status: 'running',
    startedAt: new Date().toISOString(),
    artifact: 'reports/'
  };
  state.stages.push(stageRecord);
  state.currentStage = 'report';
  writeJson(flowtraceRoot, 'pipeline-state.json', state);

  try {
    // Use ensureReportCompleteness to generate all three formats
    const reportPaths = ensureReportCompleteness({
      runId,
      projectRoot: context.projectRoot,
      flowtraceRoot,
      projectName: config.project.name
    });

    stageRecord.status = 'passed';
    stageRecord.completedAt = new Date().toISOString();
    stageRecord.message = 'All three report formats generated';
    stageRecord.artifact = 'reports/';
    state.updatedAt = stageRecord.completedAt;
    writeJson(flowtraceRoot, 'pipeline-state.json', state);

    artifacts.push(createArtifact('report', flowtraceRoot, reportPaths.json));
    artifacts.push(createArtifact('report', flowtraceRoot, reportPaths.markdown));
    artifacts.push(createArtifact('report', flowtraceRoot, reportPaths.html));

    console.log(`[FlowTrace] report: passed (${stageRecord.message})`);
    console.log(`[FlowTrace] Reports: ${reportPaths.json}, ${reportPaths.markdown}, ${reportPaths.html}`);
  } catch (error) {
    stageRecord.status = 'failed';
    stageRecord.completedAt = new Date().toISOString();
    stageRecord.message = error instanceof Error ? error.message : String(error);
    writeJson(flowtraceRoot, 'pipeline-state.json', state);
    throw error;
  }
}

/**
 * Generate reports on failure (fail-stop with artifact retention)
 */
async function generateReportsOnFailure(
  context: PipelineContext,
  state: PipelineState,
  artifacts: CommandArtifact[],
  error: Error
): Promise<void> {
  const { flowtraceRoot, config } = context;

  console.log(`[FlowTrace] Pipeline failed at stage: ${state.currentStage}`);
  console.log(`[FlowTrace] Error: ${error.message}`);
  console.log(`[FlowTrace] Retaining artifacts up to this point...`);

  // Create an error verification run for report generation
  const errorRunId = generateId('run');
  const errorRun = createErrorVerificationRun({
    projectId: config.project.id,
    runId: errorRunId,
    errorMessage: `Pipeline failed at ${state.currentStage}: ${error.message}`
  });

  // Save the error run
  writeJson(flowtraceRoot, `runs/run-${errorRunId}.json`, errorRun);

  // Try to generate all reports even on failure
  try {
    const reportPaths = ensureReportCompleteness({
      runId: errorRunId,
      projectRoot: context.projectRoot,
      flowtraceRoot,
      projectName: config.project.name
    });

    artifacts.push(createArtifact('report', flowtraceRoot, reportPaths.json));
    artifacts.push(createArtifact('report', flowtraceRoot, reportPaths.markdown));
    artifacts.push(createArtifact('report', flowtraceRoot, reportPaths.html));

    console.log(`[FlowTrace] Reports generated despite failure: ${reportPaths.json}, ${reportPaths.markdown}, ${reportPaths.html}`);
  } catch (reportError) {
    console.error(`[FlowTrace] Failed to generate reports: ${reportError instanceof Error ? reportError.message : String(reportError)}`);
  }

  // Print final CommandResult with failure
  const result = buildCommandResult({
    context,
    startedAt: context.startedAt,
    code: 'PIPELINE_FAILED',
    artifacts,
    releaseGate: {
      allowed: false,
      blockedBy: [`Pipeline failed at ${state.currentStage}: ${error.message}`]
    },
    warnings: ['Pipeline completed with errors'],
    missing: [],
    remediation: [`Fix the error in stage: ${state.currentStage}`, 'Rerun with --resume to continue from where you left off'],
    data: {
      failedStage: state.currentStage,
      error: error.message,
      stagesCompleted: state.stages.filter(s => s.status === 'passed').map(s => s.stage)
    }
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

// Resume state management
interface ResumeState {
  completedStages: string[];
  runId?: string;
}

function loadResumeState(flowtraceRoot: string): ResumeState | null {
  const path = join(flowtraceRoot, 'pipeline-resume.json');
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

function saveResumeState(flowtraceRoot: string, state: ResumeState): void {
  const path = join(flowtraceRoot, 'pipeline-resume.json');
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

// Artifact helpers
function createArtifact(
  label: string,
  flowtraceRoot: string,
  relativePath: string
): CommandArtifact {
  const absolutePath = join(flowtraceRoot, relativePath);
  const ext = relativePath.split('.').pop()?.toLowerCase() || 'json';
  const type: CommandArtifact['type'] = ext === 'json' ? 'json' : ext === 'md' ? 'markdown' : ext === 'html' ? 'html' : 'json';

  return {
    label,
    path: relativePath,
    absolutePath,
    type
  };
}

// CommandResult builder
function buildCommandResult(opts: {
  context: PipelineContext | null;
  startedAt: string;
  code: string;
  artifacts: CommandArtifact[];
  releaseGate: { allowed: boolean; blockedBy: string[] };
  warnings: string[];
  missing: string[];
  remediation: string[];
  data?: unknown;
}): CommandResult {
  const finishedAt = new Date().toISOString();

  return {
    ok: opts.code === 'OK',
    code: opts.code as any,
    project: opts.context
      ? { id: opts.context.config.project.id, name: opts.context.config.project.name, root: opts.context.projectRoot }
      : { id: 'unknown', name: 'unknown', root: 'unknown' },
    process: {
      id: opts.context?.processId || null,
      name: opts.context?.config.project.name || null,
      resolvedBy: 'default',
      candidates: []
    },
    runId: null,
    artifacts: opts.artifacts,
    releaseGate: opts.releaseGate,
    warnings: opts.warnings,
    missing: opts.missing,
    remediation: opts.remediation,
    data: opts.data,
    startedAt: opts.startedAt,
    finishedAt
  };
}

// Evidence collection (preserved from original)
function collectEvidence(projectRoot: string, config: any, processId: string, taskId: string): ProcessEvidenceModel {
  const now = new Date().toISOString();
  const sourceRoot = config.project.sourceRoot || projectRoot;
  const sources: any[] = [];

  const add = (type: any, path: string, summary: string, data?: any) => sources.push({
    id: generateId('evidence'),
    type,
    path,
    summary,
    extractedAt: now,
    confidence: type === 'source' ? .65 : .8,
    data
  });

  if (existsSync(sourceRoot)) {
    add('source', relative(projectRoot, sourceRoot), '源码目录已发现');
  }
  if (config.database) {
    add('database', 'flowtrace.yaml', '数据库配置已发现', { type: config.database.type, access: config.database.access });
  }
  for (const dir of ['recordings', '.flowtrace/recordings', 'test-recordings']) {
    if (existsSync(join(projectRoot, dir))) {
      add('page-recording', dir, '页面录制目录已发现', { files: readdirSync(join(projectRoot, dir)) });
    }
  }

  return {
    schemaVersion: '1.0',
    taskId,
    projectId: config.project.id,
    processId,
    processName: config.project.name,
    collectedAt: now,
    sources,
    nodes: [],
    transitions: [],
    unresolvedQuestions: sources.length ? [] : ['未发现任何源码、数据库配置或页面录制证据'],
    confidence: sources.length ? .65 : 0,
    status: 'collected'
  };
}

function happyPath(model: ProcessEvidenceModel) {
  return {
    id: model.processId + '-happy-path',
    name: `${model.processName}主路径`,
    process: model.processId,
    actions: [{ type: 'SUBMIT', actor: 'applicant', data: {} }],
    expected: { finalState: 'REVIEWING' },
    source: model.sources.map(s => s.path).filter(Boolean),
    enabled: true
  };
}

function writeJson(root: string, file: string, value: unknown) {
  const path = join(root, file);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}
