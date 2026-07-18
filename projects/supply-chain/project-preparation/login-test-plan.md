# 登录流程测试准备

## 当前环境

旧系统和新系统暂时使用同一套本地登录环境，但配置入口保持独立：

```text
Legacy Base URL: http://localhost:8000/its/
Current Base URL: http://localhost:8000/its/
```

当前第一阶段只使用管理员角色执行登录测试。企业和机构账号已经预留为后续角色测试配置，不在本轮自动执行范围内。

## 账号映射

| 业务角色 | 环境变量 | 当前用途 |
|---|---|---|
| 管理员 | `FLOWTRACE_ADMIN_USERNAME` / `FLOWTRACE_ADMIN_PASSWORD` | 第一阶段执行 |
| 企业 | `FLOWTRACE_ENTERPRISE_USERNAME` / `FLOWTRACE_ENTERPRISE_PASSWORD` | 后续角色测试 |
| 机构 | `FLOWTRACE_INSTITUTION_USERNAME` / `FLOWTRACE_INSTITUTION_PASSWORD` | 后续角色测试 |

密码不写入本文件、测试案例、代码、日志或报告。

## 已准备案例

| 案例 | 目的 | 当前状态 |
|---|---|---|
| `login-success-001` | 管理员正常登录 | 已准备 |
| `login-invalid-username-001` | 用户名错误 | 已准备 |
| `login-invalid-password-001` | 密码错误 | 已准备 |

## 开发前需要确认的页面信息

实际 Browser Adapter 仍需要确认以下元素：

| 元素 | 旧系统定位 | 新系统定位 | 是否已确认 |
|---|---|---|---|
| 用户名输入框 | 待确认 | 待确认 | 否 |
| 密码输入框 | 待确认 | 待确认 | 否 |
| 登录按钮 | 待确认 | 待确认 | 否 |
| 登录成功标识 | 待确认 | 待确认 | 否 |
| 登录失败提示 | 待确认 | 待确认 | 否 |
| 登录后首页 URL/标识 | 待确认 | 待确认 | 否 |

建议优先使用 `id`、`name`、`aria-label` 或 `data-testid`，避免使用动态 class 和坐标点击。

## 执行前检查

```text
[ ] http://localhost:8000/its/ 可以访问
[ ] 管理员账号可以手工登录
[ ] 错误用户名可以触发失败
[ ] 错误密码可以触发失败
[ ] 登录成功页面有稳定元素
[ ] 登录失败页面有稳定提示
[ ] 本地环境变量已配置
[ ] 当前不是生产环境
```

## 注意事项

由于旧系统和新系统当前使用相同地址，双跑结果只能验证 FlowTrace 的双上下文、案例、断言和报告链路；在没有独立新系统地址时，不能证明新旧系统实现不同情况下的真实等价性。
