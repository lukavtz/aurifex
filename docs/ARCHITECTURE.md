# Aurifex — Architecture

Status: v0.3.0
Last verified: 2026-11-15

## 1. Shape

One npm package, one domain core, three projections, zero project generator.

```text
model / user
   │
   ├── OMP ExtensionAPI ──┐
   ├── DSH Cordis tools ──┼──> CoreOperations ──> filesystem (read-only inspection,
   └── MCP stdio server ──┘                        bounded verification)
                                   ▲
                              CLI (`aurifex`)
```

Adapters translate schemas and result projections. They never implement Telegram
knowledge, path policy, or verification rules. The package produces no project files:
the agent writes the bot, and Aurifex explains how and checks the result.

## 2. Module map

```text
src/
  core/
    results.ts            DomainResult<T>, stable error codes, canonical JSON
    layout.ts             the single source of project layout paths per stack
    spec/
      bot-spec.ts         BotSpec validation, normalization, hash
    targets/
      catalog.ts          pinned target data and feature matrix
      api104-contract.ts  Bot API 10.4 methods, params, and type surface
    security/
      secrets.ts          token/secret detection and redaction
      path-policy.ts      authorized-root containment and bounded reads
    projects/
      inspect.ts          read-only project inspection
      verify.ts           the 29 deterministic checks
    operations.ts         CoreOperations facade
  adapters/
    shared.ts             host configuration, discovery guidance, path authorization
    omp/index.ts          ExtensionAPI projection
    dsh/index.ts          Cordis plugin projection
    mcp/server.ts         MCP server projection
  cli.ts                  CLI (`target`, `inspect`, `verify`, `install`)
  index.ts                public exports
skills/                   the knowledge: 15 SKILL.md trees, references, offline scripts
agents/                   bot-architect, bot-security-reviewer, bot-test-writer
commands/                 aurifex-new, aurifex-verify, aurifex-deploy
tools/                  repository checks, Bot API watcher, host smoke
examples/                 grammy_commands, aiogram_commands (hand-written)
site/                     trilingual product site
```

## 3. Why there is no generator

Version 0.2 shipped template renderers for every feature. The cost was structural: each
template had to be kept correct against a moving Bot API, each feature doubled that
surface for two stacks, and the output still needed a human to finish it. The agent
already has file tools and can write code; what it lacked was procedure and current
facts.

Version 0.3 keeps the part that is cheap and deterministic — verification — and replaces
rendering with knowledge:

- `skills/` states what to do, in what order, with which API, and where to check.
- The agent writes the project in the confirmed stack.
- `verify` checks the result against the 29 invariants.
- `examples/` proves the combination works.

There is no `.aurifex/manifest.json`, no upgrade protocol, and no template set. Nothing
in the repository claims to have generated the reference projects.

## 4. Core contracts

### DomainResult

Every operation returns:

```ts
type DomainResult<T> =
  | { schemaVersion: "domain-result-1.0.0"; status: "ok"; value: T; evidence: Evidence[] }
  | {
      schemaVersion: "domain-result-1.0.0";
      status: "error";
      error: DomainError;
      evidence: Evidence[];
    };
```

`serializeDomainResult` uses canonical JSON so adapter output is byte-stable.

Stable error codes used by the remaining operations:

- `invalid_request`
- `invalid_path`
- `unauthorized_path`
- `not_a_file`
- `not_a_directory`
- `file_too_large`
- `output_too_large`
- `target_unsupported`
- `project_unreadable`
- `verification_failed`
- `build_failed`
- `internal_error`

### Operations

`CoreOperations` exposes exactly three operations:

```ts
interface CoreOperations {
  resolveTarget(input: { stack: BotStack }): Promise<DomainResult<TargetResolution>>;
  inspectBot(input: { projectRoot: string }): Promise<DomainResult<InspectResult>>;
  verifyBot(input: { projectRoot: string }): Promise<DomainResult<VerificationReport>>;
}
```

`install` is a CLI and adapter concern (host integration commands), not a core
operation.

