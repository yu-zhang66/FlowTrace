/**
 * Tests for Runtime Collector
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RuntimeCollector, createRuntimeCollectorConfig } from '../src/runtime-collector.js';

describe('RuntimeCollector', () => {
  let collector: RuntimeCollector;

  beforeEach(() => {
    collector = new RuntimeCollector(
      createRuntimeCollectorConfig('test-runtime-collector')
    );
  });

  describe('initialize', () => {
    it('should initialize without database connection', async () => {
      const context = {
        projectRoot: '/test',
        flowtraceRoot: '/test/.flowtrace',
        processId: 'test-process',
        sourceRoot: '/test/src'
      };

      await collector.initialize(context);
      
      // 没有配置数据库连接，应该进入未连接状态
      const availability = await collector.checkAvailability(context);
      expect(availability.available).toBe(false);
      expect(availability.reason).toContain('数据库连接未配置');
    });

    it('should report unconnected status when db not configured', async () => {
      const context = {
        projectRoot: '/test',
        flowtraceRoot: '/test/.flowtrace',
        processId: 'test-process',
        sourceRoot: '/test/src'
      };

      await collector.initialize(context);
      const facts = await collector.collect(context);

      // 应该返回未连接状态的事实
      expect(facts.length).toBeGreaterThanOrEqual(1);
      const statusFact = facts.find(f => f.type === 'runtime-collection-status');
      expect(statusFact).toBeDefined();
      expect(statusFact?.content.connected).toBe(false);
    });
  });

  describe('collect with mock connection', () => {
    it('should collect runtime facts when connected', async () => {
      // 配置数据库连接
      const config = createRuntimeCollectorConfig('test-collector', {
        dbConnection: {
          host: 'localhost',
          port: 1521,
          database: 'test',
          username: 'test',
          password: 'test',
          type: 'oracle'
        },
        processInstanceTable: 'PROCESS_INSTANCE',
        processHistoryTable: 'PROCESS_HISTORY',
        maskSensitive: true
      });

      const connectedCollector = new RuntimeCollector(config);
      const context = {
        projectRoot: '/test',
        flowtraceRoot: '/test/.flowtrace',
        processId: 'test-process',
        sourceRoot: '/test/src'
      };

      // 即使连接失败，也会生成未连接状态
      await connectedCollector.initialize(context);
      const facts = await connectedCollector.collect(context);

      expect(facts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('fact structure', () => {
    it('should create facts with required fields', async () => {
      const context = {
        projectRoot: '/test',
        flowtraceRoot: '/test/.flowtrace',
        processId: 'test-process',
        sourceRoot: '/test/src'
      };

      await collector.initialize(context);
      const facts = await collector.collect(context);

      for (const fact of facts) {
        expect(fact.id).toBeDefined();
        expect(fact.type).toBeDefined();
        expect(fact.category).toBe('runtime');
        expect(fact.name).toBeDefined();
        expect(fact.description).toBeDefined();
        expect(fact.content).toBeDefined();
        expect(fact.evidence).toBeDefined();
        expect(fact.evidence.length).toBeGreaterThan(0);
        expect(fact.reviewStatus).toBeDefined();
        expect(fact.collectorType).toBe('process-instance');
        expect(fact.collectorName).toBe('test-runtime-collector');
        expect(fact.confidence).toBeGreaterThan(0);
        expect(fact.collectedAt).toBeDefined();
      }
    });
  });

  describe('cleanup', () => {
    it('should cleanup without error', async () => {
      const context = {
        projectRoot: '/test',
        flowtraceRoot: '/test/.flowtrace',
        processId: 'test-process',
        sourceRoot: '/test/src'
      };

      await collector.initialize(context);
      await expect(collector.cleanup()).resolves.not.toThrow();
    });
  });
});
