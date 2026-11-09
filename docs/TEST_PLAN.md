# Aurifex Test Plan

This document is the authoritative test matrix for Aurifex v0.1. It defines what is
checked, with which command, on which runtime, and what counts as a failure.

## Principles

- Every check is deterministic tooling: `node --test`, `oxlint`, `tsc`, `prettier`,
  `ruff`, `mypy`, `pytest`, or the secret scanner. No subjective review gates.
- Aurifex never executes generated project code during unit, security, integration, or
  host suites. Generated projects are only executed in the gated E2E suites.
- Every operation path goes through `PathPolicy`. Any path that escapes the
  authorized root is a failure, not a warning. Scaffold staging uses `wx` plus
  `realpath` checks in the same root as a deliberate atomic-commit exception.
- Telegram tokens are findings. A tracked non-fixture file or generated file that
  contains a token-shaped literal fails the build; `tests/fixtures/` is excluded from
  the scanner, so planted-token tests build strings at runtime.

## Environments

| Tool   | Version                         | Used by                                     |
| ------ | ------------------------------- | ------------------------------------------- |
| Node   | >= 24.9.0 (CI: 24)              | all suites; `--experimental-strip-types`    |
| pnpm   | 12.18                           | install, scripts, `verify`                  |
| Bun    | 1.4.2                           | generated grammY project install/build/test |
| uv     | 0.12.23                         | generated aiogram project lock/sync/run     |
| Python | 3.14 (supported `>=3.11,<3.15`) | generated aiogram project                   |
| Docker | current stable                  | optional tgfake compose harness             |

Unit, security, integration, and host suites require no network. Generated-project E2E
runs package managers and therefore needs network; the live suite also needs network.

## Matrix

| Suite           | Command                             | Scope                                                                           | Network | Skip behavior                                                                |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| Unit            | `pnpm test:unit`                    | `tests/unit/**/*.test.ts`                                                       | no      | never skipped                                                                |
| Security        | `pnpm test:security`                | `tests/security/**/*.test.ts`                                                   | no      | never skipped                                                                |
| Integration     | `pnpm test:integration`             | `tests/integration/**/*.test.ts`                                                | no      | never skipped                                                                |
| Host            | `pnpm test:host`                    | `tests/host/**/*.test.ts`                                                       | no      | never skipped                                                                |
| E2E (generated) | `AURIFEX_E2E=1 pnpm test:e2e`       | `tests/e2e/**/*.test.ts`                                                        | yes     | skipped unless `AURIFEX_E2E=1`                                               |
| E2E (live)      | `AURIFEX_LIVE=1 pnpm test:e2e:live` | `tests/e2e/live-telegram.test.ts`                                               | yes     | skipped unless `AURIFEX_LIVE=1`; fails if secrets are absent while it is set |
| Site            | `pnpm check:site`                   | trilingual key parity, local assets, no external scripts                        | no      | never skipped                                                                |
| Full gate       | `pnpm verify`                       | format, lint, typecheck, unit, security, integration, host, site, secrets, pack | no      | never skipped                                                                |

`pnpm verify` order is fixed:
`format:check → lint → typecheck → test:unit → test:security → test:integration → test:host → check:secrets → pack:check`.

## Deterministic checks

| Check            | Command                             | Failure condition                                                                                 |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Formatting       | `pnpm format:check`                 | any file differs from Prettier output                                                             |
| Lint             | `pnpm lint`                         | any `oxlint` diagnostic                                                                           |
| Types            | `pnpm typecheck`                    | any TypeScript error (strict, NodeNext, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) |
| Secret literals  | `node scripts/check-no-secrets.mjs` | token-shaped literal in any tracked text file                                                     |
| Package contents | `pnpm pack:check`                   | declared `files` missing from the tarball                                                         |
| Environment      | workflow steps                      | missing Node 24, Bun 1.4.2, or uv 0.12.23                                                         |

## Suite detail

### Unit (`tests/unit`)

