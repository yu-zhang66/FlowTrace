# FlowTrace 安装与迁移

## 环境要求

- Node.js 20 LTS 或更高版本
- pnpm 9 或更高版本
- 目标系统的测试环境、账号和可访问地址
- 使用浏览器流程时安装 Playwright 浏览器：`pnpm exec playwright install chromium`

## 从 GitHub 安装

```bash
git clone https://github.com/yu-zhang66/FlowTrace.git
cd FlowTrace
corepack enable
pnpm install
pnpm build
```

验证安装：

```bash
pnpm flowtrace --help
pnpm typecheck
pnpm test
```

`dist/`、`node_modules/`、执行结果和报告缓存都由 Git 忽略，可以在目标机器重新生成。

## 安装到另一台设备

在新设备上重复 clone、`pnpm install` 和 `pnpm build`。Skill 是独立于目标项目的能力包；如果使用 Codex，需要将仓库中的 `skill/flowtrace/` 安装到该设备的 `$CODEX_HOME/skills/flowtrace/`，或按团队的 Skill 分发机制安装。

目标项目只需要自己的 `.flowtrace/` 配置和业务资产，不需要复制 `packages/`，也不需要复制 `.flowtrace/adapters/`。跨设备迁移时应单独迁移：

1. `.flowtrace/flowtrace.yaml`、`systems/`、`processes/` 和 `scenarios/`。
2. `.env` 或 CI Secret（通过安全方式重新配置，不从 Git 复制真实密码）。
3. 必要的脱敏基线和人工确认的流程资产。
4. 测试环境的数据库快照、Mock 或外部插件依赖（如果该项目明确使用）。

执行机器必须能够访问目标系统；内网地址不可达时，FlowTrace 本身无法替代网络连通性、VPN、代理或跳板机配置。

