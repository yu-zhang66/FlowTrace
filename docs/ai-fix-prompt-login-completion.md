# AI 修复提示词：完成 FlowTrace 登录双跑 MVP

```text
你负责修复并完成 FlowTrace 的登录流程 MVP。当前代码已经有基础模型、Scenario Resolver、Playwright Adapter 和 Test Executor，但尚未形成真正可运行的端到端闭环。

工作目录：
- FlowTrace 开发仓库：/Users/fengjue/project/szwl/FlowTrace
- 真实被测项目：/Users/fengjue/project/szwl/supply_chain

严格遵守：
- FlowTrace 目录只开发通用能力。
- supply_chain 目录保存真实项目的流程、案例、配置、Adapter、执行证据和报告。
- 不要把 supply_chain 的 URL、账号、密码、selector 或业务案例硬编码进 FlowTrace core、runner、cli 或 Skill。
- 不要覆盖或删除 supply_chain 已有的 `.flowtrace` 资产。
- 不要将密码、Cookie、Token 写入 Git、案例、日志、报告或截图。
- 不要使用 legacy-shadow 结果声称真实新旧流程等价。
- 不要为了通过测试删除或弱化现有测试。

一、先阅读文件

1. openspec/AGENTS.md
2. openspec/project.md
3. openspec/changes/add-login-ai-dual-run/proposal.md
4. openspec/changes/add-login-ai-dual-run/design.md
5. openspec/changes/add-login-ai-dual-run/tasks.md
6. openspec/changes/add-login-ai-dual-run/specs/login-dual-run/spec.md
7. docs/ai-implementation-prompt-login-dual-run.md
8. docs/ai-modification-prompt-target-project-isolation.md
9. packages/cli/src/commands/test/test.ts
10. packages/cli/src/commands/test/test-executor.ts
11. packages/cli/src/commands/test/scenario-resolver.ts
12. packages/adapter/src/playwright-browser-adapter.ts
13. packages/adapter/src/login-adapter-loader.ts
14. packages/core/src/models/login-execution.ts
15. /Users/fengjue/project/szwl/supply_chain/.flowtrace/processes/user-login.json
16. /Users/fengjue/project/szwl/supply_chain/zgweb/src/views/Login1.vue
17. /Users/fengjue/project/szwl/supply_chain/doc/agent-browser-login-test-case-v2.md

二、必须修复的核心问题

1. 让 `flowtrace test` 真正执行测试

当前 `packages/cli/src/commands/test/test.ts` 在打印“Full browser adapter integration requires additional setup”后结束，这是不允许的。

实现完整流程：

1. 解析目标项目路径，默认使用当前工作目录。
2. 加载目标项目 `.flowtrace/flowtrace.yaml`。
3. 加载 `.flowtrace/login-test-config.json` 或等价目标项目配置。
4. 解析 process、scenario 和 adapter。
5. 校验案例和凭据引用。
6. 创建 LoginAdapterLoader。
7. 初始化 legacy/current Adapter。
8. 调用 LoginTestExecutor 执行案例。
9. 执行结束后 cleanup 两个 Adapter。
10. 保存 executions 产物。
11. 生成 JSON 和 Markdown 报告。
12. 根据 P0/P1 gate 返回正确退出码。

CLI 目标：

flowtrace test --project /Users/fengjue/project/szwl/supply_chain --process user-login --mode dual-browser

在目标项目目录中也必须支持：

cd /Users/fengjue/project/szwl/supply_chain
flowtrace test --process user-login --mode dual-browser

2. 修复 expected 断言

不能只用 `actual.finalState === AUTHENTICATED` 判定通过。

必须实现：

- actual.finalState 与 scenario.expected.finalState 比较。
- expected.semanticPath 存在时比较标准化后的 semanticPath。
- expected.errorCode 存在时比较 errorCode。
- 预期 `LOGIN_FAILED` 且实际也是符合预期的失败时，案例应通过。
- 预期失败不能被当作执行异常。
- 预期成功但实际失败：P0。
- 预期失败但实际成功：P0。
- legacy/current 认证状态不一致：P0 blocking。
- 错误类型不一致：P1 blocking。
- 错误提示文案不同但错误类型一致：默认 P1 non-blocking 或按项目配置处理，但报告必须记录。

增加独立的 assertion 函数和测试，不要把断言逻辑散落在 CLI 中。

3. 修复 `inferErrorType`

以下输入必须识别为 `INVALID_PASSWORD`：

- `Incorrect password`
- `Invalid password`
- `Wrong password`
- `密码错误`
- `密码不正确`

以下输入必须识别为 `INVALID_USERNAME`：

- `Invalid username`
- `Incorrect username`
- `User not found`
- `用户名错误`
- `用户不存在`

保留 ACCOUNT_LOCKED、ACCOUNT_DISABLED、TIMEOUT、NETWORK_ERROR、ELEMENT_NOT_FOUND 等分类。

必须修复现有失败测试：

packages/core/test/login-models.test.ts

4. 修复错误密码案例的凭据处理

禁止在 Scenario 中写入明文错误密码。

支持以下形式之一：

```yaml
data:
  usernameRef: FLOWTRACE_ADMIN_USERNAME
  passwordRef: FLOWTRACE_INVALID_PASSWORD
