# 供应链首个试点计划

## 被测项目

`/Users/fengjue/project/szwl/supply_chain`

重点模块：`zg-autoflow`、`zg-autoform`、`zg-scf`、`zg-system`、`zg-message`、`zg-third`、`zgweb`、Oracle 19c 和 RocketMQ。

## 流程选择

首个流程确定为：**融资申请审批**。

新流程尚未开发，首期使用旧流程实现两个适配器：`LegacyFlowAdapter` 和临时的 `CurrentFlowAdapter`。两者底层可以调用同一旧流程，但必须经过不同适配器边界执行，以先验证案例、双跑、比较和报告链路；新流程完成后只替换 `CurrentFlowAdapter` 的配置和实现。

## 采集产物

```text
projects/supply-chain/facts/
  process.json
  rules.json
  roles.json
  api-map.json
  data-map.json
  runtime-traces/
projects/supply-chain/mappings/
  state-map.yaml
  node-semantic-map.yaml
  business-actions.yaml
```

## 验收

- 一个流程可以形成版本化旧基线。
- 至少覆盖正常、边界、退回、权限、外部失败五类场景。
- 新旧流程使用相同案例执行。
- P0 数据、状态和权限差异自动阻断。
- 报告定位到案例、动作、证据和受影响对象。
- 测试账号由业务方提供；数据库采集使用当前供应链项目配置进行只读访问。
- 首期数据使用脱敏测试数据或数据库快照，不对在线 Oracle 执行写操作。
