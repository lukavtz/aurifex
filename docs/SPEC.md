# Aurifex — Product Specification

Status: accepted for v0.1.0
Last verified: 2026-11-09

## 1. Problem

Building a Telegram bot is easy to start and hard to finish correctly. The common
failure modes are security and operations, not syntax:

- bot tokens committed or logged;
- webhooks without `secret_token`, HTTPS, or an allowed port;
- admin commands without server-side authorization;
- long work inside a webhook request, causing retries and duplicate side effects;
- no `update_id` deduplication, no `retry_after` handling;
- in-memory FSM state in production;
- Mini App `initData` trusted without HMAC validation;
- no deterministic tests, only manual chat checks.

Existing agent skills cover API knowledge. Existing MCP servers expose Telegram
account operations. Neither owns the full lifecycle: scaffold, implement, verify,
test, deploy, and migrate.

## 2. Goals

1. Make a production-grade bot project the default output, for TypeScript and Python.
2. Encode Telegram-specific security invariants in generated code and in verification.
3. Give the agent deterministic tools with stable schemas, not prose-only guidance.
4. Reuse one domain core across OMP, DeepSeek Harness, and MCP.
5. Keep live Telegram access optional and secret-gated.

## 3. Non-goals for v0.1.0

- A hosted bot runtime or control plane.
- A full Bot API client library.
- MTProto/userbot automation. A separate optional module may be added later; v0.1.0
  targets the official Bot API only.
- Copying third-party skill text. Reference repositories inform patterns; all
  shipped text and code are original or properly attributed.

## 4. Personas

- **Agent operator**: asks the model to create or harden a bot; expects working files.
- **Bot developer**: reviews generated code and runs the verification gate.
- **Security reviewer**: audits tokens, webhook handling, authorization, and data flow.
- **Platform maintainer**: updates Bot API and framework versions without rewriting adapters.

## 5. Supported targets

| Stack      | Framework | Version | Runtime                | Bot API tested |
| ---------- | --------- | ------- | ---------------------- | -------------- |
| TypeScript | grammY    | 1.46.0  | Node >= 24.9.0         | 10.3           |
| Python     | aiogram   | 3.31.0  | Python >= 3.11, < 3.15 | 10.3           |

Current Bot API: 10.4 (2026-11-09). Framework type declarations cover 10.3, so
generated projects ship a typed raw adapter for 10.4-only methods: `sendWidget`,
`sendSharedWidget`, `answerWidgetQuery`, `editMessageWidgetData`,
`editSharedWidgetData`, `sendRichMessage`, `sendRichMessageDraft`, ephemeral
callback replies, and rich messages/drafts. TON wallet cards, share themes, and
rich-message quotes remain reachable through the framework raw transport.
The target catalog exposes both `testedBotApi: "10.3"` and
`supportedBotApi: "10.4"`; verification fails a project that drops the adapter.

## 6. Functional requirements

### F1 — Target resolution

`telegram_bot_target_resolve` returns the exact stack target, framework version, runtime
constraint, Bot API version, framework-tested Bot API version, supported features,
and warnings. Unknown stack is a typed error.

### F2 — Safe scaffold

`telegram_bot_scaffold` creates a project under an authorized root. It:

- validates `BotSpec` strictly;
- refuses a non-empty destination unless `overwrite` is explicitly true;
- writes files with exclusive creation;
- never writes a real token;
- returns relative paths, byte sizes, and SHA-256 for every file.

Generated project includes:

- `.env.example` with empty token, database, and Redis password placeholders;
- webhook and polling modes;
- explicit `allowed_updates`;
- `update_id` deduplication interface;
- `retry_after` handling;
- admin allowlist;
- error handler;
- graceful shutdown;
- health endpoint;
- Redis/Postgres configuration;
- Dockerfile with a non-root user;
- docker-compose with app, Caddy, and optional Postgres/Redis; credentials come from `.env`;
- offline tests;
- README with exact run and deploy commands.

### F3 — Feature addition

`telegram_bot_add_feature` adds one feature module without rewriting unrelated files:

- `commands` — a new slash command with authorization guidance;
- `llm` — a provider-neutral chat handler boundary;
- `inline` — inline query handler with result validation;
- `payments` — Stars invoice, pre-checkout, successful-payment handling;
- `miniapps` — Mini App launch and server-side `initData` validation;
- `moderation` — allowlist and message-policy middleware;
- `broadcast` — rate-limited, resumable broadcast worker;
- `widgets` — Bot API 10.4 widget queries;
- `rich` — Bot API 10.4 rich messages and drafts.

Every generated feature compiles or parses in its target stack and includes a test
or a test stub with an asserted contract.

### F4 — Inspection

`telegram_bot_inspect` detects the stack, framework version, webhook or polling
mode, and the scanned file list. It returns findings with file evidence where
possible and never executes project code.

