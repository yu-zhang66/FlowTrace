/**
 * Structured command result model shared by every orchestration command.
 *
 * The dual-run / verification pipeline consumes the JSON form of this object.
 * Human-readable output is layered on top by each command but never diverges
 * from the contract documented in `command-orchestration` / `artifact-reporting`.
 */

import type { PipelineStage, PipelineStageStatus } from './process-evidence.js';

export type CommandCode =
  | 'OK'
  | 'NOT_INITIALIZED'
  | 'CONFIG_INCOMPLETE'
  | 'PROCESS_NOT_FOUND'
  | 'AMBIGUOUS_PROCESS'
  | 'RECORDING_NOT_FOUND'
  | 'RECORDING_NOT_CONFIRMED'
  | 'CASES_INVALID'
  | 'MISSING_CAPTCHA_CONFIG'
  | 'MISSING_ARTIFACT'
  | 'PIPELINE_FAILED';

export interface CommandArtifact {
  label: string;
  path: string;
  absolutePath: string;
  type: 'json' | 'markdown' | 'html' | 'evidence' | 'recording' | 'scenario' | 'config';
}

export interface ReleaseGate {
  allowed: boolean;
  blockedBy: string[];
  requiresHumanApproval?: boolean;
}

export interface CommandResult<T = unknown> {
  ok: boolean;
  code: CommandCode;
  project: {
    id: string;
    name: string;
    root: string;
  };
  process: {
    id: string | null;
    name: string | null;
    resolvedBy: 'explicit-id' | 'name' | 'alias' | 'natural-language' | 'default' | null;
    candidates: ProcessCandidate[];
  };
  runId: string | null;
  artifacts: CommandArtifact[];
  releaseGate: ReleaseGate;
  warnings: string[];
  missing: string[];
  remediation: string[];
  data?: T;
  startedAt: string;
  finishedAt: string;
}

export interface ProcessCandidate {
  id: string;
  name: string;
  aliases: string[];
  confidence: number;
  source: 'inventory' | 'metadata' | 'flow-record';
}

export interface ProcessResolution {
  ok: boolean;
  code: 'OK' | 'PROCESS_NOT_FOUND' | 'AMBIGUOUS_PROCESS';
  process: ProcessCandidate | null;
  candidates: ProcessCandidate[];
  matchedBy: ProcessCandidate['source'] | null;
  query: string;
}

export type ProjectStatusCode =
  | 'NOT_INITIALIZED'
  | 'INCOMPLETE_CONFIG'
  | 'PROCESS_NOT_FOUND'
  | 'RECORDING_PENDING'
  | 'RECORDING_NOT_CONFIRMED'
  | 'SCENARIOS_MISSING'
  | 'SCENARIOS_INVALID'
  | 'READY';

export type ProcessRecordingStatus =
  | 'NOT_RECORDED'
  | 'RECORDED'
  | 'CONFIRMED'
  | 'INVALID';

export interface StatusSnapshot {
  project: { id: string; name: string; root: string };
  status: ProjectStatusCode;
  config: {
    exists: boolean;
    path: string | null;
    missing: string[];
    warnings: string[];
  };
  recording: {
    processId: string | null;
    status: ProcessRecordingStatus;
    artifact: string | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
  } | null;
  scenarios: {
    count: number;
    valid: number;
    invalid: number;
    lastGenerated: string | null;
  };
  captcha: {
    configured: boolean;
    testModeEnabled: boolean;
    signingKeyConfigured: boolean;
    allowedOrigins: string[];
    missing: string[];
  };
  run: {
    runId: string | null;
    status: PipelineStageStatus | null;
    currentStage: PipelineStage | null;
    updatedAt: string | null;
  } | null;
}

export interface CapabilityListEntry {
  command: string;
  status: 'available' | 'blocked';
  reasons: string[];
}