```

或：

```yaml
data:
  usernameRef: FLOWTRACE_ADMIN_USERNAME
  passwordRef: FLOWTRACE_ADMIN_INVALID_PASSWORD
```

执行器必须读取 usernameRef/passwordRef 对应环境变量，并把真实值只传给 Adapter，不能写入结果。

不要把 `password` 明文字段作为有效测试输入。

5. 修复流程 ID

真实 supply_chain 流程 ID 是：

```text
user-login
```

不能在 LoginTestExecutor 中硬编码：

```typescript
processId: 'login'
```

必须从执行请求或目标项目配置传入 processId。

Skill 可以把“登录流程”解析为目标项目中名称包含“登录”的流程，但不能硬编码供应链专属路径。第一阶段允许提供通用别名配置：

```yaml
processAliases:
  login: user-login
```

6. 修复登录 URL 配置

不能默认把 Base URL 拼接成 `/login`。

目标项目必须能够配置完整 URL：

```json
{
  "legacy": {
    "baseUrl": "http://localhost:8000/its/",
    "loginUrl": "http://localhost:8000/its/user/login"
  },
  "current": {
    "baseUrl": "http://localhost:8000/its/",
    "loginUrl": "http://localhost:8000/its/user/login"
  }
}
```

通用 Adapter 使用配置中的 loginUrl；只有 loginUrl 未配置时才使用安全的通用 fallback，并在日志中明确提示。

7. 实现验证码处理

真实 supply_chain 登录页面包含图片验证码：

- 图片来自 Base64 data URL。
- 输入框 placeholder 为“请输入验证码”。
- 登录前调用验证码校验接口。

优先实现 OCR 方案：

1. 读取验证码图片 Base64。
2. 写入临时文件或内存 Buffer。
3. 调用 OCR 识别。
4. 填写验证码输入框。
5. 点击登录。
6. 如果验证码错误，最多刷新并重试 3 次。
7. OCR 失败必须返回明确的验证码错误，而不是伪造成功。

Adapter 配置至少支持：

- captchaSelector
- captchaInputSelector
- captchaEnabled
- captchaStrategy: ocr | test-mode | disabled
- maxCaptchaRetries

关于 test-mode：

- 不要添加永久硬编码超级验证码。
- 如果实现测试专用验证码，必须由后端显式环境配置启用。
- 只能在本地/测试 profile 生效。
- 生产 profile 必须强制关闭。
- 启动时打印 test-mode 警告。
- 添加测试证明关闭 test-mode 后特殊验证码无效。

当前可以优先使用 OCR，不修改业务认证后端。

8. 修复 Playwright 证据采集

必须实现：

- 每个 Adapter 独立 BrowserContext。
- legacy/current 不共享 cookies、localStorage、sessionStorage 或 Page。
- 成功和失败都保存 result.json。
- 失败保存 screenshot。
- 失败保存 trace.zip。
- 捕获 console error 和 page error。
- 捕获关键网络失败。
- 证据路径写入目标项目 `.flowtrace/executions/<run-id>/`。
- 不要把所有证据写入 FlowTrace 仓库。
- 报告中的证据链接必须可打开。

必须确保 cleanup 在成功、失败和异常场景都会执行。

9. 实现真实报告

至少生成：

<target-project>/.flowtrace/reports/login-report-<run-id>.json
<target-project>/.flowtrace/reports/login-report-<run-id>.md

报告必须包含：

- projectId
- processId
- mode
- legacy/current URL（敏感参数脱敏）
- 执行时间
- 案例总数、通过数、失败数
- 每个案例的 expected/actual
- 每个案例的 legacy/current 结果
- 每一步的 actor、action、状态、错误和耗时
- 差异详情
- P0/P1/P2/P3 统计
- release gate
- 截图、trace、result JSON 链接
- legacy-shadow 警告

10. 在 supply_chain 中补齐目标项目资产

不要把这些文件写入 FlowTrace/projects/supply-chain 作为运行时来源。

在真实项目中创建或更新：

/Users/fengjue/project/szwl/supply_chain/.flowtrace/
├── flowtrace.yaml
├── login-test-config.json
├── scenarios/user-login/
│   ├── user-login-success-001.yaml
│   ├── user-login-invalid-username-001.yaml
│   └── user-login-invalid-password-001.yaml
├── adapters/legacy-login-browser-adapter.mjs
├── adapters/current-login-browser-adapter.mjs
├── executions/
└── reports/

真实环境默认：

- legacyBaseUrl: http://localhost:8000/its/
- currentBaseUrl: http://localhost:8000/its/
- legacy/current loginUrl: http://localhost:8000/its/user/login

账号只通过环境变量引用，不要在提示词、代码、案例、日志或报告中输出密码。

11. 更新 Skill

更新 `/Users/fengjue/project/szwl/FlowTrace/skill/flowtrace/SKILL.md`：

- 用户说“帮我测试登录流程”时，先读取当前项目的流程定义。
- 识别当前项目中的登录流程 ID；不要固定写死 `login`。
- 检查当前项目 `.flowtrace`、案例、Adapter、登录配置和凭据引用。
- 缺少配置时停止并报告，不使用 FlowTrace 仓库示例回退。
- 调用 `flowtrace test --project <current-project> --process <resolved-process> --mode dual-browser`。
- 测试完成后读取目标项目报告。
- 只根据真实报告总结结果。

三、必须新增或修复的测试

1. Unit tests

- inferErrorType 英文/中文错误识别。
- expected AUTHENTICATED 断言。
- expected LOGIN_FAILED 断言。
- expected errorCode 断言。
- semanticPath 断言。
- processId 传递。
- loginUrl 使用配置值。
- 明文密码拒绝。
- 凭据脱敏。

2. Integration tests

- `flowtrace test` 不再停留在提示语，而是调用 Executor。
- single-browser 实际调用 Adapter。
- dual-browser 实际调用 legacy/current 两个 Adapter。
- 两侧 BrowserContext 不共享。
- 失败时保存截图和 Trace。
- expected 登录失败案例可以通过。
- P0/P1 差异阻断并返回非零码。
- 报告写入目标项目。
- 无 `.flowtrace` 时不读取 FlowTrace 示例项目。

3. supply_chain 端到端测试

在服务可访问、凭据通过环境变量注入后，执行：

cd /Users/fengjue/project/szwl/supply_chain
flowtrace test --process user-login --mode dual-browser

如果真实环境不可用，必须提供明确失败报告，不得使用假结果替代；同时使用本地 mock login app 完成离线端到端测试。

四、完成标准

必须全部满足：

1. `openspec validate add-login-ai-dual-run --strict` 通过。
2. `pnpm test` 全部通过，不能有失败测试。
3. `pnpm typecheck` 通过。
4. `pnpm build` 通过。
5. `flowtrace test` 真正执行 Adapter，不再只打印提示。
6. single-browser 和 dual-browser 都可运行。
7. 登录成功、用户名错误、密码错误案例均可执行。
8. `user-login` 流程 ID 能正确出现在报告中。
9. OCR 验证码流程可运行，或安全 test-mode 已实现并通过启停测试。
10. 旧系统和新系统各自创建独立 BrowserContext。
11. 真实目标项目的配置、案例、Adapter、报告均位于 supply_chain/.flowtrace。
12. Agent 在 supply_chain 项目中输入“帮我测试登录流程”可以启动测试并读取报告。
13. 报告包含真实执行步骤和证据。
14. P0/P1 差异正确阻断。
15. 代码、日志、报告和截图中不存在明文密码、Cookie 或 Token。

五、执行结束时必须汇报

- 修改文件清单。
- FlowTrace 与 supply_chain 分别修改了什么。
- 每条测试命令和结果。
- 是否实际访问 localhost 登录环境。
- 是否使用 OCR 或测试专用验证码模式。
- 生成的报告绝对路径。
- 仍然存在的环境阻塞项。
- 明确说明当前是否已经达到“Agent 自然语言唤起真实登录双跑测试”。
```
