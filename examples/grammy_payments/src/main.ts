import { createBot } from "./bot.js";
import { getConfig } from "./config.js";
import { registerFeatures } from "./features/index.js";
import { logger } from "./logger.js";
import { createQueue } from "./runtime/queue.js";
import { initTelemetry, shutdownTelemetry } from "./runtime/telemetry.js";
import { userSyncMiddleware } from "./security/user-sync.js";
import { createServer } from "./server.js";
import { closeDb, getDb } from "./storage/db.js";

const ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "inline_query",
  "pre_checkout_query",
  "shipping_query",
  "my_chat_member",
  "chat_member",
] as const;

async function main(): Promise<void> {
  const config = getConfig();
  await initTelemetry({
    serviceName: config.OTEL_SERVICE_NAME || "grammY Payments",
    otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
    sentryDsn: config.SENTRY_DSN,
  });
  const bot = createBot();
  const database = getDb(config.DATABASE_URL);
  if (database === null) {
    throw new Error("DATABASE_URL is required when runtime.queue is postgres");
  }
  bot.use(userSyncMiddleware(database.client));
  const queue = createQueue(database.client, {
    visibilityTimeoutSeconds: config.QUEUE_VISIBILITY_TIMEOUT_SECONDS,
  });
  // One bootstrap run; the handler reschedules itself every six hours.
  await queue.enqueue(
    "payment.reconcile",
    {},
    {
      runAt: new Date(Date.now() + 60_000),
      idempotencyKey: "reconcile:bootstrap",
    },
  );
  await registerFeatures({
    bot,
    sql: database.client,
    queue: queue,
    config,
  });
  await bot.api.setMyCommands([
    { command: "start", description: "Start the bot" },
    { command: "help", description: "Show available commands" },
  ]);

  const server =
    config.BOT_MODE === "webhook"
      ? await createServer(bot, config.WEBHOOK_SECRET, config.BOT_TOKEN, {
          config,
          sql: database.client,
        })
      : undefined;
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    if (server !== undefined) {
      const { promise, resolve } = Promise.withResolvers<void>();
      server.close(() => resolve());
      await promise;
    }
    await bot.stop();
    await closeDb();
    await shutdownTelemetry();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  if (config.BOT_MODE === "webhook") {
    if (config.WEBHOOK_URL === "") {
      throw new Error("WEBHOOK_URL is required in webhook mode");
    }
    await bot.init();
    server?.listen(config.PORT, () =>
      logger.info({ port: config.PORT }, "webhook server listening"),
    );
    await bot.api.setWebhook(config.WEBHOOK_URL, {
      secret_token: config.WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
      max_connections: 40,
      drop_pending_updates: false,
    });
    return;
  }

  await bot.api.deleteWebhook({ drop_pending_updates: false });
  await bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
}

main().catch((error: unknown) => {
  logger.error({ message: error instanceof Error ? error.message : "unknown" }, "startup failed");
  process.exitCode = 1;
});
