# FlowTrace 架构

```text
项目事实/代码/页面/运行记录
          ↓
    Fact Collector
          ↓
    Fact Baseline
          ↓
 AI Scenario Generator
          ↓
  Schema + Evidence Validator
          ↓
 ┌────────────────┬────────────────┐
 │ Legacy Adapter │ Current Adapter│
 └────────────────┴────────────────┘
          ↓
     Dual Runner
          ↓
 Result Normalizer / Comparator
          ↓
   Diff + AI Explanation
          ↓
 Report / Release Gate
```

FlowTrace 不实现业务流程引擎，而是通过目标项目 `.flowtrace/` 中的系统声明和流程 DSL 接入被测系统。流程引擎 API 可以完全不同；测试案例只表达业务动作，内置运行时负责将声明式步骤转换为实际 HTTP 或浏览器操作。只有非标准能力才通过显式外部插件接入。

目标项目负责保存项目专属产物：

```text
<target-project>/.flowtrace/
├── flowtrace.yaml
├── adapters/
├── facts/
├── semantic/
├── mappings/
├── scenarios/
├── fixtures/
├── executions/
└── reports/
```

FlowTrace 仓库中的项目目录只能保存示例或适配器模板，不能作为真实项目事实的唯一归属位置。

比较对象包括：业务最终状态、语义流程路径、审批角色和权限、关键业务字段、数据库副作用、外部调用、消息通知和审计记录。

## 页面差异与业务等价

新旧系统的页面、按钮、URL、表单布局、节点名称和操作步骤可以不同。FlowTrace 不以页面像素、DOM、URL 或引擎节点 ID 作为流程等价的主要依据，而是通过稳定的业务语义关键词和业务动作比较。

允许页面实现不同，但以下内容必须保持一致或具有经批准的映射：业务意图、业务动作和语义路径、审批角色与权限边界、业务规则和分支条件、关键数据和状态、外部系统副作用、审计和责任追溯。

页面测试验证“用户能否完成同一业务目标”，而不是验证新旧页面完全相同。关键词维护见 [业务语义关键词字典](semantic-dictionary.md)。

供应链项目使用 Oracle 19c，MVP 阶段不连接线上库执行写操作；采集默认只读，执行使用脱敏副本、测试库快照或事务回滚环境。FlowTrace 自身的服务化数据库按当前决策使用 Oracle，并通过独立 Schema 与被测业务数据隔离；MVP 文件化运行，不强制依赖数据库。
