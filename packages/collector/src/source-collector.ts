/**
 * Source Code Scanner Collector
 * 
 * 扫描源码目录，提取流程定义、业务规则、API 等信息
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
import { generateCollectorId } from '@flowtrace/core';

/**
 * 源码事实信息
 */
interface SourceFact {
  className: string;
  packageName: string;
  filePath: string;
  annotations: string[];
  methods: MethodInfo[];
  businessSummary: string;
  relatedTables: string[];
}

/**
 * 方法信息
 */
interface MethodInfo {
  name: string;
  signature: string;
  lineNumber: number;
  annotations: string[];
}

/**
 * 融资流程源码采集结果
 */
interface FinancingSourceResult {
  controllers: FinancingClassInfo[];
  services: FinancingClassInfo[];
  enums: FinancingClassInfo[];
}

/**
 * 融资流程类信息
 */
interface FinancingClassInfo {
  className: string;
  packageName: string;
  filePath: string;
  annotations: string[];
  methods: FinancingMethodInfo[];
  businessSummary: string;
  relatedTables: string[];
}

/**
 * 融资流程方法信息
 */
interface FinancingMethodInfo {
  name: string;
  signature: string;
  returnType: string;
  parameters: string[];
  lineNumber: number;
  annotations: string[];
}

/**
 * 融资流程类名模式
 */
const FINANCING_CLASS_PATTERNS = [
  'FinanceController',
  'ScfSubmitFlowImpl',
  'FinanceStateEnum',
  'FlowTypeEnum',
  'LoanAfterInfoServiceImpl',
];

export interface SourceCollectorConfig extends CollectorConfig {
  options?: {
    /** 源码根目录 */
    sourceRoot?: string;
    /** 扫描的文件扩展名 */
    extensions?: string[];
    /** 排除的目录 */
    excludeDirs?: string[];
    /** 包含的目录 */
    includeDirs?: string[];
    /** 最大文件大小 (bytes) */
    maxFileSize?: number;
  };
}

/**
 * 源码扫描采集器
 */
export class SourceCollector implements Collector {
  readonly name: string;
  readonly type = 'source-scanner' as const;
  config: SourceCollectorConfig;

  private sourceRoot: string = '';
  private extensions: string[] = ['.java', '.xml', '.yaml', '.yml', '.json', '.properties'];
  private excludeDirs: string[] = ['target', 'node_modules', '.git', 'test', 'tests', 'build', 'dist'];
  private maxFileSize: number = 1024 * 1024; // 1MB

  constructor(config: SourceCollectorConfig) {
    this.name = config.name || 'source-collector';
    this.config = config;
    
    if (config.options) {
      this.sourceRoot = config.options.sourceRoot || '';
      this.extensions = config.options.extensions || this.extensions;
      this.excludeDirs = config.options.excludeDirs || this.excludeDirs;
      this.maxFileSize = config.options.maxFileSize || this.maxFileSize;
    }
  }

  async initialize(context: CollectorContext): Promise<void> {
    this.sourceRoot = this.sourceRoot || context.sourceRoot;
    
    if (!existsSync(this.sourceRoot)) {
      throw new Error(`Source root does not exist: ${this.sourceRoot}`);
    }
  }

  async collect(context: CollectorContext): Promise<CollectedFact[]> {
    const facts: CollectedFact[] = [];
    const timestamp = new Date().toISOString();

    // 扫描 Java 文件
    const javaFiles = this.scanFiles(this.sourceRoot, ['.java']);
    for (const file of javaFiles) {
      const fileFacts = this.extractFromJavaFile(file, timestamp);
      facts.push(...fileFacts);
    }

    // 扫描 XML 配置文件
    const xmlFiles = this.scanFiles(this.sourceRoot, ['.xml']);
    for (const file of xmlFiles) {
      const fileFacts = this.extractFromXmlFile(file, timestamp);
      facts.push(...fileFacts);
    }

    // 扫描 YAML 配置文件
    const yamlFiles = this.scanFiles(this.sourceRoot, ['.yaml', '.yml']);
    for (const file of yamlFiles) {
      const fileFacts = this.extractFromYamlFile(file, timestamp);
      facts.push(...fileFacts);
    }

    return facts;
  }

