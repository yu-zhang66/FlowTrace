import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
export async function loadPlaywrightFlowAdapter(projectRoot, side, evidenceDir) {
    const configPath = join(resolve(projectRoot), '.flowtrace', 'adapters', `${side}-playwright-adapter.mjs`);
    const adaptersRoot = resolve(projectRoot, '.flowtrace', 'adapters');
    if (!resolve(configPath).startsWith(adaptersRoot + '/') || !existsSync(configPath))
        throw new Error(`Playwright adapter not found for ${side}: ${configPath}`);
    const module = await import(configPath);
    const factory = module.default ?? module[`create${side[0].toUpperCase()}${side.slice(1)}PlaywrightAdapter`] ?? module.createPlaywrightAdapter;
    if (typeof factory !== 'function')
        throw new Error(`Adapter ${configPath} must export a factory`);
    const adapter = await factory({ side, projectRoot: resolve(projectRoot), evidenceDir });
    if (!adapter || typeof adapter.executeAction !== 'function' || typeof adapter.cleanup !== 'function')
        throw new Error(`Adapter ${configPath} does not satisfy PlaywrightFlowAdapter`);
    return adapter;
}
export async function runPlaywrightDualRun(scenario, adapters, legacyShadow = false) {
    if (scenario.enabled === false || scenario.status === 'NEEDS_REVIEW' || scenario.review?.status === 'NEEDS_REVIEW')
        throw new Error(`Scenario ${scenario.id} is not confirmed/enabled`);
    await Promise.all([adapters.legacy.initialize(), adapters.current.initialize()]);
    try {
        await Promise.all([adapters.legacy.reset(), adapters.current.reset()]);
        for (const action of scenario.actions)
            await Promise.all([adapters.legacy.executeAction(action), adapters.current.executeAction(action)]);
        const [legacy, current] = await Promise.all([adapters.legacy.observe(), adapters.current.observe()]);
        const differences = [];
        if (legacy.finalState !== current.finalState)
            differences.push('finalState differs between legacy and current');
        if (scenario.expected.finalState !== 'UNKNOWN' && legacy.finalState !== scenario.expected.finalState)
            differences.push('legacy finalState does not match expected');
        if (scenario.expected.finalState !== 'UNKNOWN' && current.finalState !== scenario.expected.finalState)
            differences.push('current finalState does not match expected');
        return { mode: 'dual-browser', legacy, current, differences, legacyShadow };
    }
    finally {
        await Promise.allSettled([adapters.legacy.cleanup(), adapters.current.cleanup()]);
    }
}
//# sourceMappingURL=playwright-flow-contract.js.map