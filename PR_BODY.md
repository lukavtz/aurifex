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

Commands from [docs/TEST_PLAN.md](docs/TEST_PLAN.md), run on branch `feat/knowledge-plugin`
at commit `0644b88`.

- [x] `pnpm install --frozen-lockfile` — lockfile regenerated for the 0.3 dependency set
- [x] `npx tsc --noEmit` — no errors
- [x] `node scripts/check-skills.mjs` → `check-skills: ok · 15 skills`
- [x] `node scripts/check-site.mjs` → `check-site: ok · 3 locales · 135 keys · 7 local assets`
- [x] `node --test --experimental-strip-types "tests/unit/**/*.test.ts"` → 182 pass, 0 fail, 3 skipped (`install-windows` needs pwsh)
- [x] `node --test --experimental-strip-types "tests/security/**/*.test.ts"` → 23 pass, 0 fail
- [x] `node --test --experimental-strip-types "tests/integration/**/*.test.ts"` → 23 pass, 0 fail
- [x] `node --test --experimental-strip-types "tests/host/**/*.test.ts"` → 11 pass, 0 fail
- [x] `pnpm verify` → exit 0 (format, lint, typecheck, unit, security, fuzz, integration, host,
      skills, site, secrets, pack dry-run)
- [x] `(cd examples/grammy_commands && bun test)` → 34 pass, 2 skip, 0 fail; `bun run typecheck` clean
- [x] `(cd examples/aiogram_commands && uv run pytest -q)` → 34 passed
- [x] `node dist/cli.js verify examples/grammy_commands --json` → `{"ok":true,"pass":29,"warn":0,"fail":0}`
- [x] `node dist/cli.js verify examples/aiogram_commands --json` → `{"ok":true,"pass":29,"warn":0,"fail":0}`
- [x] `node dist/cli.js --help` → `target`, `inspect`, `verify`, `install`
- [x] `node dist/adapters/mcp/server.js` → `initialize` with `1999-01-01` answers `2025-11-25`;
      `tools/list` returns `telegram_bot_target_resolve`, `telegram_bot_inspect`, `telegram_bot_verify`
- [x] Failing-first tests: each new contract test was written red before the behaviour existed —
      `layout.test.ts` (recipes reference vs `layoutPaths()`), `check-skills.test.ts` (checker red on
      every violation), `api104-contract.test.ts`, `reference-projects.test.ts`,
      `skill-scripts.test.ts` (initially fetched the live docs page; now proven offline under a dead
      proxy), `verify.test.ts` (23 mutations, each pinning one check id)

```
$ pnpm verify
All matched files use Prettier code style!
ℹ pass 182   ℹ fail 0        # unit (3 skipped: pwsh-only)
ℹ pass 23    ℹ fail 0        # security
ℹ pass 7     ℹ fail 0        # fuzz
ℹ pass 23    ℹ fail 0        # integration
ℹ pass 11    ℹ fail 0        # host
check-skills: ok · 15 skills
check-site: ok · 3 locales · 135 keys · 7 local assets
check-no-secrets: clean
Tarball Details  aurifex-0.3.0.tgz

# GitHub Actions on this PR: verify (ubuntu, macos, windows), fuzz, audit, package smoke,
# workflow lint, dependency review, CodeQL — all pass.

$ node dist/cli.js verify examples/grammy_commands --json
{"ok":true,"summary":{"pass":29,"warn":0,"fail":0}}
$ node dist/cli.js verify examples/aiogram_commands --json
{"ok":true,"summary":{"pass":29,"warn":0,"fail":0}}

$ printf 'initialize(1999-01-01) / tools/list' | node dist/adapters/mcp/server.js
"2025-11-25"
["telegram_bot_target_resolve","telegram_bot_inspect","telegram_bot_verify"]
```

## Security

- [x] No token, webhook secret, API key, or private chat id is added, logged, or committed
      (`check-no-secrets: clean`, `check-skills` token regex, `token-plant` tests)
- [x] Every filesystem read still resolves through `PathPolicy` (`path-traversal`, `verify.test.ts` symlink case)
- [x] Verification output never echoes a matched secret and never executes project code
      (redaction asserted in `token-plant` and `webhook-constants`)
- [x] New dependencies are pinned to exact versions and pass `pnpm audit --prod`
      (no dependency added; the MCP server stays zero-dependency)
- [x] Bot API 10.4 gaps are handled by a typed raw adapter, not claimed as native
      framework support (`api104-contract`, `botapi.104` checks on both references)
- [x] Removed tool names do not appear in skills, docs, or prompts
      (`check-skills` rejects them; docs grep is part of `docs/TEST_PLAN.md`)
