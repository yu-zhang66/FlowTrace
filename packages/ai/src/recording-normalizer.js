import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { generateId, ScenarioSchema, validateNoPlaintextSecrets } from '@flowtrace/core';
const ACTIONS = new Set(['SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'WITHDRAW', 'TRANSFER', 'COUNTERSIGN', 'COUNTERSIGN_COMPLETE', 'LOGIN']);
export function normalizeRecording(input) {
    const raw = JSON.parse(readFileSync(input.recordingPath, 'utf8'));
    const warnings = [...(raw.warnings ?? [])];
    const unmapped = [];
    const actions = (raw.steps ?? []).flatMap((step, index) => {
        const mapped = typeof step.businessAction === 'string' ? step.businessAction : undefined;
        if (!mapped || !ACTIONS.has(mapped)) {
            unmapped.push(`${step.sourceFile ?? basename(input.recordingPath)}:${step.sourceLine ?? index + 1}`);
            return [];
        }
        return [{ type: mapped, actor: input.actor ?? 'recorded-user', data: { provenance: { recording: raw.recordingId ?? basename(input.recordingPath), sourceLine: step.sourceLine ?? index + 1 } } }];
    });
    if (unmapped.length)
        warnings.push(`${unmapped.length} recording steps require business-action review`);
    const candidate = {
        id: generateId('recorded-scenario'), name: `Recorded ${input.process}`, process: input.process,
        severity: 'P2', actions: actions.length ? actions : [{ type: 'LOGIN', actor: input.actor ?? 'recorded-user', data: { usernameRef: 'FLOWTRACE_USERNAME', passwordRef: 'FLOWTRACE_PASSWORD' } }],
        expected: { finalState: 'UNKNOWN' }, status: 'NEEDS_REVIEW', enabled: false,
        review: { status: 'NEEDS_REVIEW', unmappedSteps: unmapped, warnings, reason: 'Recording-derived candidate requires human confirmation' },
        source: [`recordings/${basename(input.recordingPath)}`]
    };
    // Parse the execution fields first, then reattach review metadata so older
    // compiled core consumers cannot strip the formal review fields.
    const parsed = ScenarioSchema.parse(candidate);
    const scenario = { ...parsed, status: 'NEEDS_REVIEW', enabled: false, review: candidate.review };
    const security = validateNoPlaintextSecrets(scenario);
    if (!security.valid)
        throw new Error(`Normalization produced sensitive output: ${security.violations?.join(', ')}`);
    return { scenarios: [scenario], mode: 'deterministic', warnings };
}
//# sourceMappingURL=recording-normalizer.js.map