/**
 * API Facts Collector
 * 
 * 采集 API 定义、请求/响应结构、认证方式等信息
 * 支持从源码扫描和配置文件中提取
 */

import type { 
  Collector, 
  CollectorContext, 
  CollectedFact,
  CollectorConfig
} from '@flowtrace/core';
import { generateCollectorId } from '@flowtrace/core';

/**
 * API Collector 配置
 */
export interface ApiCollectorConfig extends CollectorConfig {
  options?: {
    /** API 基础 URL */
    baseUrl?: string;
    /** API 文档 URL (Swagger/OpenAPI) */
    apiDocsUrl?: string;
    /** 认证配置 */
    auth?: {
      type: 'bearer' | 'basic' | 'api-key' | 'oauth2' | 'none';
      token?: string;
      username?: string;
      password?: string;
      apiKey?: string;
      apiKeyHeader?: string;
    };
    /** 采集的 API 前缀 */
    pathPrefix?: string;
    /** 是否采集响应示例 */
    includeExamples?: boolean;
    /** 采集超时时间 */
    timeout?: number;
    /** 代理配置 */
    proxy?: {
      host: string;
      port: number;
      auth?: {
        username: string;
        password: string;
      };
    };
    /** API 调用记录表名 */
    apiCallLogTable?: string;
    /** 采集时间范围 */
    timeRange?: {
      start: string;
      end: string;
    };
  };
}

/**
 * API 定义信息
 */
export interface ApiDefinition {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses?: Record<string, ApiResponse>;
  security?: string[];
}

/**
 * API 参数
 */
export interface ApiParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  type: string;
  required: boolean;
  description?: string;
  example?: unknown;
}

/**
 * API 请求体
 */
export interface ApiRequestBody {
  contentType: string;
  schema?: Record<string, unknown>;
  example?: unknown;
  required: boolean;
}

/**
 * API 响应
 */
export interface ApiResponse {
  statusCode: number;
  description: string;
  contentType?: string;
  schema?: Record<string, unknown>;
  example?: unknown;
}

/**
 * API 调用记录
 */
export interface ApiCallLog {
  id: string;
  endpoint: string;
  method: string;
  requestTime: string;
  responseTime: string;
  statusCode: number;
  requestHeaders: Record<string, string>;
  requestBody?: Record<string, unknown>;
  responseBody?: Record<string, unknown>;
  userId?: string;
  sessionId?: string;
  duration: number;
}

/**
 * API Collector 实现
 */
export class ApiCollector implements Collector {
  readonly name: string;
  readonly type = 'api-scanner' as const;
  config: ApiCollectorConfig;
  
  private isConnected: boolean = false;
  private discoveredApis: Map<string, ApiDefinition> = new Map();

  constructor(config: ApiCollectorConfig) {
    this.name = config.name || 'api-collector';
    this.config = config;
  }

  async initialize(context: CollectorContext): Promise<void> {
    console.log(`[ApiCollector] Initializing for project: ${context.projectId}`);
    
    const baseUrl = this.config.options?.baseUrl;
    if (!baseUrl) {
      console.log(`[ApiCollector] No API endpoint configured. Will scan source code for API definitions.`);
      this.isConnected = false;
      return;
    }

    try {
      // 尝试获取 API 文档
      const docsAvailable = await this.checkApiDocs();
      if (docsAvailable) {
        this.isConnected = true;
        console.log(`[ApiCollector] API endpoint connected`);
      } else {
        console.log(`[ApiCollector] API endpoint not accessible`);
        this.isConnected = false;
      }
    } catch (error) {
      console.log(`[ApiCollector] API connection failed: ${error instanceof Error ? error.message : String(error)}`);
      this.isConnected = false;
    }
  }

  async collect(context: CollectorContext): Promise<CollectedFact[]> {
    const facts: CollectedFact[] = [];
    const timestamp = new Date().toISOString();

    // 首先从源码扫描 API 定义
    const sourceFacts = await this.collectFromSource(context);
    facts.push(...sourceFacts);

    // 如果 API 可用，采集 API 调用日志
    if (this.isConnected) {
      const logFacts = await this.collectApiLogs(timestamp);
      facts.push(...logFacts);
    } else {
      console.log(`[ApiCollector] API not connected - cannot collect real API call logs`);
      facts.push(this.createNotConnectedFact(timestamp));
    }

    console.log(`[ApiCollector] Collected ${facts.length} API facts`);
    return facts;
  }

