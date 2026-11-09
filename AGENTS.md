# Aurifex — project rules

## Scope

Aurifex is a capability package, not a bot runtime. It generates, inspects,
verifies, and deploys Telegram bot projects. It must not become a framework that
owns a user's bot process.

## Non-negotiable rules

- Model input never grants filesystem authority. Every path is resolved through
  `PathPolicy` and checked against an authorized root.
- Never write a real secret. Generated `.env` files contain empty placeholders.
- Token-shaped literals are findings, not warnings.
- Webhook mode requires a secret token, HTTPS, an allowed port, and a
  constant-time header check in generated code.
- Long-running work never runs inside a webhook handler.
- Live Telegram tests are secret-gated and never run in the default suite.
- Public contracts are versioned. A breaking tool schema requires a new spec
  version and a migration note.

## Structure

- `src/core/` — domain logic, path policy, templates, operations facade.
- `src/adapters/` — thin host projections. No domain logic.
- `skills/`, `agents/`, `commands/`, `rules/`, `prompts/` — declarative surfaces.
- `tests/unit`, `tests/integration`, `tests/host`, `tests/security`, `tests/e2e`.
- `raw/` — reference clones. Ignored by git.

## Verification

`pnpm verify` is the gate. It runs format check, lint, typecheck, unit, security,
integration, host contract tests, and package dry-run. E2E is separate and
secret-gated.

## Style

- Node 24+, ESM, strict TypeScript, no `any` in public contracts.
- Small modules, explicit result types, deterministic tests.
- No new dependency without a documented reason and a license check.
