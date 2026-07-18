/**
 * Generic evidence writer for FlowTrace builtin runtime.
 *
 * Writes one JSON evidence frame per action under
 * `<evidenceRoot>/<side>/<scenarioId>/<NN>-<action>.json` using the canonical
 * frame schema (channel/side/scenarioId/actionIndex/action/actor/timestamp/
 * request{}/response{}/stateBefore/stateAfter/semanticPath). All inputs are
 * passed through the provided redactor so secrets never reach disk.
 *
 * MUST NOT contain any business identifier.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { RuntimeEvidenceFrame } from './types.js';
import type { Redactor } from './redaction.js';

export interface WriteEvidenceOptions {
  evidenceRoot: string;
  side: string;
  scenarioId: string;
  actionIndex: number;
  action: string;
  stepIndex?: number;
  actor?: string;
  request: RuntimeEvidenceFrame['request'];
  response: RuntimeEvidenceFrame['response'];
  stateBefore: string | null;
  stateAfter: string | null;
  semanticPath: string[];
  redactor: Redactor;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function safeActionSlug(action: string): string {
  return String(action).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'action';
}

export async function writeEvidenceFrame(opts: WriteEvidenceOptions): Promise<string | null> {
  if (!opts.evidenceRoot) return null;
  const scenarioDir = path.join(opts.evidenceRoot, opts.side, opts.scenarioId);
  await fs.mkdir(scenarioDir, { recursive: true });

  const stepSuffix = typeof opts.stepIndex === 'number' ? `-s${pad2(opts.stepIndex)}` : '';
  const filename = `${pad2(opts.actionIndex)}-${safeActionSlug(opts.action)}${stepSuffix}.json`;
  const filePath = path.join(scenarioDir, filename);

  const frame: RuntimeEvidenceFrame = {
    channel: opts.response === undefined ? 'browser' : 'http',
    side: opts.side,
    scenarioId: opts.scenarioId,
    actionIndex: opts.actionIndex,
    action: opts.action,
    actor: opts.actor,
    timestamp: new Date().toISOString(),
    request: {
      method: opts.request.method,
      url: opts.request.url,
      headers: opts.request.headers ? (opts.redactor.redactHeaders(opts.request.headers) as Record<string, unknown>) : undefined,
      body: opts.request.body !== undefined ? opts.redactor(opts.request.body) : undefined,
    },
    response: {
      status: opts.response.status ?? null,
      headers: opts.response.headers ? (opts.redactor.redactHeaders(opts.response.headers) as Record<string, unknown>) : undefined,
      body: opts.response.body !== undefined ? opts.redactor(opts.response.body) : undefined,
    },
    stateBefore: opts.stateBefore,
    stateAfter: opts.stateAfter,
    semanticPath: [...opts.semanticPath],
  };

  await fs.writeFile(filePath, JSON.stringify(frame, null, 2), 'utf8');
  return filePath;
}

/**
 * Append a screenshot evidence alongside the JSON frame under the same
 * `<NN>-<action>.png` filename. Returns the absolute path of the screenshot
 * file or null if no buffer was supplied.
 */
export async function writeEvidenceScreenshot(opts: {
  evidenceRoot: string;
  side: string;
  scenarioId: string;
  actionIndex: number;
  action: string;
  stepIndex?: number;
  buffer: Buffer | null;
}): Promise<string | null> {
  if (!opts.evidenceRoot || !opts.buffer) return null;
  const scenarioDir = path.join(opts.evidenceRoot, opts.side, opts.scenarioId);
  await fs.mkdir(scenarioDir, { recursive: true });
  const stepSuffix = typeof opts.stepIndex === 'number' ? `-s${pad2(opts.stepIndex)}` : '';
  const filename = `${pad2(opts.actionIndex)}-${safeActionSlug(opts.action)}${stepSuffix}.png`;
  const filePath = path.join(scenarioDir, filename);
  await fs.writeFile(filePath, opts.buffer);
  return filePath;
}