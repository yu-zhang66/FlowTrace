# FlowTrace 命令门禁与测试验证码开发提示词

你负责实现 OpenSpec 变更 `add-flowtrace-command-gates-and-captcha`。必须先阅读该 change 下的 `proposal.md`、`design.md`、`tasks.md` 和全部 spec delta；不要实现页面点击录制功能。

## 实施边界

本次实现包括：自然语言流程解析、当前项目默认选择、初始化与配置状态检查、录制状态门禁、测试案例门禁、结构化 CLI 输出、pipeline/resume、JSON/Markdown/HTML 报告完整性、FlowTrace 硬编码验证码移除，以及 supply_chain 测试环境受控超级验证码。

本次不包括：浏览器页面录制器、生产验证码策略改变、Release Gate 规则改变、真实银行或业务数据写入。

## 开发规则

1. 严格按 `tasks.md` 顺序实施；每完成一个任务更新勾选状态。
2. 保持现有显式 `--project` 和 `--process` 参数兼容；未指定项目时使用当前工作目录。
3. 流程可通过 process ID、名称、别名或自然语言描述解析；歧义必须阻断并返回候选，不得猜测。
4. 生成案例前必须存在并确认录制；测试前必须存在确认录制、有效案例和完整配置。
5. 配置不全时禁止启动录制、案例生成或测试。
6. 不在源码、Scenario、报告或日志中写入密码、验证码、Token 或签名密钥。
7. 测试验证码必须默认关闭，仅测试环境可通过配置、时效和签名校验启用。
8. 测试成功和失败都必须生成 JSON、Markdown、HTML；HTML 缺失时命令必须失败。

## 阶段验收提示词

### 阶段 1：状态与流程解析

完成标准：实现 `status`、结构化结果、当前项目默认解析、process ID/名称/别名/自然语言解析、歧义阻断和配置缺失提示。

必须通过：

- 唯一流程名称解析测试
- 显式 process ID 测试
- 多候选 `AMBIGUOUS_PROCESS` 测试
- 未找到 `PROCESS_NOT_FOUND` 测试
- 未初始化和配置缺失非零退出测试
- `--project` 显式参数兼容测试

### 阶段 2：命令前置门禁

完成标准：collect、generate-cases、validate-cases、test、report、pipeline 均使用统一状态检查；生成案例和测试不能绕过录制状态。

必须通过：

- 未初始化时阻断
- 配置不完整时阻断
- 流程不存在时阻断
- 未录制时生成案例被阻断
- 已录制但未确认时生成案例被阻断
- 无有效案例时测试被阻断
- 所有阻断结果包含缺失项和修复建议

### 阶段 3：Pipeline 与报告

完成标准：pipeline 按前置状态、案例、测试、报告顺序运行，支持 resume，失败时保留中间产物。

必须通过：

- 完整成功 pipeline 测试
- 中间阶段失败后 resume 测试
- 测试失败仍生成三类报告测试
- HTML 缺失/为空时命令失败测试
- 报告路径为目标项目下 `.flowtrace/reports` 的绝对路径
- JSON 结果包含 runId、process、artifacts、releaseGate 和 warnings

### 阶段 4：受控超级验证码

完成标准：supply_chain 后端支持测试模式、配置验证码、HMAC 签名、时间戳和环境/来源限制；FlowTrace 不再硬编码验证码。

必须通过：

- 测试模式关闭时超级验证码失败
- 测试模式开启且签名有效时成功
- 错误签名失败
- 过期时间戳失败
- 非允许来源失败
- 普通验证码行为不回归
- FlowTrace 源码搜索不到固定验证码值
- 缺少验证码或签名配置时 status/test 阻断

### 阶段 5：Skill 集成

完成标准：更新 `skill/flowtrace/SKILL.md` 和 `agents/openai.yaml`，使 Skill 先解析项目和流程，再执行状态检查，最后调用命令并读取结构化结果。

必须通过：

- “帮我采集登录流程”可解析并执行
- “帮我采集融资申请流程”可解析并执行
- “帮我生成融资申请流程测试案例”在无确认录制时被阻断
- “帮我测试融资申请流程”在配置不全时被阻断
- 未指定项目时默认当前项目
- 报告结果包含 HTML 绝对路径和 Gate 状态

## 最终验证命令

在 FlowTrace 仓库执行：

```bash
pnpm typecheck
pnpm test
pnpm build
openspec validate add-flowtrace-command-gates-and-captcha --strict
```

在 supply_chain 仓库执行项目规定的后端编译、前端 lint 和登录验证码集成测试。不要连接生产库，不要提交真实账号、密码、验证码或密钥。

## 交付要求

交付时必须说明：

- 已完成哪些阶段
- 每个阶段通过了哪些测试
- 尚未完成的 tasks
- 修改的 FlowTrace 文件和 supply_chain 文件
- 配置模板和启用测试模式的方法
- 任何无法执行的测试及原因
- 明确说明页面录制功能本次未实现
