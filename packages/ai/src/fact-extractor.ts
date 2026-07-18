import type { AIProvider } from './provider.js';
import type { Fact, Evidence } from '@flowtrace/core';
import { generateId } from '@flowtrace/core';

export interface FactExtractorConfig {
  provider: AIProvider;
  confidenceThreshold?: number;
  extractMetadata?: boolean;
}

export interface ExtractionResult {
  facts: Fact[];
  warnings: string[];
  errors: string[];
}

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
  private provider: AIProvider;
  private config: FactExtractorConfig;

  constructor(provider: AIProvider, config: Partial<Omit<FactExtractorConfig, 'provider'>> = {}) {
    this.provider = provider;
    this.config = {
      provider: provider,
      confidenceThreshold: 0.7,
      extractMetadata: true,
      ...config
    };
  }

  async initialize(): Promise<void> {
    await this.provider.initialize();
  }

  async extractFromSource(
    sourceType: 'code' | 'documentation' | 'database' | 'api' | 'page',
    sourceContent: string,
    sourcePath?: string
  ): Promise<ExtractionResult> {
    const result: ExtractionResult = {
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
      const response = await this.provider.completeJSON<{ facts: Partial<Fact>[] }>({
        prompt,
        system: EXTRACTION_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 4096
      });

      for (const partial of response.facts || []) {
        const evidence: Evidence[] = [];

        if (sourcePath) {
          evidence.push({
            source: sourcePath,
            confidence: 0.85,
            extractedAt: new Date().toISOString()
          });
        }

        const fact: Fact = {
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
    } catch (error) {
      result.errors.push(`Extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  async extractFromCode(code: string, filePath: string): Promise<ExtractionResult> {
    return this.extractFromSource('code', code, filePath);
  }

  async extractFromDocumentation(doc: string, docPath: string): Promise<ExtractionResult> {
    return this.extractFromSource('documentation', doc, docPath);
  }

  mergeFacts(results: ExtractionResult[]): Fact[] {
    const merged: Fact[] = [];
    const seen = new Set<string>();

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
