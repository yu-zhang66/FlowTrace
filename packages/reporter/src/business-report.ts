/**
 * Business Report Generator
 * 
 * 生成面向业务人员的多页报告：
 * 1. 总览页
 * 2. 场景清单页
 * 3. 场景详细对比页
 * 4. 差异分析页
 * 5. Release Gate 页
 * 6. 数据与 API 对比页
 * 7. 采集可信度页
 */

import type { 
  Scenario, 
  DualExecutionResult, 
  VerificationRun,
  VerificationSummary,
  ReleaseGate,
  Difference
} from '@flowtrace/core';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface CollectionStatus {
  runtimeCollected: boolean;
  runtimeMessage: string;
  databaseCollected: boolean;
  databaseMessage: string;
  apiCollected: boolean;
  apiMessage: string;
  sourceCollected: boolean;
}

export interface BusinessReportConfig {
  outputDir: string;
  projectName: string;
  projectId: string;
  currentAdapterMode: string;
  includeScenarios: boolean;
  includeDifferences: boolean;
  includeDataComparison: boolean;
}

export interface ScenarioDetail {
  scenario: Scenario;
  result: DualExecutionResult;
  expected: {
    finalState: string;
    semanticPath: string[];
    nodeDetails: Array<{
      nodeName: string;
      actor: string;
      action: string;
      preState: string;
      postState: string;
    }>;
  };
  legacy: {
    finalState: string;
    semanticPath: string[];
    nodeDetails: Array<{
      nodeName: string;
      actor: string;
      action: string;
      timestamp: string;
      preState: string;
      postState: string;
    }>;
    apiCalls: Array<{
      endpoint: string;
      method: string;
      statusCode: number;
    }>;
    databaseChanges: Record<string, unknown>;
  };
  current: {
    finalState: string;
    semanticPath: string[];
    nodeDetails: Array<{
      nodeName: string;
      actor: string;
      action: string;
      timestamp: string;
      preState: string;
      postState: string;
    }>;
    apiCalls: Array<{
      endpoint: string;
      method: string;
      statusCode: number;
    }>;
    databaseChanges: Record<string, unknown>;
  };
  comparison: {
    finalStateMatch: boolean;
    pathMatch: boolean;
    businessDataMatch: boolean;
    apiSemanticMatch: boolean;
    differences: Difference[];
    businessConclusion: string;
    blockingDifferences: Difference[];
  };
}

/**
 * 业务报告生成器
 */
export class BusinessReportGenerator {
  private config: BusinessReportConfig;
  private scenarioDetails: Map<string, ScenarioDetail> = new Map();

  constructor(config: Partial<BusinessReportConfig>) {
    this.config = {
      outputDir: '.flowtrace/reports',
      projectName: '项目',
      projectId: 'unknown',
      currentAdapterMode: 'legacy-shadow',
      includeScenarios: true,
      includeDifferences: true,
      includeDataComparison: true,
      ...config
    };
  }

  /**
   * 生成完整报告
   */
  generate(
    scenarios: Scenario[],
    results: DualExecutionResult[],
    collectionStatus: CollectionStatus
  ): void {
    console.log('[BusinessReport] Generating business report...');

    // 构建场景详情
    this.buildScenarioDetails(scenarios, results);

    // 创建输出目录
    if (!existsSync(this.config.outputDir)) {
      mkdirSync(this.config.outputDir, { recursive: true });
    }

    // 生成各页面
    this.generateOverviewPage(collectionStatus);
    this.generateScenarioListPage();
    
    if (this.config.includeScenarios) {
      this.generateScenarioDetailPages();
    }
    
    if (this.config.includeDifferences) {
      this.generateDifferenceAnalysisPage();
    }
    
    this.generateReleaseGatePage();
    
    if (this.config.includeDataComparison) {
      this.generateDataComparisonPage();
    }
    
    this.generateCollectionCredibilityPage(collectionStatus);
    this.generateIndexPage();

    console.log('[BusinessReport] Report generated successfully');
  }

  /**
   * 构建场景详情
   */
  private buildScenarioDetails(scenarios: Scenario[], results: DualExecutionResult[]): void {
    for (const scenario of scenarios) {
      const result = results.find(r => r.scenarioId === scenario.id);
      if (!result) continue;

      const detail: ScenarioDetail = {
        scenario,
        result,
        expected: this.buildExpectedDetails(scenario),
        legacy: this.buildLegacyDetails(result.legacyResult),
        current: this.buildCurrentDetails(result.currentResult),
        comparison: this.buildComparisonDetails(result)
      };

      this.scenarioDetails.set(scenario.id, detail);
    }
  }

