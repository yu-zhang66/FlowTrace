import chalk from 'chalk';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { createRequire } from 'module';
import { TargetProjectLoader } from '@flowtrace/core';
export function buildRecordingMetadata(input) {
    return {
        id: input.id,
        processId: input.processId,
        url: input.url,
        specFile: input.specFile,
        authFile: input.authFile,
        createdAt: input.createdAt ?? new Date().toISOString(),
        playwrightVersion: input.playwrightVersion,
        status: 'RECORDED'
    };
}
const require = createRequire(import.meta.url);
function getPlaywrightVersion() {
    try {
        return require('@playwright/test/package.json').version;
    }
    catch {
        return 'unknown';
    }
}
function safeId(value) {
    return value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'recording';
}
function runCodegen(args, cwd) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn('npx', ['playwright', 'codegen', ...args], {
            cwd,
            stdio: 'inherit',
            env: process.env
        });
        child.once('error', reject);
        child.once('exit', code => resolvePromise(code ?? 1));
    });
}
export function resolveRecordingPath(recordingsDir, requested, fallbackName) {
    const base = resolve(recordingsDir);
    const candidate = requested === undefined ? resolve(base, fallbackName) : resolve(base, requested);
    const relativeCandidate = relative(base, candidate);
    if (requested !== undefined && (isAbsolute(requested) || relativeCandidate === '..' || relativeCandidate.startsWith(`..${sep}`))) {
        throw new Error(`Recording output must remain inside ${base}`);
    }
    const realBase = realpathSync(base);
    let existingParent = dirname(candidate);
    while (!existsSync(existingParent) && existingParent !== dirname(existingParent)) {
        existingParent = dirname(existingParent);
    }
    existingParent = realpathSync(existingParent);
    const parentRelative = relative(realBase, existingParent);
    if (parentRelative === '..' || parentRelative.startsWith(`..${sep}`)) {
        throw new Error(`Recording output must remain inside ${base}`);
    }
    if (existsSync(candidate)) {
        const candidateRelative = relative(realBase, realpathSync(candidate));
        if (candidateRelative === '..' || candidateRelative.startsWith(`..${sep}`)) {
            throw new Error(`Recording output must remain inside ${base}`);
        }
    }
    return candidate;
}
export async function recordCommand(options) {
    const projectRoot = resolve(process.cwd(), options.project ?? '.');
    if (!existsSync(projectRoot)) {
        console.error(chalk.red(`Project path does not exist: ${projectRoot}`));
        process.exitCode = 1;
        return;
    }
    let target;
    try {
        target = new TargetProjectLoader().load(projectRoot);
    }
    catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        console.error(chalk.gray(`Run: flowtrace init --project ${projectRoot}`));
        process.exitCode = 2;
        return;
    }
    const processId = options.process ?? target.config.pilot?.process ?? 'demo-process';
    if (!processId) {
        console.error(chalk.red('A process is required. Use --process <id>.'));
        process.exitCode = 2;
        return;
    }
    if (!options.url) {
        console.error(chalk.red('A starting URL is required. Use --url <url>.'));
        process.exitCode = 2;
        return;
    }
    const recordingsDir = join(target.flowtraceRoot, 'recordings');
    mkdirSync(recordingsDir, { recursive: true });
    const recordingId = safeId(options.output ? options.output.replace(/\.[^.]+$/, '') : processId);
    const specPath = resolveRecordingPath(recordingsDir, options.output, `${recordingId}.spec.ts`);
    const authPath = resolveRecordingPath(recordingsDir, options.auth, `${recordingId}-auth.json`);
    mkdirSync(dirname(specPath), { recursive: true });
    mkdirSync(dirname(authPath), { recursive: true });
    const args = [
        '--target=playwright-test',
        `--output=${specPath}`,
        `--save-storage=${authPath}`,
        options.url
    ];
    console.log(chalk.blue(`\nStarting Playwright recording for process: ${processId}`));
    console.log(chalk.gray(`Project: ${projectRoot}`));
    console.log(chalk.gray(`Spec output: ${relative(projectRoot, specPath)}`));
    console.log(chalk.gray(`Auth state output: ${relative(projectRoot, authPath)}`));
    const exitCode = await runCodegen(args, projectRoot).catch(error => {
        console.error(chalk.red(`Failed to start Playwright Codegen: ${error instanceof Error ? error.message : String(error)}`));
        return 1;
    });
    if (exitCode !== 0) {
        console.error(chalk.red(`Playwright Codegen exited with code ${exitCode}`));
        process.exitCode = exitCode;
        return;
    }
    const metadata = buildRecordingMetadata({
        id: recordingId,
        processId,
        url: options.url,
        specFile: relative(target.flowtraceRoot, specPath),
        authFile: relative(target.flowtraceRoot, authPath),
        playwrightVersion: getPlaywrightVersion()
    });
    const metadataPath = join(dirname(specPath), `${recordingId}.metadata.json`);
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    console.log(chalk.green(`✓ Recording metadata written: ${relative(projectRoot, metadataPath)}`));
}
//# sourceMappingURL=record.js.map