# Aurifex — Product Specification

Status: accepted for v0.3.0
Last verified: 2026-11-15

## 1. Problem

A coding agent can write a Telegram bot. It usually writes the wrong one, for four
reasons:

- it starts coding before it knows what the user wants, and pads the result with
  features nobody asked for;
- it answers Bot API questions from stale model memory instead of the installed SDK and
  the current documentation;
- it omits the operational invariants — webhook authentication, `update_id`
  deduplication, `retry_after`, non-root containers — because they are not visible in
  the happy path;
- it declares success without checking anything.

Existing agent skills cover API fragments. Existing MCP servers operate Telegram
accounts. Neither supplies a complete procedure plus a deterministic gate.

## 2. Product

Aurifex is a knowledge plugin for OMP, DeepSeek Harness, and Claude Code. It ships:

1. **15 skills** that state how to interview, choose a stack, build each Telegram
   surface, and verify the result.
2. **3 MCP tools** with stable schemas: `telegram_bot_target_resolve`,
   `telegram_bot_inspect`, `telegram_bot_verify`.
3. **4 CLI commands**: `target`, `inspect`, `verify`, `install`.
4. **29 static checks** that turn security and operational invariants into a gate.
5. **2 hand-written reference projects** that pass their own suites and `verify`.

It ships no project generator, no templates, and no manifest workflow.

## 3. Goals

1. Make the agent ask before building, and build only what was confirmed.
2. Make current facts reachable: official pages, Context7, SDK releases, and the local
   installation outrank model memory.
3. Encode Telegram-specific invariants as deterministic checks over file content.
4. Project the same core through every host with no behaviour divergence.
5. Keep the package offline and dependency-free at runtime.

## 4. Non-goals

- Generating or rendering a project.
- A hosted bot runtime or control plane.
- A Bot API client library, MTProto, or userbot automation.
- Proving runtime behaviour. The gate is static; behaviour needs tests and real updates.
- Copying third-party skill text. Reference material informs patterns; shipped text is
  rewritten and attributed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## 5. Supported targets

| Stack      | Framework | Version | Runtime                | Framework types | Bot API |
| ---------- | --------- | ------- | ---------------------- | --------------- | ------- |
| TypeScript | grammY    | 1.46.0  | Node >= 24.9.0         | 10.3            | 10.4    |
| Python     | aiogram   | 3.31.0  | Python >= 3.11, < 3.15 | 10.3            | 10.4    |

Current Bot API: 10.4 (released 2026-11-09). Both frameworks type Bot API 10.3, so
10.4-only calls go through a typed raw adapter maintained by the project. The target
catalog reports `testedBotApi: "10.3"` and `supportedBotApi: "10.4"`, and check
`botapi.104` fails when the adapter is missing.

## 6. The interview contract

`BotSpec` is the document the agent proposes after questioning and the user confirms
before any code exists. It is not an input to a renderer; it is the agreement that
scopes the build.

### 6.1 Procedure

1. The agent reads `telegram-bot` and `telegram-bot-discovery`.
2. It asks 3–7 questions in one block. Each question offers options and a recommended
   value, and each maps to a `BotSpec` field.
3. It asks separately which surfaces are wanted: inline buttons, conversations, media,
   payments, Mini App.
4. It proposes the full document. Unanswered items are marked `assuming: …` in prose, not
   silently invented.
5. The user confirms or corrects. Only then does the agent write code.
6. `aurifex verify` runs on the result.

The rule is enforced by instruction content, not by the tools: the tools only resolve
targets, inspect, and verify.

### 6.2 Fields

