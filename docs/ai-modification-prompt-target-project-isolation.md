# AI 修改提示词：将 FlowTrace 改为目标项目驱动

以下提示词用于提交给负责修改代码的 AI。它是 `add-login-ai-dual-run` OpenSpec 的补充变更，必须和该 OpenSpec 一起执行。

```text
请在 /Users/fengjue/project/szwl/FlowTrace 中修改当前登录双跑 MVP 实现。

本次修改的核心目标：FlowTrace 是通用 Skill、CLI 和测试引擎；真实业务项目的配置和测试资产必须由当前目标项目提供。不得把 supply-chain 配置写死在 FlowTrace Skill、CLI 或 core 中。

一、先阅读并遵守

1. openspec/AGENTS.md
2. openspec/project.md
3. openspec/changes/add-login-ai-dual-run/proposal.md
4. openspec/changes/add-login-ai-dual-run/design.md
5. openspec/changes/add-login-ai-dual-run/tasks.md
6. openspec/changes/add-login-ai-dual-run/specs/login-dual-run/spec.md
7. docs/ai-implementation-prompt-login-dual-run.md

二、架构要求

1. FlowTrace 仓库中的 projects/supply-chain 只能作为 example、fixture 或 FlowTrace 自测项目，不得作为运行时默认项目。
2. 运行时必须从当前目标项目加载：

<target-project>/.flowtrace/
├── flowtrace.yaml
├── scenarios/
├── adapters/
├── fixtures/
├── executions/
└── reports/

3. CLI 必须支持：

flowtrace test --project <target-project> --process login --mode dual-browser

以及在目标项目目录中执行：

cd <target-project>
flowtrace test --process login --mode dual-browser

4. 如果当前目标项目没有合法的 `.flowtrace/flowtrace.yaml`，必须明确报告配置缺失，并提示：

flowtrace init --project <target-project>

不得静默使用 FlowTrace/projects/supply-chain 的案例、URL、Adapter 或报告目录。

三、必须清理的业务耦合

搜索并检查以下内容：

- projects/supply-chain
- supply-chain
- localhost:8000/its/
- 供应链
- yanyq
- zhangt
- pfyh
- 任何密码
- 具体页面 selector
- financing-approval

这些内容只能存在于示例、fixture、目标项目配置或目标项目 Adapter 中，不能存在于通用 Skill、core、runner、CLI 默认逻辑中。

四、Skill 修改要求

更新 skill/flowtrace/SKILL.md：

1. Skill 首先识别当前目标项目。
2. Skill 查找当前项目的 `.flowtrace/flowtrace.yaml`。
3. Skill 从当前项目读取 process、scenarios、adapters、credentials references 和报告路径。
4. 用户说“帮我测试登录流程”时，解析为当前项目的 `process: login`。
5. 配置缺失时只提示配置或初始化，不自行使用示例项目。
6. 测试完成后只读取当前项目生成的报告。
7. 返回报告绝对路径、通过率、差异和 release gate。

五、CLI 修改要求

1. `--project` 是目标项目路径，不是 FlowTrace 仓库路径。
2. 未提供 `--project` 时使用当前工作目录。
3. 所有路径基于目标项目解析。
4. 报告必须写入 `<target-project>/.flowtrace/reports/`。
5. 执行证据必须写入 `<target-project>/.flowtrace/executions/`。
6. 没有案例、Adapter、URL 或账号引用时，在启动浏览器前失败。
7. 错误信息必须指出缺少哪个目标项目配置。

六、目标项目初始化要求

`flowtrace init --project <target-project>` 应该只生成通用模板：

- `.flowtrace/flowtrace.yaml`
- `.flowtrace/scenarios/README.md`
- `.flowtrace/adapters/README.md`
- `.flowtrace/executions/.gitkeep`
- `.flowtrace/reports/.gitkeep`
- `.env.example`

不得在通用 init 中生成供应链账号、供应链 URL 或融资案例。

七、测试要求

增加并执行以下测试：

1. 在临时目标项目中创建 `.flowtrace/`，验证 CLI 能从该目录加载 login 案例。
2. 在另一个临时目标项目中创建不同的 login 案例，验证不会读取 FlowTrace/projects/supply-chain。
3. 删除目标项目配置，验证命令失败并提示 init，而不是回退示例项目。
4. 验证报告和 executions 写入目标项目，而不是 FlowTrace 仓库。
5. 扫描通用代码，确保没有硬编码 supply-chain 路径、URL、账号、密码、selector 或案例 ID。
6. 验证 Agent Skill 的自然语言流程使用当前项目上下文。
7. 保持原有 Vitest 测试全部通过。

八、完成标准

只有以下全部满足才算完成：

- OpenSpec 严格校验通过。
- `flowtrace test --project <target-project> --process login` 能运行。
- 在目标项目目录中直接运行也能工作。
- Skill 不引用 FlowTrace/projects/supply-chain 作为默认运行项目。
- 所有业务配置和测试资产来自目标项目。
- 缺失配置时不会静默 fallback。
- 报告和证据写入目标项目。
- 临时目标项目隔离测试通过。
- 现有测试、类型检查和构建全部通过。
- 最终输出修改文件、测试命令、测试结果和剩余阻塞项。
```
