import { createBot } from "./bot.js";
import { getConfig } from "./config.js";
import { registerFeatures } from "./features/index.js";
import { logger } from "./logger.js";
import { initTelemetry, shutdownTelemetry } from "./runtime/telemetry.js";
import { createServer } from "./server.js";
import type { Update } from "grammy/types";

// Bot API 10.4 adds the widget update kinds; grammY 1.46.0 does not type them yet.
type AllowedUpdate = Exclude<keyof Update, "update_id">;
const ALLOWED_UPDATES = [
  "callback_query",
  "chat_member",
  "chosen_inline_result",
  "edited_message",
  "inline_query",
  "message",
  "message_reaction",
  "my_chat_member",
  "poll_answer",
  "pre_checkout_query",
  "shipping_query",
  "shared_widget_query",
  "widget_query",
] as unknown as readonly AllowedUpdate[];

async function main(): Promise<void> {
  const config = getConfig();
  await initTelemetry({
    serviceName: config.OTEL_SERVICE_NAME || "grammY Commands",
    otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
    sentryDsn: config.SENTRY_DSN,
  });
  const bot = createBot();
  await registerFeatures({
    bot,
    sql: null,
    queue: null,
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
          sql: null,
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

  const webhook = await bot.api.getWebhookInfo();
  if (webhook.url !== "") {
    throw new Error("a webhook is configured; clear it explicitly before starting polling");
  }
  await bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
}

main().catch((error: unknown) => {
  logger.error({ message: error instanceof Error ? error.message : "unknown" }, "startup failed");
  process.exitCode = 1;
});
