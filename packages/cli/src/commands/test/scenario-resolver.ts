/**
 * Login Scenario Resolver
 * 
 * 解析和筛选登录测试场景
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve, extname, join } from 'path';
import yaml from 'js-yaml';
import type { Scenario } from '@flowtrace/core';
import { validateScenario, ScenarioSchema } from '@flowtrace/core';

export interface ScenarioFilter {
  /** 流程 ID */
  process?: string;
  /** 场景 ID */
  id?: string;
  /** 标签筛选 */
  tags?: string[];
  /** 只返回启用的场景 */
  enabledOnly?: boolean;
}

export interface ScenarioResolverOptions {
  /** 场景目录路径 */
  scenariosDir: string;
  /** 过滤器 */
  filter?: ScenarioFilter;
}

export interface ResolvedScenario {
  scenario: Scenario;
  validationErrors: string[];
  filePath: string;
}

/**
 * 场景解析结果
 */
export interface ScenarioResolutionResult {
  /** 有效场景 */
  validScenarios: ResolvedScenario[];
  /** 无效场景及其错误 */
  invalidScenarios: Array<{ scenario: unknown; errors: string[]; filePath: string }>;
  /** 解析错误 */
  parseErrors: Array<{ filePath: string; error: string }>;
}

/**
 * 解析单个场景文件
 */
function parseScenarioFile(filePath: string): { data: unknown; error?: string } {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const ext = extname(filePath).toLowerCase();

    let data: unknown;
    if (ext === '.json') {
      data = JSON.parse(content);
    } else if (ext === '.yaml' || ext === '.yml') {
      data = yaml.load(content);
    } else {
      return { data: null as any, error: `Unsupported file extension: ${ext}` };
    }

    return { data };
  } catch (error) {
    return {
      data: null as any,
      error: `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * 加载场景目录中的所有场景
 */
export function loadScenariosFromDir(scenariosDir: string): unknown[] {
  const scenarios: unknown[] = [];

  if (!existsSync(scenariosDir)) {
    return scenarios;
  }

  try {
    const files = readdirSync(scenariosDir, { withFileTypes: true });

    for (const file of files) {
      const fullPath = join(scenariosDir, file.name);

      if (file.isDirectory()) {
        // 递归加载子目录
        scenarios.push(...loadScenariosFromDir(fullPath));
      } else if (['.json', '.yaml', '.yml'].includes(extname(file.name).toLowerCase())) {
        const { data, error } = parseScenarioFile(fullPath);
        if (!error && data) {
          if (Array.isArray(data)) {
            scenarios.push(...data);
          } else {
            scenarios.push(data);
          }
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to load scenarios from ${scenariosDir}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return scenarios;
}

/**
 * 解析并筛选场景
 */
export function resolveScenarios(options: ScenarioResolverOptions): ScenarioResolutionResult {
  const scenariosDir = options.scenariosDir;
  const filter = options.filter || {};

  const rawScenarios = loadScenariosFromDir(scenariosDir);

  const validScenarios: ResolvedScenario[] = [];
  const invalidScenarios: Array<{ scenario: unknown; errors: string[]; filePath: string }> = [];
  const parseErrors: Array<{ filePath: string; error: string }> = [];

  for (const raw of rawScenarios) {
    // 应用过滤器
    if (filter.process && (raw as any).process !== filter.process) {
      continue;
    }
    if (filter.id && (raw as any).id !== filter.id) {
      continue;
    }
    if (filter.enabledOnly && (raw as any).enabled === false) {
      continue;
    }
    if (filter.tags && filter.tags.length > 0) {
      const scenarioTags = (raw as any).tags || [];
      const hasMatchingTag = filter.tags.some(tag => scenarioTags.includes(tag));
      if (!hasMatchingTag) {
        continue;
      }
    }

    // 验证场景
    const validation = validateScenario(raw);
    if (validation.valid) {
      validScenarios.push({
        scenario: raw as Scenario,
        validationErrors: [],
        filePath: ''
      });
    } else {
      invalidScenarios.push({
        scenario: raw,
        errors: validation.errors || ['Unknown validation error'],
        filePath: ''
      });
    }
  }

  return {
    validScenarios,
    invalidScenarios,
    parseErrors
  };
}

/**
 * 查找登录场景
 */
export function findLoginScenarios(scenariosDir: string): ScenarioResolutionResult {
  return resolveScenarios({
    scenariosDir,
    filter: {
      process: 'login',
      enabledOnly: true
    }
  });
}

/**
 * 查找特定 ID 的场景
 */
export function findScenarioById(scenariosDir: string, scenarioId: string): Scenario | null {
  const rawScenarios = loadScenariosFromDir(scenariosDir);

  for (const raw of rawScenarios) {
    if ((raw as any).id === scenarioId) {
      const validation = validateScenario(raw);
      if (validation.valid) {
        return raw as Scenario;
      }
    }
  }

  return null;
}

/**
 * 获取所有启用的场景
 */
export function getEnabledScenarios(scenariosDir: string): Scenario[] {
  const result = resolveScenarios({
    scenariosDir,
    filter: {
      enabledOnly: true
    }
  });

  return result.validScenarios.map(r => r.scenario);
}

/**
 * 验证场景文件的安全性问题
 */
export function checkScenarioSecurity(scenario: unknown): { hasIssues: boolean; issues: string[] } {
  const issues: string[] = [];
  const jsonStr = JSON.stringify(scenario);

  // 检查明文密码
  const passwordPatterns = [
    /password["\s]*:\s*["'][^$][^'"]+['"]/gi,
    /pwd["\s]*:\s*["'][^$][^'"]+['"]/gi,
    /passwd["\s]*:\s*["'][^$][^'"]+['"]/gi
  ];

  for (const pattern of passwordPatterns) {
    const matches = jsonStr.match(pattern);
    if (matches) {
      issues.push(`Found plaintext password pattern: ${matches[0].substring(0, 50)}...`);
    }
  }

  // 检查 token
  const tokenPatterns = [
    /token["\s]*:\s*["'][^$][^'"]+['"]/gi,
    /api_key["\s]*:\s*["'][^$][^'"]+['"]/gi,
    /secret["\s]*:\s*["'][^$][^'"]+['"]/gi
  ];

  for (const pattern of tokenPatterns) {
    const matches = jsonStr.match(pattern);
    if (matches) {
      issues.push(`Found plaintext secret pattern: ${matches[0].substring(0, 50)}...`);
    }
  }

  // 检查 cookie
  if (jsonStr.match(/cookie["\s]*:/gi)) {
    issues.push('Found cookie field - ensure cookies are not stored in plaintext');
  }

  return {
    hasIssues: issues.length > 0,
    issues
  };
}
