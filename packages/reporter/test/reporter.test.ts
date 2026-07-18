import { describe, it, expect } from 'vitest';
import { ReportGenerator, DifferenceClassifier } from '@flowtrace/reporter';

describe('ReportGenerator', () => {
  describe('generateVerificationRun', () => {
    it('should generate a verification run with summary', () => {
      const reporter = new ReportGenerator();

      const results = [
        {
          scenarioId: 'scenario-001',
          passed: true,
          differences: []
        },
        {
          scenarioId: 'scenario-002',
          passed: false,
          differences: [
            {
              id: 'diff-001',
              scenarioId: 'scenario-002',
              category: 'final_state' as const,
              severity: 'P0' as const,
              description: 'State mismatch',
              legacyValue: 'APPROVED',
              currentValue: 'REJECTED',
              isBlocking: true
            }
          ]
        }
      ];

      const run = reporter.generateVerificationRun('test-project', results, ['P0', 'P1']);

      expect(run.id).toBeTruthy();
      expect(run.projectId).toBe('test-project');
      expect(run.summary.total).toBe(2);
      expect(run.summary.passed).toBe(1);
      expect(run.summary.failed).toBe(1);
      expect(run.releaseGate.allowed).toBe(false);
    });

    it('should allow release when no blocking differences', () => {
      const reporter = new ReportGenerator();

      const results = [
        {
          scenarioId: 'scenario-001',
          passed: true,
          differences: []
        }
      ];

      const run = reporter.generateVerificationRun('test-project', results, ['P0', 'P1']);

      expect(run.releaseGate.allowed).toBe(true);
    });
  });

  describe('generateMarkdown', () => {
    it('should generate markdown report', () => {
      const reporter = new ReportGenerator({ includeDetails: true });

      const run = {
        id: 'run-001',
        projectId: 'test-project',
        timestamp: new Date().toISOString(),
        scenarios: [
          {
            scenarioId: 'scenario-001',
            passed: true,
            differences: []
          }
        ],
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          differencesBySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 }
        },
        releaseGate: {
          allowed: true,
          blockedBy: []
        }
      };

      const markdown = reporter.generateMarkdown(run, 'Test Project');

      expect(markdown).toContain('Test Project');
      expect(markdown).toContain('scenario-001');
      expect(markdown).toContain('Summary');
    });
  });

  describe('generateHtml', () => {
    it('should generate HTML report', () => {
      const reporter = new ReportGenerator({ includeDetails: true });

      const run = {
        id: 'run-001',
        projectId: 'test-project',
        timestamp: new Date().toISOString(),
        scenarios: [
          {
            scenarioId: 'scenario-001',
            passed: true,
            differences: []
          }
        ],
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          differencesBySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 }
        },
        releaseGate: {
          allowed: true,
          blockedBy: []
        }
      };

      const html = reporter.generateHtml(run, 'Test Project');

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Test Project');
      expect(html).toContain('scenario-001');
    });
  });
});

describe('DifferenceClassifier', () => {
  describe('classify', () => {
    it('should classify final_state as P0', () => {
      const severity = DifferenceClassifier.classify({ category: 'final_state' });
      expect(severity).toBe('P0');
    });

    it('should classify permission as P0', () => {
      const severity = DifferenceClassifier.classify({ category: 'permission' });
      expect(severity).toBe('P0');
    });

    it('should classify semantic_path as P1', () => {
      const severity = DifferenceClassifier.classify({ category: 'semantic_path' });
      expect(severity).toBe('P1');
    });

    it('should classify database as P1', () => {
      const severity = DifferenceClassifier.classify({ category: 'database' });
      expect(severity).toBe('P1');
    });
  });

  describe('isBlocking', () => {
    it('should return true for P0', () => {
      expect(DifferenceClassifier.isBlocking('P0')).toBe(true);
    });

    it('should return true for P1', () => {
      expect(DifferenceClassifier.isBlocking('P1')).toBe(true);
    });

    it('should return false for P2', () => {
      expect(DifferenceClassifier.isBlocking('P2')).toBe(false);
    });

    it('should return false for P3', () => {
      expect(DifferenceClassifier.isBlocking('P3')).toBe(false);
    });
  });

  describe('sortBySeverity', () => {
    it('should sort severities correctly', () => {
      const sorted = ['P1', 'P3', 'P0', 'P2'].sort(DifferenceClassifier.sortBySeverity);
      expect(sorted).toEqual(['P0', 'P1', 'P2', 'P3']);
    });
  });

  describe('groupBySeverity', () => {
    it('should group differences by severity', () => {
      const differences = [
        { severity: 'P0' as const, scenarioId: 's1', category: 'final_state' as const, description: '', legacyValue: null, currentValue: null, id: 'd1', isBlocking: true },
        { severity: 'P0' as const, scenarioId: 's2', category: 'final_state' as const, description: '', legacyValue: null, currentValue: null, id: 'd2', isBlocking: true },
        { severity: 'P1' as const, scenarioId: 's3', category: 'semantic_path' as const, description: '', legacyValue: null, currentValue: null, id: 'd3', isBlocking: false }
      ];

      const grouped = DifferenceClassifier.groupBySeverity(differences);

      expect(grouped.P0).toHaveLength(2);
      expect(grouped.P1).toHaveLength(1);
      expect(grouped.P2).toHaveLength(0);
      expect(grouped.P3).toHaveLength(0);
    });
  });
});
