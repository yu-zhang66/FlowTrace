# FlowTrace AI 驱动的新旧流程双跑测试开发计划

## 1. 文档目的

本文档定义 FlowTrace 的目标形态、实现思路、功能范围、开发阶段、验收标准和测试计划。

目标效果是：用户在目标项目中安装 FlowTrace Skill 后，通过 Agent 自然语言发起测试，例如：

```text
帮我测试融资申请流程
```

Agent 自动找到目标项目中的测试案例，分别驱动旧系统和新系统执行相同案例，采集真实执行证据，比较两套流程的结果，并生成 Markdown/HTML 测试报告。

## 2. 产品目标与非目标

### 2.1 产品目标

FlowTrace 要解决的问题是：

> 新流程替换旧流程后，使用相同业务输入和操作步骤，是否仍然产生等价的业务结果。

最终闭环：

```text
自然语言请求
  → Agent 识别项目和流程
  → 查找并校验测试案例
  → 旧系统实际执行
  → 恢复同一测试数据
  → 新系统实际执行
  → 结果标准化和比较
  → 证据归档
  → 生成测试报告
```

### 2.2 非目标

第一阶段不实现：

- 让 AI 自由探索并自行定义业务预期
- 让 AI 自己决定测试通过或发布
- 自动修改业务系统数据或生产配置
- 用 `legacy-shadow` 结果证明新旧流程等价
- 一开始支持所有业务流程和所有页面

AI 负责理解请求、选择案例和调度工具；实际执行、断言、比较和门禁必须由确定性程序完成。

## 3. 目标架构

```text
FlowTrace Skill
      ↓
Agent Orchestrator
      ↓
Scenario Resolver
      ↓
flowtrace test / Test Run API
      ↓
Dual Test Runner
   ┌──┴─────────────┐
   ↓                ↓
Legacy Adapter   Current Adapter
   ↓                ↓
Browser/API      Browser/API
   └──┬─────────────┘
      ↓
Assertion Engine + Result Comparator
      ↓
Evidence Store
      ↓
Markdown/HTML/JSON Report
```

### 3.1 技术选型

- 浏览器自动化：Playwright
- Agent 调度：现有 FlowTrace Skill，后续可通过 CLI 或 MCP 暴露工具
- 测试案例：YAML/JSON，JSON Schema + Zod 校验
- 执行产物：JSON、截图、Trace、视频、日志、Markdown、HTML
- 测试数据：脱敏 Fixture、快照恢复或事务回滚
- FlowTrace 自身测试：Vitest

Playwright 负责可靠地操作浏览器并生成 trace、截图、视频和网络证据；AI 不直接替代 Playwright 测试脚本。Playwright MCP 可作为页面探索和 Agent 操作的辅助能力，但正式回归测试仍应沉淀为项目 Adapter。

## 4. 两种执行模式

### 4.1 真实业务测试模式

```bash
flowtrace test --project projects/supply-chain --process financing-application-approval
```

用于真实操作某一套系统，验证测试案例本身是否通过。

### 4.2 新旧流程双跑模式

```bash
flowtrace test \
  --project projects/supply-chain \
  --process financing-application-approval \
  --mode dual-browser
```

同一案例执行两次：

1. 恢复测试快照 A，执行旧系统。
2. 保存旧系统实际结果和证据。
3. 恢复测试快照 A，执行新系统。
4. 保存新系统实际结果和证据。
5. 进行预期断言和新旧结果比较。

现有 `verify` 命令可以暂时保留兼容，但新功能统一使用 `test --mode dual-browser` 表达真实双跑测试。

## 5. 目标项目目录

```text
projects/supply-chain/.flowtrace/
├── flowtrace.yaml
├── scenarios/
│   ├── financing-approval-normal-001.yaml
│   └── ...
├── fixtures/
│   ├── financing-approval-normal.json
│   └── snapshots/
├── adapters/
│   ├── legacy-browser-adapter.ts
│   ├── current-browser-adapter.ts
│   └── index.ts
├── mappings/
│   ├── state-mapping.yaml
│   └── field-mapping.yaml
├── executions/
└── reports/
```

项目配置增加：

```yaml
test:
  adapter: adapters/index.ts
  mode: dual-browser
  legacyBaseUrl: http://legacy.test
  currentBaseUrl: http://current.test
  headless: true
  screenshot: on-failure
  trace: retain-on-failure
  video: on-failure
  accounts:
    supplier:
      usernameEnv: FLOWTRACE_SUPPLIER_USERNAME
      passwordEnv: FLOWTRACE_SUPPLIER_PASSWORD
    core_enterprise_reviewer:
      usernameEnv: FLOWTRACE_CORE_REVIEWER_USERNAME
      passwordEnv: FLOWTRACE_CORE_REVIEWER_PASSWORD
```

