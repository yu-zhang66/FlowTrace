/**
 * FlowTrace Configuration Pre-Checker
 *
 * 在生成测试案例前检查所有必要配置的完整性
 * 缺少配置时返回 BLOCKED_MISSING_CONFIG 状态
 */
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { loadTargetProjectConfig } from './target-config.js';

// ============================================================
// Types & Schemas
// ============================================================

/**
 * P0 配置检查项（阻断项，缺失则不执行测试）
 */
const P0_CONFIG_KEYS = [
  'applicant_account',
  'test_enterprise',
  'valid_credit',
  'financing_flow_code',
  'oracle_readonly_connection'
] as const;

/**
 * P1 配置检查项（警告项，缺失时测试可能部分阻断）
 */
const P1_CONFIG_KEYS = [
  'approval_node_accounts',
  'signing_accounts',
  'transfer_target_account',
  'test_enterprise_permissions',
  'available_plans',
  'contracts_agreements',
  'documents',
  'business_materials'
] as const;

/**
 * P2 配置检查项（信息项）
 */
const P2_CONFIG_KEYS = [
  'login_captcha_strategy',
  'app_base_url',
  'legacy_adapter_mode',
  'current_adapter_mode',
  'bank_isolation_strategy',
  'payment_isolation_strategy',
  'signature_isolation_strategy'
] as const;

export type P0ConfigKey = typeof P0_CONFIG_KEYS[number];
export type P1ConfigKey = typeof P1_CONFIG_KEYS[number];
export type P2ConfigKey = typeof P2_CONFIG_KEYS[number];

/**
 * 配置检查选项
 */
export interface ConfigCheckOptions {
  /** 目标项目路径 */
  projectPath: string;
  /** 流程 ID（可选） */
  processId?: string;
  /** 是否检查数据库连接 */
  checkDatabase?: boolean;
  /** 是否检查适配器配置 */
  checkAdapters?: boolean;
}

/**
 * 配置检查结果
 */
export interface ConfigCheckResult {
  /** 检查状态：READY 或 BLOCKED_MISSING_CONFIG */
  status: 'READY' | 'BLOCKED_MISSING_CONFIG';
  /** P0 缺失的配置项 */
  p0Missing: string[];
  /** P1 缺失的配置项 */
  p1Missing: string[];
  /** P2 缺失的配置项 */
  p2Missing: string[];
  /** 警告信息 */
  warnings: string[];
  /** 检查时间 */
  checkedAt: string;
  /** 项目标识 */
  project: string;
}

/**
 * 单级别检查结果
 */
interface LevelCheckResult {
  pass: boolean;
  missing: string[];
}

/**
 * 配置检查结果 Zod Schema
 */
export const ConfigCheckResultSchema = z.object({
  status: z.enum(['READY', 'BLOCKED_MISSING_CONFIG']),
  p0Missing: z.array(z.string()),
  p1Missing: z.array(z.string()),
  p2Missing: z.array(z.string()),
  warnings: z.array(z.string()),
  checkedAt: z.string(),
  project: z.string()
});

export type ConfigCheckResultType = z.infer<typeof ConfigCheckResultSchema>;

// ============================================================
// Sensitive Data Handling
// ============================================================

/**
 * 敏感配置前缀（这些配置不输出到日志）
 */
const SENSITIVE_PREFIXES = [
  'password',
  'secret',
  'token',
  'connection',
  'credential'
];

/**
 * 检查配置键是否为敏感配置
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_PREFIXES.some(prefix => lowerKey.includes(prefix));
}

/**
 * 脱敏处理：隐藏敏感配置的详细内容
 */