  async checkAvailability(context: CollectorContext): Promise<{ available: boolean; reason?: string }> {
    const root = this.sourceRoot || context.sourceRoot;
    
    if (!existsSync(root)) {
      return { available: false, reason: `Source root does not exist: ${root}` };
    }

    const javaFiles = this.scanFiles(root, ['.java']);
    if (javaFiles.length === 0) {
      return { available: false, reason: 'No Java files found in source root' };
    }

    return { available: true };
  }

  async cleanup(): Promise<void> {
    // No cleanup needed
  }

  /**
   * 采集融资流程源码事实
   */
  async collectFinancingSourceFacts(projectPath: string): Promise<CollectedFact[]> {
    const facts: CollectedFact[] = [];
    const timestamp = new Date().toISOString();

    // 使用现有的 scanFiles 方法扫描 Java 文件
    const javaFiles = this.scanFiles(projectPath, ['.java']);

    for (const file of javaFiles) {
      const fileName = basename(file);
      
      // 检查文件是否匹配融资流程相关模式
      const isFinancingFile = FINANCING_CLASS_PATTERNS.some(pattern => 
        fileName.includes(pattern.replace(/Impl$/, '').replace(/Enum$/, '').replace(/Controller$/, ''))
      ) || this.isFinancingRelatedPath(file);

      if (isFinancingFile) {
        const fileFacts = this.extractFinancingFacts(file, timestamp, projectPath);
        facts.push(...fileFacts);
      }
    }

    return facts;
  }