账号密码只能通过环境变量或安全凭据注入，不能写入案例、Skill 或报告。

## 6. 测试案例规范

测试案例只表达业务语义，不绑定 URL、DOM 选择器或引擎节点 ID。

```yaml
id: financing-approval-normal-001
name: 正常融资申请审批通过
process: financing-application-approval
severity: P0
source:
  - facts/baseline.json#FR001
fixtures:
  - financing-approval-normal
actions:
  - type: SUBMIT
    actor: supplier
    data:
      financingAmount: 1000000
      financingTerm: 6
  - type: APPROVE
    actor: core_enterprise_reviewer
  - type: APPROVE
    actor: risk_assessor
  - type: APPROVE
    actor: financing_approver
expected:
  finalState: APPROVED
  semanticPath:
    - SUBMIT
    - CORE_ENTERPRISE_REVIEW
    - RISK_ASSESSMENT
    - FINANCING_APPROVAL
    - APPROVED
  database:
    financing_application.status: APPROVED
    financing_application.approved_amount: 1000000
```

第一阶段必须支持：

- 正常审批
- 核心企业拒绝
- 风控拒绝
- 融资机构拒绝
- 退回补充材料后重新提交
- 撤回
- 权限不足
- 重复提交
- 金额超过授信额度
- 外部系统失败或超时

## 7. 核心模块与功能要求

### 7.1 Scenario Resolver

负责：

- 扫描 `.flowtrace/scenarios/`
- 按 process、案例 ID、名称、标签和严重级别筛选
- 排除 enabled=false 的案例
- 校验案例 Schema
- 输出本次执行的案例清单

完成标准：给定“融资申请流程”，能够稳定找到全部相关案例，并在没有案例或案例无效时阻止执行。

### 7.2 Test Adapter

统一接口：

```typescript
interface TestAdapter {
  readonly name: string;
  readonly type: 'legacy' | 'current';
  initialize(): Promise<void>;
  reset(scenario: Scenario): Promise<void>;
  login(actor: string): Promise<void>;
  executeAction(action: ScenarioAction): Promise<ActionExecutionResult>;
  queryResult(): Promise<NormalizedResult>;
  captureEvidence(): Promise<Evidence[]>;
  cleanup(): Promise<void>;
}
```

Adapter 负责把 `SUBMIT`、`APPROVE`、`REJECT` 等业务动作转换成具体页面操作或 API 请求。

完成标准：供应链项目至少有 Legacy Browser Adapter 和 Current Browser Adapter，能够执行正常审批案例的全部动作。

### 7.3 Test Environment

负责：

- 准备 Fixture
- 创建测试快照
- 恢复快照
- 清理测试数据
- 保证旧系统和新系统使用同一初始状态

禁止直接对生产库执行写操作。

完成标准：同一个案例连续执行两次时，第二次不会继承第一次的业务状态。

### 7.4 Step Executor

每个 action 必须单独执行和记录：

```typescript
interface StepExecutionResult {
  index: number;
  action: ScenarioAction;
  passed: boolean;
  actualState?: string;
  expectedState?: string;
  error?: string;
  evidence: Evidence[];
  startedAt: string;
  finishedAt: string;
}
```

完成标准：报告能够定位到具体第几步、哪个角色、哪个业务动作失败。

### 7.5 Assertion Engine

负责比较实际结果和案例预期，至少支持：

- finalState
- semanticPath
- 关键业务字段
- 数据库字段路径
- 外部调用次数和参数
- 错误类型和错误码
- 权限拒绝
- 通知和审计记录

完成标准：不能仅因为新旧系统结果相同就判定通过；两边同时产生相同错误时，也必须检查案例是否明确预期该错误。

### 7.6 Comparator

比较旧系统和新系统的标准化结果：

- 最终状态
- 语义路径
- 审批角色
- 关键数据
- 数据库副作用
- 外部调用
- 通知
- 审计

允许忽略：

- 请求 ID
- 时间戳
- 页面 URL
- DOM 节点 ID
- 内部流程节点 ID

完成标准：技术实现可以不同，但核心业务结果、审批责任、关键金额和外部副作用差异必须被发现。

### 7.7 Evidence Collector

每个案例和步骤保存：

- 页面截图
- Playwright trace
- 视频（失败或配置启用时）
- 页面 URL
- 请求和响应摘要
- 浏览器控制台错误
- 实际状态
- 断言结果
- 数据库变化
- 外部调用记录

完成标准：失败案例可以脱离 Agent 对话，通过报告和证据复盘。

### 7.8 Report Generator

生成：

```text
.flowtrace/reports/report-<run-id>.json
.flowtrace/reports/report-<run-id>.md
.flowtrace/reports/report-<run-id>.html
```