function sanitizeForLog(value: unknown, key: string): string {
  if (isSensitiveKey(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string' && value.length > 50) {
    return value.substring(0, 20) + '...[REDACTED]';
  }
  return String(value);
}

// ============================================================
// Config Loading
// ============================================================

/**
 * 从环境变量获取配置值
 */
function getFromEnv(envVar: string): string | undefined {
  return process.env[envVar];
}

/**
 * 尝试从多个来源获取配置值
 */
function resolveConfigValue(value: unknown, envVar?: string): { value: unknown; source: 'config' | 'env' | 'missing' } {
  if (envVar) {
    const envValue = getFromEnv(envVar);
    if (envValue !== undefined) {
      return { value: envValue, source: 'env' };
    }
  }
  return { value, source: value !== undefined ? 'config' : 'missing' };
}

/**
 * 从 YAML 配置中提取测试配置
 */
function loadTestConfig(projectPath: string): Record<string, unknown> {
  const candidates = [
    resolve(projectPath, '.flowtrace', 'flowtrace.yaml'),
    resolve(projectPath, '.flowtrace', 'flowtrace.yml'),
    resolve(projectPath, 'flowtrace.yaml'),
    resolve(projectPath, 'flowtrace.yml')
  ];

  for (const configPath of candidates) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        const raw = yaml.load(content) as Record<string, unknown>;

        // 尝试从 loginTest 配置获取
        const loginTest = raw['loginTest'] as Record<string, unknown> | undefined;
        if (loginTest) {
          return loginTest;
        }

        // 尝试从 scenarios 配置获取
        const scenarios = raw['scenarios'] as Record<string, unknown> | undefined;
        if (scenarios) {
          return scenarios;
        }

        // 直接返回顶层配置
        return raw;
      } catch {
        // 继续尝试下一个路径
      }
    }
  }

  return {};
}

/**
 * 加载测试凭据配置（从 JSON 配置文件）
 */
function loadCredentialsConfig(projectPath: string): Record<string, unknown> {
  const candidates = [
    resolve(projectPath, '.flowtrace', 'scenarios', 'user-login', 'login-test-config.json'),
    resolve(projectPath, 'scenarios', 'user-login', 'login-test-config.json'),
    resolve(projectPath, '.flowtrace', 'login-test-config.json'),
    resolve(projectPath, 'login-test-config.json')
  ];

  for (const configPath of candidates) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        continue;
      }
    }
  }

  return {};
}

// ============================================================
// ConfigChecker Class
// ============================================================

/**
 * FlowTrace 配置预检查器
 *
 * 在生成测试案例前检查所有必要配置的完整性
 */
export class ConfigChecker {
  private projectPath: string;
  private warnings: string[] = [];

  /**
   * 创建配置检查器实例
   * @param projectPath 目标项目路径
   */
  constructor(projectPath: string) {
    this.projectPath = resolve(projectPath);
  }

  /**
   * 检查 P0 配置（阻断项）
   * @returns P0 检查结果
   */
  async checkP0(): Promise<LevelCheckResult> {
    const missing: string[] = [];
    const config = loadTestConfig(this.projectPath);
    const credentials = loadCredentialsConfig(this.projectPath);

    for (const key of P0_CONFIG_KEYS) {
      const value = config[key] ?? credentials[key];
      const { source } = resolveConfigValue(value);

      if (source === 'missing') {
        missing.push(key);
      }
    }

    return {
      pass: missing.length === 0,
      missing
    };
  }

  /**
   * 检查 P1 配置（警告项）
   * @returns P1 检查结果
   */
  async checkP1(): Promise<LevelCheckResult> {
    const missing: string[] = [];
    const config = loadTestConfig(this.projectPath);
    const credentials = loadCredentialsConfig(this.projectPath);

    for (const key of P1_CONFIG_KEYS) {
      const value = config[key] ?? credentials[key];
      const { source } = resolveConfigValue(value);

      if (source === 'missing') {
        missing.push(key);
      }
    }

    return {
      pass: missing.length === 0,
      missing
    };
  }

  /**
   * 检查 P2 配置（信息项）
   * @returns P2 检查结果
   */
  async checkP2(): Promise<LevelCheckResult> {
    const missing: string[] = [];
    const config = loadTestConfig(this.projectPath);

    for (const key of P2_CONFIG_KEYS) {
      const value = config[key];
      if (value === undefined || value === null) {
        missing.push(key);
      }
    }

    return {
      pass: missing.length === 0,
      missing
    };
  }

  /**
   * 获取警告信息列表
   * @returns 警告信息数组
   */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * 添加警告信息
   * @param warning 警告内容
   */
  addWarning(warning: string): void {
    this.warnings.push(warning);
  }

  /**
   * 检查是否可以执行测试
   * @returns 是否可以执行（仅 P0 配置完整）
   */
  async canExecute(): Promise<boolean> {
    const p0Result = await this.checkP0();
    return p0Result.pass;
  }

