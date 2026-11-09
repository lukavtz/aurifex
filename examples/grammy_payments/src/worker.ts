import { createBot } from "./bot.js";
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
    serviceName: config.OTEL_SERVICE_NAME || "grammy_payments",
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
