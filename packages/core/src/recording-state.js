import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const RECORDING_STATE_FILE = 'recording-state.json';
export function readRecordingState(flowtraceRoot) {
    try {
        const value = JSON.parse(readFileSync(join(flowtraceRoot, RECORDING_STATE_FILE), 'utf8'));
        if (!isRecordingState(value)) {
            return null;
        }
        return value;
    }
    catch {
        return null;
    }
}
export function writeRecordingState(flowtraceRoot, state) {
    const path = join(flowtraceRoot, RECORDING_STATE_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}
export function clearRecordingState(flowtraceRoot) {
    try {
        unlinkSync(join(flowtraceRoot, RECORDING_STATE_FILE));
    }
    catch {
        // Clearing an absent or already-removed state is intentionally idempotent.
    }
}
export function createConfirmedState(opts) {
    const now = new Date().toISOString();
    return {
        schemaVersion: 1,
        processId: opts.processId,
        status: 'CONFIRMED',
        artifact: opts.artifact,
        confirmedBy: opts.confirmedBy,
        confirmedAt: now,
        createdAt: now,
        updatedAt: now
    };
}
export function createRecordedState(opts) {
    const now = new Date().toISOString();
    return {
        schemaVersion: 1,
        processId: opts.processId,
        status: 'RECORDED',
        artifact: opts.artifact,
        confirmedBy: null,
        confirmedAt: null,
        createdAt: now,
        updatedAt: now
    };
}
export function createNotRecordedState(processId) {
    const now = new Date().toISOString();
    return {
        schemaVersion: 1,
        processId,
        status: 'NOT_RECORDED',
        artifact: null,
        confirmedBy: null,
        confirmedAt: null,
        createdAt: now,
        updatedAt: now
    };
}
function isRecordingState(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const state = value;
    return (typeof state.schemaVersion === 'number' &&
        typeof state.processId === 'string' &&
        isRecordingStatus(state.status) &&
        (typeof state.artifact === 'string' || state.artifact === null) &&
        (typeof state.confirmedBy === 'string' || state.confirmedBy === null) &&
        (typeof state.confirmedAt === 'string' || state.confirmedAt === null) &&
        typeof state.createdAt === 'string' &&
        typeof state.updatedAt === 'string');
}
function isRecordingStatus(value) {
    return value === 'NOT_RECORDED' || value === 'RECORDED' || value === 'CONFIRMED' || value === 'INVALID';
}
//# sourceMappingURL=recording-state.js.map