  private buildExpectedDetails(scenario: Scenario) {
    const nodeDetails = scenario.actions.map((action, i) => ({
      nodeName: this.getNodeName(action.type),
      actor: action.actor,
      action: this.getActionLabel(action.type),
      preState: this.getPreState(scenario, i),
      postState: this.getPostState(scenario, i)
    }));

    return {
      finalState: scenario.expected?.finalState || 'UNKNOWN',
      semanticPath: scenario.expected?.semanticPath || scenario.actions.map(a => a.type),
      nodeDetails
    };
  }

  private buildLegacyDetails(result: any) {
    if (!result) {
      return {
        finalState: '未执行',
        semanticPath: [],
        nodeDetails: [],
        apiCalls: [],
        databaseChanges: {}
      };
    }

    return {
      finalState: result.finalState,
      semanticPath: result.semanticPath || [],
      nodeDetails: this.extractNodeDetails(result),
      apiCalls: this.extractApiCalls(result),
      databaseChanges: result.databaseChanges || {}
    };
  }

  private buildCurrentDetails(result: any) {
    if (!result) {
      return {
        finalState: '未执行',
        semanticPath: [],
        nodeDetails: [],
        apiCalls: [],
        databaseChanges: {}
      };
    }

    return {
      finalState: result.finalState,
      semanticPath: result.semanticPath || [],
      nodeDetails: this.extractNodeDetails(result),
      apiCalls: this.extractApiCalls(result),
      databaseChanges: result.databaseChanges || {}
    };
  }

  private buildComparisonDetails(result: DualExecutionResult) {
    const blockingDiffs = result.differences.filter(d => d.isBlocking || d.severity === 'P0' || d.severity === 'P1');
    
    let businessConclusion = '';
    if (result.error) {
      businessConclusion = '执行失败';
    } else if (blockingDiffs.length > 0) {
      businessConclusion = '存在阻断性差异';
    } else if (result.differences.length > 0) {
      businessConclusion = '存在非阻断性差异';
    } else {
      businessConclusion = '新旧流程一致';
    }

    return {
      finalStateMatch: result.legacyResult?.finalState === result.currentResult?.finalState,
      pathMatch: JSON.stringify(result.legacyResult?.semanticPath) === JSON.stringify(result.currentResult?.semanticPath),
      businessDataMatch: true, // 需要根据实际比较结果设置
      apiSemanticMatch: true,
      differences: result.differences,
      businessConclusion,
      blockingDifferences: blockingDiffs
    };
  }

  private extractNodeDetails(result: any): Array<any> {
    if (!result.auditRecords) return [];
    return result.auditRecords.map((record: any) => ({
      nodeName: record.action || record.nodeName || 'UNKNOWN',
      actor: record.actor || 'SYSTEM',
      action: record.action || 'N/A',
      timestamp: record.timestamp || '',
      preState: record.oldState || '',
      postState: record.state || record.newState || ''
    }));
  }

  private extractApiCalls(result: any): Array<any> {
    if (!result.externalCalls) return [];
    return result.externalCalls.map((call: any) => ({
      endpoint: call.endpoint || 'UNKNOWN',
      method: call.method || 'GET',
      statusCode: call.statusCode || 0
    }));
  }

