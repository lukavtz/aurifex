# Aurifex Test Plan

This document is the authoritative test matrix for Aurifex `0.3.1`. It defines what is
checked, with which command, and what counts as a failure.

## Principles

- Every check is deterministic tooling: `node --test`, `oxlint`, `tsc`, `prettier`,
  `bun test`, `pytest`, `uv`, or the repository check scripts. No subjective review gates.
- The verifier under test never executes project code. Integration tests feed it fixed
  trees and compare check ids.
- Every filesystem read goes through `PathPolicy`. A path that escapes the authorized
  root is a failure, not a warning.
- Telegram tokens are findings. A tracked file containing a token-shaped literal fails
  the build; fixtures build such strings at runtime instead of storing them.
- Knowledge is code: `tools/check-skills.mjs` validates the 15 skills offline.

## Environments

| Tool   | Version                                                                    | Used by                                  |
| ------ | -------------------------------------------------------------------------- | ---------------------------------------- |
| Node   | >= 24.9.0 (CI: 24)                                                         | all suites; `--experimental-strip-types` |
| pnpm   | 12.18.0                                                                    | install, scripts, `verify`               |
| Bun    | 1.4.4 (`oven-sh/setup-bun@v2`)                                             | `examples/grammy_commands`               |
| uv     | `astral-sh/setup-uv@v6` (shim; the action installs its current uv, no pin) | `examples/aiogram_commands`              |
| Python | 3.14 (supported `>=3.11,<3.15`)                                            | `examples/aiogram_commands`              |
| Docker | current stable                                                             | optional, not in the default gate        |

Unit, security, integration, host, skill, site, and secret suites require no network.
The reference-project suites install dependencies and therefore need network; CI runs
them in the `examples` job, not in `pnpm verify`.

## Full command list

This list is what a maintainer runs locally; CI splits it into jobs.

```sh
pnpm install --frozen-lockfile
npx tsc --noEmit
node tools/check-skills.mjs
node tools/check-site.mjs
node --test --experimental-strip-types "tests/unit/**/*.test.ts"
node --test --experimental-strip-types "tests/security/**/*.test.ts"
node --test --experimental-strip-types "tests/integration/**/*.test.ts"
node --test --experimental-strip-types "tests/host/**/*.test.ts"
pnpm verify
```

The reference projects are gated by the CI job `examples` (matrix over
`grammy_commands` and `aiogram_commands`), which runs the same suites and then the
`aurifex verify` gate:

```sh
(cd examples/grammy_commands && bun install --frozen-lockfile && bun run typecheck && bun test)
(cd examples/aiogram_commands && uv sync --frozen && uv run pytest -q)

node dist/cli.js verify examples/grammy_commands --json
node dist/cli.js verify examples/aiogram_commands --json
```

The job fails on a non-zero `summary.fail`, not only on a non-zero exit code.

```sh
node dist/cli.js --help
node dist/adapters/mcp/server.js   # stdio: initialize -> tools/list = 3
```

Expected observations:

- `check-skills: ok · 15 skills`
- `check-site: ok · 3 locales …`
- unit, security, integration, and host suites finish without failures
- both reference projects install from their frozen lockfiles, typecheck, and pass
  their own tests in the `examples` matrix
- both `verify --json` runs produce `"ok": true` and `summary.fail == 0`
- `tools/list` returns exactly `telegram_bot_target_resolve`,
  `telegram_bot_inspect`, `telegram_bot_verify`
- `initialize` with a client version of `1999-01-01` answers `2025-11-25`

## Matrix