  /**
   * 执行完整的配置检查
   * @param options 检查选项
   * @returns 配置检查结果
   */
  async check(options?: Partial<ConfigCheckOptions>): Promise<ConfigCheckResult> {
    const opts = {
      checkDatabase: true,
      checkAdapters: true,
      ...options
    };

    this.warnings = [];
    const warnings: string[] = [];

    // 加载目标项目配置
    let targetConfig;
    try {
      targetConfig = loadTargetProjectConfig(this.projectPath);
    } catch (error) {
      return {
        status: 'BLOCKED_MISSING_CONFIG',
        p0Missing: ['project_config'],
        p1Missing: [],
        p2Missing: [],
        warnings: [`无法加载项目配置: ${error instanceof Error ? error.message : String(error)}`],
        checkedAt: new Date().toISOString(),
        project: this.projectPath
      };
    }

    // 执行 P0/P1/P2 检查
    const [p0Result, p1Result, p2Result] = await Promise.all([
      this.checkP0(),
      this.checkP1(),
      this.checkP2()
    ]);

    // 检查适配器模式
    if (opts.checkAdapters && targetConfig.pilot) {
      const currentAdapterMode = targetConfig.pilot.currentAdapterMode;
      if (currentAdapterMode !== 'legacy-shadow') {
        warnings.push(
          `适配器模式 "${currentAdapterMode}" 不是 recommended 的 "legacy-shadow" 模式，` +
          '可能影响测试结果对比准确性'
        );
      }
    }

    // 检查数据库配置
    if (opts.checkDatabase) {
      if (!targetConfig.database.connection) {
        const dbConfigSource = targetConfig.database.configSource;
        if (!dbConfigSource || !existsSync(resolve(this.projectPath, dbConfigSource))) {
          warnings.push(
            '数据库连接配置不可用，请确保 config/database.yaml 存在或设置 database.connection'
          );
        }
      }
    }

    // 检查敏感配置是否从环境变量加载
    const config = loadTestConfig(this.projectPath);
    const loginTest = config['loginTest'] as Record<string, unknown> | undefined;
    if (loginTest && loginTest['credentials']) {
      const credentials = loginTest['credentials'] as Record<string, string>;
      for (const [key, envVar] of Object.entries(credentials)) {
        if (typeof envVar === 'string' && envVar.endsWith('_ENV')) {
          const envValue = getFromEnv(envVar);
          if (!envValue) {
            warnings.push(
              `敏感配置 "${key}" 引用了环境变量 ${envVar}，但该变量未设置`
            );
          }
        }
      }
    }

    // 合并警告
    warnings.push(...this.warnings);

    // 确定状态
    const status: 'READY' | 'BLOCKED_MISSING_CONFIG' =
      p0Result.missing.length > 0 ? 'BLOCKED_MISSING_CONFIG' : 'READY';

    // 构建结果
    const result: ConfigCheckResult = {
      status,
      p0Missing: p0Result.missing,
      p1Missing: p1Result.missing,
      p2Missing: p2Result.missing,
      warnings,
      checkedAt: new Date().toISOString(),
      project: targetConfig.project?.id || targetConfig.project?.name || 'unknown'
    };

    // 使用 Zod 验证结果格式
    try {
      ConfigCheckResultSchema.parse(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`配置检查结果格式错误: ${error.message}`);
      }
      throw error;
    }

    return result;
  }
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * 创建配置检查器
 * @param projectPath 项目路径
 * @returns ConfigChecker 实例
 */
export function createConfigChecker(projectPath: string): ConfigChecker {
  return new ConfigChecker(projectPath);
}

/**
 * 快速检查配置（返回是否可以执行测试）
 * @param projectPath 项目路径
 * @returns 是否可以执行
 */
export async function quickConfigCheck(projectPath: string): Promise<boolean> {
  const checker = new ConfigChecker(projectPath);
  return checker.canExecute();
}

/**
 * 完整检查配置
 * @param projectPath 项目路径
 * @param options 检查选项
 * @returns 检查结果
 */
export async function checkConfig(
  projectPath: string,
  options?: Partial<ConfigCheckOptions>
): Promise<ConfigCheckResult> {
  const checker = new ConfigChecker(projectPath);
  return checker.check(options);
}
