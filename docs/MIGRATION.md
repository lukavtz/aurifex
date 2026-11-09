# Migration

Status: `0.1.0` to `0.2.0`, BotSpec `bot-spec-1.0.0` to `bot-spec-1.1.0`.

Sources: [`upgrade.ts`](../src/core/projects/upgrade.ts),
[`manifest.ts`](../src/core/projects/manifest.ts),
[`add-feature.ts`](../src/core/projects/add-feature.ts),
[`bot-spec.ts`](../src/core/spec/bot-spec.ts).

## What changed

- Package version `0.2.0`; release tag `v0.2.0`.
- `BOT_SPEC_VERSION` is `bot-spec-1.1.0`. Documents with `bot-spec-1.0.0` are
  accepted, normalized, and validated by the same rules.
- `runtime` is required in 1.1. It holds `queue: "postgres" | "none"` and the
  telemetry booleans.
- Queued features (`llm`, `broadcast`, `payments`) require Postgres storage and a
  Postgres queue. `security.idempotency`, `security.rateLimit`, and `miniapps`
  require Redis.
- `bot-spec-1.0.0` normalization adds `runtime`, `i18n.zh`, miniapp defaults, and
  telemetry defaults. See [BOT_SPEC.md](BOT_SPEC.md).
- New generated files: secret loader, Postgres queue and worker, job modules,
  payments runtime, telemetry, readiness, healthcheck, and `docker-compose`
  `worker`/`migrate` services when the queue is enabled.
- `.env.example` gains `*_FILE` forms and the queue, Mini App, telemetry, and
  metrics variables.
- The scaffold writes `.aurifex/manifest.json` last, with the SHA-256 of every
  rendered file.

## Manifest

Path: `.aurifex/manifest.json`.

```json
{
  "manifestVersion": 1,
  "specVersion": "bot-spec-1.1.0",
  "stack": "grammy",
  "specHash": "<sha256 of the normalized spec>",
  "generatedAt": "<ISO timestamp>",
  "files": { "src/config.ts": "<sha256>" }
}
```

`files` covers every file written by the scaffold. The manifest is protected by
the same path policy as the project. A new scaffold always writes it after the
source files, so a partially written project has files but no manifest.

The manifest is required for `aurifex upgrade` and `aurifex add`. `inspect` and
`verify` do not read it. A missing manifest returns `project_unreadable` with the
hint `run aurifex upgrade --apply first`.

## Upgrade

```text
aurifex upgrade <root>
aurifex upgrade <root> --apply
```

Default is a dry run. `--apply` writes. The command:

1. reads the manifest; a missing or invalid manifest returns
   `project_unreadable`;
2. returns immediately when `specVersion` is already current;
3. hashes every file listed in `manifest.files`;
4. refuses to migrate when any file is missing or its hash differs, returning
   `project_unreadable` with the mismatched paths and writing nothing;
5. on `--apply`, rewrites only `.aurifex/manifest.json` with
   `specVersion: "bot-spec-1.1.0"` and a new `generatedAt`.

The dry run returns `actions` describing the review steps. It never writes.

### Safe upgrade limits

The original `BotSpec` is not stored in the project. Therefore `upgrade` cannot
regenerate generated source correctly, and it does not try:

- no generated file is rewritten;
- no file is deleted;
- no dependency, migration, `.env.example`, or Compose service is added;
- only the manifest is touched;
- a user-modified generated file blocks the upgrade instead of being replaced.

`0.2.0` has no automatic manifest reconstruction. A project without a manifest
cannot be upgraded by this command. Re-scaffold with `aurifex new` and port the
custom code, or add the infrastructure manually and then create the manifest
deliberately.

`aurifex upgrade-plan <root>` is separate: it reads the stack and returns Bot API
10.4 migration actions. It writes nothing and does not inspect the manifest.

## API 1.0 in `new`

`aurifex new --spec <file|->` accepts a `bot-spec-1.0.0` document. The normalizer
fills the 1.1 fields, validation runs once on the normalized document, and the
scaffold writes a manifest with `specVersion: "bot-spec-1.1.0"`. A 1.0 document
that violates a 1.1 coupling rule fails with `invalid_request` and the hint
`run aurifex upgrade --apply`.

A 1.1 document without `runtime` fails.

## Adding a feature

```text
aurifex add <root> --feature <feature> --name <name>
```

- `.aurifex/manifest.json` must exist; otherwise `project_unreadable` with the
  upgrade hint.
- Existing project must be detected as grammY (`package.json` dependency) or
  aiogram (`pyproject.toml` contains `aiogram`); otherwise
  `project_unreadable`.
- `--name` must match `^[a-z][a-z0-9_]{1,31}$` and must not be reserved:
  `index`, `main`, `bot`, `config`, `admin`, `start`, `help`.
- `--feature miniapps` requires `--name miniapp`.
- Every target file is checked first. If any exists and `--overwrite` is absent,
  the command returns `feature_exists` and writes nothing.
- Writes are rolled back when a later write fails.
- The command infers a minimal spec from the project name. It does not read the
  original spec.

Added features may require infrastructure that the inferred spec assumes. Check
the generated `.env.example`, migrations, and Compose services, then run
`aurifex verify <root>`.

## Upgrade procedure

1. Back up the project and the database.
2. Run `aurifex upgrade <root>` and read `actions`.
3. Resolve every approval manually: secret files, queue, worker, telemetry,
   migrations, and dependencies.
4. Run `aurifex upgrade <root> --apply`.
5. Run `aurifex verify <root>`; the check count grows with the new runtime.
6. Run the generated tests and the migrations in a copy of the database.
7. Deploy `migrate`, then `bot` and `worker`.

## Rollback

The upgrade changes one manifest file. To roll back the manifest change, restore
the previous manifest from version control. Rolling back the runtime is a normal
application rollback: restore the prior image, prior dependencies, and prior
database dump. Do not run an older binary against a newer schema without checking
the migration.

## Verification

```text
node --test --experimental-strip-types tests/unit/schema.test.ts
node --test --experimental-strip-types tests/unit/spec-v11.test.ts
node --test --experimental-strip-types tests/integration/upgrade.test.ts
```

The schema is described in [BOT_SPEC.md](BOT_SPEC.md). Operational steps are in
[OPERATIONS.md](OPERATIONS.md).
