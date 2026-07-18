# 登录流程 AI 双跑开发执行提示词

以下内容可以完整复制给负责实现的 AI 编程 Agent。Agent 必须先阅读并遵守 OpenSpec，再开始修改代码。

```text
你现在负责在 FlowTrace 仓库中完整实现 OpenSpec 变更：

openspec/changes/add-login-ai-dual-run/

工作目录：/Users/fengjue/project/szwl/FlowTrace

目标：实现登录流程 MVP，让用户在目标项目中通过 FlowTrace Skill 使用自然语言发起测试；Agent 自动找到 process=login 的测试案例，调用 flowtrace test，分别在旧系统和新系统中执行同一案例，比较真实登录结果，保存证据并生成报告。

一、必须先做的事情

1. 完整阅读：
   - openspec/AGENTS.md
   - openspec/project.md
   - openspec/changes/add-login-ai-dual-run/proposal.md
   - openspec/changes/add-login-ai-dual-run/design.md
   - openspec/changes/add-login-ai-dual-run/tasks.md
   - openspec/changes/add-login-ai-dual-run/specs/login-dual-run/spec.md
2. 阅读现有实现：
   - packages/core/src/models/scenario.ts
   - packages/core/src/models/execution.ts
   - packages/adapter/src/interfaces.ts
   - packages/adapter/src/config-adapter-loader.ts
   - packages/cli/src/commands/index.ts
   - packages/cli/src/commands/verify.ts
   - skill/flowtrace/SKILL.md
3. 检查当前工作树，保留用户已有修改，不执行 destructive git 操作。
4. 不要重新实现已有能力；优先抽取、复用和扩展现有 Scenario、Adapter、Runner、Reporter 结构。

二、严格范围

本次只实现 login 流程，不实现融资申请提交、审批、数据库快照或 MCP 服务。

必须支持：

- LOGIN 业务动作
- 登录成功
- 用户名错误
- 密码错误
- 单系统模式
- 旧系统/新系统 dual-browser 双跑模式
- Playwright 浏览器操作
- 独立 Browser Context
- 登录状态断言
- 登录后页面状态断言
- 登录错误码/错误提示比较
- 截图、Trace、页面 URL、步骤结果、错误日志
- JSON 和 Markdown 报告
- P0/P1 release gate 和非零退出码
- FlowTrace Skill 通过 flowtrace test 调度

不允许：

- 让 AI 自由猜测页面元素并把猜测当成稳定测试脚本
- 用 scenario.expected 伪造实际执行结果
- 将 legacy-shadow 结果表述为真实新旧等价
- 将密码、Cookie、Token 写入代码、案例、日志或报告
- 对生产数据库或生产系统执行写操作
- 删除现有测试来让构建通过

三、实现要求

1. Core 模型

- 在 BusinessActionType 中增加 LOGIN。
- 增加 LoginInput、LoginObservation、EvidenceRef、StepExecutionResult 等类型。
- 扩展 Scenario 校验：LOGIN 至少需要 actor；凭据只能使用 usernameRef/passwordRef/secretRef 等引用；拒绝明文 password、token、cookie 等敏感字段进入版本化案例。
- 保持现有 Scenario 兼容，不破坏现有 SUBMIT/APPROVE 等案例。
- 为 finalState、semanticPath、errorCode、errorMessage、landing page 等登录结果增加确定性断言。

2. Browser Adapter

在适当的 packages/adapter 或 packages/runner 模块中新增通用 BrowserTestAdapter 接口：

interface BrowserTestAdapter {
  readonly name: string;
  readonly type: 'legacy' | 'current';
  initialize(): Promise<void>;
  reset(): Promise<void>;
  login(actor: string, input: LoginInput): Promise<LoginObservation>;
  cleanup(): Promise<void>;
}

- 使用 Playwright。
- 旧系统和新系统必须使用独立 BrowserContext。
- 不共享 cookies、localStorage、sessionStorage、Page 或登录状态。
- 页面 URL、选择器、登录按钮和成功/失败页面细节必须由目标项目 Adapter 提供，不能硬编码到 FlowTrace 通用核心。
- 捕获页面截图、trace、当前 URL、控制台错误和网络失败。
- 默认失败时保留截图和 trace；支持配置 always/on-failure/never。
- 对日志、请求、响应和报告执行敏感信息脱敏。

3. Runner

新增 flowtrace test CLI 命令，至少支持：

flowtrace test --project <path> --process login --mode single-browser
flowtrace test --project <path> --process login --mode dual-browser
flowtrace test --project <path> --scenario <scenario-id>

要求：

- 解析目标项目 .flowtrace/flowtrace.yaml。
- 从 .flowtrace/scenarios 加载并筛选 enabled=true、process=login 的案例。
- 执行前完整校验案例；没有有效案例时不得启动浏览器。
- 单系统模式执行配置的 adapter。
- 双跑模式按顺序执行 legacy 和 current。
- 每个案例开始前创建全新的 browser context。
- 每个案例失败后默认继续后续案例，并在配置 stopOnFailure=true 时停止。
- 记录 run、case、step、adapter、start/end time、status、error、evidence。
- 发生 P0/P1 gate 差异时进程返回非零退出码。
- 无测试账号、Base URL 或 Adapter 配置时，给出明确错误并在浏览器启动前停止。

4. 结果比较

实现两层判断：

A. 实际结果 vs scenario.expected：
- expected AUTHENTICATED，实际 LOGIN_FAILED：P0。
- expected LOGIN_FAILED，实际 AUTHENTICATED：P0。
- expected LOGIN_FAILED，实际 LOGIN_FAILED：只要错误类型符合预期则通过。

B. legacy vs current：
- 认证状态不一致：P0 blocking。
- 业务错误码或错误提示不一致：P1 blocking，除非配置为允许差异。
- 登录后业务页面/工作台语义不一致：默认 P2。
- 动态 URL 参数、request ID、时间戳等技术字段必须归一化或忽略。
- legacy-shadow 必须在报告和 release gate 中标记为 harness-only，不能产生真实 equivalence approval。

5. 证据和报告

产物目录：

.flowtrace/executions/<run-id>/
├── run.json
├── cases/<scenario-id>/legacy/result.json
├── cases/<scenario-id>/legacy/screenshot.png
├── cases/<scenario-id>/legacy/trace.zip
├── cases/<scenario-id>/current/result.json
├── cases/<scenario-id>/current/screenshot.png
└── cases/<scenario-id>/current/trace.zip

生成：

.flowtrace/reports/report-<run-id>.json
.flowtrace/reports/report-<run-id>.md

报告必须包含：

- 项目、流程、执行模式、运行时间
- 执行案例总数、通过数、失败数
- 每个案例的旧系统结果、新系统结果和比较结果
- 每个步骤的 actor、action、状态、错误和耗时
- expected 与 actual
- P0/P1/P2/P3 差异
- release gate 状态
- 截图、trace 和 result.json 的相对链接
- legacy-shadow 限制说明
- 数据来源和环境说明

6. 目标项目测试 Fixture

增加一个本地可自动化验证的 mock login app 或等价的本地测试适配器，不能依赖真实账号才能运行仓库测试。

至少准备：

- login-success-001
- login-invalid-username-001
- login-invalid-password-001

真实项目配置通过环境变量提供：

- LEGACY_BASE_URL
- CURRENT_BASE_URL
- SUPPLIER_USERNAME
- SUPPLIER_PASSWORD

测试输出中不得出现真实密码。

7. Skill 调度

更新 skill/flowtrace/SKILL.md：

- 用户说“测试登录流程”时识别为 process=login。
- 检查 flowtrace.yaml、案例、Adapter、Base URL 和账号引用。
- 先执行案例校验，再调用 flowtrace test。
- 等待命令完成后读取 JSON/Markdown 报告。
- 只能根据报告返回通过、失败、差异和报告路径。
- 不得自行判断或修改 release gate。
- 缺少凭据或配置时应明确报告阻塞原因，不得猜测。

四、必须编写的测试

1. Unit tests

- LOGIN action schema 校验。
- plaintext password/token/cookie 拒绝。
- process/id/tag/enabled scenario resolver。
- AUTHENTICATED 和 LOGIN_FAILED 断言。
- legacy/current 状态差异比较。
- 错误码和错误提示差异比较。
- 动态字段归一化。
- 敏感信息脱敏。
- report/release gate 生成。

2. Adapter tests

- 成功登录。
- 用户名错误。
- 密码错误。
- 页面超时。
- 登录元素缺失。
- 登录后页面验证失败。
- context 被正确隔离和关闭。

3. Integration tests

- flowtrace test 能加载 login 案例。
- 无效案例时不启动浏览器。
- single-browser 能执行完整案例集。
- dual-browser 能分别执行 legacy/current。
- 旧系统和新系统不共享 cookie/storage。
- 失败时保存 screenshot、trace、result.json。
- P0/P1 差异返回非零退出码。
- 密码不会出现在任何产物中。

4. End-to-end test

使用本地 mock login app 执行：

flowtrace test --project <fixture-project> --process login --mode dual-browser

验证：

- 至少 3 个案例均被执行。
- 双跑共执行 6 次登录。
- 结果和报告文件存在。
- 构造一个新旧错误提示差异时报告出现 P1 blocking。
- 构造一个认证状态差异时报告出现 P0 blocking。

5. Agent acceptance test

验证对话：

用户：帮我测试登录流程

Agent 必须：

- 找到当前项目。
- 找到 process=login 案例。
- 启动正确的 flowtrace test 命令。
- 等待执行完成。
- 返回真实报告路径和 gate 状态。
- 不把 legacy-shadow 称为真实等价。

五、完成标准

只有以下全部满足时才算完成：

- openspec validate add-login-ai-dual-run --strict 通过。
- 所有相关 TypeScript 包 build/typecheck 通过。
- pnpm test 全部通过，并且新增测试实际被执行。
- 本地 mock login 双跑端到端测试通过。
- CLI 可以执行单系统和双系统 login 测试。
- Agent 对话可以启动测试并读取报告。
- 成功、用户名错误、密码错误案例均可执行。
- 新旧认证状态和错误差异可被确定性发现。
- 截图、trace、步骤结果和 Markdown 报告全部生成。
- P0/P1 gate 和非零退出码正确工作。
- 密码、Cookie、Token 不出现在源码、日志和报告中。
- 不修改或删除与本变更无关的现有功能和测试。

六、执行方式

- 按 tasks.md 顺序实施。
- 每完成一组任务就运行对应测试。
- 不要停留在接口或 mock 返回值；必须实现可运行的本地 mock 端到端闭环。
- 如果真实旧/新系统地址或账号缺失，先完成本地 mock 测试，并把真实环境接入标记为待配置，而不是伪造成功。
- 最后输出：修改文件清单、实现摘要、测试命令和结果、未完成项、报告路径。
```