报告必须包含：

- 执行环境
- 执行模式
- 案例清单
- 每个案例的通过/失败状态
- 每个步骤的执行结果
- 预期值和实际值
- 新旧差异
- 证据文件链接
- P0～P3 统计
- 发布门禁结论
- legacy-shadow 或 Demo 限制说明

## 8. Agent 和 Skill 调度机制

Skill 需要新增真实双跑工作流：

```text
用户提出测试请求
  ↓
Agent 读取当前项目和 flowtrace.yaml
  ↓
Agent 解析业务流程名称
  ↓
Agent 调用案例查询工具
  ↓
Agent 展示即将执行的案例数量
  ↓
Agent 调用 flowtrace test
  ↓
Agent 等待任务结束
  ↓
Agent 读取 JSON/Markdown 报告
  ↓
Agent 返回摘要和报告绝对路径
```

第一阶段可以使用 CLI 调度：

```text
Skill → shell → flowtrace test
```

第二阶段再提供 MCP 工具：

```text
flowtrace.list_scenarios
flowtrace.start_test_run
flowtrace.get_test_run
flowtrace.read_report
```

这样 Agent 不需要解析复杂终端输出，而是通过结构化工具获得执行状态。

## 9. 分阶段开发计划

### 阶段 0：工程准备

开发内容：

- 确定 `test` 命令和执行模式
- 确定测试 Adapter 接口
- 确定执行结果和证据目录
- 确定供应链测试环境、账号和 URL
- 明确不能使用线上写库

完成标准：接口、目录和一条端到端样例案例评审通过。

### 阶段 1：单系统真实测试

开发内容：

- `flowtrace test` 命令
- Scenario Resolver
- Browser Adapter
- Playwright 登录、提交和审批
- 逐步执行记录
- expected 断言
- 截图和 Markdown 报告

完成标准：

- 能对一个系统执行正常融资审批案例
- 能识别失败步骤
- 能生成包含截图和实际结果的报告
- 测试结果不是由 expected 伪造

### 阶段 2：双系统执行

开发内容：

- Legacy Adapter
- Current Adapter
- 两套系统 Base URL
- 双账号上下文
- 同一 Fixture/快照恢复
- 新旧结果标准化

完成标准：同一案例可以分别在旧系统和新系统真实执行，并生成两侧执行证据。

### 阶段 3：双跑比较和门禁

开发内容：

- 状态比较
- 路径比较
- 数据库比较
- 外部调用比较
- 权限和审计比较
- P0～P3 差异分级
- release gate

完成标准：构造一个新旧流程状态不一致、金额不一致或审批角色不一致的场景时，系统能够正确失败并阻断发布。

### 阶段 4：案例集和异常流程

开发内容：

- 拒绝
- 退回
- 撤回
- 转办
- 会签
- 越权
- 重复提交
- 外部系统异常
- 边界金额

完成标准：供应链第一批核心案例全部可以执行，且每个案例都有明确的预期和证据。

### 阶段 5：Agent Skill 和 MCP

开发内容：

- 更新 `skill/flowtrace/SKILL.md`
- 增加“真实测试”和“双跑测试”调度规则
- 增加案例查询工具
- 增加启动任务工具
- 增加任务状态查询工具
- 增加报告读取工具

完成标准：用户只需要说“测试融资申请流程”，Agent 就能自动找到案例、启动双跑并返回报告。

### 阶段 6：CI/CD 和持续回归

开发内容：

- 按标签执行
- 按严重级别执行
- 定时执行
- CI 中执行 P0/P1 案例
- 历史结果比较
- 失败重跑
- 测试报告归档

完成标准：代码或流程变更后，CI 可以自动执行关键案例并在 P0/P1 差异时失败。

## 10. 验收测试计划

### 10.1 框架单元测试

- 案例加载和筛选
- Schema 校验
- 断言操作符
- 数据库路径比较
- 动态字段忽略
- 差异严重级别计算
- 报告生成

### 10.2 Adapter 集成测试

- 登录成功和失败
- 提交成功
- 审批成功
- 拒绝成功
- 退回成功
- 权限不足
- 页面元素不存在
- 页面超时
- API 错误

### 10.3 双跑集成测试

- 旧、新系统都成功且结果一致
- 旧系统成功、新系统失败
- 最终状态不同
- 语义路径不同
- 审批角色不同
- 金额不同
- 外部调用次数不同
- 两次执行使用相同初始快照

### 10.4 Agent 调度测试

测试对话：

```text
帮我测试融资申请流程
```

验收：

- 找到正确项目
- 找到正确流程
- 找到正确案例
- 调用正确执行命令
- 不跳过案例校验
- 执行结束后读取真实报告
- 不自行修改通过/失败结论

