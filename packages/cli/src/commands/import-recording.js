import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, relative, resolve } from 'path';
import yaml from 'js-yaml';
import { loadTargetProjectConfig } from '@flowtrace/core';
import { parseRecordingFile } from '@flowtrace/core';
function locatorKey(step) {
    if (step.type !== 'click' && step.type !== 'fill' && step.type !== 'assertion')
        return undefined;
    return step.locator;
}
function loadMappings(projectRoot, path) {
    const mappingPath = path
        ? resolve(projectRoot, path)
        : resolve(projectRoot, '.flowtrace', 'mappings', 'browser-actions.yaml');
    if (!existsSync(mappingPath))
        return new Map();
    const parsed = yaml.load(readFileSync(mappingPath, 'utf8'));
    const entries = Array.isArray(parsed?.mappings) ? parsed.mappings : [];
    return new Map(entries.filter(entry => entry?.locator && entry?.semanticAction)
        .map(entry => [entry.locator, entry.semanticAction]));
}
function actionFromStep(step, mappings) {
    const key = locatorKey(step);
    return key ? mappings.get(key) : undefined;
}
function scenarioIdFromInput(input) {
    return basename(input).replace(/\.(spec|test)\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-');
}
function inferFinalState(assertions) {
    const stateAssertion = [...assertions].reverse().find(assertion => assertion.assertionType === 'text' &&
        assertion.locator === 'testid=process-state' &&
        typeof assertion.expected === 'string' &&
        assertion.expected.trim().length > 0);
    return typeof stateAssertion?.expected === 'string' ? stateAssertion.expected : 'UNKNOWN';
}
function buildScenario(projectRoot, processId, inputPath, recording, mappings) {
    const actions = [];
    const assertions = [];
    const unmapped = [];
    for (const [index, step] of recording.steps.entries()) {
        const semanticAction = actionFromStep(step, mappings);
        if (semanticAction) {
            actions.push({
                type: semanticAction,
                actor: 'REVIEW_REQUIRED',
                confirmed: false,
                sourceStep: index,
                sourceLine: step.sourceLine
            });
        }
        else if (step.type === 'click' || step.type === 'fill') {
            unmapped.push(`${step.type} ${step.locator}`);
        }
        if (step.type === 'assertion') {
            assertions.push({
                after: semanticAction,
                locator: step.locator,
                assertionType: step.assertionType,
                expected: step.expected,
                sourceStep: index,
                sourceLine: step.sourceLine
            });
        }
    }
    const finalExpected = inferFinalState(assertions);
    const id = scenarioIdFromInput(inputPath);
    return {
        scenario: {
            id,
            name: id,
            process: processId,
            status: 'NEEDS_REVIEW',
            source: [relative(resolve(process.cwd()), inputPath)],
            sourceRecording: relative(resolve(projectRoot, '.flowtrace'), inputPath),
            actions,
            assertions,
            expected: {
                finalState: typeof finalExpected === 'string' ? finalExpected : 'UNKNOWN'
            },
            enabled: false,
            review: {
                status: 'NEEDS_REVIEW',
                unmappedSteps: unmapped,
                warnings: recording.warnings,
                reason: 'Imported recordings require explicit business-action and actor confirmation.'
            }
        },
        unmapped
    };
}
export async function importRecordingCommand(options) {
    const projectRoot = resolve(process.cwd(), options.project ?? '.');
    const inputPath = resolve(projectRoot, options.input);
    if (!existsSync(inputPath)) {
        throw new Error(`Recording input not found: ${inputPath}`);
    }
    let target;
    try {
        target = loadTargetProjectConfig(projectRoot);
    }
    catch (error) {
        throw new Error(`Target project is not initialized: ${error instanceof Error ? error.message : String(error)}`);
    }
    const processId = options.process ?? target.pilot?.process ?? target.processId;
    if (!processId)
        throw new Error('A process is required: pass --process <id>.');
    const recording = await parseRecordingFile(inputPath, { metadata: { processId } });
    const recordingsDir = resolve(projectRoot, '.flowtrace', 'recordings');
    const scenariosDir = resolve(projectRoot, '.flowtrace', 'scenarios');
    mkdirSync(recordingsDir, { recursive: true });
    mkdirSync(scenariosDir, { recursive: true });
    const rawPath = resolve(recordingsDir, `${scenarioIdFromInput(inputPath)}.raw.json`);
    writeFileSync(rawPath, JSON.stringify(recording, null, 2) + '\n', 'utf8');
    const mappings = loadMappings(projectRoot, options.mapping);
    const { scenario, unmapped } = buildScenario(projectRoot, processId, inputPath, recording, mappings);
    const outputPath = options.output
        ? resolve(projectRoot, options.output)
        : resolve(scenariosDir, `${scenarioIdFromInput(inputPath)}.yaml`);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, yaml.dump(scenario, { noRefs: true, lineWidth: 120 }), 'utf8');
    console.log(chalk.green(`✓ Imported recording: ${inputPath}`));
    console.log(chalk.gray(`  Raw recording: ${rawPath}`));
    console.log(chalk.gray(`  Scenario draft: ${outputPath}`));
    console.log(chalk.yellow(`  Status: NEEDS_REVIEW`));
    if (unmapped.length > 0) {
        console.log(chalk.yellow(`  Unmapped steps: ${unmapped.length}`));
        for (const item of unmapped)
            console.log(chalk.gray(`    - ${item}`));
    }
}
//# sourceMappingURL=import-recording.js.map