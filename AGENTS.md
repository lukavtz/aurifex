# Aurifex — project rules

## Scope

Aurifex is a knowledge and verification plugin for agent harnesses, not a bot
runtime and not a project generator. It teaches an agent how to interview a
user, how to build a grammY or aiogram bot, where to obtain current Bot API
facts, and how to check the result; it supplies a machine-readable Bot API 10.4
contract; and it verifies a project statically. It never owns, runs, or
rewrites a user's bot.

## Non-negotiable rules

- Model input never grants filesystem authority. Every path is resolved through
  `PathPolicy` and checked against an authorized root.
- Never write a real secret. Placeholder `.env` files contain empty values.
- Token-shaped literals are findings, not warnings.
- The plugin teaches and verifies that webhook mode requires a secret token,
  HTTPS, an allowed port, and a constant-time header check in the bot code.
- The plugin teaches and verifies that long-running work never runs inside a
  webhook handler. Anything above the webhook timeout must enqueue.
- Live Telegram tests are secret-gated and never run in the default suite.
- Public contracts are versioned. A breaking tool schema requires a new spec
  version and a migration note.

## Reference projects

`examples/grammy_commands` and `examples/aiogram_commands` are hand-written.
They are the proof that the knowledge produces working code, and they double as
`verify` fixtures. Each must keep passing its own test suite and
`aurifex verify`. Tooling never rewrites them.

## Structure

- `src/core/` — domain logic: `layout.ts`, `operations.ts`,
  `projects/{inspect,verify}.ts`, `security/`, `spec/`, `targets/`.
- `src/adapters/` — thin host projections. No domain logic.
- `skills/`, `agents/`, `commands/`, `rules/`, `prompts/` — declarative
  surfaces.
- `tests/unit`, `tests/integration`, `tests/host`, `tests/security`,
  `tests/fixtures`.
- `raw/` — reference clones. Ignored by git.

## Verification

`pnpm verify` is the gate. It runs format check, lint, typecheck, unit,
security, fuzz, integration, host contract tests, `check:skills`, `check:site`,
`check:secrets`, and a package dry-run.

## Style

- Node 24+, ESM, strict TypeScript, no `any` in public contracts.
- Small modules, explicit result types, deterministic tests.
- No new dependency without a documented reason and a license check.
