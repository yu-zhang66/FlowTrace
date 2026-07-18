import { existsSync } from 'fs';
import { resolve } from 'path';

export interface PreflightTarget {
  baseUrl?: string;
  usernameEnv?: string;
  passwordEnv?: string;
  username?: string;
  password?: string;
  captcha?: { enabled?: boolean; strategy?: string; testValue?: string };
}

export interface PreflightOptions {
  projectPath: string;
  processId: string;
  scenariosDir: string;
  mode: 'single-browser' | 'dual-browser';
  legacy: PreflightTarget;
  current?: PreflightTarget;
}

export interface PreflightResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
  remediation: string[];
}

/** Validate everything that must be present before a browser is started. */
export function runLoginPreflight(options: PreflightOptions): PreflightResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const remediation: string[] = [];
  const flowtraceConfig = resolve(options.projectPath, '.flowtrace', 'flowtrace.yaml');

  if (!existsSync(flowtraceConfig)) {
    missing.push('.flowtrace/flowtrace.yaml');
    remediation.push(`flowtrace init --project ${options.projectPath}`);
  }
  if (!existsSync(options.scenariosDir)) {
    missing.push(`scenarios directory: ${options.scenariosDir}`);
  }

  const checkTarget = (name: string, target?: PreflightTarget) => {
    if (!target?.baseUrl) missing.push(`${name}.baseUrl`);
    const usernameEnv = target?.usernameEnv || 'TEST_USERNAME';
    const passwordEnv = target?.passwordEnv || 'TEST_PASSWORD';
    if (!target?.username && !process.env[usernameEnv]) missing.push(`${name}.${usernameEnv}`);
    if (!target?.password && !process.env[passwordEnv]) missing.push(`${name}.${passwordEnv}`);
    if (target?.captcha?.enabled && target.captcha.strategy === 'test-mode' && !target.captcha.testValue) {
      missing.push(`${name}.captcha.testValue`);
      remediation.push(`为 ${name} 配置 captcha.testValue（test-mode）`);
    }
  };

  checkTarget('legacy', options.legacy);
  if (options.mode === 'dual-browser') checkTarget('current', options.current);
  if (options.mode === 'dual-browser' && !options.current) missing.push('current adapter configuration');

  if (missing.length > 0) {
    warnings.push('浏览器尚未启动：前置检查未通过');
  }
  return { ok: missing.length === 0, missing, warnings, remediation };
}
