# FlowTrace MVP

FlowTrace 是一个 TypeScript/Node.js 的流程一致性测试工具，用于验证新流程替换旧流程后是否保持原有的业务行为。

## 项目结构

```
FlowTrace/
├── packages/
│   ├── core/           # 核心模型、类型定义、Zod schemas、配置加载
│   ├── adapter/        # FlowAdapter 接口和供应链适配器实现
│   ├── runner/         # 双跑执行引擎
│   ├── reporter/       # 差异分类和报告生成
│   ├── ai/             # AI provider 抽象、场景生成、事实提取
│   └── cli/            # Commander CLI 入口
├── projects/
│   └── supply-chain/   # 供应链项目配置和场景
├── skill/
│   └── flowtrace/      # FlowTrace Skill for Cursor/Codex
├── schemas/            # JSON Schema 定义
└── docs/               # 文档
```

## 技术栈

- Node.js 20 LTS+
- TypeScript 5+
- pnpm 9+ workspaces
- Zod + Ajv (数据验证)
- js-yaml (YAML 加载)
- Commander (CLI)
- Vitest (测试)

## 快速开始

### 安装依赖

```bash
cd FlowTrace
pnpm install
```

### 构建项目

```bash
pnpm build
```

### 运行测试

```bash
pnpm test
```

### CLI 命令

```bash
# 列出项目
pnpm flowtrace list

# 采集基线
pnpm flowtrace collect --project projects/supply-chain

# 生成场景
pnpm flowtrace generate-cases --project projects/supply-chain

# 验证场景
pnpm flowtrace validate-cases --project projects/supply-chain

# 执行验证
pnpm flowtrace verify --project projects/supply-chain

# 生成报告
pnpm flowtrace report --project projects/supply-chain --format html

# 渲染 Markdown
pnpm flowtrace render --project projects/supply-chain --type baseline
```

## 包说明

### @flowtrace/core
核心包，包含：
- 业务动作类型 (SUBMIT, APPROVE, REJECT, etc.)
- 流程事实模型
- 测试场景 Schema
- 执行结果模型
- 差异模型
- 项目配置模型
- 配置加载器

### @flowtrace/adapter
适配器包，包含：
- `FlowAdapter` 接口
- `LegacyFlowAdapter` - 旧流程适配器
- `CurrentFlowAdapter` - 当前流程适配器（支持 legacy-shadow 模式）

### @flowtrace/runner
执行引擎包，包含：
- `DualRunner` - 双跑执行器

### @flowtrace/reporter
报告包，包含：
- `DifferenceClassifier` - 差异分类器
- `ReportGenerator` - 报告生成器

### @flowtrace/ai
AI 包，包含：
- `AIProvider` 接口
- `OpenAIProvider` - OpenAI 实现
- `ScenarioGenerator` - 场景生成器
- `FactExtractor` - 事实提取器

### @flowtrace/cli
CLI 包，包含命令：
- `collect` - 采集基线
- `generate-cases` - 生成场景
- `validate-cases` - 验证场景
- `verify` - 执行验证
- `render` - 渲染 Markdown
- `report` - 生成报告
- `list` - 列出项目

## 差异分级

| 分级 | 含义 | 发布门禁 |
|------|------|----------|
| P0 | 核心业务差异 | 阻塞 |
| P1 | 业务路径差异 | 阻塞 |
| P2 | 非核心行为差异 | 需审核 |
| P3 | 技术实现差异 | 可配置放行 |

## Pilot 阶段说明

当前处于 Pilot 阶段，`currentAdapter` 使用 `legacy-shadow` 模式，即委托给 legacy adapter 执行。报告将说明这仅验证测试链路，不证明新流程等价性。

## 下一步

- [ ] 实现 Vue 3 UI (tasks.md 6.4)
- [ ] 实现 Oracle 数据库采集 (tasks.md 2.3)
- [ ] 获取测试凭证并确认测试环境 (tasks.md 7.1)
- [ ] 执行完整 Pilot 验证 (tasks.md 7.2-7.5)