- `bot-spec.test.ts` — `validateBotSpec`, feature-name rules, duplicate rejection,
  webhook-secret rule, locale rule, control-character rejection, `botSpecHash` stability.
- `catalog.test.ts` — exact grammY/aiogram pins, Node/Python ranges, tested Bot API `10.3`,
  `resolveStack` warnings.
- `path-policy.test.ts` — `..`, absolute escapes, NUL bytes, backslashes, symlink escape,
  `wx` semantics, overwrite, 1 MiB cap, ignored directories.
- `secrets.test.ts` — token detection, redaction shape, placeholder ignore,
  `WEBHOOK_SECRET_RE` validation.
- `templates-grammy.test.ts` — deterministic grammY set, Bot API 10.4 raw adapter,
  10.4 widget/rich handlers, middleware wiring, 1 MiB cap, non-root Dockerfile.
- `templates-aiogram.test.ts` — deterministic aiogram set, `TelegramMethod` raw
  methods, miniapp route, retry helper, pytest `pythonpath`, non-root Dockerfile.
- `templates-miniapp.test.ts` — React/Vite files, relative base, WebApp init, no
  external scripts, no token literal.
- `cli.test.ts` — exit codes `0/1/2`, JSON shape, usage errors, project-relative
  scaffold paths.
- `install.test.ts` — one-command installer: dry-run, all hosts, source resolution,
  missing host, redaction (POSIX fake-host shims).
- `install-scripts.test.ts` — `install.sh`/`install.ps1` flow, persistent root, Node
  version floor, idempotent re-run; PowerShell execution is Windows-only.
- `install-windows.test.ts` — Windows-only `.cmd` host shim execution through `cmd.exe`.
- `content.test.ts` — skill/agent/command frontmatter, name/directory agreement, body size
  under 8 KB, Bot API 10.4 skill coverage.
- `scripts/check-site.mjs` — EN/RU/ZH key parity, every local asset, no external scripts.

### Security (`tests/security`)

- `token-plant.test.ts` — planting a token-shaped literal in a scaffolded project makes
  `verify` fail `token.literal` without echoing the token.
- `path-traversal.test.ts` — `..`, absolute escapes, symlink files/directories, NUL,
  backslashes, and percent-encoded dot segments; scaffold and add-feature escapes.
- `webhook-constants.test.ts` — framework secret-token options pass
  `webhook.constant_time`; custom `==`/`===` header compares fail; output never echoes
  the secret.

### Integration (`tests/integration`)

- `scaffold.test.ts` — file set, hashes, `.env.example` emptiness, destination refusal,
  overwrite semantics, rollback after a mid-write failure, spec errors, path escape.
- `verify.test.ts` — clean grammY and aiogram scaffolds pass; planted token, missing
  webhook secret, missing `.gitignore`, removed 10.4 adapter, and symlink root fail.
- `add-feature.test.ts` — all nine features for both stacks, duplicate refusal, invalid
  names, single `miniapp` add, nested project roots.
- `deploy.test.ts` — domain validation, deployment files, set-webhook scripts, harness
  fixtures/fake transport, upgrade plan; no Telegram call is made.

### Host (`tests/host`)

- `omp-adapter.test.ts` — 9 tools, approval tiers, strict schemas, no filesystem I/O at
  registration, `details.status` for target resolve and scaffold.
- `dsh-adapter.test.ts` — no default export, `name`/`inject`/`Config`/`apply`, 8 registered
  tools, disposal removes them.
- `mcp-server.test.ts` — stdio `initialize`, `tools/list` (9 tools), `tools/call`, no
  stdout noise.

### E2E (`tests/e2e`, gated)

- `generated-grammy.test.ts` — scaffold, `bun install`, `bun run typecheck`, `bun test`,
  `bun run build`, config parse with a dummy environment.
- `generated-aiogram.test.ts` — scaffold, `uv lock`, `uv sync --frozen`,
  `uv run ruff check .`, `uv run mypy app`, `uv run pytest -q`.
- `live-telegram.test.ts` — `getMe`, `getWebhookInfo`, one `sendMessage` to the test chat.

