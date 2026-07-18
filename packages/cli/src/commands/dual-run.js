import { resolve, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { loadTargetProjectConfig, ScenarioSchema } from '@flowtrace/core';
import { loadPlaywrightFlowAdapter, runPlaywrightDualRun } from '@flowtrace/adapter';
export async function dualRunCommand(options) {
    const projectRoot = resolve(process.cwd(), options.project ?? '.');
    const config = loadTargetProjectConfig(projectRoot);
    const scenarioPath = resolve(projectRoot, options.scenario);
    const scenario = ScenarioSchema.parse(yaml.load(readFileSync(scenarioPath, 'utf8')));
    const evidenceDir = join(config.flowtraceRoot, 'executions', `dual-${Date.now()}`);
    mkdirSync(evidenceDir, { recursive: true });
    const adapters = {
        legacy: await loadPlaywrightFlowAdapter(projectRoot, 'legacy', evidenceDir),
        current: await loadPlaywrightFlowAdapter(projectRoot, 'current', evidenceDir)
    };
    const result = await runPlaywrightDualRun(scenario, adapters, options.legacyShadow ?? false);
    const output = join(evidenceDir, 'dual-run.json');
    writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');
    console.log(`Dual-run result: ${output}`);
}
//# sourceMappingURL=dual-run.js.map