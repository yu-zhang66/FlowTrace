/**
 * API Dual-Run Executor
 *
 * 支持新旧系统 API 的双跑、映射和语义对比
 */
/**
 * API Dual Runner
 */
export class ApiDualRunner {
    mappings = new Map();
    legacyAuth;
    currentAuth;
    defaultTimeout = 30000;
    constructor(options) {
        if (options?.mappings) {
            for (const mapping of options.mappings) {
                this.mappings.set(mapping.id, mapping);
            }
        }
        this.legacyAuth = options?.legacyAuth;
        this.currentAuth = options?.currentAuth;
        this.defaultTimeout = options?.defaultTimeout || 30000;
    }
    /**
     * 添加 API 映射
     */
    addMapping(mapping) {
        this.mappings.set(mapping.id, mapping);
    }
    /**
     * 批量添加 API 映射
     */
    addMappings(mappings) {
        for (const mapping of mappings) {
            this.addMapping(mapping);
        }
    }
    /**
     * 执行 API 双跑
     */
    async executeDualRun(actionType, legacyBaseUrl, currentBaseUrl, requestData) {
        const mapping = this.findMapping(actionType);
        if (!mapping) {
            throw new Error(`No API mapping found for action: ${actionType}`);
        }
        // 映射请求数据
        const mappedRequest = this.mapRequest(mapping, requestData);
        // 并行执行新旧 API 调用
        const [legacyResult, currentResult] = await Promise.all([
            this.callLegacyApi(mapping, legacyBaseUrl, mappedRequest),
            this.callCurrentApi(mapping, currentBaseUrl, mappedRequest)
        ]);
        // 比较结果
        const comparison = this.compareResults(mapping, legacyResult, currentResult);
        return { legacy: legacyResult, current: currentResult, comparison };
    }
    /**
     * 查找 API 映射
     */
    findMapping(actionType) {
        // 根据 action type 查找映射
        const mappingIdMap = {
            'SUBMIT': 'submitFinancing',
            'APPROVE': 'approveFinancing',
            'REJECT': 'rejectFinancing',
            'RETURN': 'returnFinancing',
            'WITHDRAW': 'withdrawFinancing',
            'TRANSFER': 'transferFinancing',
            'COUNTERSIGN': 'countersignFinancing',
            'COUNTERSIGN_COMPLETE': 'countersignCompleteFinancing'
        };
        const mappingId = mappingIdMap[actionType];
        if (mappingId) {
            return this.mappings.get(mappingId);
        }
        // 模糊匹配
        for (const [id, mapping] of this.mappings) {
            if (id.toLowerCase().includes(actionType.toLowerCase())) {
                return mapping;
            }
        }
        return undefined;
    }
    /**
     * 映射请求数据
     */
    mapRequest(mapping, data) {
        const result = {};
        for (const fieldMap of mapping.requestMapping) {
            const sourceValue = data[fieldMap.from];
            if (sourceValue !== undefined) {
                result[fieldMap.to] = this.transformValue(sourceValue, fieldMap.transform || 'none');
            }
            else if (fieldMap.defaultValue !== undefined) {
                result[fieldMap.to] = fieldMap.defaultValue;
            }
        }
        // 添加未映射但不在忽略列表中的字段
        for (const [key, value] of Object.entries(data)) {
            if (!mapping.requestMapping.some(m => m.from === key) &&
                !mapping.ignoredFields.includes(key)) {
                result[key] = value;
            }
        }
        return result;
    }
    /**
     * 转换字段值
     */
    transformValue(value, transform) {
        switch (transform) {
            case 'string':
                return String(value);
            case 'number':
                return Number(value);
            case 'boolean':
                return Boolean(value);
            case 'date':
                return new Date(value).toISOString();
            default:
                return value;
        }
    }
    /**
     * 调用旧系统 API
     */
    async callLegacyApi(mapping, baseUrl, data) {
        const startTime = Date.now();
        const url = `${baseUrl}${mapping.legacy.path}`;
        try {
            const response = await this.fetchWithTimeout(url, mapping.legacy.method, data, this.legacyAuth, mapping.timeout || this.defaultTimeout);
            return {
                success: response.ok,
                statusCode: response.status,
                duration: Date.now() - startTime,
                request: {
                    method: mapping.legacy.method,
                    path: mapping.legacy.path,
                    headers: {},
                    body: data
                },
                response: {
                    headers: {},
                    body: response.body,
                    normalizedBody: this.normalizeResponse(mapping, response.body)
                },
                rawData: { legacy: response.body }
            };
        }
        catch (error) {
            return {
                success: false,
                statusCode: 0,
                duration: Date.now() - startTime,
                request: {
                    method: mapping.legacy.method,
                    path: mapping.legacy.path,
                    headers: {},
                    body: data
                },
                response: {
                    headers: {},
                    body: null
                },
                error: error instanceof Error ? error.message : String(error),
                rawData: { legacy: null }
            };
        }
    }
    /**
     * 调用新系统 API
     */
    async callCurrentApi(mapping, baseUrl, data) {
        const startTime = Date.now();
        const url = `${baseUrl}${mapping.current.path}`;
        try {
            const response = await this.fetchWithTimeout(url, mapping.current.method, data, this.currentAuth, mapping.timeout || this.defaultTimeout);
            return {
                success: response.ok,
                statusCode: response.status,
                duration: Date.now() - startTime,
                request: {
                    method: mapping.current.method,
                    path: mapping.current.path,
                    headers: {},
                    body: data,
                    mappedBody: data
                },
                response: {
                    headers: {},
                    body: response.body,
                    normalizedBody: this.normalizeResponse(mapping, response.body)
                },
                rawData: { current: response.body }
            };
        }
        catch (error) {
            return {
                success: false,
                statusCode: 0,
                duration: Date.now() - startTime,
                request: {
                    method: mapping.current.method,
                    path: mapping.current.path,
                    headers: {},
                    body: data,
                    mappedBody: data
                },
                response: {
                    headers: {},
                    body: null
                },
                error: error instanceof Error ? error.message : String(error),
                rawData: { current: null }
            };
        }
    }
    /**
     * 发送 HTTP 请求
     */
    async fetchWithTimeout(url, method, body, auth, timeout) {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (auth) {
            switch (auth.type) {
                case 'bearer':
                    headers['Authorization'] = `Bearer ${auth.token}`;
                    break;
                case 'basic':
                    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
                    headers['Authorization'] = `Basic ${encoded}`;
                    break;
                case 'api-key':
                    headers['X-API-Key'] = auth.apiKey || '';
                    break;
            }
        }
        const response = await fetch(url, {
            method,
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeout || this.defaultTimeout)
        });
        let responseBody;
        try {
            responseBody = await response.json();
        }
        catch {
            responseBody = await response.text();
        }
        return {
            ok: response.ok,
            status: response.status,
            body: responseBody
        };
    }
    /**
     * 标准化响应数据
     */
    normalizeResponse(mapping, body) {
        if (typeof body !== 'object' || body === null) {
            return { raw: body };
        }
        const result = {};
        const response = body;
        // 应用响应映射
        for (const fieldMap of mapping.responseMapping) {
            const sourceValue = response[fieldMap.from];
            if (sourceValue !== undefined) {
                result[fieldMap.to] = this.transformValue(sourceValue, fieldMap.transform || 'none');
            }
        }
        // 添加不在忽略列表且不在映射中的字段
        for (const [key, value] of Object.entries(response)) {
            if (!mapping.responseMapping.some(m => m.from === key) &&
                !mapping.ignoredFields.includes(key)) {
                result[key] = value;
            }
        }
        return result;
    }
    /**
     * 比较 API 结果
     */
    compareResults(mapping, legacy, current) {
        const differences = [];
        const technicalDiffs = {
            httpDiff: mapping.legacy.method !== mapping.current.method,
            fieldNameDiff: false,
            fieldStructureDiff: false,
            statusCodeDiff: legacy.statusCode !== current.statusCode,
            errorCodeDiff: false
        };
        // 状态码比较
        const statusCodeDiff = {
            legacy: legacy.statusCode,
            current: current.statusCode,
            same: legacy.statusCode === current.statusCode
        };
        // HTTP 方法差异
        if (technicalDiffs.httpDiff) {
            differences.push({
                category: 'http',
                description: `HTTP 方法不一致: 旧=${mapping.legacy.method}, 新=${mapping.current.method}`,
                severity: 'P2',
                blocking: false
            });
        }
        // 状态码差异
        if (statusCodeDiff.same) {
            // 状态码相同，进一步比较响应体
            const legacyBody = legacy.response.normalizedBody || {};
            const currentBody = current.response.normalizedBody || {};
            this.compareObjects(legacyBody, currentBody, mapping, differences);
        }
        else {
            // 状态码不同
            const isBothSuccess = legacy.statusCode >= 200 && legacy.statusCode < 300 &&
                current.statusCode >= 200 && current.statusCode < 300;
            const isBothError = legacy.statusCode >= 400 && current.statusCode >= 400;
            if (!isBothSuccess && !isBothError) {
                differences.push({
                    category: 'status_code',
                    description: `HTTP 状态码不一致: 旧=${legacy.statusCode}, 新=${current.statusCode}`,
                    legacy: legacy.statusCode,
                    current: current.statusCode,
                    severity: isBothSuccess ? 'P0' : 'P1',
                    blocking: true
                });
            }
        }
        // 业务语义判断
        const semanticDiff = differences.some(d => d.severity === 'P0' || d.severity === 'P1');
        return {
            consistent: differences.filter(d => d.severity === 'P0' || d.severity === 'P1').length === 0,
            differences,
            statusCodeDiff,
            semanticDiff,
            technicalDiffs
        };
    }
    /**
     * 比较两个对象
     */
    compareObjects(legacy, current, mapping, differences) {
        const allKeys = new Set([...Object.keys(legacy), ...Object.keys(current)]);
        for (const key of allKeys) {
            // 跳过忽略字段
            if (mapping.ignoredFields.includes(key)) {
                continue;
            }
            const legacyValue = legacy[key];
            const currentValue = current[key];
            if (legacyValue === undefined) {
                differences.push({
                    category: 'field_value',
                    field: key,
                    current: currentValue,
                    description: `新系统包含旧系统不存在的字段: ${key}`,
                    severity: 'P3',
                    blocking: false
                });
            }
            else if (currentValue === undefined) {
                differences.push({
                    category: 'field_value',
                    field: key,
                    legacy: legacyValue,
                    description: `旧系统包含新系统不存在的字段: ${key}`,
                    severity: 'P3',
                    blocking: false
                });
            }
            else if (JSON.stringify(legacyValue) !== JSON.stringify(currentValue)) {
                // 值不同
                differences.push({
                    category: 'field_value',
                    field: key,
                    legacy: legacyValue,
                    current: currentValue,
                    description: `字段值不一致: ${key}`,
                    severity: 'P2',
                    blocking: false
                });
            }
        }
    }
}
/**
 * 创建 API 双跑器
 */
