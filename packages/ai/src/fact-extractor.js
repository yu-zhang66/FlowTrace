import { generateId } from '@flowtrace/core';
const EXTRACTION_SYSTEM_PROMPT = `You are a FlowTrace fact extractor specialized in analyzing legacy business processes and extracting structured facts.

Your role is to analyze source code, documentation, and runtime data to extract:
1. Process definitions (nodes, transitions, conditions)
2. Business rules (validation, approval conditions)
3. Roles and permissions
4. Data effects (database changes, API calls)
5. External system integrations
6. Page elements and UI flows

Each fact must include:
- Unique ID
- Type (process-definition, business-rule, role, etc.)
- Category (process_definition, rule, role, etc.)
- Name and description
- Content (structured JSON with relevant details)
- Evidence (source references with confidence scores)

Be precise and conservative. Only extract facts with clear evidence.`;
const EXTRACTION_USER_PROMPT = `Extract structured facts from the following legacy process source:

Source Type: {{sourceType}}
Source Content:
{{sourceContent}}

Extract facts in the following categories:
- process_definition: Process nodes, transitions, conditions
- rule: Business rules, validation logic
- role: User roles and permissions
- data_effect: Database changes and data impacts
- external_call: External system integrations

Output as JSON array of facts:`;
export class FactExtractor {
    provider;
    config;
    constructor(provider, config = {}) {
        this.provider = provider;
        this.config = {
            provider: provider,
            confidenceThreshold: 0.7,
            extractMetadata: true,
            ...config
        };
    }
    async initialize() {
        await this.provider.initialize();
    }
    async extractFromSource(sourceType, sourceContent, sourcePath) {
        const result = {
            facts: [],
            warnings: [],
            errors: []
        };
        const sourceTypeMap = {
            code: 'Source Code',
            documentation: 'Documentation',
            database: 'Database Schema',
            api: 'API Specification',
            page: 'UI Page'
        };
        const prompt = EXTRACTION_USER_PROMPT
            .replace('{{sourceType}}', sourceTypeMap[sourceType])
            .replace('{{sourceContent}}', sourceContent);
        try {
            const response = await this.provider.completeJSON({
                prompt,
                system: EXTRACTION_SYSTEM_PROMPT,
                temperature: 0.2,
                maxTokens: 4096
            });
            for (const partial of response.facts || []) {
                const evidence = [];
                if (sourcePath) {
                    evidence.push({
                        source: sourcePath,
                        confidence: 0.85,
                        extractedAt: new Date().toISOString()
                    });
                }
                const fact = {
                    id: partial.id || generateId('fact'),
                    type: partial.type || 'unknown',
                    category: partial.category || 'process_definition',
                    name: partial.name || 'Unnamed Fact',
                    description: partial.description,
                    content: partial.content || {},
                    evidence: evidence.length > 0 ? evidence : undefined,
                    reviewStatus: 'AUTO_EXTRACTED'
                };
                if (this.config.confidenceThreshold) {
                    const minConfidence = this.config.confidenceThreshold;
                    if (fact.evidence && fact.evidence[0]?.confidence < minConfidence) {
                        result.warnings.push(`Fact "${fact.name}" has low confidence (${fact.evidence[0]?.confidence})`);
                        continue;
                    }
                }
                result.facts.push(fact);
            }
        }
        catch (error) {
            result.errors.push(`Extraction failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return result;
    }
    async extractFromCode(code, filePath) {
        return this.extractFromSource('code', code, filePath);
    }
    async extractFromDocumentation(doc, docPath) {
        return this.extractFromSource('documentation', doc, docPath);
    }
    mergeFacts(results) {
        const merged = [];
        const seen = new Set();
        for (const result of results) {
            for (const fact of result.facts) {
                const key = `${fact.type}:${fact.name}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(fact);
                }
            }
        }
        return merged;
    }
}
//# sourceMappingURL=fact-extractor.js.map