### BotSpec

`BotSpec` is the agreement between the user and the agent, not a template input. The
schema is `bot-spec-1.1.0`; the validator is authoritative and the JSON Schema mirrors it
for editors. Fields and coupling rules are in [BOT_SPEC.md](BOT_SPEC.md).

### layout.ts

`src/core/layout.ts` is the only TypeScript location that names project-relative paths:
queue, worker, payments, Mini App session, Bot API 10.4 adapter, migration, user sync,
tests directory, and lockfile for each stack. `verify.ts` derives its path constants from
`LAYOUT`; `skills/telegram-bot-recipes/references/project-layout.md` is the
human-readable copy, and a unit test asserts the two agree.

## 5. Path and read policy

All operations that touch the filesystem are created from
`CoreOperationsOptions { root, now? }`. `createCoreOperations` resolves `root` with
`realpath` and builds one `PathPolicy` that every operation receives. There is no second
filesystem authority.

Rules:

1. Resolve the real root with `realpath`.
2. For reads, `realpath(candidate)` must be inside the root.
3. The project root of `inspect` and `verify` must be a directory inside the root and
   must not be a symlink escape.
4. Operations never write to a bot project. The installer alone writes build output and
   host registrations, outside the `PathPolicy` root.
5. Cap file reads at 1 MiB and total verification input at 64 MiB. A file that cannot be
   scanned because it is oversized fails `scan.bounded`.

The host adapters use `createPathPolicy`. OMP authorizes `ctx.cwd`; DSH authorizes the
configured `root`; MCP authorizes `AURIFEX_ROOT` (default `cwd`); the CLI authorizes
`--root` (default `cwd`).

## 6. Verification model

`verifyBot` matches static file-content markers in a bounded snapshot. It never executes
project code, uses the network, or calls Telegram. Markers do not prove runtime
behaviour. Checks are pure functions over that snapshot:

```ts
interface Check {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  evidence?: { path: string; line?: number };
}
```

`ok` is true only when no check is `fail`. Warnings remain visible. The 29 ids are
grouped in the README and enumerated in [TEST_PLAN.md](TEST_PLAN.md).

Project execution is a separate, explicit step performed by the operator or by the
project's own test suite.

## 7. Knowledge model

Each `skills/<name>/SKILL.md` is a procedure with three mandatory sections:

- `## Procedure` — ordered steps, exact APIs, and what to read next.
- `## Gotchas` — symptoms, causes, fixes.
- `## Sources` — at least three absolute `https://` references.

Heavy detail lives in `references/*.md`; the skill states when to read which file.
`tools/check-skills.mjs` enforces the structure offline: frontmatter name matches the
directory, description exists and is within 1024 characters, body is at most 500 lines,
required headings are present, relative links resolve, and removed generator tool names
do not appear.

One topic has one owner. Security lives in `telegram-security`, limits in
`telegram-bot-api`, delivery in `telegram-deploy`, Bot API 10.4 in
`telegram-bot-api-104`, and failure modes in `telegram-bot-failures`. Other skills
cross-reference instead of copying.

## 8. Host projections

### OMP

- `src/adapters/omp/index.ts` default-exports a factory.
- Registers three tools with `pi.registerTool`, schemas with `pi.zod`.
- Registers `aurifex-new`, `aurifex-verify`, `aurifex-deploy` commands, matching
  `commands/*.md`.
- `aurifex-new` sends the discovery prompt and never writes code before the user confirms
  the proposed `BotSpec`.
- Authorizes paths from `ctx.cwd`. All three tools are `read` approval.

### DeepSeek Harness

- Function plugin with `name`, `inject = ["tools", "systemPrompt"]`, `apply`.
- No default export.
- `Config` is a Schemastery schema.
- The same three tools use `defineTool` with canonical JSON output and a renderer.
- The system-prompt section imports `DISCOVERY_GUIDANCE` from `src/adapters/shared.ts`.
- `cordis.patch.yml` inserts one row; registrations are fiber-owned.

