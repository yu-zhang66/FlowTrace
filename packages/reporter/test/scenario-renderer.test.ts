/**
 * Tests for Scenario Renderer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  ScenarioRenderer, 
  createScenarioRenderer 
} from '../src/scenario-renderer.js';
import type { Scenario } from '@flowtrace/core';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('ScenarioRenderer', () => {
  let renderer: ScenarioRenderer;
  const testOutputDir = join(process.cwd(), 'test-scenarios');

  beforeEach(() => {
    renderer = createScenarioRenderer({
      outputDir: testOutputDir,
      includeMermaid: true,
      includeTimeline: true,
      language: 'zh'
    });

    // 确保输出目录存在
    if (!existsSync(testOutputDir)) {
      mkdirSync(testOutputDir, { recursive: true });
    }
  });

  describe('renderScenario', () => {
    it('should render scenario with all components', () => {
      const scenario: Scenario = {
        id: 'test-scenario',
        name: '正常审批流程',
        process: 'supply-chain-approval',
        severity: 'P0',
        source: ['baseline.json#process'],
        actions: [
          { type: 'SUBMIT', actor: 'supplier' },
          { type: 'APPROVE', actor: 'core_enterprise' },
          { type: 'APPROVE', actor: 'risk_assessor' },
          { type: 'APPROVE', actor: 'finance' }
        ],
        expected: {
          finalState: 'APPROVED',
          semanticPath: ['SUBMIT', 'APPROVE', 'APPROVE', 'APPROVE']
        },
        tags: ['happy-path', 'essential'],
        enabled: true
      };

      const rendered = renderer.renderScenario(scenario);

      expect(rendered.scenario).toBe(scenario);
      expect(rendered.markdown).toBeDefined();
      expect(rendered.html).toBeDefined();
      expect(rendered.mermaid).toBeDefined();
      expect(rendered.timeline).toBeDefined();
      expect(rendered.sequenceDiagram).toBeDefined();
    });

    it('should include scenario metadata in markdown', () => {
      const scenario: Scenario = {
        id: 'test-scenario',
        name: '测试场景',
        process: 'test-process',
        actions: [
          { type: 'SUBMIT', actor: 'supplier' }
        ],
        expected: { finalState: 'SUBMITTED' },
        enabled: true
      };

      const rendered = renderer.renderScenario(scenario);

      // 验证 Markdown 包含必要的元信息
      expect(rendered.markdown).toContain('案例编号');
      expect(rendered.markdown).toContain('案例名称');
      expect(rendered.markdown).toContain('测试场景');
    });

    it('should render business sections', () => {
      const scenario: Scenario = {
        id: 'test-scenario',
        name: '审批流程',
        process: 'test-process',
        actions: [
          { type: 'SUBMIT', actor: 'supplier' },
          { type: 'REJECT', actor: 'reviewer', data: { reason: '不合格' } }
        ],
        expected: { finalState: 'REJECTED' },
        enabled: true
      };

      const rendered = renderer.renderScenario(scenario);

      // 验证包含业务章节
      expect(rendered.markdown).toContain('一、业务目标');
      expect(rendered.markdown).toContain('二、参与角色');
      expect(rendered.markdown).toContain('三、前置条件');
      expect(rendered.markdown).toContain('四、业务流程图');
      expect(rendered.markdown).toContain('五、详细步骤');
    });
  });

  describe('renderMermaid', () => {
    it('should generate flowchart diagram', () => {
      const scenario: Scenario = {
        id: 'test',
        name: 'Test',
        process: 'test',
        actions: [
          { type: 'SUBMIT', actor: 'supplier' },
          { type: 'APPROVE', actor: 'approver' }
        ],
        expected: { finalState: 'APPROVED' },
        enabled: true
      };

      const mermaid = renderer.renderMermaid(scenario);

      expect(mermaid).toContain('```mermaid');
      expect(mermaid).toContain('flowchart TD');
      expect(mermaid).toContain('提交融资申请');
      expect(mermaid).toContain('```');
    });

    it('should include nodes for each action', () => {
      const scenario: Scenario = {
        id: 'test',
        name: 'Test',
        process: 'test',
        actions: [
          { type: 'SUBMIT', actor: 'a' },
          { type: 'APPROVE', actor: 'b' },
          { type: 'REJECT', actor: 'c' }
        ],
        expected: { finalState: 'REJECTED' },
        enabled: true
      };

      const mermaid = renderer.renderMermaid(scenario);

      expect(mermaid).toContain('提交融资申请');
      expect(mermaid).toContain('审批通过');
      expect(mermaid).toContain('审批拒绝');
    });
  });

  describe('renderSequenceDiagram', () => {
    it('should generate sequence diagram', () => {
      const scenario: Scenario = {
        id: 'test',
        name: 'Test',
        process: 'test',
        actions: [
          { type: 'SUBMIT', actor: 'supplier' },
          { type: 'APPROVE', actor: 'approver' }
        ],
        expected: { finalState: 'APPROVED' },
        enabled: true
      };

      const sequence = renderer.renderSequenceDiagram(scenario);

      expect(sequence).toContain('```mermaid');
      expect(sequence).toContain('sequenceDiagram');
      expect(sequence).toContain('participant');
    });
  });

  describe('renderTimeline', () => {
    it('should render steps with details', () => {
      const scenario: Scenario = {
        id: 'test',
        name: 'Test',
        process: 'test',
        actions: [
          { type: 'SUBMIT', actor: 'supplier', data: { amount: 1000 } },
          { type: 'APPROVE', actor: 'approver' }
        ],
        expected: { finalState: 'APPROVED' },
        enabled: true
      };

      const timeline = renderer.renderTimeline(scenario);

      expect(timeline).toContain('步骤 1');
      expect(timeline).toContain('步骤 2');
      expect(timeline).toContain('操作人');
      expect(timeline).toContain('操作');
    });
  });

  describe('renderHtml', () => {
    it('should include mermaid script', () => {
      const scenario: Scenario = {
        id: 'test',
        name: 'Test',
        process: 'test',
        actions: [
          { type: 'SUBMIT', actor: 'supplier' }
        ],
        expected: { finalState: 'SUBMITTED' },
        enabled: true
      };

      const html = renderer.renderHtml(scenario);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('mermaid');
      expect(html).toContain('mermaid.initialize');
    });

    it('should include scenario details', () => {
      const scenario: Scenario = {
        id: 'test',
        name: '正常审批流程',
        process: 'test',
        severity: 'P0',
        actions: [
          { type: 'SUBMIT', actor: 'supplier' }
        ],
        expected: { finalState: 'SUBMITTED' },
        enabled: true
      };

      const html = renderer.renderHtml(scenario);

      expect(html).toContain('正常审批流程');
      expect(html).toContain('P0');
      expect(html).toContain('test');
    });
  });

  describe('renderAll', () => {
    it('should render multiple scenarios', () => {
      const scenarios: Scenario[] = [
        {
          id: 'scenario-1',
          name: '场景1',
          process: 'test',
          actions: [{ type: 'SUBMIT', actor: 'a' }],
          expected: { finalState: 'SUBMITTED' },
          enabled: true
        },
        {
          id: 'scenario-2',
          name: '场景2',
          process: 'test',
          actions: [{ type: 'APPROVE', actor: 'b' }],
          expected: { finalState: 'APPROVED' },
          enabled: true
        }
      ];

      const rendered = renderer.renderAll(scenarios);

      expect(rendered.length).toBe(2);
      expect(rendered[0].scenario.id).toBe('scenario-1');
      expect(rendered[1].scenario.id).toBe('scenario-2');
    });
  });

  describe('branch detection', () => {
    it('should detect rejection branch', () => {
      const scenario: Scenario = {
        id: 'test',
        name: 'Test',
        process: 'test',
        actions: [
          { type: 'SUBMIT', actor: 'supplier' },
          { type: 'REJECT', actor: 'approver', data: { reason: '不合格' } }
        ],
        expected: { finalState: 'REJECTED' },
        enabled: true
      };

      const mermaid = renderer.renderMermaid(scenario);

      expect(mermaid).toContain('拒绝');
    });

    it('should detect return branch', () => {
      const scenario: Scenario = {
        id: 'test',
        name: 'Test',
        process: 'test',
        actions: [
          { type: 'SUBMIT', actor: 'supplier' },
          { type: 'RETURN', actor: 'approver', data: { reason: '补充材料' } }
        ],
        expected: { finalState: 'RETURNED' },
        enabled: true
      };

      const mermaid = renderer.renderMermaid(scenario);

      expect(mermaid).toContain('退回');
    });
  });
});
