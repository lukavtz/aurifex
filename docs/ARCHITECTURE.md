# Aurifex — Architecture

Status: v0.2.0
Last verified: 2026-11-09

## 1. Shape

One npm package, one domain core, three thin host adapters.

```text
model / user
   │
   ├── OMP ExtensionAPI ──┐
   ├── DSH Cordis tools ──┼──> CoreOperations ──> filesystem / templates
   └── MCP stdio server ──┘
```

Adapters translate schemas and result projections. They never implement Telegram
logic, path policy, or verification rules.

## 2. Module map

```text
src/
  core/
    results.ts            DomainResult<T>, stable error codes, canonical JSON
    spec/
      bot-spec.ts         BotSpec validation, normalization, hash
    targets/
      catalog.ts          exact target data and feature matrix
    security/
      secrets.ts          token/secret detection and redaction
      path-policy.ts      authorized-root containment and safe writes
    projects/
      scaffold.ts         scaffold operation
      inspect.ts          read-only project inspection
      verify.ts           deterministic checks
      add-feature.ts      feature module generation
      deploy.ts           deploy plan and webhook script
      test-harness.ts     offline fixtures and fake transport
      upgrade.ts          Bot API migration plan
      features/
        grammy.ts         grammY feature renderers (incl. widgets, rich)
        aiogram.ts        aiogram feature renderers
      templates/
        shared.ts         base files, Docker, Caddy, CI
        grammy.ts         grammY file map + Bot API 10.4 raw adapter
        aiogram.ts        aiogram file map + Bot API 10.4 raw methods
        miniapp.ts        React/Vite Mini App
    operations.ts         CoreOperations facade
  adapters/
    shared.ts             host configuration and path authorization
    omp/index.ts          ExtensionAPI projection
    dsh/index.ts          Cordis plugin projection
    mcp/server.ts         MCP server projection
  cli.ts                  CLI + one-command installer
  index.ts                public exports
```

## 3. Core contracts

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

Stable error codes:

- `invalid_request`
- `invalid_path`
- `unauthorized_path`
- `destination_exists`
- `file_too_large`
- `file_exists` (mapped to `destination_exists` by the facade)
- `not_a_file`
- `not_a_directory`
- `output_too_large`
- `target_unsupported`
- `project_unreadable`
- `verification_failed`
- `feature_exists`
- `internal_error`

### BotSpec

```ts
interface BotSpec {
  schemaVersion: "bot-spec-1.1.0";
  name: string; // ^[a-z][a-z0-9_]{1,63}$
  displayName: string;
  stack: "grammy" | "aiogram";
  features: readonly BotFeature[];
  deployment: "docker";
  storage: { postgres: boolean; redis: boolean };
  i18n: {
    defaultLocale: "en" | "ru" | "zh";
    en: boolean;
    ru: boolean;
    zh: boolean;
  };
  security: {
    webhookSecret: true;
    adminAllowlist: boolean;
    rateLimit: boolean;
    idempotency: boolean;
  };
  runtime: {
    queue: "postgres" | "none";
    telemetry: { otlp: boolean; prometheus: boolean; sentry: boolean };
  };
  miniapps?: {
    sessionTtlSeconds: number; // 300..2592000, default 86400
    allowedOrigins: readonly string[];
  };
  payments?: {
    products: readonly {
      id: string; // ^[a-z][a-z0-9_]{1,31}$
      title: string; // 1..32
      description: string; // 1..255
      stars: number; // 1..10000
      subscription: boolean;
    }[];
  };
}
```

Validation is strict: unknown keys, duplicate features, empty strings, and a
missing webhook secret are rejected.

## 4. Path and write policy

All operations that touch the filesystem are created from `CoreOperationsOptions`:

```ts
interface CoreOperationsOptions {
  root: string;
  now?: () => Date;
}
```

`createCoreOperations` resolves `root` with `realpath` and builds one `PathPolicy`
that every operation receives. There is no second filesystem authority.

Rules:

1. Resolve the real root with `realpath`.
2. For reads, `realpath(candidate)` must be inside the root.
3. For writes, resolve the parent with `realpath`; the target must not be a
   symlink; the lexical and real paths must both be inside the root.
4. Create files with `flag: "wx"` unless `overwrite` is explicit.
5. Never follow a symlink while creating intermediate directories.
6. Cap file reads at 1 MiB and total verification input at 64 MiB; an
   unscannable oversized file fails `token.literal`.
7. Generated compose files never hardcode database passwords, publish the bot
   port directly, or expose Redis without a password; Caddy terminates TLS.

The host adapters use `createPathPolicy`. OMP authorizes `ctx.cwd`; DSH authorizes
the configured `root`; MCP authorizes `AURIFEX_ROOT` (default `cwd`); the CLI
authorizes `--root` (default `cwd`).

## 5. Templates

Templates are TypeScript functions returning `TemplateFile[]`.
No template engine and no runtime dependency.