export function createApiDualRunner(options) {
    return new ApiDualRunner(options);
}
/**
 * 创建标准 API 映射
 */
export function createStandardMappings() {
    return [
        {
            id: 'submitFinancing',
            businessMeaning: '提交融资申请',
            legacy: { method: 'POST', path: '/api/v1/financing/submit' },
            current: { method: 'POST', path: '/api/v2/financing/apply' },
            requestMapping: [
                { from: 'financingAmount', to: 'amount' },
                { from: 'financingTerm', to: 'term' },
                { from: 'interestRate', to: 'rate' },
                { from: 'coreEnterprise', to: 'coreEnterpriseId' },
                { from: 'supplier', to: 'supplierId' },
                { from: 'contractId', to: 'contractNo' }
            ],
            responseMapping: [
                { from: 'applicationId', to: 'id' },
                { from: 'status', to: 'state' }
            ],
            ignoredFields: ['requestId', 'timestamp', 'traceId', 'clientIp'],
            expectedStatus: 200,
            timeout: 30000
        },
        {
            id: 'approveFinancing',
            businessMeaning: '审批融资申请',
            legacy: { method: 'POST', path: '/api/v1/financing/approve' },
            current: { method: 'POST', path: '/api/v2/financing/approve' },
            requestMapping: [
                { from: 'applicationId', to: 'id' },
                { from: 'approvedAmount', to: 'amount' },
                { from: 'comment', to: 'remark' }
            ],
            responseMapping: [
                { from: 'status', to: 'state' }
            ],
            ignoredFields: ['requestId', 'timestamp', 'traceId', 'approverId'],
            expectedStatus: 200,
            timeout: 30000
        },
        {
            id: 'rejectFinancing',
            businessMeaning: '拒绝融资申请',
            legacy: { method: 'POST', path: '/api/v1/financing/reject' },
            current: { method: 'POST', path: '/api/v2/financing/reject' },
            requestMapping: [
                { from: 'applicationId', to: 'id' },
                { from: 'reason', to: 'rejectReason' }
            ],
            responseMapping: [
                { from: 'status', to: 'state' }
            ],
            ignoredFields: ['requestId', 'timestamp', 'traceId'],
            expectedStatus: 200,
            timeout: 30000
        }
    ];
}
//# sourceMappingURL=api-dual-runner.js.map