### F5 — Verification

`telegram_bot_verify` returns check results with `pass | warn | fail` and evidence. A single
`fail` makes `ok: false`. Mandatory checks:

- no Telegram-token-shaped literal in tracked text files;
- `.env` ignored;
- webhook secret validation present;
- HTTPS and allowed port in deploy configuration;
- constant-time secret comparison in custom webhook code;
- non-root container;
- explicit `allowed_updates`;
- `update_id` deduplication;
- `retry_after` handling;
- tests present.

### F6 — Deploy plan

`telegram_bot_deploy_plan` writes or returns:

- `Dockerfile`, `docker-compose.yml`, `.dockerignore`;
- webhook registration script;
- required environment variable list;
- exact `setWebhook` parameters;
- a preflight checklist.

It does not call Telegram. Calling `setWebhook` remains an explicit operator action.

### F7 — Test harness

`telegram_bot_test_harness` writes:

- offline update fixtures;
- a fake Bot API transport for grammY or aiogram;
- a secret-token rejection test;
- a tgfake compose file that is written unconditionally; running it is optional.

### F8 — Skills and subagents

Ship skills for Bot API 10.4 (including widgets and rich messages), grammY,
aiogram, security, testing, deployment, payments, and Mini Apps. Ship subagents for
architecture, security review, and test writing. Skills are guidance, not executable
authority.

### F9 — One-command installation

`aurifex install --host all` installs the same package into OMP, DeepSeek Harness,
and Claude Code. It detects installed hosts, prints the exact command per host, and
supports `--dry-run`, `--json`, `--scope`, and `--profile`. Claude Code uses
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `.mcp.json`;
OMP uses `package.json#omp.extensions`; DSH uses `cordis.patch.yml`.

## 7. Security requirements

- Token pattern: `\d{6,}:[A-Za-z0-9_-]{30,}`. Finding is `fail`, never `warn`.
- Webhook secret: 1–256 chars, `[A-Za-z0-9_-]+`, header
  `X-Telegram-Bot-Api-Secret-Token`.
- Webhook URL: HTTPS; port 443, 80, 88, or 8443; no redirects.
- Generated webhook code compares the secret in constant time.
- Generated code never logs the token or full request URL.
- Admin commands check an allowlist server-side.
- Mini App `initData` validated with HMAC-SHA256 using
  `HMAC_SHA256(bot_token, "WebAppData")`, sorted fields, and `auth_date` freshness.
- Stars flow: answer `pre_checkout_query` within 10 s; deliver only after
  `successful_payment`; store `telegram_payment_charge_id`.
- Broadcasts: per-chat serialization, `retry_after` backoff, idempotent resume.
- Paths: realpath containment, no symlink escape, no writes outside the authorized root.
- Compose: no fixed database/Redis passwords, no direct bot port publication,
  Caddy terminates TLS; secrets come from `.env`.
- Dependencies: exact versions for generated bots; a lockfile is recommended and
  reported as a warning by verification.

## 8. Acceptance criteria

v0.1.0 is accepted when:

1. `pnpm verify` passes on Linux, macOS, and Windows CI.
2. `telegram_bot_scaffold` produces a TypeScript project that passes `bun install`,
   `bun run typecheck`, and `bun test` in a clean temp directory.
3. `telegram_bot_scaffold` produces a Python project that passes `ruff check`,
   `mypy`, and `pytest` in a Python 3.14 container.
4. Generated webhook tests reject a missing or wrong secret token.
5. `telegram_bot_verify` fails on a planted token and on a missing secret check.
6. OMP loads the extension, lists the tools, and executes `telegram_bot_target_resolve`.
7. DSH installs the bundle in a fresh profile, `--dump-config` succeeds, and the
   typed tool executes.
8. MCP `initialize` + `tools/list` + `tools/call` succeed over stdio.
9. Live E2E is skipped without secrets and passes with a test bot when enabled.
10. No generated file contains a real token or a hardcoded webhook secret.
11. Generated projects expose the typed Bot API 10.4 adapter and a widget query
    handler; `verify` reports `botapi.104: pass`.
12. `aurifex install --dry-run --host all --json` reports OMP, DSH, and Claude Code
    commands without executing them.

## 9. Version policy

- Bot API version is data, not code. Updating it changes the target catalog and
  adds a migration note.
- Framework versions are exact in generated lockfiles.
- A framework that trails the Bot API ships a typed raw adapter and a migration
  note; the package never claims that framework types cover the newer API.
- Breaking tool schema changes bump `specVersion` and require a migration test.

## 10. Delivery policy

- One focused branch per slice.
- `pnpm verify` before every commit.
- PR description includes commands run and their output.
- Live E2E evidence is attached only when the secret-gated run actually executed.
