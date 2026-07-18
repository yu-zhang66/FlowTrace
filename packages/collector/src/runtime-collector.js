/**
 * Runtime Process Instance Collector
 *
 * 采集旧系统实际运行的流程实例数据
 * 包括：流程节点、审批人、状态变化、操作记录等
 */
import { generateCollectorId } from '@flowtrace/core';
/**
 * Runtime Collector 实现
 */
export class RuntimeCollector {
    name;
    type = 'process-instance';
    config;
    isConnected = false;
    connection = null;
    maskSensitive = true;
    constructor(config) {
        this.name = config.name || 'runtime-collector';
        this.config = config;
        this.maskSensitive = config.options?.maskSensitive ?? true;
    }
    async initialize(context) {
        console.log(`[RuntimeCollector] Initializing for project: ${context.projectId}`);
        const dbConfig = this.config.options?.dbConnection;
        if (!dbConfig) {
            console.log(`[RuntimeCollector] No database connection configured. Will use demo mode.`);
            return;
        }
        try {
            // 尝试建立数据库连接
            this.connection = await this.createConnection(dbConfig);
            this.isConnected = true;
            console.log(`[RuntimeCollector] Database connection established`);
        }
        catch (error) {
            console.log(`[RuntimeCollector] Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
            console.log(`[RuntimeCollector] Falling back to demo mode - NO REAL DATA`);
            this.isConnected = false;
        }
    }
    async collect(context) {
        const facts = [];
        const timestamp = new Date().toISOString();
        if (!this.isConnected) {
            console.log(`[RuntimeCollector] NOT CONNECTED - Cannot collect real runtime facts`);
            console.log(`[RuntimeCollector] Will output collection summary with "未连接" status`);
            // 输出明确的未连接状态
            facts.push(this.createNotConnectedFact(timestamp));
            return facts;
        }
        try {
            // 采集流程实例
            const instances = await this.fetchProcessInstances();
            for (const instance of instances) {
                // 采集每个实例的事件历史
                const events = await this.fetchProcessEvents(instance.processInstanceId);
                facts.push(this.createProcessInstanceFact(instance, events, timestamp));
                // 为每个事件创建单独的事实
                for (const event of events) {
                    facts.push(this.createProcessEventFact(event, timestamp));
                }
            }
            console.log(`[RuntimeCollector] Collected ${facts.length} runtime facts`);
        }
        catch (error) {
            console.error(`[RuntimeCollector] Collection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return facts;
    }
    async checkAvailability(context) {
        const dbConfig = this.config.options?.dbConnection;
        if (!dbConfig) {
            return {
                available: false,
                reason: '数据库连接未配置 - 当前仅使用源码采集，不能作为真实业务基线'
            };
        }
        if (!this.isConnected) {
            return {
                available: false,
                reason: '数据库连接失败 - 请检查连接配置和网络安全'
            };
        }
        return { available: true };
    }
    async cleanup() {
        if (this.connection) {
            try {
                await this.closeConnection(this.connection);
            }
            catch {
                // 忽略关闭错误
            }
            this.connection = null;
        }
        this.isConnected = false;
    }
    /**
     * 创建未连接状态的事实
     */
    createNotConnectedFact(timestamp) {
        return {
            id: generateCollectorId('runtime'),
            type: 'runtime-collection-status',
            category: 'runtime',
            name: '运行时采集状态',
            description: '数据库连接未建立，无法采集真实运行时数据',
            content: {
                connected: false,
                status: '未连接',
                message: '当前仅使用源码事实，不能作为真实业务基线',
                required: [
                    '数据库连接配置',
                    '有效的数据库凭据',
                    '流程实例表访问权限'
                ],
                note: '必须配置真实的数据库连接才能采集运行时数据'
            },
            evidence: [{
                    source: 'runtime-collector',
                    confidence: 1.0,
                    extractedAt: timestamp,
                    metadata: {
                        collector: 'runtime-collector',
                        mode: 'not-connected'
                    }
                }],
            reviewStatus: 'AUTO_EXTRACTED',
            collectorType: 'process-instance',
            collectorName: this.name,
            confidence: 1.0,
            collectedAt: timestamp
        };
    }
    /**
     * 创建流程实例事实
     */
    createProcessInstanceFact(instance, events, timestamp) {
        return {
            id: generateCollectorId('runtime'),
            type: 'process-instance',
            category: 'runtime',
            name: `流程实例: ${instance.businessKey || instance.processInstanceId}`,
            description: `运行时流程实例，包含 ${events.length} 个事件`,
            content: {
                processInstanceId: instance.processInstanceId,
                businessKey: instance.businessKey,
                status: instance.status,
                startTime: instance.startTime,
                endTime: instance.endTime,
                startActor: this.maskSensitive ? this.maskActor(instance.startActor) : instance.startActor,
                currentNode: instance.currentNode,
                businessData: this.maskSensitive ? this.maskBusinessData(instance.businessData) : instance.businessData,
                eventCount: events.length,
                nodeSequence: events.map(e => e.nodeName),
                actors: [...new Set(events.map(e => this.maskSensitive ? this.maskActor(e.actor) : e.actor))]
            },
            evidence: [{
                    source: this.config.options?.processInstanceTable || 'process_instance',
                    confidence: 0.95,
                    extractedAt: timestamp,
                    metadata: {
                        collector: 'runtime-collector',
                        realData: true,
                        eventCount: events.length
                    }
                }],
            reviewStatus: 'AUTO_EXTRACTED',
            collectorType: 'process-instance',
            collectorName: this.name,
            confidence: 0.95,
            collectedAt: timestamp
        };
    }
    /**
     * 创建流程节点事件事实
     */
    createProcessEventFact(event, timestamp) {
        return {
            id: generateCollectorId('runtime'),
            type: 'process-event',
            category: 'runtime',
            name: `${event.eventType} @ ${event.nodeName}`,
            description: `${this.maskSensitive ? this.maskActor(event.actor) : event.actor} 在 ${event.nodeName} 执行 ${event.action}`,
            content: {
                processInstanceId: event.processInstanceId,
                businessKey: event.businessKey,
                eventTime: event.eventTime,
                eventType: event.eventType,
                actor: this.maskSensitive ? this.maskActor(event.actor) : event.actor,
                actorName: event.actorName,
                action: event.action,
                nodeId: event.nodeId,
                nodeName: event.nodeName,
                oldState: event.oldState,
                newState: event.newState,
                comment: event.comment,
                reason: event.reason,
                rawSource: event.rawSource,
                confidence: event.confidence
            },
            evidence: [{
                    source: this.config.options?.processHistoryTable || 'process_history',
                    confidence: event.confidence,
                    extractedAt: timestamp,
                    metadata: {
                        collector: 'runtime-collector',
                        realData: true,
                        nodeName: event.nodeName
                    }
                }],
            reviewStatus: 'AUTO_EXTRACTED',
            collectorType: 'process-instance',
            collectorName: this.name,
            confidence: event.confidence,
            collectedAt: timestamp
        };
    }
    /**
     * 脱敏处理
     */
    maskActor(actor) {
        if (!actor || actor.length < 2)
            return '***';
        return actor.substring(0, 2) + '***';
    }
    /**
     * 脱敏业务数据
     */
    maskBusinessData(data) {
        const sensitiveFields = ['password', 'secret', 'token', 'account', 'idCard', 'bankAccount', 'phone', 'email'];
        const masked = {};
        for (const [key, value] of Object.entries(data)) {
            const lowerKey = key.toLowerCase();
            if (sensitiveFields.some(f => lowerKey.includes(f))) {
                masked[key] = '***MASKED***';
            }
            else {
                masked[key] = value;
            }
        }
        return masked;
    }
    /**
     * 创建数据库连接
     */
    async createConnection(config) {
        const type = config.type || 'oracle';
        if (type === 'oracle') {
            // Oracle 连接实现
            try {
                const oracledb = await import('oracledb');
                const connection = await oracledb.getConnection({
                    user: config.username,
                    password: config.password,
                    connectString: `${config.host}:${config.port}/${config.database}`
                });
                return connection;
            }
            catch (error) {
                throw new Error(`Oracle connection failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        else if (type === 'postgresql') {
            // PostgreSQL 连接实现
            const { Client } = await import('pg');
            const client = new Client({
                host: config.host,
                port: config.port,
                database: config.database,
                user: config.username,
                password: config.password
            });
            await client.connect();
            return client;
        }
        else if (type === 'mysql') {
            // MySQL 连接实现
            const mysql = await import('mysql2/promise');
            const connection = await mysql.createConnection({
                host: config.host,
                port: config.port,
                database: config.database,
                user: config.username,
                password: config.password
            });
            return connection;
        }
        throw new Error(`Unsupported database type: ${type}`);
    }
    /**
     * 关闭数据库连接
     */
    async closeConnection(connection) {
        if (connection && typeof connection.close === 'function') {
            await connection.close();
        }
    }
    /**
     * 获取流程实例列表
     */
    async fetchProcessInstances() {
        const tableName = this.config.options?.processInstanceTable || 'PROCESS_INSTANCE';
        const processDefId = this.config.options?.processDefinitionId;
        const maxInstances = this.config.options?.maxInstances || 100;
        const timeRange = this.config.options?.timeRange;
        let query = `SELECT * FROM ${tableName}`;
        const conditions = [];
        const params = [];
        if (processDefId) {
            conditions.push(`PROCESS_DEF_ID = :processDefId`);
            params.push(processDefId);
        }
        if (timeRange) {
            conditions.push(`START_TIME >= TO_DATE(:startTime, 'YYYY-MM-DD HH24:MI:SS')`);
            conditions.push(`START_TIME <= TO_DATE(:endTime, 'YYYY-MM-DD HH24:MI:SS')`);
            params.push(timeRange.start, timeRange.end);
        }
        if (conditions.length > 0) {
            query += ` WHERE ` + conditions.join(' AND ');
        }
        query += ` ORDER BY START_TIME DESC FETCH FIRST ${maxInstances} ROWS ONLY`;
        try {
            const result = await this.executeQuery(query, params);
            return result.map((row) => this.mapToProcessInstance(row));
        }
        catch (error) {
            console.error(`[RuntimeCollector] Failed to fetch process instances: ${error}`);
            return [];
        }
    }
    /**
     * 获取流程事件历史
     */
    async fetchProcessEvents(processInstanceId) {
        const tableName = this.config.options?.processHistoryTable || 'PROCESS_HISTORY';
        const query = `
      SELECT * FROM ${tableName} 
      WHERE PROCESS_INSTANCE_ID = :processInstanceId 
      ORDER BY EVENT_TIME ASC
    `;
        try {
            const result = await this.executeQuery(query, [processInstanceId]);
            return result.map((row) => this.mapToProcessEvent(row));
        }
        catch (error) {
            console.error(`[RuntimeCollector] Failed to fetch process events: ${error}`);
            return [];
        }
    }
    /**
     * 执行查询
     */
    async executeQuery(query, params) {
        if (!this.connection)
            return [];
        try {
            const result = await this.connection.execute(query, params, { outFormat: 4002 }); // OBJECT format
            return result.rows || [];
        }
        catch (error) {
            throw error;
        }
    }
    /**
     * 映射数据库行为流程实例
     */
    mapToProcessInstance(row) {
        return {
            processInstanceId: row.PROCESS_INSTANCE_ID || row.process_instance_id || row.id,
            businessKey: row.BUSINESS_KEY || row.business_key || '',
            status: row.STATUS || row.status || 'UNKNOWN',
            startTime: row.START_TIME || row.start_time || new Date().toISOString(),
            endTime: row.END_TIME || row.end_time,
            startActor: row.START_ACTOR || row.start_actor || row.STARTER || 'SYSTEM',
            currentNode: row.CURRENT_NODE || row.current_node,
            businessData: row.BUSINESS_DATA ? JSON.parse(row.BUSINESS_DATA) : {},
            events: []
        };
    }
    /**
     * 映射数据库行为流程事件
     */
    mapToProcessEvent(row) {
        const eventType = this.mapToEventType(row.EVENT_TYPE || row.event_type || row.ACTION);
        return {
            processInstanceId: row.PROCESS_INSTANCE_ID || row.process_instance_id,
            businessKey: row.BUSINESS_KEY || row.business_key || '',
            eventTime: row.EVENT_TIME || row.event_time || row.CREATE_TIME || new Date().toISOString(),
            eventType,
            actor: row.ACTOR || row.actor || row.USER_ID || 'SYSTEM',
            actorName: row.ACTOR_NAME || row.actor_name || row.USER_NAME,
            action: row.ACTION || row.action || eventType,
            nodeId: row.NODE_ID || row.node_id || row.TASK_ID || '',
            nodeName: row.NODE_NAME || row.node_name || row.TASK_NAME || eventType,
            oldState: row.OLD_STATE || row.old_state || '',
            newState: row.NEW_STATE || row.new_state || row.STATUS || '',
            comment: row.COMMENT || row.comment,
            reason: row.REASON || row.reason,
            rawSource: row,
            confidence: 0.95
        };
    }
    /**
     * 映射事件类型
     */
    mapToEventType(type) {
        const upperType = (type || '').toUpperCase();
        const typeMap = {
            'START': 'START',
            'INITIATE': 'START',
            'SUBMIT': 'SUBMIT',
            'APPROVE': 'APPROVE',
            'AGREE': 'APPROVE',
            'PASS': 'APPROVE',
            'REJECT': 'REJECT',
            'REFUSE': 'REJECT',
            'DENY': 'REJECT',
            'RETURN': 'RETURN',
            'BACK': 'RETURN',
            'WITHDRAW': 'WITHDRAW',
            'CANCEL': 'WITHDRAW',
            'TRANSFER': 'TRANSFER',
            'ASSIGN': 'TRANSFER',
            'DELEGATE': 'TRANSFER',
            'COUNTERSIGN': 'COUNTERSIGN',
            'PARALLEL': 'COUNTERSIGN',
            'COUNTERSIGN_COMPLETE': 'COUNTERSIGN_COMPLETE',
            'END': 'END',
            'COMPLETE': 'END',
            'FINISH': 'END'
        };
        return typeMap[upperType] || 'APPROVE';
    }
}
/**
 * 创建 Runtime Collector 配置
 */
export function createRuntimeCollectorConfig(name = 'runtime-collector', options) {
    return {
        name,
        type: 'process-instance',
        enabled: true,
        priority: 20,
        options
    };
}
/**
 * 创建 Runtime Collector 实例
 */
export function createRuntimeCollector(config) {
    return new RuntimeCollector(config);
}
//# sourceMappingURL=runtime-collector.js.map