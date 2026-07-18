# 目标项目接入指南

## 1. 初始化

```bash
pnpm flowtrace init --project /absolute/path/to/project --process login
```

初始化不会创建项目适配器源码。默认运行时是 `builtin`，能力由 FlowTrace 提供，目标项目只提供声明式配置。

## 2. 填写系统配置

修改 `.flowtrace/flowtrace.yaml` 和 `systems/legacy.yaml`、`systems/current.yaml`：

- `baseUrl`：测试环境地址
- `channel`：`http` 或 `browser`
- `login`：登录路径、字段和提交动作
- `pages`、`selectors`、`endpoints`：页面与接口的业务配置
- `redact`：额外敏感字段和请求头

不要把账号密码直接写入这些文件。配置只引用环境变量名。

## 3. 编写流程和案例

在 `.flowtrace/processes/` 中声明流程状态、转移和动作步骤，在 `.flowtrace/scenarios/` 中编写案例。支持的 DSL 步骤包括：

`goto`、`fill`、`click`、`select`、`upload`、`wait`、`request`、`observe`、`extract`、`assert`、`screenshot`、`conditional` 和 `repeat`。

导入的案例必须经过人工确认；直接手写并提交到项目目录的案例视为已确认。先执行：

```bash
pnpm flowtrace validate-processes --project /absolute/path/to/project
pnpm flowtrace validate-cases --project /absolute/path/to/project
```

## 4. 运行和查看

```bash
pnpm flowtrace collect --project /absolute/path/to/project
pnpm flowtrace generate-cases --project /absolute/path/to/project
pnpm flowtrace verify --project /absolute/path/to/project
pnpm flowtrace report --project /absolute/path/to/project --format html
```

单次运行的 JSON、截图、网络证据、场景观察和三种报告都位于：

```text
.flowtrace/executions/<run-id>/
```

HTML 报告使用固定模板，Legacy / Current 并列展示，Evidence 列内嵌缩略图，避免依赖外部链接。

## 5. 外部插件边界

只有内置运行时无法表达的能力才配置 `runtime.adapter: external`，例如特殊 SSO、验证码、WebSocket 或原生客户端。插件必须显式声明、可审计，并由目标项目自行提供；FlowTrace 不会静默加载项目代码，也不会回退到仓库示例。