### 10.5 端到端验收

完整执行：

```bash
flowtrace test \
  --project projects/supply-chain \
  --process financing-application-approval \
  --mode dual-browser
```

必须满足：

1. 旧系统完成一次真实流程。
2. 新系统完成一次真实流程。
3. 两边使用相同测试数据起点。
4. 每个动作都有执行记录。
5. 每个失败步骤都有证据。
6. 结果可以进行确定性比较。
7. 生成 JSON、Markdown 和 HTML 报告。
8. P0/P1 差异能够阻断发布。
9. Agent 能通过自然语言启动整个任务。

## 11. 第一版完成定义

第一版不要求支持所有流程，满足以下条件即可认为核心功能完成：

- 支持一个供应链融资申请流程
- 支持正常审批、拒绝、退回三个案例
- 支持浏览器自动化
- 支持旧系统和新系统双跑
- 支持同一测试数据快照恢复
- 支持最终状态和语义路径比较
- 支持截图、trace 和失败日志
- 支持 Markdown 报告
- 支持 `flowtrace test` CLI
- Skill 能根据自然语言调用该命令
- 不能把 legacy-shadow 结果标记为真实等价

## 12. 推荐实施原则

1. 先实现确定性测试执行器，再接入更强的 AI 浏览器能力。
2. AI 负责调度，不负责最终判定。
3. 测试案例描述业务动作，Adapter 描述页面或 API 细节。
4. 旧系统和新系统必须使用相同初始数据。
5. 每一步都要有实际结果和证据。
6. 所有发布门禁由程序判断。
7. 先跑通一个完整流程，再扩展案例数量。

## 13. MVP 范围调整：先实现登录流程

在融资申请流程之前，第一版只实现 `login` 流程，用于验证完整技术闭环：

```text
Agent 自然语言调度
  → 找到 login 测试案例
  → 旧系统登录
  → 恢复测试环境
  → 新系统登录
  → 比较登录结果
  → 生成报告
```

本节优先级高于前文中“第一版直接支持融资申请”的描述；融资申请属于登录 MVP 之后的第二阶段。

### 13.1 登录 MVP 必须支持的案例

- 登录成功
- 用户名错误
- 密码错误
- 用户被禁用或无权限
- 登录超时或页面异常
- 登录成功后首页/工作台状态验证

第一版至少实现前三个案例。

### 13.2 登录案例示例

```yaml
id: login-success-001
name: 用户登录成功
process: login
severity: P0
fixtures:
  - login-valid-user
actions:
  - type: LOGIN
    actor: supplier
    data:
      usernameRef: SUPPLIER_USERNAME
      passwordRef: SUPPLIER_PASSWORD
expected:
  finalState: AUTHENTICATED
  semanticPath:
    - LOGIN_PAGE
    - AUTHENTICATED
```

密码不能写入案例文件，正式执行只能使用环境变量或安全凭据引用。

### 13.3 登录 Adapter 的职责

Legacy 和 Current Adapter 都实现相同的 `LOGIN` 动作，但页面细节可以不同：

```text
LegacyLoginAdapter  → 旧系统登录页、旧系统首页
CurrentLoginAdapter → 新系统登录页、新系统首页
```

两侧都必须返回统一结果：

```typescript
interface LoginResult {
  finalState: 'AUTHENTICATED' | 'LOGIN_FAILED';
  semanticPath: string[];
  errorCode?: string;
  errorMessage?: string;
  currentUrl: string;
  evidence: Evidence[];
}
```

### 13.4 登录 MVP 命令

```bash
flowtrace test \
  --project projects/supply-chain \
  --process login \
  --mode dual-browser
```

### 13.5 登录 MVP 完成标准

只有全部满足以下条件，登录 MVP 才算完成：

1. Agent 能理解“测试登录流程”。
2. Agent 能找到 `process: login` 的案例。
3. Agent 能调用 `flowtrace test`。
4. 旧系统和新系统各执行一次每个案例。
5. 两侧使用独立浏览器上下文和正确账号。
6. 登录成功、失败状态能够被程序断言。
7. 登录后 URL、页面标识和错误提示能够被比较。
8. 每个案例保存截图、步骤结果和失败日志。
9. 生成 JSON 和 Markdown 报告。
10. 新旧登录结果差异能够被标记为 P0/P1，并进入发布门禁。
11. `legacy-shadow` 模式明确标记为框架验证，不能作为真实对比结论。

### 13.6 登录 MVP 之后的开发顺序

```text
登录
  → 融资申请提交
  → 核心企业审批
  → 风控审批
  → 融资机构审批
  → 拒绝/退回/撤回
  → 权限和异常流程
```
