---
name: flowtrace
description: FlowTrace workflow orchestration for legacy process baseline collection, AI-assisted test generation, and dual-run verification
---

# FlowTrace Skill

A Cursor/Codex skill for orchestrating FlowTrace workflows using natural language commands.

## Core Principle

**All business assets belong to the target project, not FlowTrace.**

FlowTrace is a generic runtime SDK (`@flowtrace/adapter`) plus a
config-driven DSL plus recording/import evidence plus optional external
plugins. Business behavior lives in the target project's
`.flowtrace/` directory as `systems/`, `processes/` and `scenarios/`
declarative YAML — NOT as JavaScript or TypeScript source files under
`.flowtrace/adapters/`.

```
<target-project>/
├── .flowtrace/
│   ├── flowtrace.yaml           # Project configuration (runtime adapter + systems mapping)
│   ├── systems/                 # Per-system config (baseUrl, channel, auth, selectors, redact)
│   ├── processes/               # Process DSL (states/transitions + action step sequences)
│   ├── scenarios/               # Hand-written or imported scenarios
│   ├── recordings/              # Raw recordings / HAR / Playwright traces
│   ├── facts/                   # Masked fixtures
│   ├── executions/
│   │   └── <run-id>/            # One self-contained task bundle
│   │       ├── evidence/        # Redacted JSON frames + PNG screenshots
│   │       ├── scenarios/       # Per-scenario dual-run observations
│   │       ├── reports/         # Final JSON / Markdown / HTML reports
│   │       └── run.json         # Run manifest and artifact index
│   └── reports/                 # Latest-run index / compatibility mirrors
└── .env                         # Credentials (not committed)
```

FlowTrace CLI, skill and core code never hard-code project paths,
URLs, credentials, scenario IDs or business state names.

## Purpose

This skill enables AI agents (Cursor, Codex) to orchestrate FlowTrace workflows:

- "测试登录流程" - Run login test scenarios
- "采集流程基线" - Collect process baseline facts
- "生成测试案例" - Generate test scenarios
- "执行双跑验证" - Run dual-run verification

## Identifying the Target Project

The skill must first identify the target project:

1. Check if user specified `--project <path>` or mentioned a project path
2. If working in a directory, check for `.flowtrace/flowtrace.yaml`
3. If no configuration found, report the missing configuration
4. **Never fallback to FlowTrace's internal `projects/` directory**

### Configuration Detection

```bash
# Required: .flowtrace/flowtrace.yaml must exist
<target-project>/.flowtrace/flowtrace.yaml
```

If missing:
```
FlowTrace configuration not found.
Initialize with: flowtrace init --project <target-project>
```

## Login Test Workflow

When user says "测试登录流程" or similar:

> Routing rule: first read `.flowtrace/flowtrace.yaml`. If
> `runtime.adapter: builtin`, first inspect `package.json`: when it declares
> `test:flowtrace`, MUST run `npm run test:flowtrace` from the target project;
> otherwise use `flowtrace verify --project <path>`. Never run the legacy
> `flowtrace test --mode dual-browser` CAPTCHA/login gate for builtin projects.
> The legacy login workflow below applies only to projects using the legacy
> adapter mode.

```
1. Identify target project
   → Check .flowtrace/flowtrace.yaml exists
   → Report error if missing, do NOT fallback to examples

2. Check login configuration
   → Verify .flowtrace/scenarios/ contains login scenarios
   → Check .flowtrace/login-test-config.json or environment variables
   → Verify adapter configuration exists

3. Execute login test
   → flowtrace test --project <target-project> --process login --mode dual-browser
   → Or if already in project directory: flowtrace test --process login

4. Read test results
   → Read <target-project>/.flowtrace/reports/login-report-<run-id>.json
   → Read <target-project>/.flowtrace/reports/login-report-<run-id>.md

5. Return results
   → Report absolute path to generated report
   → Report pass/fail and difference summary
   → Report Release Gate status (PASSED/BLOCKED)
   → Do NOT interpret or override gate decision
```

## Command Gates

Every command checks its prerequisites before executing. This prevents partial or invalid states from propagating through the workflow.

### Gate Requirements by Command

| Command | Required Prerequisites |
|---------|----------------------|
| `collect` | `init`, `config` |
| `generate-cases` | `init`, `config`, `process`, `recording-confirmed` |
| `validate-cases` | `init`, `config`, `cases` |
| `test` | Legacy adapter projects only; builtin projects route to `verify` |
| `report` | `init`, `config` |

### Checking Gate Status

Before executing any command, you can check if prerequisites are met:

```bash
# Check current status with human-readable output
flowtrace status --project <path> --human

# Check status with process filter
flowtrace status --project <path> --process <process-id> --human
```

