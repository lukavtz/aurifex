import type { BotStack } from "./spec/bot-spec.ts";

/**
 * Role-based project layout for both supported stacks.
 *
 * Every role names one file whose position is fixed for the stack. Callers ask
 * for a role (`LAYOUT[stack].worker`) instead of spelling a path, so a stack can
 * never drift from the contract. `skills/telegram-bot-recipes/references/
 * project-layout.md` mirrors this table and is kept in sync by
 * `tests/unit/layout.test.ts`.
 */
export interface StackLayout {
  /** Process start: loads config, opens storage, registers handlers, starts transport. */
  readonly entry: string;
  /** Bot instance construction and dispatcher wiring. */
  readonly bot: string;
  /** Environment parsing and startup validation. */
  readonly config: string;
  /** Logger construction with secret redaction. */
  readonly logger: string;
  /** HTTP app assembly for webhook, Mini App, readiness, and metrics. */
  readonly httpServer: string;
  /** Liveness/readiness endpoints. */
  readonly httpHealth: string;
  /** `/metrics` endpoint. */
  readonly httpTelemetry: string;
  /** Secret-file loading for the HTTP process. */
  readonly httpSecrets: string;
  /** Typed raw-adapter wrappers for the Bot API 10.4 calls the framework does not type. */
  readonly api104: string;
  /** update_id deduplication, fail-closed. */
  readonly dedupe: string;
  /** Single place that owns the database connection and queries. */
  readonly store: string;
  /** Durable job queue: enqueue and claim. */
  readonly queue: string;
  /** Worker entrypoint: claims jobs, runs handlers, retries, shuts down. */
  readonly worker: string;
  /** Invoice creation, pre-checkout validation, idempotent fulfilment, refunds. */
  readonly payments: string;
  /** Mini App server side: validates initData, issues its own session. */
  readonly miniapp: string;
  /** First migration: users, jobs, payments, sessions. */
  readonly migration: string;
  /** Project tests, faked at the update boundary. */
  readonly tests: string;
  /** Pinned dependency lockfile. */
  readonly lockfile: string;
}

export const LAYOUT: Readonly<Record<BotStack, StackLayout>> = {
  grammy: {
    entry: "src/main.ts",
    bot: "src/bot.ts",
    config: "src/config.ts",
    logger: "src/logger.ts",
    httpServer: "src/http/server.ts",
    httpHealth: "src/http/health.ts",
    httpTelemetry: "src/http/telemetry.ts",
    httpSecrets: "src/http/secrets.ts",
    api104: "src/telegram/api104.ts",
    dedupe: "src/guard/dedupe.ts",
    store: "src/store/db.ts",
    queue: "src/job/queue.ts",
    worker: "src/job/worker.ts",
    payments: "src/service/payments.ts",
    miniapp: "src/miniapp/session.ts",
    migration: "drizzle/0001_runtime_schema.sql",
    tests: "tests/",
    lockfile: "bun.lock",
  },
  aiogram: {
    entry: "app/main.py",
    bot: "app/bot.py",
    config: "app/config.py",
    logger: "app/logger.py",
    httpServer: "app/http/server.py",
    httpHealth: "app/http/health.py",
    httpTelemetry: "app/http/telemetry.py",
    httpSecrets: "app/http/secrets.py",
    api104: "app/telegram/api104.py",
    dedupe: "app/guard/dedupe.py",
    store: "app/store/db.py",
    queue: "app/job/queue.py",
    worker: "app/job/worker.py",
    payments: "app/service/payments.py",
    miniapp: "app/miniapp/session.py",
    migration: "migrations/versions/0001_runtime_schema.py",
    tests: "tests/",
    lockfile: "uv.lock",
  },
};

/** Every path in the layout contract, deduplicated and sorted. */
export function layoutPaths(): readonly string[] {
  const paths = new Set<string>();
  for (const layout of Object.values(LAYOUT)) {
    for (const path of Object.values(layout)) paths.add(path);
  }
  return [...paths].toSorted();
}
