# feat: Aurifex v0.1

Aurifex is an MIT-licensed capability package that lets a coding agent (OMP, DeepSeek
Harness, Claude Code, MCP) create, harden, test, and deploy production Telegram bots.
TypeScript/grammY and Python/aiogram are first-class. Bot API 10.4 is supported through a
typed raw adapter generated into every project.

## Implemented

### Core domain

- `DomainResult<T>`, `FileRef`, `Check`, canonical serialization, SHA-256 helpers.
- Versioned `BotSpec` with strict validation, reserved feature names, deterministic hash.
- Pinned targets: grammY `1.46.0` / Node `>=24.9.0`; aiogram `3.31.0` /
  Python `>=3.11,<3.15`; framework types `10.3`, supported Bot API `10.4`.
- `CoreOperations` facade shared by every adapter and the CLI.

### Security

- `PathPolicy`: root containment, symlink rejection, `wx` writes, atomic replacement,
  1 MiB read cap, ignored build directories.
- Token detection (including URL-embedded tokens), redaction, webhook-secret validation.
- Scaffold/add-feature crash-safe overwrite with staging and rollback.
- Generated bots: mandatory webhook secret, HTTPS/port checks, numeric admin allowlist,
  Redis update dedupe, rate limiting, `retry_after`, Mini App `initData` HMAC, non-root
  containers, Caddy TLS front end, no published bot port, no fixed DB passwords.

### Generation and verification

- grammY, aiogram, and React/Vite Mini App renderers.
- Nine features: commands, LLM, inline, Stars payments, Mini Apps, moderation, broadcasts,
  Bot API 10.4 widgets, rich messages/drafts.
- `scaffoldBot`, `addFeature`, `inspectBot`, `verifyBot`, `planDeploy`,
  `generateTestHarness`, `upgradePlan`.
- Public check IDs include `token.literal`, `env.ignored`, `webhook.secret`,
  `webhook.https`, `webhook.port`, `webhook.constant_time`, `container.non_root`,
  `updates.allowed`, `updates.dedupe`, `retry.retry_after`, `botapi.104`, `tests.present`,
  `deps.lockfile`, `logs.redaction`, `allowlist.present`, `scan.bounded`.

### Host projections

- CLI with `target/new/inspect/verify/add/deploy/harness/upgrade-plan/install`, JSON output,
  exit codes `0/1/2`, and one-command `install --host all` for OMP, DSH, and Claude Code.
- OMP extension: eight `telegram_bot_*` tools, three commands.
- DSH plugin: eight `defineTool` tools, prompt section, `cordis.patch.yml`; validated in a
  fresh `dsh@0.2.2-rc.1` profile with `--dump-config`.
- MCP v2 stdio server: same eight tools, structured content, 256 KiB cap.
- Claude Code: plugin + marketplace manifests, `.mcp.json` using
  `${CLAUDE_PLUGIN_ROOT}/dist/adapters/mcp/server.js`; installed and enabled in an isolated
  `HOME`.

### Content and delivery

- Nine skills, three agents, three commands, one rule file, one review prompt; adapted from
  Apache-2.0/MIT upstreams with attribution in `THIRD_PARTY_NOTICES.md`.
- Deterministic CI, live E2E workflow, secret scanner, package dry-run.

## Verification

Local results:

| Command                       | Result                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm verify`                 | pass — format, lint, typecheck, 108 unit, 10 security, 59 integration, 9 host, secret scan, pack |
| `AURIFEX_E2E=1 pnpm test:e2e` | 2 pass, 1 skipped (live)                                                                         |
| Generated grammY project      | `bun install`, `bun run typecheck`, `bun test` (27 pass), `bun run build`                        |
| Generated aiogram project     | `uv lock`, `uv sync --frozen`, `ruff`, `mypy`, `pytest` (28 pass)                                |
| Generated Mini App            | `bun run build` — Vite output at `dist/miniapp`                                                  |
| MCP built server              | `initialize` + `tools/list` — 8 tools                                                            |
| OMP                           | `omp plugin link .` + `omp plugin doctor` — plugin ok                                            |
| DSH                           | fresh profile install + `--dump-config` — `aurifex` row present                                  |
| Claude Code                   | isolated `HOME`: marketplace add + plugin install — enabled, MCP server listed                   |
| `pnpm audit --prod`           | no known vulnerabilities                                                                         |

CI status: pending the first push. The `verify` job runs on Ubuntu, macOS, and Windows; the
`e2e` job runs generated projects with Bun 1.4.2, uv 0.12.23, and Python 3.14.

## Limitations

- Framework type declarations cover Bot API 10.3; 10.4-only calls use the generated typed
  raw adapter. Native framework bindings are not claimed.
- Generated projects are standalone; they do not depend on `aurifex` or a shared runtime.
- Live Telegram tests are secret-gated and were not executed without a test bot token/chat.
- Docker image builds were not executed locally because the Docker daemon was unavailable;
  the generated files pass file-level/static checks and the E2E project builds.
- Interactive OMP tool execution is covered by the host contract test; `omp plugin doctor`
  validates loading.
