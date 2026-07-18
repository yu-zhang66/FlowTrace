import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { loadTargetProjectConfig } from '@flowtrace/core';
import { normalizeRecording } from '@flowtrace/ai';
export function normalizeCasesCommand(options) {
    const projectRoot = resolve(process.cwd(), options.project ?? '.');
    const config = loadTargetProjectConfig(projectRoot);
    const recordingDir = join(config.flowtraceRoot, 'recordings');
    const inputs = options.input ? [resolve(projectRoot, options.input)] : (existsSync(recordingDir) ? readdirSync(recordingDir).filter(name => name.endsWith('.raw.json')).map(name => join(recordingDir, name)) : []);
    if (!inputs.length)
        throw new Error(`No raw recordings found under ${recordingDir}`);
    const outputDir = resolve(config.flowtraceRoot, 'scenarios');
    mkdirSync(outputDir, { recursive: true });
    const scenarios = inputs.flatMap(recordingPath => normalizeRecording({ recordingPath, process: options.process ?? config.processId }).scenarios);
    const output = options.output ? resolve(projectRoot, options.output) : join(outputDir, 'recorded-candidates.yaml');
    if (!output.startsWith(outputDir + '/') && output !== outputDir)
        throw new Error('Normalized scenarios must remain under .flowtrace/scenarios');
    writeFileSync(output, yaml.dump(scenarios), 'utf8');
    console.log(`Wrote ${scenarios.length} reviewable scenario candidate(s) to ${output}`);
}
//# sourceMappingURL=normalize-cases.js.map