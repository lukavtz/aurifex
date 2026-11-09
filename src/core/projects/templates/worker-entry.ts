import type { BotSpec } from "../../spec/bot-spec.ts";

// Worker entrypoints and job loaders. These files only exist in projects with
// `runtime.queue === "postgres"`; the webhook process never runs a job.

export function renderWorkerEntryTs(spec: BotSpec): string {
  return `import { createBot } from "./bot.js";
import { getConfig } from "./config.js";
import { loadJobHandlers } from "./jobs/index.js";
import { logger } from "./logger.js";
import { createQueue } from "./runtime/queue.js";
import { initTelemetry, shutdownTelemetry } from "./runtime/telemetry.js";
import { runWorker } from "./runtime/worker.js";
import { getRedis } from "./security/dedupe.js";
import { closeDb, getDb } from "./storage/db.js";

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const config = getConfig();
  await initTelemetry({
    serviceName: config.OTEL_SERVICE_NAME || "${spec.name}",
    otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
    sentryDsn: config.SENTRY_DSN,
  });

  const database = getDb(config.DATABASE_URL);
  if (database === null) {
    throw new Error("DATABASE_URL is required for the worker");
  }

  const bot = createBot(config);
  const redis = getRedis(config.REDIS_URL);
  const queue = createQueue(database.client, {
    visibilityTimeoutSeconds: config.QUEUE_VISIBILITY_TIMEOUT_SECONDS,
  });
  const handlers = await loadJobHandlers({ bot, sql: database.client, queue, config, redis });

  const controller = new AbortController();
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker shutting down");
    controller.abort();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  let forced = false;
  const { promise: deadline, resolve: drain } = Promise.withResolvers<void>();
  controller.signal.addEventListener(
    "abort",
    () => {
      const timer = setTimeout(() => {
        forced = true;
        drain();
      }, SHUTDOWN_TIMEOUT_MS);
      timer.unref();
    },
    { once: true },
  );

  await Promise.race([runWorker(queue, handlers, controller.signal), deadline]);
  await bot.stop();
  if (redis !== null) {
    await redis.quit();
  }
  if (!forced) {
    await closeDb();
  }
  await shutdownTelemetry();
  if (forced) {
    logger.error("shutdown timed out; exiting");
    process.exit(1);
  }
  logger.info("worker stopped");
}

main().catch((error: unknown) => {
  logger.error({ message: error instanceof Error ? error.message : "unknown" }, "worker failed");
  process.exitCode = 1;
});
`;
}

export function renderJobsIndexTs(): string {
  return `import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Bot } from "grammy";
import type { Sql } from "postgres";
import type { Config } from "../config.js";
import type { ClaimedJob, Queue } from "../runtime/queue.js";
import type { JobHandler } from "../runtime/worker.js";
import type { Redis } from "ioredis";

export interface JobContext {
  bot: Bot;
  sql: Sql;
  queue: Queue;
  config: Config;
  redis: Redis | null;
  signal?: AbortSignal;
}

export interface JobModule {
  kind: string;
  handle(job: ClaimedJob, ctx: JobContext): Promise<void>;
}

function isJobModule(value: unknown): value is JobModule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; handle?: unknown };
  return (
    typeof candidate.kind === "string" &&
    candidate.kind.length > 0 &&
    typeof candidate.handle === "function"
  );
}

// Only compiled siblings are loaded: index.ts is this loader, declarations and
// tests must never become jobs. Sorting keeps the duplicate-kind error stable.
// Dynamic import is required here: job modules are a runtime registry, so their
// specifiers cannot be static.
function isJobFile(entry: string): boolean {
  return (
    entry.endsWith(".js") &&
    entry !== "index.js" &&
    !entry.endsWith(".d.js") &&
    !entry.includes(".test.") &&
    !entry.includes(".spec.")
  );
}

export async function loadJobHandlers(ctx: JobContext): Promise<Record<string, JobHandler>> {
  const directory = import.meta.dirname;
  const entries = (await readdir(directory)).filter(isJobFile).toSorted();
  const handlers: Record<string, JobHandler> = {};
  for (const entry of entries) {
    const module: unknown = await import(pathToFileURL(join(directory, entry)).href);
    if (!isJobModule(module)) {
      throw new Error(
        "invalid job module " + entry + ": expected a string kind and a handle function",
      );
    }
    if (handlers[module.kind] !== undefined) {
      throw new Error("duplicate job kind: " + module.kind);
    }
    handlers[module.kind] = (job, signal) => module.handle(job, { ...ctx, signal });
  }
  return handlers;
}
`;
}

