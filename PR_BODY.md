## Summary

Aurifex 0.3.0 turns the package into a knowledge plugin. The project generator is
deleted: no template renderers, no feature modules, no manifest, no deploy planning, no
upgrade protocol. What remains is the part that is cheap, deterministic, and useful —
static verification — plus 15 skills that teach an agent how to interview, choose a
stack, build each Telegram surface, and check the result.

Package version: `0.3.0`. BotSpec schema: unchanged at `bot-spec-1.1.0`. Tool surface:
3 MCP tools, 4 CLI commands, 29 checks, 15 skills.

Closes #

## Type

- [x] Core behavior (`src/core`)
- [x] Reference project (`examples/`)
- [x] Host adapter (OMP, DSH, MCP)
- [x] CLI
- [x] Skills, agents, commands, prompts, rules
- [x] CI, packaging, docs

## What changed

### Core

- Removed every renderer, template, feature module, manifest, deploy planner,
  test-harness generator, and upgrade path.
- `CoreOperations` is now `resolveTarget`, `inspectBot`, `verifyBot`. Nothing writes to a
  bot project.
- `src/core/layout.ts` is the single source of project layout paths per stack;
  `verify.ts` derives its constants from it, and a unit test keeps the human-readable
  copy in `skills/telegram-bot-recipes/references/project-layout.md` in sync.
- `src/core/targets/api104-contract.ts` holds the Bot API 10.4 methods, exact params, and
  type surface.
- The 29 check ids are unchanged; verification is still a bounded static scan
  (64 MiB total, 1 MiB per file), no execution, no network.

### Tools and CLI

- MCP tools: `telegram_bot_target_resolve`, `telegram_bot_inspect`,
  `telegram_bot_verify`. Protocol revision `2025-11-25`. Zero runtime dependencies.
- CLI commands: `target`, `inspect`, `verify`, `install`. Exit codes `0`/`1`/`2`;
  `--json` prints one `domain-result-1.0.0` object.
- OMP and DSH register the same three tools and the three `aurifex-*` commands.
  `DISCOVERY_GUIDANCE` is shared, not copied.

### Skills

- 15 skills, all with `## Procedure`, `## Gotchas`, and `## Sources` (at least three
  absolute `https://` URLs), bodies under 500 lines, heavy detail in `references/`.
- Topic ownership is explicit: security, limits, delivery, 10.4, and failures each have
  one owner; the rest cross-reference.
- New: `telegram-bot` (router), `telegram-bot-sources`, `telegram-bot-stack-choice`,
  `telegram-bot-recipes`, `telegram-bot-failures`.
- Bundled offline helpers: `tg_docs.py`, `tg_text.py`, `telegram_payload.py`.

### Examples and site

- `examples/grammy_commands` and `examples/aiogram_commands` are hand-written reference
  projects with no `.aurifex/` directory. They pass their own suites and `verify` with
  zero `fail`.
- The site describes knowledge and verification in three locales, with `data-truth`
  markers at checks 29, tools 3, commands 4.
- `scripts/check-skills.mjs` enforces the knowledge contract offline; `check-site.mjs`
  pins counts and lists.

### Docs

- README (EN/RU), architecture, spec, BotSpec, CLI, migration, operations, test plan,
  threat model, release, security policy, and third-party notices rewritten for the new
  surface. Generator commands and threats are gone; install, MCP, and verification
  threats remain.

## Breaking change

The 0.2 tool surface is gone. Host configurations that allowlisted the removed tools must
be updated. A project produced by 0.2 keeps running; it never depended on the plugin at
runtime. Remove its `.aurifex/manifest.json`. See [docs/MIGRATION.md](docs/MIGRATION.md).

## Verification

Commands from [docs/TEST_PLAN.md](docs/TEST_PLAN.md). Paste actual output; do not claim a
pass without it.

- [ ] `pnpm install --frozen-lockfile`
- [ ] `npx tsc --noEmit`
- [ ] `node scripts/check-skills.mjs` → `check-skills: ok · 15 skills`
- [ ] `node scripts/check-site.mjs`
- [ ] `node --test --experimental-strip-types "tests/unit/**/*.test.ts"`
- [ ] `node --test --experimental-strip-types "tests/security/**/*.test.ts"`
- [ ] `node --test --experimental-strip-types "tests/integration/**/*.test.ts"`
- [ ] `node --test --experimental-strip-types "tests/host/**/*.test.ts"`
- [ ] `pnpm verify`
- [ ] `(cd examples/grammy_commands && bun install --frozen-lockfile && bun run typecheck && bun test)`
- [ ] `(cd examples/aiogram_commands && uv sync --frozen && uv run pytest -q)`
- [ ] `node dist/cli.js verify examples/grammy_commands --json` → `"ok": true`, `fail: 0`
- [ ] `node dist/cli.js verify examples/aiogram_commands --json` → `"ok": true`, `fail: 0`
- [ ] `node dist/cli.js --help` → four commands
- [ ] `node dist/adapters/mcp/server.js` → `initialize` answers `2025-11-25`;
      `tools/list` returns three tools
- [ ] New behavior has a failing-first test, or the reason it cannot is stated

```
# commands and output
```

## Security

- [ ] No token, webhook secret, API key, or private chat id is added, logged, or committed
- [ ] Every filesystem read still resolves through `PathPolicy`
- [ ] Verification output never echoes a matched secret and never executes project code
- [ ] New dependencies are pinned to exact versions and pass `pnpm audit --prod`
- [ ] Bot API 10.4 gaps are handled by a typed raw adapter, not claimed as native
      framework support
- [ ] Removed tool names do not appear in skills, docs, or prompts
