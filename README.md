# FlowTrace

Repository: https://github.com/yu-zhang66/FlowTrace

Clone the repository with:

```bash
git clone https://github.com/yu-zhang66/FlowTrace.git
```

FlowTrace 是一套面向老系统流程替换的流程一致性测试与迁移验证工具。

它解决的不是“新流程能不能运行”，而是回答一个更重要的问题：

> 新流程替换旧流程后，是否仍然保持原有的业务规则、审批责任、数据结果、外部副作用和用户操作行为？

FlowTrace 通过旧流程基线采集、AI 辅助测试案例生成、新旧流程双跑、确定性结果比较和自动化报告，帮助团队在流程治理、节点合并、流程引擎替换和老系统迁移过程中发现并解释业务差异。

## 快速开始

### 安装

要求 Node.js 20+、pnpm 9+。FlowTrace 当前以源码仓库方式提供：

```bash
git clone https://github.com/yu-zhang66/FlowTrace.git
cd FlowTrace
corepack enable
pnpm install
pnpm build
pnpm flowtrace --help
```

构建产物位于各 workspace 的 `dist/` 目录，属于可重复生成文件，不提交到 Git。

### 初始化目标项目

FlowTrace 不依赖仓库内的示例项目作为运行目标。对任意目标项目执行：

```bash
pnpm flowtrace init --project /absolute/path/to/target-project
```

目标项目默认只维护配置和流程资产，不需要复制 FlowTrace 源码，也不需要创建 `.flowtrace/adapters/`：

```text
target-project/
├── .flowtrace/
│   ├── flowtrace.yaml       # 运行时、系统和目录配置
│   ├── systems/             # legacy/current 系统声明
│   ├── processes/           # 流程 DSL
│   ├── scenarios/           # 测试案例
│   ├── facts/               # 采集基线
│   └── executions/          # 每次执行的完整成果物目录
└── .env                     # 本机凭据，不提交
```

### 配置凭据

在目标项目中填写 `.flowtrace/flowtrace.yaml` 的系统、流程和案例配置；敏感信息通过 `.env` 或 CI Secret 注入：

```dotenv
LEGACY_BASE_URL=https://legacy.example.com
CURRENT_BASE_URL=https://current.example.com
TEST_USERNAME=automation@example.com
TEST_PASSWORD=change-me
```

不要把真实密码、Cookie、Token 或生产连接串写入 YAML、案例、报告或 Git。运行时会在证据保存前脱敏。

### 完整执行流程

```bash
PROJECT=/absolute/path/to/target-project
pnpm flowtrace status --project "$PROJECT"
pnpm flowtrace collect --project "$PROJECT"
pnpm flowtrace generate-cases --project "$PROJECT"
pnpm flowtrace validate-cases --project "$PROJECT"
pnpm flowtrace verify --project "$PROJECT"
pnpm flowtrace report --project "$PROJECT" --format html
```

也可以使用一条命令执行编排流程：

```bash
pnpm flowtrace pipeline --project /absolute/path/to/target-project
```

复杂的 SSO、验证码、WebSocket、原生客户端或特殊数据库动作，才需要在配置中显式声明外部插件；这不是默认路径。

### 查看成果物

每次执行的所有成果物集中在一个目录：

```text
target-project/.flowtrace/executions/<run-id>/
├── run.json
├── evidence/       # 脱敏 JSON、截图、网络证据
├── scenarios/      # 场景级观察和结果
└── reports/        # 固定模板的 JSON、Markdown、HTML 报告
```

HTML 报告直接内嵌截图，展示 Legacy / Current 对比、操作结果、状态变化、HTTP 信息、差异和 Release Gate。历史执行可以直接按 `<run-id>` 文件夹查看或归档。

## 核心能力

## 技术框架

FlowTrace 第一阶段采用 TypeScript 全栈实现：

```text
Node.js 20 LTS+
TypeScript 5+
pnpm 9+ workspaces
Commander               CLI
Zod + Ajv               运行时模型和 JSON Schema 校验
js-yaml                 YAML 配置和测试案例
Playwright              可选的页面采集和 UI 自动化运行时
Vitest                  FlowTrace 自身测试
oracledb / pg           可选的只读数据库采集驱动
```

当前版本使用 CLI、文件、Git 和测试环境即可运行，不要求启动独立服务端。数据库驱动和 Playwright 只在目标项目实际使用相应能力时启用。

### 1. 旧流程基线采集

