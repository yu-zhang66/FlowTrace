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

## 核心能力

## 技术框架

FlowTrace 第一阶段采用 TypeScript 全栈实现：

```text
Node.js 20 LTS+
TypeScript 5+
pnpm 9+ workspaces
Fastify                 服务 API（预留服务化）
Commander               CLI
Zod + Ajv               运行时模型和 JSON Schema 校验
js-yaml                 YAML 配置和测试案例
Playwright              页面采集和 UI 自动化
Vitest                  FlowTrace 自身测试
Vue 3 + Vite + Element Plus 轻量前端
oracledb                Oracle 只读采集/隔离测试访问
```

MVP 不要求启动服务端和数据库，使用 CLI、文件、Git 和测试环境即可运行。服务化阶段再增加 Fastify API、Worker、Redis/BullMQ 和独立 Oracle Schema。

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
<target-project>/.flowtrace  项目配置、适配器、事实、映射、案例和报告
```

接入一个新项目时，通常只需要在目标项目提供：

- 项目配置
- 旧流程适配器
- 新流程适配器
- 数据库快照或测试数据适配器
- 外部系统 Mock 配置
- 状态、节点和角色映射
- 项目专属测试案例

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

当前仓库处于 MVP 准备阶段，首个试点为供应链系统的融资申请审批流程。新流程尚未开发，首期使用旧流程作为 current adapter 的临时替身，先验证完整测试链路。

已包含：

- 通用核心模型和适配器接口
- 测试案例 Schema
- 项目配置模板
- 差异比较器骨架
- MVP 和试点实施文档

后续优先实现一个真实流程的旧基线采集、旧新双跑和第一版报告。

## 文档

- [MVP 计划](docs/mvp-plan.md)
- [架构设计](docs/architecture.md)
- [供应链试点计划](docs/supply-chain-pilot.md)
- [后续实施清单](docs/next-steps.md)
- [测试案例 Schema](schemas/test-scenario.schema.json)
