import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { RecordingArtifactSchema } from './models/recording.js';
function unquote(value) {
    return value.replace(/^['"]|['"]$/g, '');
}
function locatorFromExpression(expression) {
    const testId = expression.match(/getByTestId\(\s*(['"])(.*?)\1\s*\)/);
    if (testId)
        return `testid=${testId[2]}`;
    const role = expression.match(/getByRole\(\s*(['"])(.*?)\1(?:\s*,\s*\{\s*name:\s*(['"])(.*?)\3\s*\})?\s*\)/);
    if (role)
        return role[3] ? `role=${role[2]}[name=${role[4]}]` : `role=${role[2]}`;
    const label = expression.match(/getByLabel\(\s*(['"])(.*?)\1\s*\)/);
    if (label)
        return `label=${label[2]}`;
    const locator = expression.match(/locator\(\s*(['"])(.*?)\1\s*\)/);
    if (locator)
        return `locator=${locator[2]}`;
    return undefined;
}
function makeStep(line, sourceText, data, index) {
    return { id: `step-${index + 1}`, sourceLine: line, sourceText, ...data };
}
export function parsePlaywrightRecording(source, options = {}) {
    const steps = [];
    const warnings = [];
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const sourceText = lines[index].trim();
        const line = index + 1;
        if (!sourceText || sourceText.startsWith('//') || sourceText.startsWith('import ') || sourceText.startsWith('test('))
            continue;
        const goto = sourceText.match(/page\.goto\(\s*(['"])(.*?)\1\s*\)/);
        if (goto) {
            steps.push(makeStep(line, sourceText, { type: 'navigate', url: goto[2] }, steps.length));
            continue;
        }
        const fill = sourceText.match(/(page\..*?)\.fill\(\s*(['"])(.*?)\2\s*\)/);
        if (fill) {
            const locator = locatorFromExpression(fill[1]);
            if (locator)
                steps.push(makeStep(line, sourceText, { type: 'fill', locator, value: unquote(fill[3]) }, steps.length));
            else
                warnings.push(`Unsupported fill locator at line ${line}`);
            continue;
        }
        const click = sourceText.match(/(page\..*?)\.click\(\s*\)/);
        if (click) {
            const locator = locatorFromExpression(click[1]);
            if (locator)
                steps.push(makeStep(line, sourceText, { type: 'click', locator }, steps.length));
            else
                warnings.push(`Unsupported click locator at line ${line}`);
            continue;
        }
        const textAssertion = sourceText.match(/expect\(\s*(page\..*?)\s*\)\.toHaveText\(\s*(['"])(.*?)\2\s*\)/);
        if (textAssertion) {
            const locator = locatorFromExpression(textAssertion[1]);
            if (locator)
                steps.push(makeStep(line, sourceText, { type: 'assertion', locator, assertionType: 'text', expected: textAssertion[3] }, steps.length));
            else
                warnings.push(`Unsupported text assertion locator at line ${line}`);
            continue;
        }
        const valueAssertion = sourceText.match(/expect\(\s*(page\..*?)\s*\)\.toHaveValue\(\s*(['"])(.*?)\2\s*\)/);
        if (valueAssertion) {
            const locator = locatorFromExpression(valueAssertion[1]);
            if (locator)
                steps.push(makeStep(line, sourceText, { type: 'assertion', locator, assertionType: 'value', expected: valueAssertion[3] }, steps.length));
            else
                warnings.push(`Unsupported value assertion locator at line ${line}`);
            continue;
        }
        const visibleAssertion = sourceText.match(/expect\(\s*(page\..*?)\s*\)\.toBeVisible\(\s*\)/);
        if (visibleAssertion) {
            const locator = locatorFromExpression(visibleAssertion[1]);
            if (locator)
                steps.push(makeStep(line, sourceText, { type: 'assertion', locator, assertionType: 'visible', expected: 'true' }, steps.length));
            else
                warnings.push(`Unsupported visibility assertion locator at line ${line}`);
            continue;
        }
        const urlAssertion = sourceText.match(/expect\(\s*page\s*\)\.toHaveURL\(\s*(['"])(.*?)\1\s*\)/);
        if (urlAssertion) {
            steps.push(makeStep(line, sourceText, { type: 'assertion', assertionType: 'url', expected: urlAssertion[2] }, steps.length));
            continue;
        }
        if (sourceText.includes('await ') || sourceText.includes('expect(')) {
            const warning = `Unsupported statement at line ${line}: ${sourceText}`;
            warnings.push(warning);
            steps.push(makeStep(line, sourceText, { type: 'unsupported', warning }, steps.length));
        }
    }
    const sourceFile = options.sourceFile ?? 'recording.spec.ts';
    const metadata = {
        id: basename(sourceFile).replace(/\.[^.]+$/, ''),
        processId: options.metadata?.processId ?? 'unknown',
        sourceFile,
        baseUrl: options.metadata?.baseUrl,
        authFile: options.metadata?.authFile,
        playwrightVersion: options.metadata?.playwrightVersion,
        createdAt: options.metadata?.createdAt ?? new Date().toISOString(),
        status: options.metadata?.status ?? 'IMPORTED'
    };
    return RecordingArtifactSchema.parse({ metadata, steps, warnings });
}
export async function parsePlaywrightRecordingFile(filePath, options = {}) {
    return parsePlaywrightRecording(await readFile(filePath, 'utf8'), { ...options, sourceFile: options.sourceFile ?? filePath });
}
/** Backwards-compatible concise name used by CLI importers. */
export const parseRecordingFile = parsePlaywrightRecordingFile;
//# sourceMappingURL=recording-parser.js.map