| Suite             | Command                                                                                                   | Scope                                 | Network | Skip behavior                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------- | ----------------------------------------------------- |
| Unit              | `pnpm test:unit`                                                                                          | `tests/unit/**/*.test.ts`             | no      | never skipped                                         |
| Security          | `pnpm test:security`                                                                                      | `tests/security/**/*.test.ts`         | no      | never skipped                                         |
| Fuzz              | `pnpm test:fuzz`                                                                                          | `tests/security/fuzz.test.ts`         | no      | never skipped                                         |
| Integration       | `pnpm test:integration`                                                                                   | `tests/integration/**/*.test.ts`      | no      | never skipped                                         |
| Host              | `pnpm test:host`                                                                                          | `tests/host/**/*.test.ts`             | no      | never skipped                                         |
| Skills            | `pnpm check:skills`                                                                                       | every `skills/*/SKILL.md`             | no      | never skipped                                         |
| Site              | `pnpm check:site`                                                                                         | trilingual key parity, assets, counts | no      | never skipped                                         |
| Secrets           | `pnpm check:secrets`                                                                                      | tracked text files                    | no      | never skipped                                         |
| Package           | `pnpm pack:check`                                                                                         | declared `files` in the tarball       | no      | never skipped                                         |
| Reference grammY  | `bun install --frozen-lockfile && bun run typecheck && bun test`, then `node dist/cli.js verify … --json` | `examples/grammy_commands`            | yes     | CI job `examples`, matrix entry, fails on `fail != 0` |
| Reference aiogram | `uv sync --frozen && uv run pytest -q`, then `node dist/cli.js verify … --json`                           | `examples/aiogram_commands`           | yes     | CI job `examples`, matrix entry, fails on `fail != 0` |

`pnpm verify` order is fixed:
`format:check → lint → typecheck → test:unit → test:security → test:fuzz →
test:integration → test:host → check:skills → check:site → check:secrets → pack:check`.

## Deterministic checks

| Check            | Command                           | Failure condition                                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting       | `pnpm format:check`               | any file differs from Prettier output                                                                                                                                                                                                                                                           |
| Lint             | `pnpm lint`                       | any `oxlint` diagnostic                                                                                                                                                                                                                                                                         |
| Types            | `pnpm typecheck`                  | any TypeScript error (strict, NodeNext, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)                                                                                                                                                                                               |
| Skill structure  | `node tools/check-skills.mjs`     | missing or mismatched frontmatter, description over 1024 chars or not starting with `Use when`, body over 500 lines, missing `## Procedure`/`## Gotchas`/`## Sources`, fewer than three absolute `https://` sources, broken relative link, token-like literal, or a removed generator tool name |
| Site truth       | `node tools/check-site.mjs`       | locale key mismatch, external script, wrong count (checks 29, tools 3, commands 4), unknown tool or command, skill chip without a `SKILL.md`                                                                                                                                                    |
| Secret literals  | `node tools/check-no-secrets.mjs` | token-shaped literal in a tracked text file                                                                                                                                                                                                                                                     |
| Package contents | `pnpm pack:check`                 | declared `files` missing from the tarball                                                                                                                                                                                                                                                       |

## Suite detail

### Unit (`tests/unit`)

- `bot-spec.test.ts` — `validateBotSpec`, feature-name rules, duplicate rejection,
  webhook-secret rule, locale rule, control-character rejection, `botSpecHash` stability.
- `catalog.test.ts` — exact grammY/aiogram pins, Node/Python ranges, tested Bot API `10.3`,
  supported `10.4`, `resolveTarget` warnings.
- `api104-contract.test.ts` — `API104_METHODS`, `API104_PARAMS`, and the 10.4 type surface;
  exact params for `getUniqueGift`, `getChatShareThemeBackdrops`, and
  `deleteBusinessAccountGift`.
- `layout.test.ts` — the path set in
  `skills/telegram-bot-recipes/references/project-layout.md` equals `layoutPaths()`, and no
  layout path literal exists in TypeScript outside `src/core/layout.ts`.
- `path-policy.test.ts` — `..`, absolute escapes, NUL bytes, backslashes, symlink escape,
  1 MiB read cap, ignored directories.
- `secrets.test.ts` — token detection, redaction shape, placeholder ignore,
  `WEBHOOK_SECRET_RE` validation.
- `cli.test.ts` — exit codes `0/1/2`, JSON shape, usage errors, project path resolution.
- `install.test.ts` — installer: dry-run, all hosts, source resolution, missing host,
  redaction (POSIX fake-host shims).
- `install-scripts.test.ts` — `install.sh`/`install.ps1` flow, persistent root, Node
  version floor, idempotent re-run, automatic exit; PowerShell execution is Windows-only.