Bot API 10.4 is first-class even though grammY 1.46 and aiogram 3.31 types stop at
10.3: generated projects include `src/telegram/api104.ts` or
`app/services/api104.py`, a typed raw adapter for widgets, widget queries,
ephemeral callback replies, and rich messages/drafts. Remaining 10.4 data
surfaces (TON wallet cards, share themes, rich quotes) stay available through the
raw transport. Verification check `botapi.104` fails when the adapter is removed.

- Generated files are deterministic: same spec and target produce identical bytes.
- All dynamic values are escaped for their target context (JSON via
  `JSON.stringify`, TOML via quoted strings, Docker via allowlisted values).
- User-provided names are validated before interpolation.
- The token placeholder is always empty.

## 6. Verification model

`verifyBot` performs static checks only. It does not execute the generated project.
Checks are pure functions over a bounded file snapshot:

```ts
interface Check {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  evidence?: { path: string; line?: number };
}
```

`ok` is true only when no check is `fail`. Warnings remain visible.

Project execution is a separate, explicit step performed by the operator or the
live E2E suite.

## 7. Host projections

### OMP

- `src/adapters/omp/index.ts` default-exports a factory.
- Registers tools with `pi.registerTool`, schemas with `pi.zod`.
- Registers `/aurifex-new`, `/aurifex-verify`, `/aurifex-deploy`.
- `/aurifex-new` sends the discovery prompt and never scaffolds until the user confirms the BotSpec.
- Authorizes paths from `ctx.cwd`.
- Uses tool `approval`: `read` for resolve/inspect/verify, `write` for scaffold/add/deploy.

### DeepSeek Harness

- Function plugin with `name`, `inject = ["tools", "systemPrompt"]`, `apply`.
- No default export.
- `Config` is a Schemastery schema.
- Tools use `defineTool` with canonical JSON output and a renderer.
- `cordis.patch.yml` inserts one row.
- All registrations are fiber-owned.

### Claude Code

- `.claude-plugin/plugin.json` declares name, version, license, homepage.
- `.claude-plugin/marketplace.json` exposes the repo as a marketplace.
- `.mcp.json` registers the same stdio server.
- `skills/`, `agents/`, `commands/` are auto-discovered.
- `aurifex install --host claude` runs marketplace add + install.

### MCP

- `McpServer` with `@modelcontextprotocol/server` 2.4.0.
- Strict Zod v4 input schemas.
- Results are `structuredContent` plus serialized text, capped at 256 KiB.
- Stdout is reserved for JSON-RPC; diagnostics go to stderr.
- `serveStdio` owns transport lifecycle.

## 8. Trust boundaries

| Boundary                   | Trust        | Control                                          |
| -------------------------- | ------------ | ------------------------------------------------ |
| Model arguments            | untrusted    | strict schema, name allowlists, path policy      |
| Existing repository files  | untrusted    | bounded read, no execution, no symlink follow    |
| Third-party reference code | untrusted    | read-only reference, license check, no vendoring |
| Telegram updates           | untrusted    | secret-token check, update schema validation     |
| Mini App `initData`        | untrusted    | HMAC/Ed25519, auth_date freshness                |
| Bot token                  | secret       | env only, redaction, never written               |
| Host extension process     | trusted code | reviewed source, no sandbox claim                |

## 9. Failure behavior

- No operation leaves a partially written project without reporting it.
- Scaffold writes into a fresh directory; on failure it removes only the files it
  created in this call.
- `overwrite` never deletes unrelated files.
- Verification returns findings, not exceptions, for project content.
- Adapter errors are converted to `DomainResult` errors; unexpected exceptions
  become `internal_error` with no stack trace in the model-facing payload.

## 10. Testing strategy

- **Unit**: spec validation, target catalog, secret detection, path policy, template
  file maps.
- **Integration**: scaffold into a temp root, inspect, verify, add feature, deploy plan.
- **Security**: symlink escape, token planting, webhook secret omissions, oversized
  files, malicious names.
- **Host**: OMP tool registration shape, DSH plugin shape, MCP initialize/list/call.
- **E2E**: generated project typecheck/test in a temp directory; live Telegram only
  when `AURIFEX_LIVE=1` and secrets are present.
- **CI**: Ubuntu, macOS, Windows for core; Linux for generated Python via container.

## 11. Dependencies

Runtime: `@modelcontextprotocol/server`, `zod`.
Peers (DSH only): `@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`,
`@deepseek-ai/schemastery`.
Dev: TypeScript, Node types, OMP types, Prettier, oxlint.

No template engine, no ORM, no Telegram client in the plugin itself.

## 12. Extension points

- Add a stack: new target record + template module + adapter schema enum.
- Add a Bot API version: update `catalog.ts`, extend the typed raw adapter and its
  tests, and add a migration note. Framework type lag is expected; support is not.
- Add a feature: new generator in `add-feature.ts` + template fragment + test.
- Add a verification check: pure function in `verify.ts` + fixture test.
- Update Bot API: edit `catalog.ts`, extend the typed raw adapter, add tests and a
  migration note.