FlowTrace 将旧系统中的流程事实整理成可版本化、可追溯的基线，包括：

- 流程定义、节点和连线
- 业务规则和条件分支
- 角色、组织和权限
- 页面、按钮和表单字段
- 业务 API 和流程引擎 API
- Service、SQL、数据库表和字段
- 外部系统调用、消息和审计记录
- 历史流程实例及实际操作轨迹

每条事实可以保留来源、文件位置、运行记录、置信度和人工审核状态。AI 生成的内容必须能够追溯到事实或人工确认，不能把没有证据的推测直接当作测试依据。

### 2. 统一业务动作

测试案例不直接绑定某一个流程引擎的 URL 或内部节点 ID，而是描述业务动作：

```text
SUBMIT
APPROVE
REJECT
RETURN
WITHDRAW
TRANSFER
COUNTERSIGN
```

旧流程和新流程分别通过适配器把业务动作转换成各自的 API 调用。因此，即使新旧流程引擎完全不同，测试案例仍然可以复用。

```text
业务动作 APPROVE
  ├── 旧流程适配器 → 旧流程引擎 API
  └── 新流程适配器 → 新流程引擎 API
```

### 3. AI 测试案例生成

FlowTrace 可以根据以下输入生成结构化测试案例：

- 旧流程事实基线
- 新流程定义
- 业务规则
- 角色和权限
- 数据库影响
- 外部系统契约
- 历史流程实例
- 节点合并或流程替换变更

生成范围包括：

- 正常流程
- 边界值和条件分支
- 退回、拒绝、撤回、转办和会签
- 权限允许与权限拒绝
- 重复提交和幂等
- 外部接口失败、超时和重试
- 并发审批和异常数据
- 节点合并专项回归场景

测试案例以 YAML 或 JSON 保存，并通过 JSON Schema、流程事实和角色存在性校验。

### 4. 新旧流程双跑

对于同一个测试案例，FlowTrace 分别使用旧流程适配器和新流程适配器执行：

```text
相同输入和操作序列
        ├── 旧系统/旧流程
        └── 新系统/新流程
                ↓
          结果标准化与比较
```

执行前会恢复相同的测试数据快照，避免旧流程执行结果污染新流程。

### 5. 多维度一致性比较

FlowTrace 不要求新旧流程的节点数量、URL 或内部实现完全相同，而是比较业务语义和可观察结果：

- 最终业务状态
- 语义流程路径
- 审批角色和权限边界
- 关键业务字段
- 数据库新增、修改和删除
- 外部系统调用、参数、次数和重试
- 消息通知
- 审计记录
- 页面关键操作结果

技术字段如请求 ID、时间戳、内部节点 ID 等可以配置为忽略或映射。

### 6. 页面关键路径测试

FlowTrace 支持通过浏览器自动化验证关键用户操作：

- 登录和权限
- 打开业务页面
- 填写表单
- 提交流程
- 审批、退回和撤回
- 查看流程状态和审批记录
- 验证按钮、字段和错误提示

页面测试用于验证用户操作链路和前后端集成；核心业务一致性仍由流程、API、数据库和外部调用比较完成。

### 7. 差异分级与发布门禁

比较结果统一分级：

```text
P0  核心业务结果、金额、权限或外部副作用不一致，禁止发布
P1  业务路径、角色或状态存在差异，必须业务确认
P2  非核心行为差异，需要修复或评估
P3  技术实现或展示差异，可以配置放行
```

报告可以自动给出：

- 测试案例总数和通过率
- 新旧流程差异数量
- 失败案例和操作步骤
- 差异发生位置
- 影响的流程、节点、接口、表和外部系统
- 证据来源
- AI 生成的原因分析和修复建议
- 是否允许发布

### 8. FlowTrace Skill

FlowTrace 第一阶段即提供项目配套 Skill，用于让 Cursor/Codex 按统一流程调用 FlowTrace：选择项目和流程、采集旧基线、生成带证据的测试案例、校验案例、启动双跑、读取报告和解释差异。Skill 位于 `skill/flowtrace/`，其中的指令只负责工作流编排，实际测试执行和发布判定仍由 FlowTrace 程序完成。

### 9. 文件化产物和人工可读视图

MVP 阶段不要求 FlowTrace 自身数据库。JSON/YAML 作为机器执行的唯一事实源，FlowTrace 自动将其渲染为等价 Markdown，供人工审核、Git 版本管理和报告归档。

```text
JSON/YAML → Markdown Renderer → 人工审核/报告
```