### Gate Check Behavior

When a gate check fails:

1. **Structured JSON output** (default): The command prints a JSON error with:
   - `ok: false` - Indicates gate failure
   - `code` - Error code (e.g., `NOT_INITIALIZED`, `RECORDING_NOT_CONFIRMED`)
   - `missing` - Array of missing prerequisites
   - `remediation` - Suggested commands to fix the issue
   - Exit code: `2`

2. **Human-readable output** (`--human` flag): The command prints a friendly error message with missing items and remediation suggestions

### Example: Checking Before Running Pipeline

```
# Check status first
$ flowtrace status --project /path/to/project --human

=== FlowTrace Status ===
Project  : My Project (my-project)
Root     : /path/to/project
Status   : RECORDING_PENDING

Config   : /path/to/project/.flowtrace/flowtrace.yaml
Recording: NOT_RECORDED
Scenarios: 0 total
Captcha  : not configured

# Run collect (should pass: init + config only)
$ flowtrace collect --project /path/to/project

# Now record and confirm
$ flowtrace record --project /path/to/project
$ flowtrace record-confirm --project /path/to/project

# Check again
$ flowtrace status --project /path/to/project --human

# Run generate-cases (should pass: all prerequisites met)
$ flowtrace generate-cases --project /path/to/project
```

## Project-Agnostic Commands

Before invoking builtin verification, inspect the target project's `package.json`.
If it declares `test:flowtrace`, MUST run exactly `npm run test:flowtrace` from
that project. Do not replace it with `flowtrace test` or a direct `flowtrace
verify`; the wrapper may supply required environment setup and must delegate
execution and rendering to FlowTrace. Only when the script is absent, run
`flowtrace verify --project <target-project>`.

For builtin runtime, verification already emits canonical JSON, Markdown and
HTML. NEVER invoke `flowtrace report` afterward. The CLI also refuses to
regenerate builtin reports, so the fixed report cannot be overwritten.

The CLI enforces the same routing rule: a direct builtin `flowtrace verify` or
`flowtrace test` invocation delegates to the target project's declared
`npm run test:flowtrace` entrypoint. Do not bypass or disable this delegation.

All commands use `--project <path>` to specify the target:

```bash
# Initialize a new target project
flowtrace init --project <target-project>

# Run login tests on target project
flowtrace test --project <target-project> --process login --mode dual-browser

# Or run from within the project directory
cd <target-project>
flowtrace test --process login
```

### Command Reference

| User Intent | CLI Command |
|-------------|-------------|
| "测试登录流程" | `flowtrace test --project <path> --process login` |
| "测试 builtin 流程" | `npm run test:flowtrace` when declared; otherwise `flowtrace verify --project <path>` |
| "运行登录测试" | `flowtrace test --project <path> --process login --mode dual-browser` |
| "单系统测试" | `flowtrace test --project <path> --process login --mode single-browser` |
| "测试特定场景" | `flowtrace test --project <path> --scenario <id>` |
| "初始化项目" | `flowtrace init --project <path>` |

## Workflow Steps

### Complete MVP Pipeline (config-driven runtime)

```
1. Check the target project
   → Verify .flowtrace/flowtrace.yaml exists
   → Verify flowtrace.yaml has a runtime block with adapter: builtin
   → Verify systems/<id>.yaml files exist for both legacy and current
   → Verify processes/<id>.yaml defines the target process

2. Initialize (if needed)
   → flowtrace init --project <path>
   → Creates systems/, processes/, recordings/, facts/, scenarios/, evidence/, executions/, reports/
   → Does NOT create .flowtrace/adapters/ — the builtin runtime uses no project-local adapter source

3. Author declarative assets
   → Edit systems/legacy.yaml and systems/current.yaml with baseUrl, channel, selectors
   → Edit processes/<id>.yaml with FSM metadata + action step sequences
   → Edit scenarios/<id>.yaml with hand-written scenarios (treated as already CONFIRMED)

4. Verify (config-driven dual-run)
   → If package.json declares test:flowtrace: cd <path> && npm run test:flowtrace
   → Otherwise: flowtrace verify --project <path>
   → Output: <path>/.flowtrace/executions/<run-id>/reports/report.{json,md,html}
   → Output: <path>/.flowtrace/executions/<run-id>/evidence/<side>/<scenarioId>/<NN>-<action>.{json,png}
   → The complete result of one task is always contained in this single run directory.

5. Return results
   → Output absolute path to the generated report
   → Output pass/fail and difference summary
   → Output Release Gate status (PASS / BLOCKED)
   → Do NOT interpret or override gate decision
```

## Execution Rules

### 必须遵守

