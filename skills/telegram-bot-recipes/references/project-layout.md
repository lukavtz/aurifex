# Canonical project layout

**Goal.** One agreed set of files per stack, so the agent, the review, and the
static verifier all look in the same place. The verifier recognises these exact
module paths; a renamed file makes a feature invisible to it.

**Read this when.** Before creating any file, and whenever a new module needs a
home. It is the only file in this skill that enumerates paths.

## Rules

These matter more than the file names:

1. **One entrypoint.** A single process start function loads config, opens the
   database, registers handlers, starts the transport. Nothing else starts the bot.
2. **Handlers are thin.** A handler parses and validates the update, calls one
   service function, and renders the result. No SQL, no HTTP, no long loop.
3. **Business logic in services.** Rules, permission checks, and transaction
   boundaries live in service modules that the handler, the worker, and the
   Mini App backend all call.
4. **All SQL in one place.** The store module owns the connection and the
   queries; the migration owns schema changes. Handlers never build query strings.
5. **Config from the environment only.** Token, owner ids, database URL, webhook
   secret, model keys. Validate required values at startup and fail fast.
6. **Guards registered on the dispatcher.** Dedupe runs before every handler and
   fails closed. A guard file that is never registered is dead weight.
7. **One direction of imports.** Entrypoint to handlers to services to storage.
   A service never imports a handler; storage never imports services.
8. **Optional roles only when enabled.** Queue, worker, payments, and Mini App
   exist only when the confirmed spec enables the feature. A bot without a queue
   does not get an empty queue file; the verifier treats "not configured" as a
   pass.

## grammY / TypeScript

| Role          | Path                              | Purpose                                                                                    |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| entry         | `src/main.ts`                     | Process start: config, storage, handlers, transport. Nothing else starts the bot.          |
| bot           | `src/bot.ts`                      | Bot instance and dispatcher wiring; handlers registered here.                              |
| config        | `src/config.ts`                   | Parses and validates environment values; fails fast on a missing required value.           |
| logger        | `src/logger.ts`                   | Logger setup with secret redaction.                                                        |
| httpServer    | `src/http/server.ts`              | HTTP app: webhook route, Mini App, readiness, metrics.                                     |
| httpHealth    | `src/http/health.ts`              | Liveness and readiness endpoints; readiness checks dependencies.                           |
| httpTelemetry | `src/http/telemetry.ts`           | Metrics endpoint.                                                                          |
| httpSecrets   | `src/http/secrets.ts`             | Loads secret files for the HTTP process.                                                   |
| api104        | `src/telegram/api104.ts`          | Typed raw-adapter wrappers for the 10.4 calls grammY 1.46.0 does not type yet.             |
| dedupe        | `src/guard/dedupe.ts`             | update_id deduplication, fail-closed, registered before handlers.                          |
| store         | `src/store/db.ts`                 | Connection and queries: the only place SQL lives.                                          |
| queue         | `src/job/queue.ts`                | Durable queue: enqueue a job with an idempotency key instead of working inside the update. |
| worker        | `src/job/worker.ts`               | Worker entrypoint: claims jobs, retries with backoff, honours retry_after, shuts down.     |
| payments      | `src/service/payments.ts`         | Invoices, pre-checkout validation, idempotent fulfilment, refunds.                         |
| miniapp       | `src/miniapp/session.ts`          | Validates signed initData and issues the app's own short-lived session.                    |
| migration     | `drizzle/0001_runtime_schema.sql` | First migration: users, jobs, payments, sessions. Forward-only.                            |
| tests         | `tests/`                          | No network, no real token; the transport is faked at the update boundary.                  |
| lockfile      | `bun.lock`                        | Pinned dependency graph, committed; deployment installs from it.                           |

## aiogram / Python

| Role          | Path                                         | Purpose                                                                        |
| ------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| entry         | `app/main.py`                                | Process start: config, pool, dispatcher, transport.                            |
| bot           | `app/bot.py`                                 | Bot and dispatcher construction; routers and middleware registered here.       |
| config        | `app/config.py`                              | Environment parsing and startup validation.                                    |
| logger        | `app/logger.py`                              | Logger setup with secret redaction.                                            |
| httpServer    | `app/http/server.py`                         | HTTP app: webhook route, Mini App, readiness, metrics.                         |
| httpHealth    | `app/http/health.py`                         | Liveness and readiness endpoints.                                              |
| httpTelemetry | `app/http/telemetry.py`                      | Metrics endpoint.                                                              |
| httpSecrets   | `app/http/secrets.py`                        | Loads secret files for the HTTP process.                                       |
| api104        | `app/telegram/api104.py`                     | Raw `bot(method, payload)` wrappers for 10.4.                                  |
| dedupe        | `app/guard/dedupe.py`                        | update_id deduplication as outer middleware, fail-closed.                      |
| store         | `app/store/db.py`                            | Pool and queries: the only place SQL lives.                                    |
| queue         | `app/job/queue.py`                           | Durable queue over a jobs table with an idempotency key.                       |
| worker        | `app/job/worker.py`                          | Worker entrypoint: claims jobs, retries, honours retry_after, closes the pool. |
| payments      | `app/service/payments.py`                    | Invoices, pre-checkout validation, idempotent fulfilment, refunds.             |
| miniapp       | `app/miniapp/session.py`                     | Validates signed initData and issues the app's own session.                    |
| migration     | `migrations/versions/0001_runtime_schema.py` | First revision with the same initial tables.                                   |
| tests         | `tests/`                                     | pytest, no network, no real token.                                             |
| lockfile      | `uv.lock`                                    | Pinned dependency graph, committed.                                            |

The test directory is shared by both stacks and listed once per table.

## Steps

1. Pick the stack's table and create only the roles the confirmed spec enables.
2. Write the entrypoint first; it loads config, opens storage, registers guards
   and handlers, and starts the transport.
3. Add the store and the migration with the tables the enabled features need.
4. Add service modules, then the queue and worker in one change when the feature
   is enabled.
5. Run the verifier and fix anything it reports before adding the next feature.

## Checks

- Every enabled role exists and is imported by the entrypoint or the worker.
- No handler imports storage directly; grep the handler folder for query text.
- The migration runs against an empty database and a second run is a no-op.
- Dependency install succeeds from the committed lockfile with the frozen flag.
- `aurifex verify` reports no layout-related `fail` after the files land.