同一内容禁止手工分别维护 JSON/YAML 和 Markdown。可以通过以下命令生成或检查视图：

```bash
flowtrace render --project supply-chain
flowtrace render --check --project supply-chain
```

详细约定见 [文件化产物规范](docs/artifact-format.md)。

### 10. 页面差异与业务语义

新旧流程的页面可以不同。FlowTrace 使用业务语义关键词作为稳定中间层，将不同页面、API 和引擎节点映射到统一的业务动作和语义步骤，再比较业务路径、权限、数据和外部副作用。

AI 可以提取关键词候选，但候选必须经过证据、Schema、冲突和人工审核后才能进入项目词典。详细规则见 [业务语义关键词字典](docs/semantic-dictionary.md)。

## 工作方式

一次完整的验证流程如下：

```text
采集旧流程
   ↓
建立版本化事实基线
   ↓
AI 生成测试案例
   ↓
Schema、事实和人工确认校验
   ↓
恢复隔离测试环境
   ↓
旧流程与新流程双跑
   ↓
标准化路径、状态、数据和副作用
   ↓
确定性比较差异
   ↓
AI 分析失败原因
   ↓
生成报告和发布结论
```

推荐的命令行入口为：

```bash
flowtrace collect --project <project>
flowtrace generate-cases --project <project>
flowtrace validate-cases --project <project>
flowtrace verify --project <project>
flowtrace report --project <project>
```

## 项目化和可移植设计

FlowTrace 的通用能力与被测项目隔离：

```text
flowtrace-core              通用测试执行、比较和报告
flowtrace-adapter-sdk       适配器接口
flowtrace-ai                AI 事实提取、案例生成和失败分析
flowtrace-cli                命令行入口
flowtrace-skill              AI 工作流编排
<target-project>/.flowtrace  项目配置、事实、映射、案例和报告
```

接入一个新项目时，通常只需要在目标项目提供：

- 项目配置
- 旧/新系统的 URL、认证引用、页面和 API 声明
- 流程 DSL、状态、节点和角色映射
- 数据库快照或外部系统 Mock 配置（如流程需要）
- 项目专属测试案例

只有非标准能力无法由内置运行时表达时，才需要显式外部插件。业务代码不应复制到 FlowTrace 核心，也不应默认放进目标项目的 `.flowtrace/`。

核心测试引擎不应该写死具体项目的 URL、表名、角色名或流程引擎 API。供应链流程名称和规则只能存在于供应链目标项目的 `.flowtrace/` 产物或示例 fixtures 中。

## AI 与自动化执行的边界

FlowTrace 采用“AI 辅助、程序判定”的模式：

### AI 负责

- 从代码、文档和运行记录提取业务事实
- 生成测试案例和边界场景
- 分析重复节点和变更影响
- 解释测试失败原因
- 生成报告摘要和修复建议

### 程序负责

- 启动和恢复测试环境
- 执行业务动作和 API
- 采集数据库、消息和外部调用
- 比较新旧流程结果
- 执行差异等级和发布门禁

AI 不能直接忽略差异、批准 P0 结果或修改核心业务规则。

## 安全与数据原则

- 默认不连接生产数据库执行写操作。
- 旧系统采集优先使用只读方式。
- 自动化执行使用脱敏数据、测试副本、快照或事务回滚。
- 外部系统使用 Mock 或沙箱环境。
- 测试案例、流程基线和报告均应版本化。
- 涉及金额、权限、付款、授信和库存的差异必须人工确认。

## 当前项目状态

当前仓库提供可运行的配置驱动 MVP，包含内置 HTTP/浏览器运行时、声明式 DSL、采集、案例生成、双跑验证、证据和固定报告模板。`projects/supply-chain` 仅作为配置和案例参考，不应作为其他项目的运行时回退目标。

已包含：

- 通用核心模型和适配器接口
- 测试案例 Schema
- 项目配置模板
- 差异比较器骨架
- MVP 和试点实施文档

真实项目接入前，应先在测试环境完成配置校验、登录验证、数据隔离和 Release Gate 审核。

## 文档

- [安装与迁移](docs/installation.md)
- [目标项目接入指南](docs/target-project-guide.md)
- [MVP 计划](docs/mvp-plan.md)
- [架构设计](docs/architecture.md)
- [供应链试点计划](docs/supply-chain-pilot.md)
- [后续实施清单](docs/next-steps.md)
- [测试案例 Schema](schemas/test-scenario.schema.json)