1. **配置优先** - 任何操作前先验证目标项目配置存在
2. **业务隔离** - 所有业务资产位于目标项目，不在 FlowTrace 仓库
3. **显式配置** - 禁止静默回退到示例或 fixtures
4. **错误报告** - 配置缺失时明确报告，提示初始化命令

### 禁止事项

1. **禁止使用示例项目运行** - 不得将任何示例项目（如 projects/ 下的示例）作为运行时目标
2. **禁止硬编码业务配置** - 不得在 Skill、CLI、core 中硬编码 URL、账号、selector
3. **禁止静默回退** - 配置缺失时必须报错，不使用默认或示例
4. **禁止修改 Release Gate** - Agent 只能报告 gate 状态

## Difference Severity

| Severity | Meaning | Release Gate |
|----------|---------|--------------|
| P0 | 核心业务差异 | BLOCKED |
| P1 | 业务路径差异 | BLOCKED |
| P2 | 非核心差异 | Review needed |
| P3 | 技术差异 | Can configure pass |

### Login Test Differences

| Scenario | Severity | Blocking |
|----------|----------|----------|
| 认证状态不一致 | P0 | Yes |
| 错误码不一致 | P1 | Yes |
| 错误提示文本不一致 | P1 | Configurable |
| 登录后页面路径不一致 | P2 | No |

## Output Artifacts Structure

All outputs go to `<target-project>/.flowtrace/`:

```
<target-project>/.flowtrace/
├── flowtrace.yaml           # Project configuration
├── scenarios/               # Test scenarios (project-specific)
├── adapters/               # System adapters (project-specific)
├── executions/
│   └── <run-id>/         # Test run artifacts
├── reports/
│   ├── report-<id>.json  # Verification reports
│   └── login-report-<id>.json  # Login test reports
└── facts/                  # Baseline facts
```

## Environment Variables

Target projects typically configure credentials via environment:

```
# Example .env (not committed to git)
LEGACY_BASE_URL=https://legacy.example.com
CURRENT_BASE_URL=https://current.example.com
TEST_USERNAME=automation@example.com
TEST_PASSWORD=<secret>
```

Never commit credentials to version control.

## Key Principles

1. **Configuration lives with the project** — Each target project owns its `systems/`, `processes/` and `scenarios/` declarative YAML.
2. **AI does orchestration** — Skill coordinates workflow steps.
3. **Programs do execution** — CLI handles actual execution via the builtin runtime.
4. **Deterministic gates** — P0/P1 failures block release.
5. **Evidence-based** — All facts must have source evidence.
6. **Business isolation** — No business logic in FlowTrace core, CLI or skill. Only `@flowtrace/adapter` generic primitives (HTTP/browser runtime + DSL schema/validator/interpreter + redaction + evidence writer).
7. **No silent fallback** — Missing config or missing adapter fails with an actionable error; NEVER silently falls back to demo, repository example or `.flowtrace/adapters/` lookup.
8. **Review status required** — Imported scenarios with `AUTO_EXTRACTED` / `REVIEW_REQUIRED` are refused by `flowtrace verify`; hand-written scenarios are treated as already `CONFIRMED`.

## Fixed Report Contract

Treat report generation as deterministic FlowTrace runtime behavior, never as agent-authored content.

- Always generate HTML through `@flowtrace/reporter`'s `renderFixedDualRunHtml` canonical renderer.
- Keep templates and rendering code in FlowTrace. Never create them under a target project.
- Accept only project configuration, scenario definitions, observations and evidence as renderer input.
- Preserve five summary cards, project and comparison tables, scenario cards, Legacy/Current columns, screenshot grids, action tables and evidence links.
- Preserve the canonical visual tokens: `#fafafa` background, 1500px main width, white bordered cards, 6px radius, green/red gate states and responsive two-column layout.
- Embed every PNG screenshot into canonical HTML as a `data:image/png;base64,...` source; never rely on local absolute paths, lazy loading or browser file permissions to display screenshots.
- Require at least one readable PNG screenshot for every scenario on both Legacy and Current sides. Missing or unreadable screenshots are a P1 `missingScreenshotEvidence` difference and MUST block the Release Gate.
- Treat missing screenshots as test-infrastructure/evidence failure. Never recommend weakening `execution.failOn`, removing P1, or otherwise bypassing the evidence gate.
- When the Release Gate is BLOCKED for missing evidence, do not declare the workflow verified or claim business equivalence as a completed conclusion; report the semantic comparison separately from the incomplete verification status.
- Require dual-side JSON evidence, screenshots, scenario indexes, `report.{json,md,html}` and `run.json` before a bundle may be reported complete.
- Never let an LLM, agent, CLI entry point or project-local script freely compose report HTML.

## Files

- `agents/openai.yaml` - OpenAI agent configuration
- `SKILL.md` - This file
