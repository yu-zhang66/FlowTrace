# FlowTrace 第一版 MVP AI 编码实施方案

本文档用于直接交给 Cursor、Codex 或其他 AI 编码模型执行。目标是基于当前代码完成第一版 MVP，不要求一次完成服务化、完整流程设计器或真实新流程引擎。

## 1. 最终目标

完成以下闭环：

```text
目标项目 supply_chain
  ↓
只读采集融资申请审批旧流程
  ↓
生成结构化 JSON/YAML 基线
  ↓
自动生成等价 Markdown 供人工核对
  ↓
生成带证据的融资申请测试案例
  ↓
通过目标项目适配器执行 legacy/current
  ↓
比较状态、语义路径、角色、数据和外部调用
  ↓
生成 JSON/Markdown/HTML 报告
  ↓
输出 P0/P1/P2/P3 发布结论
```

当前新流程尚未开发，因此第一阶段允许：

```text
current adapter = legacy-shadow adapter
```

但所有报告必须明确：legacy-shadow 只验证 FlowTrace 工具链，不证明未来新流程等价。

## 2. 当前代码问题和修改原则

### 当前已具备

- TypeScript/pnpm workspace
- core、adapter、runner、reporter、ai、cli 包
- 基础模型、适配器接口、双跑接口和报告模型
- OpenSpec 和 FlowTrace Skill
- `pnpm build` 和 `pnpm typecheck` 已在开发环境通过

### 必须修正

1. `collect.ts` 仍使用硬编码 `mockFacts`。
2. `generate-cases.ts` 仍混用或生成 `supplier-onboarding` 案例。
3. `verify.ts` 仍使用 `mockLegacyResult` 和 `mockCurrentResult`。
4. 流程事实、案例和报告还没有真正归属目标项目 `.flowtrace/`。
5. Oracle 只读采集没有完成。
6. AI Provider 的结构化输出校验需要补齐。
7. JSON/YAML 到 Markdown 的完整渲染需要补齐。
8. `pnpm test` 必须真实执行 Vitest，不能输出“Tests disabled”。
9. 第一阶段轻量 UI 尚未完成。
10. 页面差异需要通过业务语义关键词比较，不能要求页面完全一致。

## 3. 目标项目边界

FlowTrace 核心不得写死供应链流程、角色、表名、接口或业务规则。

供应链目标项目必须使用：

```text
/Users/fengjue/project/szwl/supply_chain/.flowtrace/
```

目标目录结构：

```text
.flowtrace/
├── flowtrace.yaml
├── adapters/
│   ├── legacy-flow-adapter.ts
│   ├── current-flow-adapter.ts
│   ├── oracle-readonly-adapter.ts
│   └── external-system-adapter.ts
├── facts/
│   ├── baseline.json
│   └── baseline.md
├── semantic/
│   ├── keywords.yaml
│   ├── pending-keywords.yaml
│   └── mappings.yaml
├── scenarios/
│   ├── *.yaml
│   └── rendered/*.md
├── fixtures/
├── executions/
├── reports/
└── mocks/
```

FlowTrace CLI 必须支持：

```bash
flowtrace collect --project /path/to/project --process <process-id>
cd /path/to/project && flowtrace collect --process <process-id>
```

两种方式都必须读取目标项目的 `.flowtrace/flowtrace.yaml`，并将输出写入目标项目 `.flowtrace/`。

## 4. 执行规则

AI 编码模型必须遵守：

1. 每完成一个阶段，先运行该阶段的验收命令。
2. 不得为了让测试通过而删除测试、降低类型约束或跳过错误。
3. 不得把真实业务流程重新写回 FlowTrace 核心。
4. 不得连接在线 Oracle 执行写操作。
5. 没有测试账号和测试环境时，只实现接口和安全的离线 fixture，不猜测凭据。
6. AI 生成的事实和案例必须有证据或 `PENDING_CONFIRM` 状态。
7. legacy-shadow 报告必须标记为“工具链验证”，不得写成“新流程通过”。
8. 所有结构化 JSON/YAML 必须自动生成等价 Markdown，禁止人工维护两份内容。

## 5. 阶段一：修复工程门禁

### 修改内容

