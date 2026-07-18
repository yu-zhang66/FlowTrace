/**
 * Tests for Business Report Generator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  BusinessReportGenerator,
  createBusinessReportGenerator,
  type CollectionStatus
} from '../src/business-report.js';
import type { Scenario, DualExecutionResult } from '@flowtrace/core';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('BusinessReportGenerator', () => {
  let generator: BusinessReportGenerator;
  const testOutputDir = join(process.cwd(), 'test-reports');

  beforeEach(() => {
    // 确保输出目录存在
    if (!existsSync(testOutputDir)) {
      mkdirSync(testOutputDir, { recursive: true });
    }

    generator = createBusinessReportGenerator({
      outputDir: testOutputDir,
      projectName: '测试项目',
      projectId: 'test-project',
      currentAdapterMode: 'legacy-shadow'
    });
  });

  describe('constructor', () => {
    it('should create generator with default config', () => {
      const gen = createBusinessReportGenerator({
        projectName: 'Test'
      });
      expect(gen).toBeDefined();
    });
  });

  describe('generate overview page', () => {
    it('should include legacy-shadow warning', () => {
      // 生成一个空报告
      const scenarios: Scenario[] = [];
      const results: DualExecutionResult[] = [];
      const collectionStatus: CollectionStatus = {
        runtimeCollected: false,
        runtimeMessage: '数据库未连接',
        databaseCollected: false,
        databaseMessage: '数据库未连接',
        apiCollected: false,
        apiMessage: 'API未连接',
        sourceCollected: true
      };

      generator.generate(scenarios, results, collectionStatus);

      // 验证文件生成
      expect(existsSync(join(testOutputDir, 'overview.html'))).toBe(true);
      expect(existsSync(join(testOutputDir, 'index.html'))).toBe(true);
    });
  });

  describe('generate scenario list', () => {
    it('should generate scenario list page', () => {
      const scenarios: Scenario[] = [
        {
          id: 'test-scenario-1',
          name: '正常审批流程',
          process: 'test-process',
          severity: 'P0',
          actions: [
            { type: 'SUBMIT', actor: 'supplier' },
            { type: 'APPROVE', actor: 'core_enterprise' }
          ],
          expected: {
            finalState: 'APPROVED'
          },
          enabled: true
        }
      ];

      const results: DualExecutionResult[] = [
        {
          scenarioId: 'test-scenario-1',
          passed: true,
          differences: [],
          legacyResult: {
            scenarioId: 'test-scenario-1',
            adapter: 'legacy',
            actions: [],
            startTime: '',
            endTime: '',
            finalState: 'APPROVED',
            semanticPath: ['SUBMIT', 'APPROVE'],
            businessData: {}
          },
          currentResult: {
            scenarioId: 'test-scenario-1',
            adapter: 'current',
            actions: [],
            startTime: '',
            endTime: '',
            finalState: 'APPROVED',
            semanticPath: ['SUBMIT', 'APPROVE'],
            businessData: {}
          }
        }
      ];

      const collectionStatus: CollectionStatus = {
        runtimeCollected: false,
        runtimeMessage: '数据库未连接',
        databaseCollected: false,
        databaseMessage: '数据库未连接',
        apiCollected: false,
        apiMessage: 'API未连接',
        sourceCollected: true
      };

      generator.generate(scenarios, results, collectionStatus);

      // 验证场景列表页
      expect(existsSync(join(testOutputDir, 'scenarios.html'))).toBe(true);
      
      // 验证场景详情页
      expect(existsSync(join(testOutputDir, 'scenario-test-scenario-1.html'))).toBe(true);
    });
  });

  describe('release gate', () => {
    it('should show blocked when P0 differences exist', () => {
      const scenarios: Scenario[] = [
        {
          id: 'test-p0',
          name: 'P0 差异场景',
          process: 'test-process',
          severity: 'P0',
          actions: [],
          expected: { finalState: 'APPROVED' },
          enabled: true
        }
      ];

      const results: DualExecutionResult[] = [
        {
          scenarioId: 'test-p0',
          passed: false,
          differences: [
            {
              id: 'diff-1',
              scenarioId: 'test-p0',
              category: 'final_state',
              severity: 'P0',
              description: '最终状态不一致',
              legacyValue: 'APPROVED',
              currentValue: 'REJECTED',
              isBlocking: true
            }
          ]
        }
      ];

      const collectionStatus: CollectionStatus = {
        runtimeCollected: false,
        runtimeMessage: '',
        databaseCollected: false,
        databaseMessage: '',
        apiCollected: false,
        apiMessage: '',
        sourceCollected: true
      };

      generator.generate(scenarios, results, collectionStatus);

      expect(existsSync(join(testOutputDir, 'release-gate.html'))).toBe(true);
    });
  });

  describe('collection credibility page', () => {
    it('should show warning when not connected', () => {
      const scenarios: Scenario[] = [];
      const results: DualExecutionResult[] = [];
      const collectionStatus: CollectionStatus = {
        runtimeCollected: false,
        runtimeMessage: '数据库连接失败',
        databaseCollected: false,
        databaseMessage: '数据库连接失败',
        apiCollected: false,
        apiMessage: 'API 不可访问',
        sourceCollected: true
      };

      generator.generate(scenarios, results, collectionStatus);

      expect(existsSync(join(testOutputDir, 'collection-status.html'))).toBe(true);
    });

    it('should show success when all connected', () => {
      const generator2 = createBusinessReportGenerator({
        outputDir: testOutputDir,
        projectName: 'Test',
        projectId: 'test',
        currentAdapterMode: 'api'
      });

      const scenarios: Scenario[] = [];
      const results: DualExecutionResult[] = [];
      const collectionStatus: CollectionStatus = {
        runtimeCollected: true,
        runtimeMessage: '已采集',
        databaseCollected: true,
        databaseMessage: '已采集',
        apiCollected: true,
        apiMessage: '已采集',
        sourceCollected: true
      };

      generator2.generate(scenarios, results, collectionStatus);

      expect(existsSync(join(testOutputDir, 'collection-status.html'))).toBe(true);
    });
  });
});
