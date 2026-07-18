/**
 * Login Scenario Resolver
 *
 * 解析和筛选登录测试场景
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { extname, join } from 'path';
import yaml from 'js-yaml';
import { validateScenario } from '@flowtrace/core';
/**
 * 解析单个场景文件
 */
function parseScenarioFile(filePath) {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const ext = extname(filePath).toLowerCase();
        let data;
        if (ext === '.json') {
            data = JSON.parse(content);
        }
        else if (ext === '.yaml' || ext === '.yml') {
            data = yaml.load(content);
        }
        else {
            return { data: null, error: `Unsupported file extension: ${ext}` };
        }
        return { data };
    }
    catch (error) {
        return {
            data: null,
            error: `Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}
/**
 * 加载场景目录中的所有场景
 */
export function loadScenariosFromDir(scenariosDir) {
    const scenarios = [];
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
            }
            else if (['.json', '.yaml', '.yml'].includes(extname(file.name).toLowerCase())) {
                const { data, error } = parseScenarioFile(fullPath);
                if (!error && data) {
                    if (Array.isArray(data)) {
                        scenarios.push(...data);
                    }
                    else {
                        scenarios.push(data);
                    }
                }
            }
        }
    }
    catch (error) {
        console.warn(`Failed to load scenarios from ${scenariosDir}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return scenarios;
}
/**
 * 解析并筛选场景
 */
export function resolveScenarios(options) {
    const scenariosDir = options.scenariosDir;
    const filter = options.filter || {};
    const rawScenarios = loadScenariosFromDir(scenariosDir);
    const validScenarios = [];
    const invalidScenarios = [];
    const parseErrors = [];
    for (const raw of rawScenarios) {
        // 应用过滤器
        if (filter.process && raw.process !== filter.process) {
            continue;
        }
        if (filter.id && raw.id !== filter.id) {
            continue;
        }
        if (filter.enabledOnly && raw.enabled === false) {
            continue;
        }
        if (filter.tags && filter.tags.length > 0) {
            const scenarioTags = raw.tags || [];
            const hasMatchingTag = filter.tags.some(tag => scenarioTags.includes(tag));
            if (!hasMatchingTag) {
                continue;
            }
        }
        // 验证场景
        const validation = validateScenario(raw);
        if (validation.valid) {
            validScenarios.push({
                scenario: raw,
                validationErrors: [],
                filePath: ''
            });
        }
        else {
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
export function findLoginScenarios(scenariosDir) {
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
export function findScenarioById(scenariosDir, scenarioId) {
    const rawScenarios = loadScenariosFromDir(scenariosDir);
    for (const raw of rawScenarios) {
        if (raw.id === scenarioId) {
            const validation = validateScenario(raw);
            if (validation.valid) {
                return raw;
            }
        }
    }
    return null;
}
/**
 * 获取所有启用的场景
 */
export function getEnabledScenarios(scenariosDir) {
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
export function checkScenarioSecurity(scenario) {
    const issues = [];
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
//# sourceMappingURL=scenario-resolver.js.map