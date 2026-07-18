# FlowTrace 文件化产物规范

MVP 阶段使用 Git 管理项目事实、测试案例、执行结果和报告，不依赖 FlowTrace 自身数据库。

## 单一事实源

JSON/YAML 是机器可执行的结构化事实源，Markdown 是由程序根据 JSON/YAML 自动渲染的人工阅读视图。

```text
JSON/YAML
   ↓
Markdown Renderer
   ↓
人工审核、报告和归档
```

禁止人工分别维护同一内容的 JSON 和 Markdown，避免两者不一致。

旧流程采集结果也必须生成 Markdown 审核稿。采集完成后不能直接进入测试案例生成，必须先经过人工核对或明确标记为待确认。

## 目录约定

```text
projects/<project>/
├── facts/
│   ├── *.json       # 结构化事实源
│   └── *.md         # 自动渲染的人工审核稿
├── scenarios/
│   ├── *.yaml       # 测试案例源文件
│   └── rendered/    # 自动生成的案例说明
├── executions/
│   └── <run-id>/
│       ├── legacy-result.json
│       ├── current-result.json
│       ├── diff.json
│       └── summary.md
└── reports/
    ├── <run-id>.json
    └── <run-id>.md
```

## 生成规则

每次生成或更新结构化文件时，FlowTrace 应同步执行：

```bash
flowtrace render --project <project>
```

CI 中应检查 Markdown 是否为最新渲染结果：

```bash
flowtrace render --check --project <project>
```

如果检查失败，说明结构化文件和 Markdown 视图不一致，流水线应失败。

## 旧流程基线审核稿

旧流程事实 Markdown 至少应包含：

- 流程名称、版本、采集时间和采集范围
- 流程节点、语义名称、节点类型和前后关系
- 分支条件、执行角色、组织和权限
- 输入字段、输出字段和数据库影响
- 业务 API、Service、SQL 和外部系统
- 每条事实的来源证据、置信度和审核状态
- 无法确认的事实和待业务确认问题
- Mermaid 流程图或等价的可读流程结构图

审核状态统一使用：

```text
CONFIRMED       已人工确认
PENDING_CONFIRM 待人工确认
REJECTED        已确认错误
AUTO_EXTRACTED  自动提取、尚未人工确认
```

只有 `CONFIRMED` 或经过明确批准的 `AUTO_EXTRACTED` 内容，才可以作为高风险测试案例的事实依据。

## 测试案例展示

测试案例 YAML/JSON 应自动渲染为包含以下内容的 Markdown：

- 案例 ID、名称、流程和严重级别
- 来源证据
- 前置条件
- 输入数据
- 业务操作序列
- 预期语义路径
- 预期最终状态
- 数据库断言
- 外部调用断言
- 审核状态

## 报告展示

执行结果 JSON 应自动渲染为 Markdown 报告，至少包含：

- 执行批次和流程版本
- 测试案例汇总
- P0/P1/P2/P3 差异数量
- 每个失败案例的操作步骤
- 旧值、新值和差异类型
- 证据和影响对象
- AI 分析结果
- 发布门禁结论