- 检查根目录 `package.json`。
- 确保 `pnpm test` 执行 `vitest run`。
- 修复所有 package 的测试依赖和测试脚本。
- 修复 core、adapter、runner、reporter、ai、cli 的类型错误。
- 修复根目录 TypeScript workspace 配置，避免 rootDir 把所有 package 当作单一项目编译。
- 清理 `src/` 和 `test/` 中错误生成的 `.js`、`.d.ts`、`.map` 文件。
- 确保构建产物只进入各 package 的 `dist/`。

### 验收命令

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

要求：四条命令都以退出码 0 结束，且 `pnpm test` 必须实际执行测试。

## 6. 阶段二：重构目标项目加载

### 修改内容

新增目标项目加载器：

```text
TargetProjectLoader
ProjectConfigLoader
AdapterLoader
ArtifactPathResolver
```

所有命令统一使用目标项目路径：

```text
collect
generate-cases
validate-cases
verify
render
report
```

默认路径规则：

```text
projectRoot/.flowtrace/flowtrace.yaml
projectRoot/.flowtrace/facts
projectRoot/.flowtrace/semantic
projectRoot/.flowtrace/scenarios
projectRoot/.flowtrace/executions
projectRoot/.flowtrace/reports
```

### 必须删除或迁移

- CLI 中的供应商准入硬编码。
- CLI 中的融资申请硬编码事实。
- CLI 中的硬编码角色、规则、表名和预期状态。
- FlowTrace 核心对 `projects/supply-chain` 的强依赖。

供应链内容只能保存在目标项目 `.flowtrace/` 或 examples/fixtures 中。

### 验收

使用一个临时空项目配置运行 `flowtrace list`，确认核心没有依赖供应链名称。使用 `supply_chain/.flowtrace` 运行时，所有输出必须写入该目录。

## 7. 阶段三：实现融资申请旧流程基线采集

### 采集来源

按以下优先级实现：

1. 代码和配置：`zg-autoflow`、`zg-scf`、`zg-system`、`zgweb`。
2. 数据库元数据和指定流程实例：Oracle 只读。
3. API 和页面入口。
4. 运行日志和审批轨迹。
5. 人工确认。

### 首期采集对象

- 融资申请流程定义
- 流程节点和状态
- 核心企业审核
- 风控评估
- 融资机构审批
- 角色和组织
- 融资申请业务表和审批记录表
- 关键字段和状态变化
- 外部系统调用
- 历史流程实例

### Oracle 安全要求

- 只读账号。
- 表白名单。
- 查询时间范围和条数限制。
- 禁止 INSERT、UPDATE、DELETE、MERGE 和 DDL。
- 测试实例必须脱敏。
- 采集配置不得硬编码密码。

### 输出

```text
.flowtrace/facts/baseline.json
.flowtrace/facts/baseline.md
```

`baseline.md` 必须包含：

- 流程 Mermaid 图
- 节点和语义名称
- 规则和分支
- 角色和权限
- API、Service、SQL、表和字段
- 外部系统
- 证据、置信度和审核状态
- 待业务确认问题

## 8. 阶段四：实现业务语义关键词

### 目标

解决新旧页面和 API 不一致的问题。页面、URL、按钮和节点名称可以不同，但映射到相同的业务语义关键词。

### 关键词文件

```text
.flowtrace/semantic/keywords.yaml
.flowtrace/semantic/pending-keywords.yaml
.flowtrace/semantic/mappings.yaml
```

### 关键词示例

```yaml
- key: FINANCING_APPLICATION_SUBMIT
  canonicalName: 提交融资申请
  type: BUSINESS_ACTION
  aliases: [提交申请, 发起融资, 发起审批]
  evidence: []
  confidence: 0.92
  reviewStatus: PENDING_CONFIRM
```

### AI 录入流程

```text
采集事实
 → AI 提取候选关键词
 → 去重和别名聚合
 → 检查已有词典冲突
 → 输出 pending-keywords.yaml
 → 人工确认
 → 写入 keywords.yaml
 → 生成 semantic-keywords.md
```

AI 不得直接把候选写入已确认词典。

## 9. 阶段五：生成融资申请测试案例

### 必须覆盖

- 正常提交和审批通过
- 核心企业拒绝
- 风控拒绝
- 融资机构拒绝
- 退回补充材料后重新提交
- 融资金额边界
- 权限不足
- 外部系统超时或失败
- 重复提交和幂等

### 案例要求

案例使用业务动作，不使用页面 URL 或引擎节点 ID：

