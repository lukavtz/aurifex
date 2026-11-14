# Canonical project layout

**Goal.** One agreed set of files per stack, so the agent, the review, and the
static verifier all look in the same place. The verifier recognises these exact
module names; a renamed file makes a feature invisible to it.

**Read this when.** Before creating any file, and whenever a new module needs a
home. It is the only file in this skill that enumerates paths.

## Module boundaries

These rules matter more than the file names:

1. **One entrypoint.** A single process start function loads config, opens the
   database, registers handlers, starts the transport. Nothing else starts the bot.
2. **Handlers are thin.** A handler parses and validates the update, calls one
   service function, and renders the result. No SQL, no HTTP, no long loop.
3. **Business logic in services.** Rules, permission checks, and transaction
   boundaries live in service modules that the handler, the worker, and the
   Mini App backend all call.
4. **All SQL in one place.** One module per stack owns queries and migrations
   mapping. Handlers never build query strings.
5. **Config from the environment only.** Token, owner ids, database URL, webhook
   secret, model keys. Validate required values at startup and fail fast.
6. **One direction of imports.** Entrypoint -> handlers -> services -> storage.
   A service never imports a handler; storage never imports services.

Create a module only when the spec enables its feature. A bot without a queue
does not get an empty queue file: the verifier treats "not configured" as a pass,
and an unused module is dead weight.

## Steps

1. Pick the stack's table and create only the modules the confirmed spec enables.
2. Write the entrypoint first; it loads config, opens storage, registers handlers,
   and starts the transport.
3. Add the user-sync path before the first feature so every handler sees a known
   actor.
4. Add the migration with the tables the enabled features need, then the service
   modules that use them.
5. Wire workers and background consumers in the same change that introduces them.
6. Run the verifier and fix anything it reports before adding the next feature.

## grammY / TypeScript

| Path                              | Purpose                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/runtime/queue.ts`            | Durable job queue: `enqueue` and `claim`. Writes a job row with an idempotency key instead of running slow work inside the update handler. |
| `src/worker.ts`                   | Worker entrypoint: claims jobs, runs the registered job handler, retries with backoff, honours `retry_after`, shuts down gracefully.       |
| `src/runtime/payments.ts`         | Invoice creation, pre-checkout validation, idempotent fulfilment keyed by `telegram_payment_charge_id`, refund bookkeeping.                |
| `src/runtime/miniapp-session.ts`  | Server side of the Mini App: validates signed `initData`, issues and stores its own short-lived session.                                   |
| `src/telegram/api104.ts`          | Typed raw-adapter wrappers for the 10.4 calls that grammY 1.46.0 does not type yet.                                                        |
| `drizzle/0001_runtime_schema.sql` | First migration: users, jobs with a unique idempotency key, payments, sessions. Forward-only and re-runnable on an empty database.         |
| `src/security/user-sync.ts`       | Upserts the user from the update, loads roles, applies the allowlist gate. Called from middleware, not from each handler.                  |
| `tests/`                          | Project tests. No network, no real token; the transport is faked at the update boundary.                                                   |
| `bun.lock`                        | Pinned dependency graph. Committed; the deployment installs from it.                                                                       |

## aiogram / Python

| Path                                         | Purpose                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `app/runtime/queue.py`                       | Durable job queue: `enqueue` and `claim` over a jobs table with an idempotency key.                                               |
| `app/worker.py`                              | Worker entrypoint: claims jobs, dispatches to handlers, retries with backoff, honours `retry_after`, closes the pool on shutdown. |
| `app/runtime/payments.py`                    | Invoice creation, pre-checkout validation, idempotent fulfilment keyed by `telegram_payment_charge_id`, refund bookkeeping.       |
| `app/runtime/miniapp_session.py`             | Validates signed `initData` and issues the app's own session.                                                                     |
| `app/services/api104.py`                     | Raw `bot(method, payload)` wrappers for 10.4.                                                                                     |
| `migrations/versions/0001_runtime_schema.py` | First Alembic revision with the same initial tables.                                                                              |
| `app/middlewares/user_sync.py`               | Outer middleware that upserts the user, loads roles, and applies the allowlist before any handler runs.                           |
| `uv.lock`                                    | Pinned dependency graph, committed.                                                                                               |

The test directory is shared by both stacks and listed once above; aiogram tests
use the same name.

## Wiring the modules

grammY: register the user-sync middleware on the bot, the payment handlers on the
bot, and job handlers in the worker. The worker imports services, never the bot
instance.

```ts
export function startWorker(deps: { jobs: JobQueue; handlers: JobHandlers }) {
  process.on("SIGTERM", () => void deps.jobs.stop());
  void deps.jobs.run({
    claim: () => deps.jobs.claim(20),
    handle: (job) => deps.handlers[job.kind](job.payload),
  });
}
```

aiogram: the same split with an outer middleware and a separate worker process.

```python
async def run_worker(jobs: JobQueue, handlers: dict[str, JobHandler]) -> None:
    async for job in jobs.claim(20):
        handler = handlers.get(job.kind)
        if handler is None:
            await jobs.fail(job, "unknown_kind")
            continue
        try:
            await handler(job.payload)
            await jobs.done(job)
        except Exception as exc:  # noqa: BLE001 - worker boundary
            await jobs.retry(job, str(exc))
```

## Checks

- Every module the enabled features need exists and is imported by the
  entrypoint or the worker.
- No handler imports storage directly; grep the handler folder for query text.
- The migration runs against an empty database and a second run is a no-op.
- `bun install --frozen-lockfile` / `uv sync --frozen` succeeds from the committed
  lockfile.
- `aurifex verify` reports no layout-related `fail` after the files land.
