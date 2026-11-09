import { Bot, type Context, type MiddlewareFn } from "grammy";
import { getConfig, type Config } from "./config.js";
import { logger } from "./logger.js";
import { retryAfterMs } from "./security/retry.js";

export interface BotWithSecurity extends Bot {
  readonly securityMiddleware: readonly MiddlewareFn<Context>[];
}

export function createBot(config: Config = getConfig()): BotWithSecurity {
  const bot = new Bot(config.BOT_TOKEN) as BotWithSecurity;
  const security: MiddlewareFn<Context>[] = [];
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