- `install-windows.test.ts` — Windows-only `.cmd` host shim execution through `cmd.exe`.
- `check-skills.test.ts` — the script passes on the repository and fails on a temporary
  directory with each violation.
- `skill-scripts.test.ts` — `tg_text.py` escaping, length, and split behavior;
  `telegram_payload.py` accepts a valid `sendMessage` and rejects `callback_data` over 64
  bytes; `tg_docs.py changelog` works offline against a prefilled cache.
- `reference-projects.test.ts` — key files exist and `.aurifex/` is absent in both
  reference projects.
- `schema.test.ts` — the JSON Schema and validator agree on accepted and rejected shapes.
- `spec-v11.test.ts` — 1.0 normalization and 1.1 coupling rules.
- `content.test.ts` — skill, agent, and command frontmatter and cross-references.
- `check-bot-api.test.ts`, `workflows.test.ts` — repository checks, workflow
  expectations, and the Bot API watcher.

### Security (`tests/security`)

- `token-plant.test.ts` — planting a token-shaped literal in a copy of a reference project
  makes `verify` fail `token.literal` without echoing the token.
- `path-traversal.test.ts` — `..`, absolute escapes, symlink files and directories, NUL,
  backslashes, and percent-encoded dot segments against inspect, verify, and the CLI.
- `webhook-constants.test.ts` — framework secret-token options pass
  `webhook.constant_time`; a custom `==`/`===` header compare fails; output never echoes
  the secret.
- `fuzz.test.ts` — `BotSpec` totality and unknown-key rejection, path escape attempts,
  payload splitting.

### Integration (`tests/integration`)

`verify.test.ts` runs the verifier against complete trees:

- both reference projects produce `ok: true` and zero `fail`;
- a copy with a token literal fails `token.literal`;
- a copy with `queue: postgres` but no worker fails `queue.worker`;
- a copy without `answerCallbackQuery` fails `tests.infrastructure`;
- a copy parsing `initData` without key sorting fails `miniapp.session`.

Each mutation asserts the exact check id, so a renamed or removed check is caught.

### Host (`tests/host`)

- `omp-adapter.test.ts` — three tools, `read` approval, strict schemas, no filesystem I/O
  at registration, three commands registered.
- `dsh-adapter.test.ts` — no default export, `name`/`inject`/`Config`/`apply`, three
  registered tools, disposal removes them.
- `mcp-server.test.ts` — stdio `initialize` (protocol `2025-11-25`), `tools/list` (three
  tools), `tools/call`, no stdout noise.

### Reference projects

`examples/grammy_commands`:

- `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`;
- `/start` replies with an inline button; the callback handler acknowledges;
- configuration comes from environment variables; tests run offline.

`examples/aiogram_commands`:

- `uv sync --frozen`, `uv run pytest -q`;
- the same surface, with `dp.feed_update(bot, update)` as the test entry point.

Both then go through `aurifex verify` via the CLI in the same `examples` job, which is
the end-to-end proof that knowledge, code, and gate agree.

## What this plan does not cover

- **Runtime behaviour.** No test starts a bot, receives a real update, or calls Telegram.
  Behavioural evidence comes from a project's own tests and a real deployment.
- **Docker image builds.** Not in the CI gate. `release.yml` builds and pushes the two
  reference images to GHCR in its `examples` job, which is `continue-on-error: true`;
  a registry problem never fails a release and is reported as a skipped publish.
- **Live Telegram API checks.** `tools/check-bot-api.mjs --check` and
  `tg_docs.py` require network and are not part of `pnpm verify`. The docs tool exits `3`
  when the network is unavailable; that is a reported state, not a test failure.
- **Agent compliance.** Whether the agent actually asks before building is instruction
  content, not something a unit test can prove. `content.test.ts` asserts the discovery
  text exists and is referenced; it does not observe a model.

## Security invariants asserted by the suites

1. No operation resolves a path outside its authorized root, including through symlinks.
2. Verification never writes, never executes, and never echoes a matched secret.
3. The MCP server answers `2025-11-25` and publishes exactly three tools.
4. Installer output redacts tokens and secrets and never prompts for credentials.
5. Removed generator tool names do not reappear in skills or documentation.
6. Both reference projects contain no token-shaped literal and no manifest.