  /**
   * 生成总览页
   */
  private generateOverviewPage(collectionStatus: CollectionStatus): void {
    const details = Array.from(this.scenarioDetails.values());
    const passed = details.filter(d => d.comparison.businessConclusion === '新旧流程一致').length;
    const failed = details.filter(d => d.comparison.businessConclusion !== '新旧流程一致').length;
    const blocking = details.filter(d => d.comparison.blockingDifferences.length > 0).length;

    const p0Count = details.reduce((sum, d) => 
      sum + d.comparison.differences.filter(diff => diff.severity === 'P0').length, 0);
    const p1Count = details.reduce((sum, d) => 
      sum + d.comparison.differences.filter(diff => diff.severity === 'P1').length, 0);
    const p2Count = details.reduce((sum, d) => 
      sum + d.comparison.differences.filter(diff => diff.severity === 'P2').length, 0);
    const p3Count = details.reduce((sum, d) => 
      sum + d.comparison.differences.filter(diff => diff.severity === 'P3').length, 0);

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>测试总览 - FlowTrace</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f0f2f5; }
    .container { max-width: 1400px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #1a73e8 0%, #0d47a1 100%); color: white; padding: 40px; border-radius: 16px; margin-bottom: 24px; }
    .header h1 { margin: 0 0 10px 0; font-size: 32px; }
    .header .subtitle { opacity: 0.9; font-size: 18px; }
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card h2 { margin: 0 0 20px 0; color: #333; border-bottom: 2px solid #1a73e8; padding-bottom: 10px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .stat-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 24px; border-radius: 12px; text-align: center; }
    .stat-card.green { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
    .stat-card.red { background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%); }
    .stat-card.orange { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
    .stat-value { font-size: 48px; font-weight: bold; margin: 10px 0; }
    .stat-label { font-size: 14px; opacity: 0.9; }
    .status-table { width: 100%; border-collapse: collapse; }
    .status-table th, .status-table td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    .status-table th { background: #f8f9fa; font-weight: 600; }
    .status-badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .status-badge.success { background: #d4edda; color: #155724; }
    .status-badge.warning { background: #fff3cd; color: #856404; }
    .status-badge.error { background: #f8d7da; color: #721c24; }
    .severity-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .severity-badge.P0 { background: #dc3545; color: white; }
    .severity-badge.P1 { background: #fd7e14; color: white; }
    .severity-badge.P2 { background: #ffc107; color: black; }
    .severity-badge.P3 { background: #6c757d; color: white; }
    .alert-box { padding: 20px; border-radius: 8px; margin: 20px 0; }
    .alert-box.danger { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
    .alert-box.warning { background: #fff3cd; border: 1px solid #ffeeba; color: #856404; }
    .alert-box.success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
    .nav-links { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
    .nav-link { padding: 12px 24px; background: white; border-radius: 8px; text-decoration: none; color: #1a73e8; font-weight: 500; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: transform 0.2s; }
    .nav-link:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.15); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${this.config.projectName} - FlowTrace 测试总览</h1>
      <div class="subtitle">生成时间: ${new Date().toLocaleString('zh-CN')}</div>
    </div>

    <div class="card">
      <h2>一、测试概览</h2>
      <div class="grid">
        <div class="stat-card">
          <div class="stat-label">测试总数</div>
          <div class="stat-value">${details.length}</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">通过</div>
          <div class="stat-value">${passed}</div>
        </div>
        <div class="stat-card red">
          <div class="stat-label">失败</div>
          <div class="stat-value">${failed}</div>
        </div>
        <div class="stat-card orange">
          <div class="stat-label">阻断性问题</div>
          <div class="stat-value">${blocking}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>二、差异统计</h2>
      <div class="grid">
        <div class="stat-card">
          <div class="stat-label">P0 核心差异</div>
          <div class="stat-value" style="color: #dc3545;">${p0Count}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">P1 路径差异</div>
          <div class="stat-value" style="color: #fd7e14;">${p1Count}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">P2 非核心差异</div>
          <div class="stat-value" style="color: #ffc107;">${p2Count}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">P3 技术差异</div>
          <div class="stat-value" style="color: #6c757d;">${p3Count}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>三、执行模式</h2>
      <table class="status-table">
        <tr>
          <td><strong>Current Adapter 模式</strong></td>
          <td><span class="status-badge ${this.config.currentAdapterMode === 'legacy-shadow' ? 'warning' : 'success'}">${this.config.currentAdapterMode}</span></td>
          <td>${this.config.currentAdapterMode === 'legacy-shadow' ? '⚠️ 仅工具链演示，不能作为真实业务测试依据' : '✓ 真实系统执行'}</td>
        </tr>
        <tr>
          <td><strong>旧流程采集</strong></td>
          <td><span class="status-badge ${collectionStatus.runtimeCollected ? 'success' : 'error'}">${collectionStatus.runtimeCollected ? '已采集' : '未采集'}</span></td>
          <td>${collectionStatus.runtimeMessage}</td>
        </tr>
        <tr>
          <td><strong>数据库基线</strong></td>
          <td><span class="status-badge ${collectionStatus.databaseCollected ? 'success' : 'error'}">${collectionStatus.databaseCollected ? '已采集' : '未采集'}</span></td>
          <td>${collectionStatus.databaseMessage}</td>
        </tr>
        <tr>
          <td><strong>API 基线</strong></td>
          <td><span class="status-badge ${collectionStatus.apiCollected ? 'success' : 'error'}">${collectionStatus.apiCollected ? '已采集' : '未采集'}</span></td>
          <td>${collectionStatus.apiMessage}</td>
        </tr>
      </table>

      ${this.config.currentAdapterMode === 'legacy-shadow' ? `
      <div class="alert-box danger">
        <strong>⚠️ 重要提示</strong><br>
        当前使用 legacy-shadow 模式，测试结果仅验证框架，不能证明新旧流程等价。<br>
        如需进行真实业务测试，必须配置真实的 Current Adapter。
      </div>
      ` : ''}
    </div>

    <div class="card">
      <h2>四、导航</h2>
      <div class="nav-links">
        <a href="index.html" class="nav-link">🏠 总览</a>
        <a href="scenarios.html" class="nav-link">📋 场景清单</a>
        <a href="differences.html" class="nav-link">🔍 差异分析</a>
        <a href="release-gate.html" class="nav-link">🚦 Release Gate</a>
        <a href="data-comparison.html" class="nav-link">📊 数据对比</a>
        <a href="collection-status.html" class="nav-link">📦 采集可信度</a>
      </div>
    </div>
  </div>
</body>
</html>`;

    writeFileSync(join(this.config.outputDir, 'overview.html'), html, 'utf-8');
  }

  /**
   * 生成场景清单页
   */
  private generateScenarioListPage(): void {
    const details = Array.from(this.scenarioDetails.values());
    
    const rows = details.map(d => `
      <tr>
        <td><a href="scenario-${d.scenario.id}.html">${d.scenario.name}</a></td>
        <td>${d.scenario.severity || 'P2'}</td>
        <td>${d.expected.finalState}</td>
        <td>${d.legacy.finalState}</td>
        <td>${d.current.finalState}</td>
        <td>${d.comparison.businessConclusion}</td>
        <td>${d.result.passed ? '<span class="status-badge success">通过</span>' : '<span class="status-badge error">失败</span>'}</td>
        <td>${d.comparison.differences.length}</td>
      </tr>
    `).join('\n');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>场景清单 - FlowTrace</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #f0f2f5; }
    .container { max-width: 1400px; margin: 0 auto; }
    .header { background: white; padding: 30px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header h1 { margin: 0; color: #333; }
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 14px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; position: sticky; top: 0; }
    tr:hover { background: #f8f9fa; }
    a { color: #1a73e8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .severity-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .severity-badge.P0 { background: #dc3545; color: white; }
    .severity-badge.P1 { background: #fd7e14; color: white; }
    .severity-badge.P2 { background: #ffc107; color: black; }
    .severity-badge.P3 { background: #6c757d; color: white; }
    .status-badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .status-badge.success { background: #d4edda; color: #155724; }
    .status-badge.error { background: #f8d7da; color: #721c24; }
    .back-link { display: inline-block; padding: 10px 20px; background: #1a73e8; color: white; text-decoration: none; border-radius: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <a href="overview.html" class="back-link">← 返回总览</a>
    
    <div class="header">
      <h1>测试场景清单</h1>
      <p>共 ${details.length} 个测试场景</p>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>场景名称</th>
            <th>严重级别</th>
            <th>预期状态</th>
            <th>旧流程状态</th>
            <th>新流程状态</th>
            <th>对比结论</th>
            <th>测试结果</th>
            <th>差异数量</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

    writeFileSync(join(this.config.outputDir, 'scenarios.html'), html, 'utf-8');
  }

  /**
   * 生成场景详情页
   */
  private generateScenarioDetailPages(): void {
    for (const [id, detail] of this.scenarioDetails) {
      const html = this.generateScenarioDetailHtml(detail);
      writeFileSync(join(this.config.outputDir, `scenario-${id}.html`), html, 'utf-8');
    }
  }

  private generateScenarioDetailHtml(detail: ScenarioDetail): string {
    const expectedPath = detail.expected.semanticPath.join(' → ');
    const legacyPath = detail.legacy.semanticPath.join(' → ');
    const currentPath = detail.current.semanticPath.join(' → ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${detail.scenario.name} - FlowTrace</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #f0f2f5; }
    .container { max-width: 1400px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; border-radius: 16px; margin-bottom: 24px; }
    .header h1 { margin: 0 0 10px 0; font-size: 28px; }
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card h2 { margin: 0 0 15px 0; color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
    .comparison-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
    .comparison-box { padding: 20px; border-radius: 8px; background: #f8f9fa; }
    .comparison-box.expected { border-left: 4px solid #1a73e8; }
    .comparison-box.legacy { border-left: 4px solid #11998e; }
    .comparison-box.current { border-left: 4px solid #f5576c; }
    .comparison-box h3 { margin: 0 0 10px 0; font-size: 16px; }
    .comparison-box .state { font-size: 24px; font-weight: bold; margin: 10px 0; }
    .comparison-box .path { font-size: 12px; color: #666; word-break: break-all; }
    .match { color: #28a745; }
    .mismatch { color: #dc3545; }
    .mermaid { background: #fafafa; padding: 20px; border-radius: 8px; text-align: center; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; }
    .severity-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .severity-badge.P0 { background: #dc3545; color: white; }
    .severity-badge.P1 { background: #fd7e14; color: white; }
    .severity-badge.P2 { background: #ffc107; color: black; }
    .severity-badge.P3 { background: #6c757d; color: white; }
    .diff-item { padding: 15px; border-radius: 8px; margin: 10px 0; background: #fff3cd; border-left: 4px solid #ffc107; }
    .diff-item.P0 { background: #f8d7da; border-color: #dc3545; }
    .diff-item.P1 { background: #ffe6e6; border-color: #fd7e14; }
    .conclusion { padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; font-size: 18px; font-weight: bold; }
    .conclusion.pass { background: #d4edda; color: #155724; }
    .conclusion.fail { background: #f8d7da; color: #721c24; }
    .back-link { display: inline-block; padding: 10px 20px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <a href="scenarios.html" class="back-link">← 返回场景清单</a>
    
    <div class="header">
      <h1>${detail.scenario.name}</h1>
      <p>案例编号: ${detail.scenario.id} | 严重级别: <span class="severity-badge ${detail.scenario.severity || 'P2'}">${detail.scenario.severity || 'P2'}</span></p>
    </div>

    <div class="card">
      <h2>预期 vs 实际对比</h2>
      <div class="comparison-grid">
        <div class="comparison-box expected">
          <h3>📋 预期流程</h3>
          <div class="state">${detail.expected.finalState}</div>
          <div class="path">${expectedPath || '未定义'}</div>
        </div>
        <div class="comparison-box legacy">
          <h3>🔄 旧流程实际</h3>
          <div class="state">${detail.legacy.finalState}</div>
          <div class="path">${legacyPath || '未执行'}</div>
        </div>
        <div class="comparison-box current">
          <h3>✨ 新流程实际</h3>
          <div class="state">${detail.current.finalState}</div>
          <div class="path">${currentPath || '未执行'}</div>
        </div>
      </div>
      
      <div class="conclusion ${detail.result.passed ? 'pass' : 'fail'}">
        ${detail.comparison.businessConclusion}
      </div>
    </div>

    <div class="card">
      <h2>流程对比详情</h2>
      <table>
        <thead>
          <tr>
            <th>对比项</th>
            <th>预期</th>
            <th>旧流程</th>
            <th>新流程</th>
            <th>是否一致</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>最终状态</td>
            <td>${detail.expected.finalState}</td>
            <td>${detail.legacy.finalState}</td>
            <td>${detail.current.finalState}</td>
            <td class="${detail.comparison.finalStateMatch ? 'match' : 'mismatch'}">${detail.comparison.finalStateMatch ? '✓ 一致' : '✗ 不一致'}</td>
          </tr>
          <tr>
            <td>流程路径</td>
            <td>${expectedPath}</td>
            <td>${legacyPath}</td>
            <td>${currentPath}</td>
            <td class="${detail.comparison.pathMatch ? 'match' : 'mismatch'}">${detail.comparison.pathMatch ? '✓ 一致' : '✗ 不一致'}</td>
          </tr>
        </tbody>
      </table>
    </div>

    ${detail.comparison.differences.length > 0 ? `
    <div class="card">
      <h2>差异明细</h2>
      ${detail.comparison.differences.map(diff => `
        <div class="diff-item ${diff.severity}">
          <strong><span class="severity-badge ${diff.severity}">${diff.severity}</span> ${diff.category}</strong>
          <p>${diff.description}</p>
          ${diff.legacyValue !== undefined ? `<p>旧值: ${JSON.stringify(diff.legacyValue)}</p>` : ''}
          ${diff.currentValue !== undefined ? `<p>新值: ${JSON.stringify(diff.currentValue)}</p>` : ''}
        </div>
      `).join('')}
    </div>
    ` : ''}

    <div class="card">
      <h2>业务影响分析</h2>
      <p>${this.getBusinessImpact(detail)}</p>
    </div>
  </div>

  <script>mermaid.initialize({ startOnLoad: true });</script>
</body>
</html>`;
  }

  private getBusinessImpact(detail: ScenarioDetail): string {
    const p0Count = detail.comparison.differences.filter(d => d.severity === 'P0').length;
    const p1Count = detail.comparison.differences.filter(d => d.severity === 'P1').length;

    if (p0Count > 0) {
      return `⚠️ 此场景存在 ${p0Count} 个核心业务差异（P0），可能导致金额计算错误、权限问题或关键数据不一致，<strong>必须修复后才能发布</strong>。`;
    }
    if (p1Count > 0) {
      return `⚡ 此场景存在 ${p1Count} 个业务路径差异（P1），可能影响业务流程的正确性，<strong>需要业务人员确认</strong>。`;
    }
    if (detail.comparison.differences.length > 0) {
      return `ℹ️ 此场景存在 ${detail.comparison.differences.length} 个非核心差异，属于可接受范围。`;
    }
    return `✅ 此场景新旧流程完全一致，可以放心发布。`;
  }

  /**
   * 生成差异分析页
   */
  private generateDifferenceAnalysisPage(): void {
    const allDifferences: Array<{ scenarioId: string; scenarioName: string; diff: Difference }> = [];
    
    for (const [scenarioId, detail] of this.scenarioDetails) {
      for (const diff of detail.comparison.differences) {
        allDifferences.push({
          scenarioId,
          scenarioName: detail.scenario.name,
          diff
        });
      }
    }

    const rows = allDifferences.map(item => `
      <tr>
        <td><a href="scenario-${item.scenarioId}.html">${item.scenarioName}</a></td>
        <td><span class="severity-badge ${item.diff.severity}">${item.diff.severity}</span></td>
        <td>${item.diff.category}</td>
        <td>${item.diff.description}</td>
        <td>${JSON.stringify(item.diff.legacyValue)}</td>
        <td>${JSON.stringify(item.diff.currentValue)}</td>
        <td>${item.diff.isBlocking ? '是' : '否'}</td>
      </tr>
    `).join('\n');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>差异分析 - FlowTrace</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #f0f2f5; }
    .container { max-width: 1600px; margin: 0 auto; }
    .header { background: white; padding: 30px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 1000px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; position: sticky; top: 0; }
    tr:hover { background: #f8f9fa; }
    a { color: #1a73e8; text-decoration: none; }
    .severity-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
    .severity-badge.P0 { background: #dc3545; color: white; }
    .severity-badge.P1 { background: #fd7e14; color: white; }
    .severity-badge.P2 { background: #ffc107; color: black; }
    .severity-badge.P3 { background: #6c757d; color: white; }
    .back-link { display: inline-block; padding: 10px 20px; background: #1a73e8; color: white; text-decoration: none; border-radius: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <a href="overview.html" class="back-link">← 返回总览</a>
    
    <div class="header">
      <h1>差异分析报告</h1>
      <p>共 ${allDifferences.length} 个差异</p>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>场景</th>
            <th>严重级别</th>
            <th>差异类别</th>
            <th>描述</th>
            <th>旧值</th>
            <th>新值</th>
            <th>是否阻断</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="7" style="text-align:center;">无差异</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

    writeFileSync(join(this.config.outputDir, 'differences.html'), html, 'utf-8');
  }

  /**
   * 生成 Release Gate 页
   */
  private generateReleaseGatePage(): void {
    const details = Array.from(this.scenarioDetails.values());
    const blockingCount = details.filter(d => d.comparison.blockingDifferences.length > 0).length;
    const canRelease = blockingCount === 0;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Release Gate - FlowTrace</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #f0f2f5; }
    .container { max-width: 1000px; margin: 0 auto; }
    .gate-box { padding: 40px; border-radius: 16px; text-align: center; margin-bottom: 30px; }
    .gate-box.pass { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; }
    .gate-box.block { background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%); color: white; }
    .gate-box h1 { font-size: 48px; margin: 0 0 20px 0; }
    .gate-box p { font-size: 18px; opacity: 0.9; }
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card h2 { margin: 0 0 15px 0; color: #333; }
    .checklist { list-style: none; padding: 0; }
    .checklist li { padding: 12px; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 10px; }
    .checklist li:last-child { border-bottom: none; }
    .check-icon { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; }
    .check-icon.pass { background: #28a745; color: white; }
    .check-icon.fail { background: #dc3545; color: white; }
    .back-link { display: inline-block; padding: 10px 20px; background: #1a73e8; color: white; text-decoration: none; border-radius: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <a href="overview.html" class="back-link">← 返回总览</a>
    
    <div class="gate-box ${canRelease ? 'pass' : 'block'}">
      <h1>${canRelease ? '✅ 可以发布' : '❌ 禁止发布'}</h1>
      <p>${canRelease ? '所有阻断性问题已解决，可以继续发布流程变更。' : `存在 ${blockingCount} 个阻断性问题，必须修复后才能发布。`}</p>
    </div>

    <div class="card">
      <h2>发布检查清单</h2>
      <ul class="checklist">
        <li>
          <span class="check-icon ${blockingCount === 0 ? 'pass' : 'fail'}">${blockingCount === 0 ? '✓' : '✗'}</span>
          P0/P1 差异数量: ${blockingCount} ${blockingCount === 0 ? '(通过)' : '(不通过)'}
        </li>
        <li>
          <span class="check-icon ${this.config.currentAdapterMode !== 'legacy-shadow' ? 'pass' : 'fail'}">${this.config.currentAdapterMode !== 'legacy-shadow' ? '✓' : '✗'}</span>
          Current Adapter 模式: ${this.config.currentAdapterMode} ${this.config.currentAdapterMode === 'legacy-shadow' ? '(legacy-shadow，不能作为真实业务依据)' : '(真实执行)'}
        </li>
        <li>
          <span class="check-icon pass">✓</span>
          测试案例数: ${details.length}
        </li>
      </ul>
    </div>

    ${!canRelease ? `
    <div class="card" style="border-left: 4px solid #dc3545;">
      <h2>阻断性问题</h2>
      <p>以下问题必须修复才能发布：</p>
      ${details.filter(d => d.comparison.blockingDifferences.length > 0).map(d => `
        <div style="margin: 10px 0; padding: 15px; background: #f8f9fa; border-radius: 8px;">
          <strong>${d.scenario.name}</strong>
          <ul>
            ${d.comparison.blockingDifferences.map(diff => `<li>${diff.description}</li>`).join('')}
          </ul>
        </div>
      `).join('')}
    </div>
    ` : ''}
  </div>
</body>
</html>`;

    writeFileSync(join(this.config.outputDir, 'release-gate.html'), html, 'utf-8');
  }

  /**
   * 生成数据对比页
   */
  private generateDataComparisonPage(): void {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>数据与 API 对比 - FlowTrace</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #f0f2f5; }
    .container { max-width: 1200px; margin: 0 auto; }
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card h2 { margin: 0 0 15px 0; color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
    .back-link { display: inline-block; padding: 10px 20px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin-bottom: 20px; }
    .api-card { padding: 15px; border: 1px solid #eee; border-radius: 8px; margin: 10px 0; }
    .api-card .method { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; background: #1a73e8; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <a href="overview.html" class="back-link">← 返回总览</a>
    
    <div class="card">
      <h2>API 调用对比</h2>
      <p>API 双跑功能需要配置真实的 API 连接才能使用。</p>
    </div>

    <div class="card">
      <h2>数据库变化对比</h2>
      <p>数据库双跑功能需要配置真实的数据库连接才能使用。</p>
    </div>
  </div>
</body>
</html>`;

    writeFileSync(join(this.config.outputDir, 'data-comparison.html'), html, 'utf-8');
  }

  /**
   * 生成采集可信度页
   */
  private generateCollectionCredibilityPage(collectionStatus: CollectionStatus): void {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>采集可信度 - FlowTrace</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #f0f2f5; }
    .container { max-width: 1000px; margin: 0 auto; }
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card h2 { margin: 0 0 15px 0; color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
    .status-item { display: flex; align-items: flex-start; gap: 15px; padding: 20px; border: 1px solid #eee; border-radius: 8px; margin: 15px 0; }
    .status-icon { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; }
    .status-icon.success { background: #d4edda; color: #28a745; }
    .status-icon.warning { background: #fff3cd; color: #ffc107; }
    .status-icon.error { background: #f8d7da; color: #dc3545; }
    .status-content h3 { margin: 0 0 5px 0; }
    .status-content p { margin: 0; color: #666; }
    .back-link { display: inline-block; padding: 10px 20px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin-bottom: 20px; }
    .alert { padding: 20px; border-radius: 8px; margin: 20px 0; }
    .alert.warning { background: #fff3cd; border: 1px solid #ffc107; color: #856404; }
    .alert.danger { background: #f8d7da; border: 1px solid #dc3545; color: #721c24; }
  </style>
</head>
<body>
  <div class="container">
    <a href="overview.html" class="back-link">← 返回总览</a>
    
    <div class="card">
      <h2>采集可信度评估</h2>
      <p>FlowTrace 测试结果的可信度取决于基线数据的采集来源。</p>
    </div>

    <div class="card">
      <h2>数据采集状态</h2>
      
      <div class="status-item">
        <div class="status-icon ${collectionStatus.sourceCollected ? 'success' : 'warning'}">
          ${collectionStatus.sourceCollected ? '✓' : '⚠'}
        </div>
        <div class="status-content">
          <h3>源码采集</h3>
          <p>${collectionStatus.sourceCollected ? '已从源码提取流程定义和 API 信息' : '未执行源码采集'}</p>
        </div>
      </div>

      <div class="status-item">
        <div class="status-icon ${collectionStatus.runtimeCollected ? 'success' : 'warning'}">
          ${collectionStatus.runtimeCollected ? '✓' : '⚠'}
        </div>
        <div class="status-content">
          <h3>运行时数据采集</h3>
          <p>${collectionStatus.runtimeCollected ? '已采集真实流程实例数据' : '未采集运行时数据'}</p>
          <p style="color: #888; font-size: 12px;">${collectionStatus.runtimeMessage}</p>
        </div>
      </div>

      <div class="status-item">
        <div class="status-icon ${collectionStatus.databaseCollected ? 'success' : 'warning'}">
          ${collectionStatus.databaseCollected ? '✓' : '⚠'}
        </div>
        <div class="status-content">
          <h3>数据库基线</h3>
          <p>${collectionStatus.databaseCollected ? '已采集数据库表结构和样本数据' : '未采集数据库数据'}</p>
          <p style="color: #888; font-size: 12px;">${collectionStatus.databaseMessage}</p>
        </div>
      </div>

      <div class="status-item">
        <div class="status-icon ${collectionStatus.apiCollected ? 'success' : 'warning'}">
          ${collectionStatus.apiCollected ? '✓' : '⚠'}
        </div>
        <div class="status-content">
          <h3>API 调用记录</h3>
          <p>${collectionStatus.apiCollected ? '已采集真实 API 调用记录' : '未采集 API 调用记录'}</p>
          <p style="color: #888; font-size: 12px;">${collectionStatus.apiMessage}</p>
        </div>
      </div>
    </div>

    ${this.config.currentAdapterMode === 'legacy-shadow' || !collectionStatus.runtimeCollected ? `
    <div class="alert warning">
      <strong>⚠️ 可信度限制</strong><br>
      当前测试结果不能完全证明新旧流程等价，需要：<br>
      <ul>
        <li>配置真实的 Current Adapter（不是 legacy-shadow）</li>
        <li>采集真实的运行时数据</li>
        <li>配置数据库连接以采集数据库基线</li>
        <li>配置 API 连接以采集 API 调用记录</li>
      </ul>
    </div>
    ` : `
    <div class="alert" style="background: #d4edda; border: 1px solid #28a745; color: #155724;">
      <strong>✅ 可信度较高</strong><br>
      测试基于真实数据，可以作为新旧流程等价性的参考依据。
    </div>
    `}
  </div>
</body>
</html>`;

    writeFileSync(join(this.config.outputDir, 'collection-status.html'), html, 'utf-8');
  }

  /**
   * 生成索引页
   */
  private generateIndexPage(): void {
    const details = Array.from(this.scenarioDetails.values());
    
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>FlowTrace 测试报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; background: #f0f2f5; }
    .container { max-width: 800px; margin: 0 auto; }
    .card { background: white; border-radius: 16px; padding: 40px; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 10px 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { color: #666; margin-bottom: 30px; }
    .nav { display: grid; gap: 12px; }
    .nav a { padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 12px; display: flex; align-items: center; gap: 15px; transition: transform 0.2s; }
    .nav a:hover { transform: translateX(5px); }
    .nav-icon { font-size: 24px; }
    .nav-text { flex: 1; }
    .nav-text strong { display: block; font-size: 18px; margin-bottom: 5px; }
    .nav-text span { font-size: 14px; opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>FlowTrace 测试报告</h1>
      <p class="subtitle">${this.config.projectName} | ${new Date().toLocaleString('zh-CN')}</p>
      
      <div class="nav">
        <a href="overview.html">
          <span class="nav-icon">📊</span>
          <span class="nav-text">
            <strong>总览</strong>
            <span>测试统计和执行模式概览</span>
          </span>
        </a>
        <a href="scenarios.html">
          <span class="nav-icon">📋</span>
          <span class="nav-text">
            <strong>场景清单</strong>
            <span>${details.length} 个测试场景</span>
          </span>
        </a>
        <a href="differences.html">
          <span class="nav-icon">🔍</span>
          <span class="nav-text">
            <strong>差异分析</strong>
            <span>所有差异的详细列表</span>
          </span>
        </a>
        <a href="release-gate.html">
          <span class="nav-icon">🚦</span>
          <span class="nav-text">
            <strong>Release Gate</strong>
            <span>发布决策和检查清单</span>
          </span>
        </a>
        <a href="data-comparison.html">
          <span class="nav-icon">📊</span>
          <span class="nav-text">
            <strong>数据对比</strong>
            <span>数据库和 API 对比详情</span>
          </span>
        </a>
        <a href="collection-status.html">
          <span class="nav-icon">📦</span>
          <span class="nav-text">
            <strong>采集可信度</strong>
            <span>数据来源和质量评估</span>
          </span>
        </a>
      </div>
    </div>
  </div>
</body>
</html>`;

    writeFileSync(join(this.config.outputDir, 'index.html'), html, 'utf-8');
  }

  // 辅助方法
  private getNodeName(actionType: string): string {
    const names: Record<string, string> = {
      'SUBMIT': '提交申请',
      'APPROVE': '审批通过',
      'REJECT': '审批拒绝',
      'RETURN': '退回补充',
      'WITHDRAW': '主动撤回',
      'TRANSFER': '转交',
      'COUNTERSIGN': '启动并签',
      'COUNTERSIGN_COMPLETE': '并签完成'
    };
    return names[actionType] || actionType;
  }

  private getActionLabel(type: string): string {
    const labels: Record<string, string> = {
      'SUBMIT': '提交',
      'APPROVE': '通过',
      'REJECT': '拒绝',
      'RETURN': '退回',
      'WITHDRAW': '撤回',
      'TRANSFER': '转交',
      'COUNTERSIGN': '并签',
      'COUNTERSIGN_COMPLETE': '并签完成'
    };
    return labels[type] || type;
  }

  private getPreState(scenario: Scenario, stepIndex: number): string {
    if (stepIndex === 0) return 'DRAFT';
    return 'PROCESSING';
  }

  private getPostState(scenario: Scenario, stepIndex: number): string {
    if (stepIndex === scenario.actions.length - 1) {
      return scenario.expected?.finalState || 'COMPLETED';
    }
    return 'PROCESSING';
  }
}

/**
 * 创建业务报告生成器
 */
export function createBusinessReportGenerator(config?: Partial<BusinessReportConfig>): BusinessReportGenerator {
  return new BusinessReportGenerator(config || {});
}