| Field           | Type                  | Meaning                                                                  |
| --------------- | --------------------- | ------------------------------------------------------------------------ |
| `schemaVersion` | string                | exactly `bot-spec-1.1.0`                                                 |
| `name`          | string                | `^[a-z][a-z0-9_]{1,63}$`; project and bot handle base                    |
| `displayName`   | string                | 1–128 chars, shown to users                                              |
| `stack`         | `grammy` \| `aiogram` | language and framework                                                   |
| `features`      | string[]              | requested surfaces; nonempty, unique, must contain `commands`            |
| `deployment`    | `docker`              | container packaging                                                      |
| `storage`       | object                | `postgres`, `redis` booleans                                             |
| `i18n`          | object                | `defaultLocale` plus enabled locales `en`, `ru`, `zh`                    |
| `security`      | object                | `webhookSecret: true`, `adminAllowlist`, `rateLimit`, `idempotency`      |
| `runtime`       | object                | `queue: "postgres" \| "none"`, `telemetry` booleans                      |
| `miniapps`      | object, optional      | `sessionTtlSeconds` (300–2592000), `allowedOrigins`                      |
| `payments`      | object, optional      | product catalogue: `id`, `title`, `description`, `stars`, `subscription` |

Feature enum: `commands`, `llm`, `inline`, `payments`, `miniapps`, `moderation`,
`broadcast`, `widgets`, `rich`. A feature the user did not ask for must not appear.

Coupling rules are validated, not advisory:

| Condition                                             | Requirement                                    |
| ----------------------------------------------------- | ---------------------------------------------- |
| `features` contains `llm`, `broadcast`, or `payments` | Postgres storage and a Postgres queue          |
| no queued feature                                     | `runtime.queue === "none"`                     |
| `security.idempotency` or `security.rateLimit`        | Redis storage                                  |
| `miniapps` present                                    | Redis storage; feature `miniapps` enabled      |
| `payments` present                                    | feature `payments` enabled, unique product ids |

The complete field table, normalization rules, and schema/validator differences are in
[BOT_SPEC.md](BOT_SPEC.md). The validator in `src/core/spec/bot-spec.ts` is
authoritative; `schema/bot-spec-1.1.schema.json` mirrors it for editors.

### 6.3 Versioning

- `BOT_SPEC_VERSION` is `bot-spec-1.1.0`.
- Documents with `bot-spec-1.0.0` are normalized once, then validated by the same rules.
  Normalization supplies `runtime`, `i18n.zh`, and Mini App defaults. The reported and
  persisted version is always `bot-spec-1.1.0`.
- A 1.1 document missing `runtime` is invalid.
- A breaking change to the interview fields bumps the minor schema version and requires
  a migration note in [MIGRATION.md](MIGRATION.md).
- Tool input schemas are versioned separately by the MCP protocol revision
  (`2025-11-25`) and `DomainResult` (`domain-result-1.0.0`).

## 7. Functional requirements

### F1 — Target resolution

`telegram_bot_target_resolve` returns the exact stack target: framework version, runtime
constraint, Bot API version, framework-tested Bot API version, supported features, and
warnings. An unknown stack is a typed `invalid_request` error.

### F2 — Inspection

`telegram_bot_inspect` detects stack, framework version, webhook or polling mode, Bot API
gap, and findings with file evidence. It never executes project code and never fails
because a file is missing; it reports `unknown` with findings.

### F3 — Verification

`telegram_bot_verify` returns 29 checks with `pass | warn | fail` and evidence. It reads a
bounded snapshot: 64 MiB total, 1 MiB per file. A single `fail` makes `ok: false`.
Warnings stay visible. The check ids, grouped by invariant:

- secrets and config: `token.literal`, `scan.bounded`, `env.ignored`, `secrets.file`,
  `logs.redaction`, `allowlist.present`;
- webhook: `webhook.secret`, `webhook.https`, `webhook.port`, `webhook.constant_time`;
- updates: `updates.allowed`, `updates.dedupe`, `dedupe.fail_closed`,
  `retry.retry_after`;