### Claude Code

- `.claude-plugin/plugin.json` declares name, version, license, homepage.
- `.claude-plugin/marketplace.json` exposes the repo as a marketplace.
- `.mcp.json` registers the same stdio server.
- `skills/`, `agents/`, `commands/` are auto-discovered.
- `rules/telegram-security.md` and `prompts/review-bot.md` ship as reference pointers.
  Claude Code and DSH do not auto-load these directories.
- `aurifex install --host claude` runs marketplace add + install.

### MCP

- Zero-dependency stdio server in `dist/adapters/mcp/server.js`: JSON-RPC 2.0 over
  stdin/stdout, no runtime `node_modules` needed. This is what makes a Claude
  marketplace install runnable from its cache copy.
- `PROTOCOL_VERSION = "2025-11-25"`; `initialize` always answers with that value.
- Strict JSON Schema input validation for every tool; unknown fields are rejected.
- Results are `structuredContent` plus serialized text, capped at 256 KiB.
- Stdout is reserved for JSON-RPC; diagnostics go to stderr.
- The server owns transport lifecycle (`initialize`, `tools/list`, `tools/call`, `ping`).

## 9. Trust boundaries

| Boundary                   | Trust        | Control                                       |
| -------------------------- | ------------ | --------------------------------------------- |
| Model arguments            | untrusted    | strict schema, stack enum, path policy        |
| Existing repository files  | untrusted    | bounded read, no execution, no symlink follow |
| Third-party reference code | untrusted    | read-only reference, no vendoring             |
| Host extension process     | trusted code | reviewed source, no sandbox claim             |
| Installer source           | publisher    | pinned ref, local build, redacted output      |

## 10. Failure behavior

- Verification returns findings, not exceptions, for project content.
- An unreadable project returns `project_unreadable` with the path, never a stack trace.
- Adapter errors are converted to `DomainResult` errors; unexpected exceptions become
  `internal_error` with no stack trace in the model-facing payload.
- `inspect` degrades to `stack: "unknown"` with findings instead of failing when files
  are absent.
- The CLI maps usage errors to exit `2` and domain errors to exit `1`.

## 11. Testing strategy

- **Unit**: spec validation, target catalog, Bot API 10.4 contract, secret detection,
  path policy, layout parity, skill structure, bundled scripts.
- **Security**: symlink escape, token planting, webhook omissions, oversized files,
  malicious paths, fuzz over `BotSpec` and path inputs.
- **Integration**: both reference projects verify clean; mutated copies fail with the
  exact expected check ids.
- **Host**: OMP tool registration shape, DSH plugin shape, MCP initialize/list/call,
  installer behaviour in isolated profiles.
- **CI**: Ubuntu, macOS, Windows for the package; the reference projects in their own
  runtimes.

The full matrix is in [TEST_PLAN.md](TEST_PLAN.md).

## 12. Dependencies

Runtime: none (Node.js built-ins only). The MCP server and CLI ship dependency-free so a
host plugin cache copy works without `node_modules`.
Peers (DSH only): `@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`,
`@deepseek-ai/schemastery`.
Dev: TypeScript, Node types, OMP types, Prettier, oxlint, `@modelcontextprotocol/server`
(type-checking only), `zod` (host tests), `fast-check`.

Bundled Python helpers under `skills/*/scripts/` use the standard library only.

## 13. Extension points

- Add a stack: extend the `BotStack` union, `catalog.ts`, `layout.ts`, and the adapter
  schema enum; add framework and recipe knowledge.
- Add a Bot API version: update `catalog.ts`, `api104-contract.ts` (rename on the next
  major), and the `telegram-bot-api-104` skill; framework type lag is expected and
  handled by a raw adapter.
- Add a verification check: pure function in `verify.ts`, fixture in
  `tests/integration/verify.test.ts`, and a line in the site truth constants.
- Add a skill: `skills/<name>/SKILL.md` plus references; `check-skills.mjs` validates it.
