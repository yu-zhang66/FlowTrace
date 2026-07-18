export class BaseAIProvider {
    initialized = false;
    async initialize() {
        this.initialized = true;
    }
    async completeJSON(request) {
        const response = await this.complete({
            ...request,
            temperature: request.temperature ?? 0.1
        });
        try {
            // Providers often wrap valid JSON in a Markdown code fence.
            const normalized = response.content
                .trim()
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
            const parsed = JSON.parse(normalized);
            return parsed;
        }
        catch (error) {
            throw new Error(`Failed to parse AI response as JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    validateOutput(data, schema) {
        return validateAgainstSchema(data, schema);
    }
}
export class OpenAIProvider extends BaseAIProvider {
    name = 'openai';
    config;
    constructor(config) {
        super();
        this.config = {
            model: 'gpt-4',
            timeout: 60000,
            maxRetries: 3,
            ...config
        };
    }
    async complete(request) {
        const url = `${this.config.baseUrl}/chat/completions`;
        const headers = {
            'Content-Type': 'application/json'
        };
        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }
        const body = {
            model: this.config.model,
            messages: [
                ...(request.system ? [{ role: 'system', content: request.system }] : []),
                { role: 'user', content: request.prompt }
            ],
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens ?? 2048,
            ...(request.stop ? { stop: request.stop } : {})
        };
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.config.timeout ?? 60000)
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        const choice = data.choices[0];
        if (!choice) {
            throw new Error('No completion choices returned');
        }
        return {
            content: choice.message.content,
            usage: {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens
            },
            model: this.config.model,
            finishReason: choice.finish_reason
        };
    }
}
export function createProvider(type, config) {
    switch (type) {
        case 'openai':
            return new OpenAIProvider(config);
        default:
            throw new Error(`Unknown provider type: ${type}`);
    }
}
/**
 * 验证数据是否符合 JSON Schema
 */
export function validateAgainstSchema(data, schema, path = 'root') {
    const errors = [];
    // 类型检查
    if (schema.type) {
        const typeError = validateType(data, schema.type, path);
        if (typeError) {
            errors.push(typeError);
        }
    }
    // 枚举检查
    if (schema.enum && data !== undefined) {
        if (!schema.enum.includes(data)) {
            errors.push({
                path,
                message: `Value must be one of: ${schema.enum.join(', ')}`,
                value: data
            });
        }
    }
    // 属性验证
    if (schema.properties && typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const obj = data;
        // 验证每个定义的属性
        for (const [key, propSchema] of Object.entries(schema.properties)) {
            const propPath = `${path}.${key}`;
            if (obj[key] !== undefined) {
                const propResult = validateAgainstSchema(obj[key], propSchema, propPath);
                errors.push(...propResult.errors || []);
            }
        }
        // 检查必需属性
        if (schema.required) {
            for (const required of schema.required) {
                if (!(required in obj)) {
                    errors.push({
                        path: `${path}.${required}`,
                        message: `Required property '${required}' is missing`,
                        value: undefined
                    });
                }
            }
        }
    }
    // 数组验证
    if (schema.items && Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
            const itemResult = validateAgainstSchema(data[i], schema.items, `${path}[${i}]`);
            errors.push(...itemResult.errors || []);
        }
    }
    // 字符串长度验证
    if (typeof data === 'string') {
        if (schema.minLength !== undefined && data.length < schema.minLength) {
            errors.push({
                path,
                message: `String must be at least ${schema.minLength} characters`,
                value: data
            });
        }
        if (schema.maxLength !== undefined && data.length > schema.maxLength) {
            errors.push({
                path,
                message: `String must be at most ${schema.maxLength} characters`,
                value: data
            });
        }
        if (schema.pattern) {
            const regex = new RegExp(schema.pattern);
            if (!regex.test(data)) {
                errors.push({
                    path,
                    message: `String must match pattern: ${schema.pattern}`,
                    value: data
                });
            }
        }
    }
    // 数字验证
    if (typeof data === 'number') {
        if (schema.minimum !== undefined && data < schema.minimum) {
            errors.push({
                path,
                message: `Number must be >= ${schema.minimum}`,
                value: data
            });
        }
        if (schema.maximum !== undefined && data > schema.maximum) {
            errors.push({
                path,
                message: `Number must be <= ${schema.maximum}`,
                value: data
            });
        }
    }
    // oneOf 验证
    if (schema.oneOf) {
        let validCount = 0;
        for (const subSchema of schema.oneOf) {
            const result = validateAgainstSchema(data, subSchema, path);
            if (result.valid) {
                validCount++;
            }
        }
        if (validCount !== 1) {
            errors.push({
                path,
                message: `Value must match exactly one of the provided schemas`,
                value: data
            });
        }
    }
    // allOf 验证
    if (schema.allOf) {
        for (const subSchema of schema.allOf) {
            const result = validateAgainstSchema(data, subSchema, path);
            errors.push(...result.errors || []);
        }
    }
    return {
        valid: errors.length === 0,
        data: errors.length === 0 ? data : undefined,
        errors: errors.length > 0 ? errors : undefined
    };
}
/**
 * 类型验证
 */
function validateType(data, expectedType, path) {
    let actualType;
    if (data === null) {
        actualType = 'null';
    }
    else if (Array.isArray(data)) {
        actualType = 'array';
    }
    else {
        actualType = typeof data;
    }
    // 特殊类型映射
    const typeMap = {
        string: ['string'],
        number: ['number', 'integer'],
        boolean: ['boolean'],
        object: ['object'],
        array: ['array'],
        null: ['null']
    };
    const validTypes = typeMap[expectedType] || [expectedType];
    if (!validTypes.includes(actualType)) {
        return {
            path,
            message: `Expected type '${expectedType}', got '${actualType}'`,
            value: data
        };
    }
    // 额外检查 integer
    if (expectedType === 'integer' && typeof data === 'number' && !Number.isInteger(data)) {
        return {
            path,
            message: `Expected integer, got float`,
            value: data
        };
    }
    return null;
}
/**
 * Scenario Schema for AI Case Generation
 */
export const ScenarioSchema = {
    type: 'object',
    properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        process: { type: 'string', minLength: 1 },
        severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
        source: { type: 'array', items: { type: 'string' } },
        input: { type: 'object' },
        actions: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    type: {
                        type: 'string',
                        enum: ['SUBMIT', 'APPROVE', 'REJECT', 'RETURN', 'WITHDRAW', 'TRANSFER', 'COUNTERSIGN', 'COUNTERSIGN_COMPLETE']
                    },
                    actor: { type: 'string', minLength: 1 },
                    data: { type: 'object' }
                },
                required: ['type', 'actor']
            }
        },
        expected: {
            type: 'object',
            properties: {
                finalState: { type: 'string' },
                semanticPath: { type: 'array', items: { type: 'string' } },
                database: { type: 'object' }
            },
            required: ['finalState']
        },
        tags: { type: 'array', items: { type: 'string' } },
        enabled: { type: 'boolean' }
    },
    required: ['id', 'name', 'process', 'actions', 'expected']
};
/**
 * 验证场景
 */
export function validateScenario(data) {
    return validateAgainstSchema(data, ScenarioSchema);
}
//# sourceMappingURL=provider.js.map