- containers: `container.non_root`, `docker.healthcheck`;
- Bot API 10.4: `botapi.104`, `botapi.104.types`;
- dependencies: `deps.lockfile`;
- queue: `queue.worker`, `queue.schema`;
- payments: `payments.schema`, `payments.validation`;
- telemetry: `telemetry.readiness`, `telemetry.metrics`;
- Mini App: `miniapp.session`, `miniapp.csp`;
- tests: `tests.present`, `tests.infrastructure`.

### F4 — Knowledge

Ship 15 skills with procedures, gotchas, and at least three absolute sources each. Heavy
material lives in `references/*.md`. The corpus is validated offline by
`scripts/check-skills.mjs`.

### F5 — Installation

`aurifex install --host all` installs the package into OMP, DSH, and Claude Code. It
detects installed hosts, prints the exact command per host, and supports `--dry-run`,
`--json`, `--scope`, `--profile`, and `--source`. Claude Code uses
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `.mcp.json`; OMP
uses `package.json#omp.extensions`; DSH uses `cordis.patch.yml`. The installer prompts
for host and scope, runs to completion, and exits without waiting for a keypress.

### F6 — Reference projects

`examples/grammy_commands` and `examples/aiogram_commands` are hand-written, carry no
manifest, pass their own test suites, and verify with zero `fail`. They are the
executable proof that the knowledge produces working code and the fixtures for
integration tests.

## 8. Security requirements

- Token pattern: `\d{6,}:[A-Za-z0-9_-]{30,}`. A hit is `fail`, never `warn`.
- Webhook secret: 1–256 chars, `[A-Za-z0-9_-]+`, header
  `X-Telegram-Bot-Api-Secret-Token`, compared in constant time.
- Webhook URL: HTTPS; port 443, 80, 88, or 8443.
- Update handling: explicit `allowed_updates`, `update_id` deduplication that fails
  closed, `retry_after` handling.
- Admin authority: numeric allowlist checked server-side, never a username.
- Mini App `initData`: HMAC-SHA256 over key-sorted pairs, own `auth_date` freshness.
- Stars payments: answer `pre_checkout_query` within 10 s, fail closed, deliver once per
  `telegram_payment_charge_id`.
- Paths: realpath containment, no symlink escape, bounded reads.
- Output: never echo a token, webhook secret, or authorization header.

Details live in `skills/telegram-security` and [THREAT_MODEL.md](THREAT_MODEL.md).

## 9. Acceptance criteria

v0.3.0 is accepted when:

1. `pnpm verify` passes on Linux, macOS, and Windows CI.
2. `node scripts/check-skills.mjs` reports `ok · 15 skills`.
3. Both reference projects install, typecheck, pass their tests, and verify with
   `summary.fail == 0`.
4. `verify` fails on a planted token, a missing worker with a queue, a missing
   `answerCallbackQuery`, and unsorted `initData`, with the exact check ids.
5. MCP `initialize` returns `2025-11-25` regardless of the requested version, and
   `tools/list` returns exactly three tools.
6. OMP loads the extension, lists three tools, and executes `telegram_bot_target_resolve`.
7. DSH installs in a fresh profile, `--dump-config` succeeds, and a typed tool executes.
8. `aurifex install --dry-run --host all --json` reports OMP, DSH, and Claude Code
   commands without executing them.
9. No skill or document names a removed generator tool.
10. Both READMEs agree on 3 tools, 4 commands, 15 skills, 29 checks, and version 0.3.0.

## 10. Version policy

- Bot API version is data: updating it changes `catalog.ts`, the 10.4 contract module,
  and the skills.
- Framework versions are exact in the reference projects' lockfiles.
- A framework that trails the Bot API uses a typed raw adapter; the package never claims
  that framework types cover the newer API.
- Breaking tool schema changes require a protocol revision note and a migration test.
- `0.3.0` is a breaking release of the tool surface: three tools and four commands.

## 11. Delivery policy

- One branch per slice; `pnpm verify` before every commit.
- The PR body includes commands run and their actual output.
- Behavioural evidence is attached only when it was produced by the current candidate.
