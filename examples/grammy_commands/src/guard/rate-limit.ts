import type { Context, MiddlewareFn } from "grammy";
import { logger } from "../logger.js";
import { getRedis } from "./dedupe.js";

export async function allowChat(
  chatId: number,
  isGroup: boolean,
  redisUrl: string | undefined = process.env.REDIS_URL,
): Promise<boolean> {
  const connection = getRedis(redisUrl);
  if (connection === null) {
    logger.warn("REDIS_URL is not set; rate limiting is disabled");
    return true;
  }
  const windowMs = isGroup ? 60_000 : 1_000;
  const limit = isGroup ? 20 : 1;
  const bucket = Math.floor(Date.now() / windowMs);
  const key = "rate:" + String(chatId) + ":" + String(windowMs) + ":" + String(bucket);
  try {
    const count = await connection.incr(key);
    if (count === 1) {
      await connection.pexpire(key, windowMs);
    }
    return count <= limit;
  } catch (error) {
    logger.error(
      { message: error instanceof Error ? error.message : "redis error" },
      "rate limit check failed; allowing message",
    );
    return true;
  }
}

export function rateLimitMiddleware(
  redisUrl: string | undefined = process.env.REDIS_URL,
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const chat = ctx.chat;
    if (chat === undefined || (await allowChat(chat.id, chat.type !== "private", redisUrl))) {
      await next();
    }
  };
}
