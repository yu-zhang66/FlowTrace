/**
 * Supply Chain Legacy System Collector
 * 
 * 专门为 supply_chain 项目采集旧系统信息
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, extname, basename, relative } from 'path';
import type { 
  Collector, 
  CollectorContext, 
  CollectedFact,
  CollectorConfig,
  CollectorEvidence
} from '@flowtrace/core';

export interface SupplyChainCollectorConfig extends CollectorConfig {
  options?: {
    /** 旧系统源码目录 */
    sourceRoot?: string;
    /** 服务器端源码目录 */
    serverDir?: string;
    /** Web 端源码目录 */
    webDir?: string;
    /** 数据库配置目录 */
    dbConfigDir?: string;
  };
}

/**
 * Supply Chain 采集器
 */
export class SupplyChainCollector implements Collector {
  readonly name: string = 'supply-chain-collector';
  readonly type = 'source-scanner' as const;
  config: SupplyChainCollectorConfig;

  private sourceRoot: string = '';
  private serverDir: string = 'zgserver';
  private webDir: string = 'zgweb';
  private dbConfigDir: string = 'config';

  constructor(config: SupplyChainCollectorConfig) {
    this.config = config;
    if (config.options) {
      this.sourceRoot = config.options.sourceRoot || '';
      this.serverDir = config.options.serverDir || this.serverDir;
      this.webDir = config.options.webDir || this.webDir;
      this.dbConfigDir = config.options.dbConfigDir || this.dbConfigDir;
    }
  }

  async initialize(context: CollectorContext): Promise<void> {
    this.sourceRoot = this.sourceRoot || context.sourceRoot;
    
    const serverPath = join(this.sourceRoot, this.serverDir);
    const webPath = join(this.sourceRoot, this.webDir);
    
    if (!existsSync(serverPath) && !existsSync(webPath)) {
      console.warn(`[SupplyChain Collector] Warning: Neither ${this.serverDir} nor ${this.webDir} found`);
    }
  }

  async collect(context: CollectorContext): Promise<CollectedFact[]> {
    const facts: CollectedFact[] = [];
    const timestamp = new Date().toISOString();

    // 1. 扫描服务器端源码
    const serverPath = join(this.sourceRoot, this.serverDir);
    if (existsSync(serverPath)) {
      console.log(`[SupplyChain Collector] Scanning server: ${serverPath}`);
      facts.push(...this.scanServerSource(serverPath, timestamp));
    }

    // 2. 扫描 Web 端源码
    const webPath = join(this.sourceRoot, this.webDir);
    if (existsSync(webPath)) {
      console.log(`[SupplyChain Collector] Scanning web: ${webPath}`);
      facts.push(...this.scanWebSource(webPath, timestamp));
    }

    // 3. 扫描配置文件
    const configPath = join(this.sourceRoot, this.dbConfigDir);
    if (existsSync(configPath)) {
      console.log(`[SupplyChain Collector] Scanning config: ${configPath}`);
      facts.push(...this.scanConfigFiles(configPath, timestamp));
    }

    return facts;
  }

  async checkAvailability(context: CollectorContext): Promise<{ available: boolean; reason?: string }> {
    const root = this.sourceRoot || context.sourceRoot;
    const serverPath = join(root, this.serverDir);
    const webPath = join(root, this.webDir);
    
    if (!existsSync(serverPath) && !existsSync(webPath)) {
      return { 
        available: false, 
        reason: `Supply Chain source directories not found: ${this.serverDir} or ${this.webDir}` 
      };
    }
    return { available: true };
  }

  async cleanup(): Promise<void> {
    // No cleanup needed
  }

  private scanServerSource(dir: string, timestamp: string): CollectedFact[] {
    const facts: CollectedFact[] = [];
    const javaFiles = this.findFiles(dir, ['.java']);
    
    console.log(`[SupplyChain Collector] Found ${javaFiles.length} Java files`);
    
    for (const file of javaFiles) {
      const fileFacts = this.extractFromJavaFile(file, dir, timestamp);
      facts.push(...fileFacts);
    }
    
    // 扫描 XML 配置
    const xmlFiles = this.findFiles(dir, ['.xml']);
    for (const file of xmlFiles) {
      const fileFacts = this.extractFromXmlFile(file, dir, timestamp);
      facts.push(...fileFacts);
    }
    
    return facts;
  }