```yaml
id: financing-application-normal-001
process: financing-application-approval
actions:
  - type: SUBMIT
    actor: supplier_user
  - type: APPROVE
    actor: core_enterprise_reviewer
expected:
  finalState: SUBMITTED
```

每个案例必须包含来源证据，并生成对应 Markdown。

## 10. 阶段六：实现真实适配器和 legacy-shadow

### 适配器接口

```typescript
interface BusinessFlowAdapter {
  initialize(): Promise<void>;
  reset(scenario: Scenario): Promise<void>;
  executeAction(action: BusinessAction): Promise<ActionResult>;
  queryResult(): Promise<NormalizedResult>;
  cleanup(): Promise<void>;
}
```

### 供应链适配器

```text
.flowtrace/adapters/legacy-flow-adapter.ts
.flowtrace/adapters/current-flow-adapter.ts
.flowtrace/adapters/oracle-readonly-adapter.ts
```

当前 `current-flow-adapter.ts` 可以委托 legacy adapter，但必须在结果 metadata 中标明：

```text
mode: legacy-shadow
equivalenceProof: false
```

不能使用测试案例的 `expected` 字段伪造实际执行结果。

## 11. 阶段七：实现双跑和比较

执行顺序：

```text
恢复快照 A
 → 旧流程执行
 → 保存旧结果

恢复快照 A
 → current 流程执行
 → 保存新结果

标准化
 → 语义路径比较
 → 状态比较
 → 权限比较
 → 数据比较
 → 外部调用比较
```

允许差异：

- URL 不同
- 页面布局不同
- 按钮名称不同
- 引擎节点 ID 不同
- 内部请求 ID 不同

禁止差异：

- 业务意图丢失
- 审批角色改变
- 权限扩大
- 核心状态改变
- 金额或关键字段改变
- 外部调用缺失或重复
- 审计责任丢失

## 12. 阶段八：报告和 Markdown

所有结构化文件必须由程序渲染：

```text
JSON/YAML → Markdown
JSON → HTML
```

必须实现：

```bash
flowtrace render --project <project>
flowtrace render --check --project <project>
```

`render --check` 必须重新渲染并比较内容，不能只比较修改时间。

报告必须包含：

- 案例总数
- 通过/失败数量
- P0/P1/P2/P3 数量
- 每个差异的旧值、新值和证据
- 影响对象
- legacy-shadow 限制说明
- 发布门禁结论

## 13. 阶段九：第一阶段轻量 UI

只实现以下页面：

1. 项目和流程选择。
2. 基线审核状态。
3. 测试案例列表和详情。
4. 创建和查看测试执行任务。
5. 报告汇总和差异详情。

技术：Vue 3、Vite、TypeScript、Element Plus。使用 `ui-ux-pro-max` 优化信息层级、加载状态、空状态、错误状态、P0/P1 视觉提示和可访问性。

## 14. 阶段十：Skill 编排

Skill 工作流：

```text
识别目标项目
 → 读取 .flowtrace/flowtrace.yaml
 → collect
 → render baseline
 → 等待/提示人工审核
 → generate-cases
 → validate-cases
 → verify
 → report
 → 解释差异
```

Skill 不得默认使用供应商准入或其他项目的流程事实。

## 15. 最终验收

必须全部满足：

```text
pnpm install 通过
pnpm build 通过
pnpm typecheck 通过
pnpm test 真正执行并通过
Skill 校验通过
OpenSpec 校验通过
collect 不再使用 mockFacts
generate-cases 不再硬编码业务流程
verify 不再使用 mockLegacyResult/mockCurrentResult
融资申请案例全部存储在 supply_chain/.flowtrace/
baseline JSON 和 Markdown 可人工核对
Oracle 只读采集可用或有明确安全阻塞说明
legacy-shadow 可完整执行
JSON/YAML 可生成等价 Markdown
报告可输出 HTML 和 Markdown
P0/P1 可执行发布门禁
FlowTrace 核心不包含供应链业务常量
```

## 16. AI 编码提交要求

每个阶段完成后，AI 编码模型必须输出：

1. 修改文件列表。
2. 实现内容摘要。
3. 未完成事项。
4. 执行过的命令及结果。
5. 新增或修改的测试。
6. 是否仍存在 Mock、TODO 或硬编码业务内容。
7. 是否影响目标项目数据安全。
