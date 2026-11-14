import { Bot, type Context, type MiddlewareFn } from "grammy";
import { getConfig, type Config } from "./config.js";
import { logger } from "./logger.js";
import { dedupeMiddleware } from "./security/dedupe.js";
import { rateLimitMiddleware } from "./security/rate-limit.js";
import { callbackAckMiddleware } from "./security/callback-ack.js";
import { retryAfterMs } from "./security/retry.js";

export interface BotWithSecurity extends Bot {
  readonly securityMiddleware: readonly MiddlewareFn<Context>[];
}

export function createBot(config: Config = getConfig()): BotWithSecurity {
  const bot = new Bot(config.BOT_TOKEN) as BotWithSecurity;
  // Answers a callback query when its handler fails before replying; registered
  // before every feature so any handler that throws still stops the spinner.
  bot.use(callbackAckMiddleware());
  const security: MiddlewareFn<Context>[] = [];
  security.push(dedupeMiddleware(config.REDIS_URL));
  security.push(rateLimitMiddleware(config.REDIS_URL));
  for (const middleware of security) {
    bot.use(middleware);
  }
  bot.catch((error) => {
    const cause = error.error;
    logger.error(
      {
        updateId: error.ctx.update.update_id,
        message: cause instanceof Error ? cause.message : "unknown error",
        retryAfterMs: retryAfterMs(cause),
      },
      "bot update failed",
    );
  });
  return Object.assign(bot, { securityMiddleware: security });
}