  private scanWebSource(dir: string, timestamp: string): CollectedFact[] {
    const facts: CollectedFact[] = [];
    
    // 扫描 JS/Vue 文件
    const jsFiles = this.findFiles(dir, ['.js', '.vue', '.ts', '.tsx']);
    
    console.log(`[SupplyChain Collector] Found ${jsFiles.length} JS/Vue files`);
    
    for (const file of jsFiles) {
      const fileFacts = this.extractFromJsFile(file, dir, timestamp);
      facts.push(...fileFacts);
    }
    
    return facts;
  }

  private scanConfigFiles(dir: string, timestamp: string): CollectedFact[] {
    const facts: CollectedFact[] = [];
    
    const configFiles = this.findFiles(dir, ['.yaml', '.yml', '.properties', '.xml', '.json']);
    
    for (const file of configFiles) {
      const fileFacts = this.extractFromConfigFile(file, dir, timestamp);
      facts.push(...fileFacts);
    }
    
    return facts;
  }

  private findFiles(dir: string, extensions: string[], results: string[] = [], excludeDirs: string[] = []): string[] {
    const defaultExclude = ['target', 'node_modules', '.git', 'test', 'tests', 'build', 'dist', 'out', '.idea', '.vscode'];
    const exclude = [...defaultExclude, ...excludeDirs];
    
    if (!existsSync(dir)) return results;
    
    try {
      const entries = readdirSync(dir);
      
      for (const entry of entries) {
        if (exclude.includes(entry)) continue;
        
        const fullPath = join(dir, entry);
        
        try {
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            this.findFiles(fullPath, extensions, results, exclude);
          } else if (stat.isFile()) {
            const ext = extname(entry).toLowerCase();
            if (extensions.includes(ext)) {
              results.push(fullPath);
            }
          }
        } catch {
          // Skip inaccessible files
        }
      }
    } catch {
      // Skip inaccessible directories
    }
    