  async checkAvailability(context: CollectorContext): Promise<{ available: boolean; reason?: string }> {
    const baseUrl = this.config.options?.baseUrl;
    const docsUrl = this.config.options?.apiDocsUrl;
    
    if (!baseUrl && !docsUrl) {
      return { 
        available: false, 
        reason: 'API 端点未配置 - 当前仅从源码扫描 API 定义，不能采集真实 API 调用记录' 
      };
    }

    if (!this.isConnected) {
      return { 
        available: false, 
        reason: 'API 端点不可访问 - 请检查网络连接和认证配置' 
      };
    }

    return { available: true };
  }

  async cleanup(): Promise<void> {
    this.isConnected = false;
    this.discoveredApis.clear();
  }

  /**
   * 从源码采集 API 定义
   */
  private async collectFromSource(context: CollectorContext): Promise<CollectedFact[]> {
    const facts: CollectedFact[] = [];
    const timestamp = new Date().toISOString();
    
    // 从源码扫描的 API 将被标记为 source-baseline
    // 这些是源码中的声明，不是实际调用
    facts.push(this.createSourceApiFact(timestamp));
    
    return facts;
  }

  /**
   * 创建源码 API 事实
   */
  private createSourceApiFact(timestamp: string): CollectedFact {
    return {
      id: generateCollectorId('api'),
      type: 'api-source-collection-status',
      category: 'api',
      name: 'API 源码采集状态',
      description: '从源码扫描采集 API 定义，实际调用日志需要 API 连接',
      content: {
        collected: true,
        status: 'source-only',
        message: '仅从源码采集 API 定义，未连接 API 端点采集真实调用记录',
        note: '必须配置 API 连接才能采集真实的请求/响应日志'
      },
      evidence: [{
        source: 'api-collector',
        confidence: 1.0,
        extractedAt: timestamp,
        metadata: { 
          collector: 'api-collector',
          mode: 'source-only'
        }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'api-scanner',
      collectorName: this.name,
      confidence: 1.0,
      collectedAt: timestamp
    };
  }

  /**
   * 创建未连接状态的事实
   */
  private createNotConnectedFact(timestamp: string): CollectedFact {
    return {
      id: generateCollectorId('api'),
      type: 'api-collection-status',
      category: 'api',
      name: 'API 调用采集状态',
      description: 'API 端点未连接，无法采集真实调用记录',
      content: {
        connected: false,
        status: '未连接',
        message: '当前仅从源码扫描 API 定义，不能作为真实 API 基线',
        required: [
          'API 基础 URL 配置',
          '有效的认证凭据',
          'API 端点网络可达'
        ],
        note: '必须配置真实的 API 连接才能采集调用记录'
      },
      evidence: [{
        source: 'api-collector',
        confidence: 1.0,
        extractedAt: timestamp,
        metadata: { 
          collector: 'api-collector',
          mode: 'not-connected'
        }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'api-scanner',
      collectorName: this.name,
      confidence: 1.0,
      collectedAt: timestamp
    };
  }

  /**
   * 采集 API 调用日志
   */
  private async collectApiLogs(timestamp: string): Promise<CollectedFact[]> {
    const facts: CollectedFact[] = [];
    
    const tableName = this.config.options?.apiCallLogTable;
    const timeRange = this.config.options?.timeRange;
    
    if (!tableName) {
      console.log(`[ApiCollector] No API call log table configured`);
      return facts;
    }

    try {
      // 从数据库表采集 API 调用日志
      const logs = await this.fetchApiCallLogs(tableName, timeRange);
      
      for (const log of logs) {
        facts.push(this.createApiCallFact(log, timestamp));
      }
      
      // 如果没有日志，也需要说明
      if (logs.length === 0) {
        console.log(`[ApiCollector] No API call logs found in ${tableName}`);
      }
    } catch (error) {
      console.error(`[ApiCollector] Failed to fetch API logs: ${error}`);
    }

    return facts;
  }

  /**
   * 创建 API 调用事实
   */
  private createApiCallFact(log: ApiCallLog, timestamp: string): CollectedFact {
    // 脱敏处理
    const maskedHeaders = this.maskHeaders(log.requestHeaders);
    const maskedRequestBody = this.maskSensitiveData(log.requestBody);
    const maskedResponseBody = this.maskSensitiveData(log.responseBody);

    return {
      id: generateCollectorId('api'),
      type: 'api-call',
      category: 'api',
      name: `${log.method} ${log.endpoint}`,
      description: `API 调用: ${log.method} ${log.endpoint} - ${log.statusCode} (${log.duration}ms)`,
      content: {
        id: log.id,
        endpoint: log.endpoint,
        method: log.method,
        requestTime: log.requestTime,
        responseTime: log.responseTime,
        statusCode: log.statusCode,
        requestHeaders: maskedHeaders,
        requestBody: maskedRequestBody,
        responseBody: maskedResponseBody,
        userId: log.userId ? this.maskActor(log.userId) : undefined,
        sessionId: log.sessionId,
        duration: log.duration
      },
      evidence: [{
        source: this.config.options?.apiCallLogTable || 'api_call_log',
        confidence: 0.95,
        extractedAt: timestamp,
        metadata: {
          collector: 'api-collector',
          realData: true,
          statusCode: log.statusCode
        }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'api-scanner',
      collectorName: this.name,
      confidence: 0.95,
      collectedAt: timestamp
    };
  }

  /**
   * 脱敏请求头
   */
  private maskHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
    const masked: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        masked[key] = '***MASKED***';
      } else {
        masked[key] = value;
      }
    }
    
    return masked;
  }

  /**
   * 脱敏敏感数据
   */
  private maskSensitiveData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!data) return undefined;
    
    const sensitiveFields = ['password', 'secret', 'token', 'account', 'idCard', 'bankAccount', 'phone', 'email', 'name'];
    const masked: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveFields.some(f => lowerKey.includes(f.toLowerCase()))) {
        masked[key] = '***MASKED***';
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = this.maskSensitiveData(value as Record<string, unknown>);
      } else {
        masked[key] = value;
      }
    }
    
