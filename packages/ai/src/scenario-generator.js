import { generateId } from '@flowtrace/core';
const SCENARIO_SYSTEM_PROMPT = `You are a FlowTrace scenario generator specialized in creating test scenarios for business process verification.

Your role is to generate structured test scenarios that:
1. Cover normal/happy-path flows
2. Cover boundary conditions and edge cases
3. Cover rejection, return, and withdraw scenarios
4. Cover permission scenarios
5. Cover external system failure scenarios

Each scenario must:
- Have a unique ID
- Have a clear, descriptive name
- Specify the business actions (SUBMIT, APPROVE, REJECT, RETURN, WITHDRAW, TRANSFER, COUNTERSIGN)
- Specify actors for each action
- Define expected final state and semantic path
- Reference source facts for evidence

Output must be valid JSON matching the FlowTrace scenario schema.`;
const SCENARIO_USER_PROMPT = `Based on the following approved process facts, generate test scenarios for the {{processName}} process.

Facts:
{{facts}}

Requirements:
- Generate scenarios covering: normal flow, boundary conditions, rejections, returns, permissions
- Each scenario should reference the fact IDs that support it
- Use appropriate severity levels (P0 for critical business paths, P1 for important paths, P2/P3 for minor variations)
- Output valid JSON array of scenarios

Generate scenarios:`;
export class ScenarioGenerator {
    provider;
    config;
    constructor(provider, config = {}) {
        this.provider = provider;
        this.config = {
            provider: provider,
            validateWithFacts: true,
            maxScenarios: 20,
            ...config
        };
    }
    async initialize() {
        await this.provider.initialize();
    }
    async generateScenarios(facts, processName, options) {
        const factsJson = JSON.stringify(facts, null, 2);
        const prompt = SCENARIO_USER_PROMPT
            .replace('{{processName}}', processName)
            .replace('{{facts}}', factsJson);
        const response = await this.provider.completeJSON({
            prompt,
            system: SCENARIO_SYSTEM_PROMPT,
            temperature: 0.3,
            maxTokens: 4096
        });
        const scenarios = response.scenarios || [];
        const generated = [];
        for (const partial of scenarios.slice(0, this.config.maxScenarios)) {
            const scenario = {
                id: partial.id || generateId('scenario'),
                name: partial.name || 'Unnamed Scenario',
                process: partial.process || processName,
                severity: partial.severity || 'P2',
                source: partial.source || [],
                precondition: partial.precondition,
                input: partial.input,
                actions: partial.actions || [],
                expected: partial.expected || { finalState: 'UNKNOWN' },
                tags: partial.tags,
                enabled: true
            };
            const validation = this.validateScenario(scenario, facts);
            generated.push({
                scenario,
                validation
            });
        }
        return generated;
    }
    validateScenario(scenario, facts) {
        const errors = [];
        if (!scenario.id) {
            errors.push('Scenario must have an ID');
        }
        if (!scenario.name) {
            errors.push('Scenario must have a name');
        }
        if (!scenario.actions || scenario.actions.length === 0) {
            errors.push('Scenario must have at least one action');
        }
        for (const action of scenario.actions || []) {
            if (!action.type) {
                errors.push('Each action must have a type');
            }
            if (!action.actor) {
                errors.push('Each action must have an actor');
            }
        }
        if (!scenario.expected?.finalState) {
            errors.push('Scenario must have an expected finalState');
        }
        if (this.config.validateWithFacts && scenario.source) {
            for (const sourceRef of scenario.source) {
                const factId = sourceRef.replace('facts/baseline.json#', '');
                const exists = facts.some(f => f.id === factId);
                if (!exists) {
                    errors.push(`Referenced fact not found: ${factId}`);
                }
            }
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
    async explainDifference(legacyResult, currentResult, difference) {
        const prompt = `Analyze the following difference detected between legacy and current process implementations:

Category: ${difference.category}
Description: ${difference.description}

Legacy Result:
${JSON.stringify(legacyResult, null, 2)}

Current Result:
${JSON.stringify(currentResult, null, 2)}

Please provide a concise explanation of:
1. What the difference means from a business perspective
2. Potential root causes
3. Recommended actions

Keep the explanation practical and actionable.`;
        const response = await this.provider.complete({
            prompt,
            system: 'You are a business process analyst explaining technical differences in business terms.',
            temperature: 0.3,
            maxTokens: 1024
        });
        return response.content;
    }
}
//# sourceMappingURL=scenario-generator.js.map