    return results;
  }

  private extractFromJavaFile(filePath: string, basePath: string, timestamp: string): CollectedFact[] {
    const facts: CollectedFact[] = [];
    
    try {
      const content = readFileSync(filePath, 'utf-8');
      const relPath = relative(basePath, filePath);
      
      // Controller 检测
      if (content.includes('@RestController') || content.includes('@Controller')) {
        facts.push(this.createApiFact(filePath, relPath, content, timestamp));
      }
      
      // Service 检测
      if (content.includes('@Service')) {
        facts.push(this.createServiceFact(filePath, relPath, content, timestamp));
      }
      
      // Repository 检测
      if (content.includes('@Repository') || content.includes('extends JpaRepository')) {
        facts.push(this.createRepositoryFact(filePath, relPath, content, timestamp));
      }
      
      // Entity 检测
      if (content.includes('@Entity') || content.includes('@Table')) {
        facts.push(this.createEntityFact(filePath, relPath, content, timestamp));
      }
      
    } catch {
      // Skip unreadable files
    }
    
    return facts;
  }

  private extractFromXmlFile(filePath: string, basePath: string, timestamp: string): CollectedFact[] {
    const facts: CollectedFact[] = [];
    
    try {
      const content = readFileSync(filePath, 'utf-8');
      const relPath = relative(basePath, filePath);
      const fileName = basename(filePath);
      
      // BPMN 文件
      if (fileName.includes('.bpmn')) {
        facts.push(this.createBpmnFact(filePath, relPath, content, timestamp));
      }
      
      // MyBatis Mapper
      if (fileName.includes('Mapper') && fileName.endsWith('.xml')) {
        facts.push(this.createMapperFact(filePath, relPath, content, timestamp));
      }
      
      // Spring 配置
      if (fileName.includes('spring') || fileName.includes('application')) {
        facts.push(this.createSpringConfigFact(filePath, relPath, content, timestamp));
      }
      
    } catch {
      // Skip unreadable files
    }
    
    return facts;
  }

  private extractFromJsFile(filePath: string, basePath: string, timestamp: string): CollectedFact[] {
    const facts: CollectedFact[] = [];
    
    try {
      const content = readFileSync(filePath, 'utf-8');
      const relPath = relative(basePath, filePath);
      const fileName = basename(filePath);
      
      // Vue 组件检测
      if (fileName.endsWith('.vue')) {
        facts.push(this.createVueComponentFact(filePath, relPath, content, timestamp));
      }
      
      // API 路由检测
      if (content.includes('axios') || content.includes('fetch') || content.includes('request')) {
        facts.push(this.createApiClientFact(filePath, relPath, content, timestamp));
      }
      
    } catch {
      // Skip unreadable files
    }
    
    return facts;
  }

  private extractFromConfigFile(filePath: string, basePath: string, timestamp: string): CollectedFact[] {
    const facts: CollectedFact[] = [];
    
    try {
      const content = readFileSync(filePath, 'utf-8');
      const relPath = relative(basePath, filePath);
      const fileName = basename(filePath);
      
      // 数据库配置
      if (fileName.includes('database') || fileName.includes('db') || fileName.includes('jdbc')) {
        facts.push(this.createDatabaseConfigFact(filePath, relPath, content, timestamp));
      }
      
      // 通用配置文件
      facts.push(this.createConfigFact(filePath, relPath, content, timestamp));
      
    } catch {
      // Skip unreadable files
    }
    
    return facts;
  }

  private generateId(): string {
    return `fact-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
  }

  private createEvidence(source: string, confidence: number, timestamp: string): CollectorEvidence {
    return {
      source,
      confidence,
      extractedAt: timestamp
    };
  }

  private createApiFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const className = basename(filePath, '.java');
    
    // 提取 API 路径
    const pathMatches = content.match(/@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["']([^"']+)["']/);
    const apiPath = pathMatches ? pathMatches[2] : '/unknown';
    const httpMethod = pathMatches ? pathMatches[1] : 'UNKNOWN';
    
    return {
      id: this.generateId(),
      type: 'api-endpoint',
      category: 'api',
      name: `${className} - ${apiPath}`,
      description: `REST API: ${httpMethod} ${apiPath}`,
      content: {
        filePath: relPath,
        className,
        httpMethod,
        apiPath
      },
      evidence: [this.createEvidence(relPath, 0.9, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  private createServiceFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const className = basename(filePath, '.java');
    
    return {
      id: this.generateId(),
      type: 'service',
      category: 'service',
      name: className,
      description: `Business service component`,
      content: {
        filePath: relPath,
        className
      },
      evidence: [this.createEvidence(relPath, 0.9, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  private createRepositoryFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const className = basename(filePath, '.java');
    
    // 提取表名
    const tableMatch = content.match(/@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/);
    const tableName = tableMatch ? tableMatch[1] : className.replace('Repository', '').toUpperCase();
    
    return {
      id: this.generateId(),
      type: 'repository',
      category: 'data_access',
      name: className,
      description: `Data access layer for ${tableName}`,
      content: {
        filePath: relPath,
        className,
        tableName
      },
      evidence: [this.createEvidence(relPath, 0.9, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  private createEntityFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const className = basename(filePath, '.java');
    
    // 提取表名
    const tableMatch = content.match(/@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/);
    const tableName = tableMatch ? tableMatch[1] : className.toUpperCase();
    
    // 提取字段
    const fieldMatches = content.match(/@Column\s*\([^)]*\)\s*\n\s*private\s+(\w+)\s+(\w+)/g) || [];
    const fields = fieldMatches.map(m => {
      const match = m.match(/private\s+(\w+)\s+(\w+)/);
      return match ? { type: match[1], name: match[2] } : null;
    }).filter(Boolean);
    
    return {
      id: this.generateId(),
      type: 'entity',
      category: 'data_effect',
      name: tableName,
      description: `Database entity ${className}`,
      content: {
        filePath: relPath,
        className,
        tableName,
        fields
      },
      evidence: [this.createEvidence(relPath, 0.9, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  private createBpmnFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const fileName = basename(filePath);
    
    // 提取流程定义
    const processMatch = content.match(/processId=["']([^"']+)["']/);
    const processId = processMatch ? processMatch[1] : fileName.replace('.bpmn', '');
    
    // 提取任务节点
    const taskMatches = content.match(/<userTask[^>]*name=["']([^"']+)["']/g) || [];
    const tasks = taskMatches.map(m => {
      const match = m.match(/name=["']([^"']+)["']/);
      return match ? match[1] : 'Unknown';
    });
    
    // 提取服务任务
    const serviceTaskMatches = content.match(/<serviceTask[^>]*name=["']([^"']+)["']/g) || [];
    const serviceTasks = serviceTaskMatches.map(m => {
      const match = m.match(/name=["']([^"']+)["']/);
      return match ? match[1] : 'Unknown';
    });
    
    return {
      id: this.generateId(),
      type: 'process-definition',
      category: 'process_definition',
      name: processId,
      description: `BPMN process with ${tasks.length} user tasks and ${serviceTasks.length} service tasks`,
      content: {
        filePath: relPath,
        processId,
        userTasks: tasks,
        serviceTasks,
        totalNodes: tasks.length + serviceTasks.length
      },
      evidence: [this.createEvidence(relPath, 0.95, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.95,
      collectedAt: timestamp
    };
  }

  private createMapperFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const fileName = basename(filePath);
    
    // 统计 SQL 操作
    const selectCount = (content.match(/<select/g) || []).length;
    const insertCount = (content.match(/<insert/g) || []).length;
    const updateCount = (content.match(/<update/g) || []).length;
    const deleteCount = (content.match(/<delete/g) || []).length;
    
    return {
      id: this.generateId(),
      type: 'mybatis-mapper',
      category: 'data_access',
      name: fileName,
      description: `MyBatis mapper with ${selectCount + insertCount + updateCount + deleteCount} operations`,
      content: {
        filePath: relPath,
        operations: { select: selectCount, insert: insertCount, update: updateCount, delete: deleteCount }
      },
      evidence: [this.createEvidence(relPath, 0.85, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.85,
      collectedAt: timestamp
    };
  }

  private createSpringConfigFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const fileName = basename(filePath);
    
    return {
      id: this.generateId(),
      type: 'spring-config',
      category: 'config',
      name: fileName,
      description: `Spring configuration file`,
      content: {
        filePath: relPath
      },
      evidence: [this.createEvidence(relPath, 0.8, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.8,
      collectedAt: timestamp
    };
  }

  private createVueComponentFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const fileName = basename(filePath);
    
    // 提取组件名
    const nameMatch = content.match(/name:\s*["']([^"']+)["']/);
    const componentName = nameMatch ? nameMatch[1] : fileName.replace('.vue', '');
    
    return {
      id: this.generateId(),
      type: 'vue-component',
      category: 'frontend',
      name: componentName,
      description: `Vue component`,
      content: {
        filePath: relPath,
        componentName
      },
      evidence: [this.createEvidence(relPath, 0.8, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.8,
      collectedAt: timestamp
    };
  }

  private createApiClientFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const fileName = basename(filePath);
    
    // 提取 API 路径
    const apiMatches = content.match(/["'](\/api\/[^"']+)["']/g) || [];
    const apis = [...new Set(apiMatches.map(m => m.replace(/["']/g, '')))];
    
    return {
      id: this.generateId(),
      type: 'api-client',
      category: 'frontend',
      name: fileName,
      description: `API client with ${apis.length} endpoints`,
      content: {
        filePath: relPath,
        endpoints: apis
      },
      evidence: [this.createEvidence(relPath, 0.75, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.75,
      collectedAt: timestamp
    };
  }

  private createDatabaseConfigFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const fileName = basename(filePath);
    
    // 提取数据库连接信息
    const urlMatch = content.match(/jdbc:oracle:[^:]+:@([^:]+):(\d+):([^/]+)/);
    const dbConfig = urlMatch ? {
      host: urlMatch[1],
      port: urlMatch[2],
      database: urlMatch[3]
    } : null;
    
    return {
      id: this.generateId(),
      type: 'database-config',
      category: 'config',
      name: fileName,
      description: `Database configuration`,
      content: {
        filePath: relPath,
        dbConfig
      },
      evidence: [this.createEvidence(relPath, 0.9, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  private createConfigFact(filePath: string, relPath: string, content: string, timestamp: string): CollectedFact {
    const fileName = basename(filePath);
    
    return {
      id: this.generateId(),
      type: 'config-file',
      category: 'config',
      name: fileName,
      description: `Configuration file`,
      content: {
        filePath: relPath
      },
      evidence: [this.createEvidence(relPath, 0.7, timestamp)],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: this.type,
      collectorName: this.name,
      confidence: 0.7,
      collectedAt: timestamp
    };
  }
}

/**
 * 创建 Supply Chain 采集器
 */
export function createSupplyChainCollector(config?: Partial<SupplyChainCollectorConfig>): Collector {
  return new SupplyChainCollector({
    name: 'supply-chain-collector',
    type: 'source-scanner',
    enabled: true,
    priority: 5,
    options: config?.options
  } as SupplyChainCollectorConfig);
}
