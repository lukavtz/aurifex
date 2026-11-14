# feat: Aurifex v0.2.0

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
- Public verification returns 29 static check IDs, including `token.literal`,
  `botapi.104.types`, queue and payment schema checks, Mini App checks, and
  `allowlist.present`.

### Host projections

- CLI exposes 10 commands: `target/new/inspect/verify/add/deploy/harness/upgrade-plan/upgrade/install`.
- OMP extension: nine `telegram_bot_*` tools and three commands.
- DSH plugin: nine `defineTool` tools, prompt section, `cordis.patch.yml`.
- Zero-dependency MCP stdio server: same nine tools, structured content, 256 KiB cap.
  It ships with no runtime `node_modules` requirement, so a Claude marketplace cache
  copy works as installed.
- Claude Code: plugin + marketplace manifests, `.mcp.json` using
  `${CLAUDE_PLUGIN_ROOT}/dist/adapters/mcp/server.js`.

### Content and delivery

- Ten skills, three agents, three commands, one rule file, one review prompt; adapted
  from Apache-2.0/MIT upstreams with attribution in `THIRD_PARTY_NOTICES.md`.
- Deterministic CI, live E2E workflow, secret scanner, package dry-run.

## Verification

Local results:

| Command                       | Result                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm verify`                 | pass — format, lint, typecheck, unit, security, integration, host, secret scan, pack      |
| `AURIFEX_E2E=1 pnpm test:e2e` | 2 pass, 1 skipped (live)                                                                  |
| Generated grammY project      | `bun install`, `bun run typecheck`, `bun test` (27 pass), `bun run build`                 |
| Generated aiogram project     | `uv lock`, `uv sync --frozen`, `ruff`, `mypy`, `pytest` (28 pass)                         |
| Generated Mini App            | `bun run build` — Vite output at `dist/miniapp`                                           |
| MCP built server              | `initialize` + `tools/list` — nine tools, runs from a bare `dist/` without `node_modules` |
| OMP                           | `omp plugin link .` + `omp plugin doctor` — plugin ok                                     |
| DSH                           | fresh profile install + `--dump-config` — `aurifex` row present                           |
| Claude Code                   | isolated `HOME`: marketplace add + plugin install — enabled, MCP server listed            |
| `pnpm audit --prod`           | no known vulnerabilities                                                                  |

Verification and host runs must be recorded from the current release candidate; do not
reuse results from earlier releases or claim success without their artifacts.

## Limitations

- Framework type declarations cover Bot API 10.3; 10.4-only calls use the generated typed
  raw adapter. Native framework bindings are not claimed.
- Generated projects are standalone; they do not depend on `aurifex` or a shared runtime.
- Live Telegram tests are secret-gated; they require a test bot token and chat.
- Docker image builds require a Docker daemon; generated-file checks do not replace them.
- Interactive host smoke tests require the pinned host binaries and isolated profiles.
