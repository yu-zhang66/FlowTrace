# FlowTrace 业务语义关键词字典

FlowTrace 不直接用页面文字、引擎节点 ID 或 API URL 判断新旧流程是否一致，而是使用稳定的业务语义关键词作为中间层：

```text
旧页面/API/流程节点 ─┐
                     ├── 业务语义关键词 ── 比较器
新页面/API/流程节点 ─┘
```

例如“部门负责人审批”和“核心企业审核”可以统一为 `CORE_ENTERPRISE_APPROVE`。

## 维护位置

全局通用词典：

```text
packages/core/resources/semantic-dictionary.yaml
```

项目业务词典：

```text
projects/supply-chain/semantic/keywords.yaml
```

示例：

```yaml
version: 1
project: supply-chain
process: financing-application-approval
keywords:
  - key: FINANCING_APPLICATION_SUBMIT
    canonicalName: 提交融资申请
    type: BUSINESS_ACTION
    aliases: [提交申请, 发起融资, 发起审批]
    definition: 申请人完成融资申请填写并提交审批
    evidence:
      - source: zgweb/src/views/financingManagement/financingApply/Index.vue
    reviewStatus: PENDING_CONFIRM
```

关键词类型包括：

```text
BUSINESS_ACTION
BUSINESS_STEP
BUSINESS_RULE
BUSINESS_STATE
ROLE
DATA_OBJECT
DATA_FIELD
EXTERNAL_OPERATION
```

## AI 自动录入流程

```text
扫描代码/页面/流程/数据库/运行记录
              ↓
AI 提取候选关键词
              ↓
标准化、去重、相似词聚合
              ↓
匹配已有词典并检查冲突
              ↓
生成新增/别名/冲突候选
              ↓
Schema、证据和置信度校验
              ↓
人工确认
              ↓
写入 keywords.yaml
              ↓
生成 Markdown 审核稿
```

建议命令：

```bash
flowtrace semantic extract --project projects/supply-chain
flowtrace semantic validate --project projects/supply-chain
flowtrace semantic render --project projects/supply-chain
```

AI 候选必须包含 `key`、规范名称、类型、定义、证据、置信度和 `PENDING_CONFIRM` 状态。未批准的候选只能写入：

```text
projects/supply-chain/semantic/pending-keywords.yaml
```

不能直接进入正式词典。涉及审批责任、金额规则和权限边界的关键词必须人工确认。

## 版本和审核

正式词典和候选词都生成 Markdown 审核稿。关键词被案例、映射或报告引用后，不直接删除，而是标记为 `DEPRECATED` 并保留替代关系。