  /**
   * 检查文件路径是否与融资流程相关
   */
  private isFinancingRelatedPath(filePath: string): boolean {
    const financingPathPatterns = [
      /controller.*finance/i,
      /service.*finance/i,
      /service.*scf/i,
      /service.*loan/i,
      /enums.*finance/i,
      /enums.*flow/i,
    ];
    return financingPathPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * 从融资相关文件提取事实
   */
  private extractFinancingFacts(filePath: string, timestamp: string, projectPath: string): CollectedFact[] {
    const facts: CollectedFact[] = [];

    try {
      const content = readFileSync(filePath, 'utf-8');
      const fileName = basename(filePath);
      const relativePath = filePath.replace(projectPath + '/', '');

      // 检测是否为 Controller
      if (content.includes('@RestController') || content.includes('@Controller')) {
        facts.push(this.createFinancingControllerFact(fileName, relativePath, content, filePath, timestamp));
      }

      // 检测是否为 Service
      if (content.includes('@Service')) {
        facts.push(this.createFinancingServiceFact(fileName, relativePath, content, filePath, timestamp));
      }

      // 检测是否为 Enum
      if (content.includes('enum ') || (content.includes('class') && content.includes('Enum'))) {
        facts.push(this.createFinancingEnumFact(fileName, relativePath, content, filePath, timestamp));
      }

    } catch {
      // 跳过无法读取的文件
    }

    return facts;
  }

  /**
   * 创建融资 Controller 事实
   */
  private createFinancingControllerFact(
    fileName: string,
    path: string,
    content: string,
    fullPath: string,
    timestamp: string
  ): CollectedFact {
    // 提取包名
    const packageMatch = content.match(/package\s+([\w.]+);/);
    const packageName = packageMatch ? packageMatch[1] : '';

    // 提取类名
    const classMatch = content.match(/class\s+(\w+)/);
    const className = classMatch ? classMatch[1] : fileName.replace('.java', '');

    // 提取 API 路径
    const pathMatches = content.match(/@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["']([^"']+)["']/g) || [];
    const apiPaths = pathMatches.map(m => {
      const match = m.match(/@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["']([^"']+)["']/);
      return {
        method: match?.[1] || 'REQUEST',
        path: match?.[2] || ''
      };
    });

    // 提取方法
    const methods = this.extractFinancingMethods(content, className);

    return {
      id: generateCollectorId('fin'),
      type: 'financing-controller',
      category: 'financing-application',
      name: className,
      description: `融资申请前端控制器: ${className}`,
      content: {
        fileName,
        filePath: path,
        packageName,
        className,
        apiPaths,
        methodCount: methods.length,
        methods
      },
      evidence: [{
        source: fullPath,
        confidence: 0.95,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector', type: 'financing-controller' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  /**
   * 创建融资 Service 事实
   */
  private createFinancingServiceFact(
    fileName: string,
    path: string,
    content: string,
    fullPath: string,
    timestamp: string
  ): CollectedFact {
    // 提取包名
    const packageMatch = content.match(/package\s+([\w.]+);/);
    const packageName = packageMatch ? packageMatch[1] : '';

    // 提取类名
    const classMatch = content.match(/class\s+(\w+)/);
    const className = classMatch ? classMatch[1] : fileName.replace('.java', '');

    // 提取关联表名
    const tableMatches = content.match(/@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/g) || [];
    const relatedTables = tableMatches.map(m => {
      const match = m.match(/@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/);
      return match?.[1] || '';
    }).filter(Boolean);

    // 提取方法
    const methods = this.extractFinancingMethods(content, className);

    // 生成业务摘要
    const businessSummary = this.generateBusinessSummary(className, methods);

    return {
      id: generateCollectorId('fin'),
      type: 'financing-service',
      category: 'financing-application',
      name: className,
      description: `融资流程服务实现: ${className}`,
      content: {
        fileName,
        filePath: path,
        packageName,
        className,
        businessSummary,
        relatedTables,
        methodCount: methods.length,
        methods
      },
      evidence: [{
        source: fullPath,
        confidence: 0.95,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector', type: 'financing-service' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  /**
   * 创建融资 Enum 事实
   */
  private createFinancingEnumFact(
    fileName: string,
    path: string,
    content: string,
    fullPath: string,
    timestamp: string
  ): CollectedFact {
    // 提取包名
    const packageMatch = content.match(/package\s+([\w.]+);/);
    const packageName = packageMatch ? packageMatch[1] : '';

    // 提取类名
    const classMatch = content.match(/enum\s+(\w+)|class\s+(\w+)/);
    const className = classMatch ? (classMatch[1] || classMatch[2]) : fileName.replace('.java', '');

    // 提取 Enum 值
    const valueMatches = content.match(/^\s*(\w+)\s*\([^)]*\)/gm) || [];
    const values = valueMatches.map(v => {
      const match = v.match(/^\s*(\w+)\s*\(/);
      return match?.[1] || '';
    }).filter(Boolean);

    // 提取注释描述
    const descMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
    const description = descMatch ? descMatch[1].replace(/[\s*]/g, '').trim() : '';

    return {
      id: generateCollectorId('fin'),
      type: 'financing-enum',
      category: 'financing-application',
      name: className,
      description: description || `融资流程枚举: ${className}`,
      content: {
        fileName,
        filePath: path,
        packageName,
        className,
        values,
        valueCount: values.length
      },
      evidence: [{
        source: fullPath,
        confidence: 0.95,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector', type: 'financing-enum' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.95,
      collectedAt: timestamp
    };
  }

  /**
   * 提取融资流程方法信息
   */
  private extractFinancingMethods(content: string, className: string): FinancingMethodInfo[] {
    const methods: FinancingMethodInfo[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      // 匹配方法定义
      const methodMatch = line.match(/(?:public|private|protected)?\s+(?:static\s+)?(\w+(?:<[^>]+>)?(?:\[\])*)\s+(\w+)\s*\(([^)]*)\)/);
      if (methodMatch && !line.includes('//') && !line.includes('*') && methodMatch[2] !== className) {
        const returnType = methodMatch[1];
        const methodName = methodMatch[2];
        const params = methodMatch[3].split(',').map(p => p.trim()).filter(Boolean);

        // 提取方法注解
        const annotations: string[] = [];
        for (let i = Math.max(0, index - 3); i < index; i++) {
          const annMatch = lines[i].match(/@(\w+)/);
          if (annMatch) {
            annotations.push(annMatch[1]);
          }
        }

        methods.push({
          name: methodName,
          signature: `${returnType} ${methodName}(${params.join(', ')})`,
          returnType,
          parameters: params,
          lineNumber: index + 1,
          annotations
        });
      }
    });

    return methods;
  }

  /**
   * 生成业务摘要
   */
  private generateBusinessSummary(className: string, methods: FinancingMethodInfo[]): string {
    if (className.includes('ScfSubmitFlowImpl')) {
      return '融资提交流程实现，处理融资申请的提交和状态流转';
    }
    if (className.includes('LoanAfterInfoServiceImpl')) {
      return '放款后信息服务实现，处理放款后的信息管理和跟踪';
    }
    if (className.includes('Finance')) {
      return '融资业务服务，处理融资相关业务逻辑';
    }
    return `业务服务类，包含 ${methods.length} 个业务方法`;
  }

  private scanFiles(dir: string, extensions: string[], results: string[] = []): string[] {
    if (!existsSync(dir)) {
      return results;
    }

    try {
      const entries = readdirSync(dir);
      
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        
        try {
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            // 跳过排除的目录
            if (this.excludeDirs.includes(entry)) {
              continue;
            }
            this.scanFiles(fullPath, extensions, results);
          } else if (stat.isFile()) {
            const ext = extname(entry).toLowerCase();
            if (extensions.includes(ext) && stat.size <= this.maxFileSize) {
              results.push(fullPath);
            }
          }
        } catch {
          // 跳过无法访问的文件
        }
      }
    } catch {
      // 跳过无法读取的目录
    }

    return results;
  }

  private extractFromJavaFile(filePath: string, timestamp: string): CollectedFact[] {
    const facts: CollectedFact[] = [];
    
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fileName = basename(filePath);
      const relativePath = filePath.replace(this.sourceRoot + '/', '');
      
      // 检测 Controller
      if (content.includes('@RestController') || content.includes('@Controller')) {
        facts.push(this.createApiFact(fileName, relativePath, content, filePath, timestamp));
      }
      
      // 检测 Service
      if (content.includes('@Service')) {
        facts.push(this.createServiceFact(fileName, relativePath, content, filePath, timestamp));
      }
      
      // 检测 Repository
      if (content.includes('@Repository') || content.includes('extends JpaRepository') || content.includes('extends CrudRepository')) {
        facts.push(this.createRepositoryFact(fileName, relativePath, content, filePath, timestamp));
      }
      
      // 检测 Entity
      if (content.includes('@Entity') || content.includes('@Table')) {
        facts.push(this.createEntityFact(fileName, relativePath, content, filePath, timestamp));
      }
      
      // 检测 Spring Bean 配置
      if (content.includes('@Configuration') || content.includes('@Bean')) {
        facts.push(this.createConfigFact(fileName, relativePath, content, filePath, timestamp));
      }

    } catch {
      // 跳过无法读取的文件
    }
    
    return facts;
  }

  private extractFromXmlFile(filePath: string, timestamp: string): CollectedFact[] {
    const facts: CollectedFact[] = [];
    
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fileName = basename(filePath);
      const relativePath = filePath.replace(this.sourceRoot + '/', '');

      // 检测 Spring 配置
      if (fileName.includes('spring') || fileName.includes('application')) {
        facts.push(this.createSpringConfigFact(fileName, relativePath, content, filePath, timestamp));
      }

      // 检测 BPMN 文件
      if (fileName.endsWith('.bpmn') || fileName.endsWith('.bpmn20.xml')) {
        facts.push(this.createBpmnFact(fileName, relativePath, content, filePath, timestamp));
      }

      // 检测 MyBatis 映射
      if (fileName.includes('Mapper') && fileName.endsWith('.xml')) {
        facts.push(this.createMapperFact(fileName, relativePath, content, filePath, timestamp));
      }

    } catch {
      // 跳过无法读取的文件
    }
    
    return facts;
  }

  private extractFromYamlFile(filePath: string, timestamp: string): CollectedFact[] {
    const facts: CollectedFact[] = [];
    
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fileName = basename(filePath);
      const relativePath = filePath.replace(this.sourceRoot + '/', '');

      // 检测配置文件
      if (fileName.includes('application') || fileName.includes('config')) {
        facts.push(this.createYamlConfigFact(fileName, relativePath, content, filePath, timestamp));
      }

    } catch {
      // 跳过无法读取的文件
    }
    
    return facts;
  }

  private createEvidence(source: string, line: number, content: string, metadata?: Record<string, any>): CollectorEvidence {
    return {
      source,
      line,
      confidence: 0.8,
      extractedAt: new Date().toISOString(),
      metadata
    };
  }

  private createApiFact(fileName: string, path: string, content: string, fullPath: string, timestamp: string): CollectedFact {
    // 提取 API 路径
    const pathMatches = content.match(/@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["']([^"']+)["']/);
    const apiPath = pathMatches ? pathMatches[2] : '/unknown';
    
    // 提取方法名
    const methodMatch = content.match(/(public|private|protected)\s+\w+\s+(\w+)\s*\(/);
    const methodName = methodMatch ? methodMatch[2] : 'unknown';

    return {
      id: generateCollectorId('fact'),
      type: 'api-endpoint',
      category: 'api',
      name: `${fileName.replace('.java', '')} - ${apiPath}`,
      description: `REST API endpoint: ${methodName} ${apiPath}`,
      content: {
        fileName,
        filePath: path,
        httpMethod: pathMatches?.[1] || 'UNKNOWN',
        apiPath,
        methodName
      },
      evidence: [{
        source: fullPath,
        confidence: 0.9,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.85,
      collectedAt: timestamp
    };
  }

  private createServiceFact(fileName: string, path: string, content: string, fullPath: string, timestamp: string): CollectedFact {
    return {
      id: generateCollectorId('fact'),
      type: 'service',
      category: 'service',
      name: fileName.replace('.java', ''),
      description: `Business service component`,
      content: {
        fileName,
        filePath: path,
        className: fileName.replace('.java', '')
      },
      evidence: [{
        source: fullPath,
        confidence: 0.9,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  private createRepositoryFact(fileName: string, path: string, content: string, fullPath: string, timestamp: string): CollectedFact {
    return {
      id: generateCollectorId('fact'),
      type: 'data-access',
      category: 'data_access',
      name: fileName.replace('.java', ''),
      description: `Data access layer component`,
      content: {
        fileName,
        filePath: path,
        className: fileName.replace('.java', '')
      },
      evidence: [{
        source: fullPath,
        confidence: 0.9,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  private createEntityFact(fileName: string, path: string, content: string, fullPath: string, timestamp: string): CollectedFact {
    // 提取表名
    const tableMatch = content.match(/@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/);
    const tableName = tableMatch ? tableMatch[1] : fileName.replace('.java', '').toUpperCase();
    
    return {
      id: generateCollectorId('fact'),
      type: 'data-entity',
      category: 'data_effect',
      name: tableName,
      description: `Database entity: ${tableName}`,
      content: {
        fileName,
        filePath: path,
        tableName,
        className: fileName.replace('.java', '')
      },
      evidence: [{
        source: fullPath,
        confidence: 0.9,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  private createConfigFact(fileName: string, path: string, content: string, fullPath: string, timestamp: string): CollectedFact {
    return {
      id: generateCollectorId('fact'),
      type: 'configuration',
      category: 'config',
      name: fileName,
      description: `Configuration class`,
      content: {
        fileName,
        filePath: path
      },
      evidence: [{
        source: fullPath,
        confidence: 0.9,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  private createSpringConfigFact(fileName: string, path: string, content: string, fullPath: string, timestamp: string): CollectedFact {
    return {
      id: generateCollectorId('fact'),
      type: 'spring-config',
      category: 'config',
      name: fileName,
      description: `Spring configuration file`,
      content: {
        fileName,
        filePath: path
      },
      evidence: [{
        source: fullPath,
        confidence: 0.85,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.85,
      collectedAt: timestamp
    };
  }

  private createBpmnFact(fileName: string, path: string, content: string, fullPath: string, timestamp: string): CollectedFact {
    // 提取流程名称
    const processMatch = content.match(/processId=["']([^"']+)["']/);
    const processId = processMatch ? processMatch[1] : fileName.replace('.bpmn', '');
    
    // 提取任务节点
    const taskMatches = content.match(/<userTask[^>]*name=["']([^"']+)["']/g) || [];
    const tasks = taskMatches.map(m => {
      const match = m.match(/name=["']([^"']+)["']/);
      return match ? match[1] : 'Unknown Task';
    });

    return {
      id: generateCollectorId('fact'),
      type: 'process-definition',
      category: 'process_definition',
      name: processId,
      description: `BPMN process definition with ${tasks.length} tasks`,
      content: {
        fileName,
        filePath: path,
        processId,
        tasks,
        nodeCount: tasks.length
      },
      evidence: [{
        source: fullPath,
        confidence: 0.9,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector', type: 'bpmn' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.9,
      collectedAt: timestamp
    };
  }

  private createMapperFact(fileName: string, path: string, content: string, fullPath: string, timestamp: string): CollectedFact {
    // 提取 SQL 操作
    const selectMatches = content.match(/<select[^>]*id=["']([^"']+)["']/g) || [];
    const updateMatches = content.match(/<update[^>]*id=["']([^"']+)["']/g) || [];
    const insertMatches = content.match(/<insert[^>]*id=["']([^"']+)["']/g) || [];
    const deleteMatches = content.match(/<delete[^>]*id=["']([^"']+)["']/g) || [];

    return {
      id: generateCollectorId('fact'),
      type: 'mybatis-mapper',
      category: 'data_access',
      name: fileName,
      description: `MyBatis mapper with ${selectMatches.length + updateMatches.length + insertMatches.length + deleteMatches.length} operations`,
      content: {
        fileName,
        filePath: path,
        operations: {
          select: selectMatches.length,
          update: updateMatches.length,
          insert: insertMatches.length,
          delete: deleteMatches.length
        }
      },
      evidence: [{
        source: fullPath,
        confidence: 0.85,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector', type: 'mybatis' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.85,
      collectedAt: timestamp
    };
  }

  private createYamlConfigFact(fileName: string, path: string, content: string, fullPath: string, timestamp: string): CollectedFact {
    return {
      id: generateCollectorId('fact'),
      type: 'yaml-config',
      category: 'config',
      name: fileName,
      description: `YAML configuration file`,
      content: {
        fileName,
        filePath: path
      },
      evidence: [{
        source: fullPath,
        confidence: 0.8,
        extractedAt: timestamp,
        metadata: { scanner: 'source-collector', type: 'yaml' }
      }],
      reviewStatus: 'AUTO_EXTRACTED',
      collectorType: 'source-scanner',
      collectorName: this.name,
      confidence: 0.8,
      collectedAt: timestamp
    };
  }
}

/**
 * 创建源码采集器配置
 */
export function createSourceCollectorConfig(
  name: string = 'source-collector',
  options?: SourceCollectorConfig['options']
): SourceCollectorConfig {
  return {
    name,
    type: 'source-scanner',
    enabled: true,
    priority: 10,
    options
  };
}

/**
 * 创建源码采集器实例
 */
export function createSourceCollector(config: SourceCollectorConfig): Collector {
  return new SourceCollector(config);
}

/**
 * 检测是否为融资流程相关类
 */
export function isFinancingClassName(className: string): boolean {
  return FINANCING_CLASS_PATTERNS.some(p => className.includes(p));
}

export { FINANCING_CLASS_PATTERNS };
export type { FinancingClassInfo, FinancingMethodInfo, FinancingSourceResult };