export function renderWorkerEntryPy(spec: BotSpec): string {
  return `from __future__ import annotations

import asyncio
import contextlib
import signal

from app.bot import create_bot, create_redis
from app.config import get_settings
from app.db.session import create_session_factory
from app.jobs import JobContext, load_job_handlers
from app.logger import configure_logging
from app.runtime.queue import Queue
from app.runtime.telemetry import init_telemetry, shutdown_telemetry
from app.runtime.worker import run_worker

SHUTDOWN_TIMEOUT_SECONDS = 30


def _install_signal_handlers(stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for name in ("SIGINT", "SIGTERM"):
        signum = getattr(signal, name)
        try:
            loop.add_signal_handler(signum, stop.set)
        except NotImplementedError:  # Windows event loops
            signal.signal(signum, lambda *_: loop.call_soon_threadsafe(stop.set))


async def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    init_telemetry(
        settings.otel_service_name or "${spec.name}",
        settings.otel_exporter_otlp_endpoint,
        settings.sentry_dsn,
    )

    bot = create_bot(settings)
    redis = create_redis(settings)
    session_factory = create_session_factory(settings.database_url)
    if session_factory is None:
        raise RuntimeError("DATABASE_URL is required for the worker")
    engine = session_factory.kw["bind"]
    queue = Queue(
        session_factory,
        visibility_timeout_seconds=settings.queue_visibility_timeout_seconds,
    )
    ctx = JobContext(
        bot=bot,
        session_factory=session_factory,
        queue=queue,
        settings=settings,
        redis=redis,
    )
    handlers = load_job_handlers(ctx)

    stop = asyncio.Event()
    _install_signal_handlers(stop)

    worker_task = asyncio.create_task(run_worker(queue, handlers, stop))
    stop_task = asyncio.create_task(stop.wait())
    try:
        done, _ = await asyncio.wait(
            {worker_task, stop_task}, return_when=asyncio.FIRST_COMPLETED
        )
        if worker_task in done:
            await worker_task
        else:
            try:
                await asyncio.wait_for(worker_task, timeout=SHUTDOWN_TIMEOUT_SECONDS)
            except TimeoutError:
                worker_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await worker_task
    finally:
        stop_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await stop_task
        await bot.session.close()
        if redis is not None:
            await redis.aclose()
        await engine.dispose()
        shutdown_telemetry()


if __name__ == "__main__":
    asyncio.run(main())
`;
}

export function renderJobsIndexPy(): string {
  return `from __future__ import annotations

import asyncio
import dataclasses
import importlib
import pkgutil
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from aiogram import Bot
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.runtime.queue import ClaimedJob, Queue

JobHandler = Callable[[ClaimedJob, asyncio.Event], Awaitable[None]]


@dataclass(frozen=True)
class JobContext:
    bot: Bot
    session_factory: async_sessionmaker[AsyncSession]
    queue: Queue
    settings: Settings
    redis: Redis | None
    stop: asyncio.Event | None = None


def _bind(handle: Callable[[ClaimedJob, JobContext], Awaitable[None]], ctx: JobContext) -> JobHandler:
    async def handler(job: ClaimedJob, stop: asyncio.Event) -> None:
        await handle(job, dataclasses.replace(ctx, stop=stop))

    return handler


def _job_module_names() -> list[str]:
    package: Any = importlib.import_module(__name__)
    return sorted(
        info.name
        for info in pkgutil.iter_modules(package.__path__)
        if not info.name.startswith("_")
    )


def load_job_handlers(ctx: JobContext) -> dict[str, JobHandler]:
    handlers: dict[str, JobHandler] = {}
    for module_name in _job_module_names():
        module = importlib.import_module(f"{__name__}.{module_name}")
        kind = getattr(module, "KIND", None)
        handle = getattr(module, "handle", None)
        if not isinstance(kind, str) or not kind:
            raise RuntimeError(f"job module {module_name} must define a non-empty KIND")
        if not callable(handle):
            raise RuntimeError(f"job module {module_name} must define handle(job, ctx)")
        if kind in handlers:
            raise RuntimeError(f"duplicate job kind: {kind}")
        handlers[kind] = _bind(handle, ctx)
    return handlers
`;
}