Unless `AURIFEX_E2E=1` is set, generated-project suites emit an explicit skip message and
exit successfully. CI sets it for the `e2e` job.

### Pages

`.github/workflows/pages.yml` runs `node scripts/check-site.mjs`, uploads `site/`, and
deploys with the official Pages actions. The live URL is
<https://lukavtz.github.io/aurifex/>.

### Live suite

Environment variables:

| Variable                  | Definition                                               |
| ------------------------- | -------------------------------------------------------- |
| `AURIFEX_LIVE`            | Set to `1` to enable live Telegram calls.                |
| `TELEGRAM_TEST_BOT_TOKEN` | Token of a dedicated test bot. Never a production token. |
| `TELEGRAM_TEST_CHAT_ID`   | Chat id owned by the test operator.                      |

- The live suite skips with an explicit message when `AURIFEX_LIVE` is unset.
- When `AURIFEX_LIVE=1` but either secret is missing, the suite fails loudly.
- The live workflow `.github/workflows/live-e2e.yml` runs on `workflow_dispatch` only and
  fails before the tests if secrets are absent.
- The suite never calls `setWebhook`, never prints the token, and never writes it to disk.

## Security invariants asserted by the suites

1. No operation resolves a path outside its authorized root, including through symlinks.
2. Generated files never contain a real or token-shaped secret; `.env.example` is empty.
3. Webhook mode requires `secretToken`/`secret_token`, HTTPS, an allowed port, and a
   constant-time comparison.
4. Update deduplication (`update_id`) and `allowed_updates` are present in generated bots.
5. Logging redacts `BOT_TOKEN`, `WEBHOOK_SECRET`, `LLM_API_KEY`, and authorization headers.
6. Containers run as a non-root user.
7. Generated compose files use `.env` credentials, do not publish the bot port,
   and put Caddy in front of the bot.
8. `verify` reports tokens as failures even in API URLs or oversized files, and its
   output never includes the full token.

## Bot API 10.4 support

grammY 1.46.0 and aiogram 3.31.0 type declarations cover Bot API `10.3`. Aurifex
supports `10.4` first-class through a typed raw adapter generated into every
project (`src/telegram/api104.ts`, `app/services/api104.py`). The adapter covers
`sendWidget`, `sendSharedWidget`, `answerWidgetQuery`, `editMessageWidgetData`,
`editSharedWidgetData`, `sendRichMessage`, `sendRichMessageDraft`, ephemeral
ephemeral callback replies, and rich messages/drafts. Other 10.4 data surfaces
remain reachable through the raw transport.

Generated tests assert the raw method names and payload bounds. `verify` check
`botapi.104` fails when the adapter is removed. The package never claims that
framework types themselves cover 10.4.

Raw-method use is also subject to the platform limits the catalog reports: `update_id` is
unique per bot, updates are retained for 24 hours, and a webhook and a polling loop must
not consume the same bot concurrently.

## Infrastructure, fuzz, Docker, and load

| Command                             | Gate                   | Coverage                                                                                                                                   |
| ----------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AURIFEX_INFRA=1 pnpm test:infra`   | Postgres 18 + Redis 8  | queue idempotency/claim exclusivity/dead-letter/recovery, payment uniqueness/refund/reconcile, broadcast resume, readiness, backup/restore |
| `pnpm test:fuzz`                    | 10,000 fast-check runs | `BotSpec` totality, unknown-key rejection, path escape, generated Hypothesis initData parser                                               |
| `AURIFEX_DOCKER=1 pnpm test:docker` | Docker daemon          | generated images: non-root user and `/healthz` 200                                                                                         |
| `AURIFEX_LOAD=1 pnpm test:load`     | generated webhook      | p95 < 250 ms, error rate < 0.1%, no 5xx                                                                                                    |

The default `pnpm verify` gate does not require Docker. CI runs infrastructure, Docker,
fuzz, and load jobs on Ubuntu; the infrastructure job receives service containers, the
Docker job uses buildx.
