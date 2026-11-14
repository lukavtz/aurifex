# Migration

Status: `0.2.0` to `0.3.0`. BotSpec stays at `bot-spec-1.1.0`.

Sources: [`src/core/operations.ts`](../src/core/operations.ts),
[`src/adapters/mcp/server.ts`](../src/adapters/mcp/server.ts),
[`src/cli.ts`](../src/cli.ts).

## What changed

- Package version `0.3.0`. This is a breaking release of the tool surface, not of the
  `BotSpec` schema.
- The project generator was removed: template renderers, feature renderers, the manifest,
  deploy planning, test-harness generation, and the upgrade protocol.
- MCP tools dropped from nine to three: `telegram_bot_target_resolve`,
  `telegram_bot_inspect`, `telegram_bot_verify`. The removed six were the scaffold,
  add-feature, deploy-plan, test-harness, and both upgrade tools.
- CLI commands dropped from ten to four: `target`, `inspect`, `verify`, `install`.
- Skills grew from ten to fifteen. The new ones are `telegram-bot`, `telegram-bot-sources`,
  `telegram-bot-stack-choice`, `telegram-bot-recipes`, and `telegram-bot-failures`.
- `examples/` now holds two hand-written reference projects; the payment example was
  removed. No example carries `.aurifex/manifest.json`.
- The verifier is unchanged in count (29 checks) and ids. It no longer receives paths
  from templates; paths come from [`src/core/layout.ts`](../src/core/layout.ts).

## Command map

| Removed command | Replacement                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `new`           | Read `telegram-bot`, `telegram-bot-discovery`, and `telegram-bot-recipes`; the agent writes the project.                                   |
| `add`           | `telegram-bot-recipes` and the per-surface reference files (`inline-buttons`, `payments`, `mini-apps`, `llm`, `broadcast`, `bot-api-104`). |
| `deploy`        | `telegram-deploy` skill for delivery, webhook registration, and shutdown semantics.                                                        |
| `harness`       | `telegram-testing` skill: update fixtures, fake transport, and the scenario matrix.                                                        |
| `upgrade`       | Not replaced. There is no manifest, so there is nothing to bump.                                                                           |
| `upgrade-plan`  | Read `telegram-bot-api-104` for the 10.4 call surface and limits.                                                                          |

The agent now builds the bot in the user's project. Aurifex supplies procedure and
references, then `aurifex verify` checks the result.

## Tool map

| Removed tool          | Replacement                     |
| --------------------- | ------------------------------- |
| scaffold              | Skills; the agent writes files. |
| add-feature           | `telegram-bot-recipes`.         |
| deploy-plan           | `telegram-deploy`.              |
| test-harness          | `telegram-testing`.             |
| upgrade, upgrade-plan | `telegram-bot-api-104`.         |

`target_resolve`, `inspect`, and `verify` keep their names and semantics. Any host
configuration that allowlisted the removed tools should be updated: the MCP server now
publishes three tools and rejects calls to the others.

## Keeping an existing generated project

A project written by `0.2.x` keeps working. Nothing in it depends on Aurifex at runtime,
and `inspect`/`verify` never read the manifest.

1. Delete `.aurifex/manifest.json` and the empty `.aurifex/` directory. Version `0.3.0`
   does not read them, and leaving them implies a lifecycle that no longer exists.
2. Keep `.aurifex/` in `.gitignore` only if other tooling uses it; otherwise remove the
   entry.
3. Run `aurifex verify <project>`. The 29 checks and their ids are unchanged, so a
   previously passing project should still pass.
4. Continue with the skills for any new work. Layout and conventions are documented in
   `skills/telegram-bot-recipes/references/project-layout.md`; if the generated project
   differs, follow the project, not the document.
5. Migrate to the 10.4 call surface by reading `telegram-bot-api-104`. There is no
   automated rewrite.

## BotSpec

The schema is unchanged at `bot-spec-1.1.0`. `validateBotSpec`, the JSON Schema, the
feature enum, and the locale enum behave exactly as in `0.2.0`. Documents with
`bot-spec-1.0.0` are still normalized once and then validated. The difference is
consumption: the confirmed document scopes what the agent writes, instead of feeding a
renderer.

See [BOT_SPEC.md](BOT_SPEC.md).

## Verification

```text
node --test --experimental-strip-types tests/unit/schema.test.ts
node --test --experimental-strip-types tests/unit/spec-v11.test.ts
node --test --experimental-strip-types "tests/integration/**/*.test.ts"
```

Operational steps after migration are in [OPERATIONS.md](OPERATIONS.md).