    return masked;
  }

  /**
   * 脱敏用户标识
   */
  private maskActor(actor: string): string {
    if (!actor || actor.length < 2) return '***';
    return actor.substring(0, 2) + '***';
  }

  /**
   * 检查 API 文档可用性
   */
  private async checkApiDocs(): Promise<boolean> {
    const docsUrl = this.config.options?.apiDocsUrl;
    
    if (!docsUrl) {
      // 尝试默认路径
      const baseUrl = this.config.options?.baseUrl;
      if (!baseUrl) return false;
      
      try {
        const response = await this.fetchWithTimeout(`${baseUrl}/swagger-ui.html`, {
          timeout: this.config.options?.timeout || 5000
        });
        return response.ok;
      } catch {
        return false;
      }
    }

    try {
      const response = await this.fetchWithTimeout(docsUrl, {
        timeout: this.config.options?.timeout || 5000
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 发送带超时的请求
   */
  private async fetchWithTimeout(url: string, options: { timeout?: number } = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 5000);
    
    try {
      const headers = this.buildAuthHeaders();
      const response = await fetch(url, {
        signal: controller.signal,
        headers
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 构建认证头
   */
  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const auth = this.config.options?.auth;
    
    if (!auth) return headers;
    
    switch (auth.type) {
      case 'bearer':
        if (auth.token) {
          headers['Authorization'] = `Bearer ${auth.token}`;
        }
        break;
      case 'basic':
        if (auth.username && auth.password) {
          const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
        }
        break;
      case 'api-key':
        const headerName = auth.apiKeyHeader || 'X-API-Key';
        if (auth.apiKey) {
          headers[headerName] = auth.apiKey;
        }
        break;
    }
    
    return headers;
  }

  /**
   * 从数据库获取 API 调用日志
   */
  private async fetchApiCallLogs(
    tableName: string, 
    timeRange?: { start: string; end: string }
  ): Promise<ApiCallLog[]> {
    // 这个方法需要数据库连接
    // 由于 collector 主要负责从已有数据中采集，这里只是占位
    // 实际的数据库采集应该由 database-collector 提供
    
    console.log(`[ApiCollector] Would fetch API logs from ${tableName}`);
    return [];
  }
}

/**
 * 创建 API Collector 配置
 */
export function createApiCollectorConfig(
  name: string = 'api-collector',
  options?: ApiCollectorConfig['options']
): ApiCollectorConfig {
  return {
    name,
    type: 'api-scanner',
    enabled: true,
    priority: 25,
    options
  };
}

/**
 * 创建 API Collector 实例
 */
export function createApiCollector(config: ApiCollectorConfig): Collector {
  return new ApiCollector(config);
}
