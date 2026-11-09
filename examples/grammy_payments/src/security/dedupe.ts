import { Redis } from "ioredis";
import type { Context, MiddlewareFn } from "grammy";
import { logger } from "../logger.js";

let client: Redis | undefined;

export function getRedis(redisUrl: string | undefined = process.env.REDIS_URL): Redis | null {
  if (redisUrl === undefined || redisUrl === "") return null;
  if (client === undefined) {
    client = new Redis(redisUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
  }
  return client;
}

export async function claimUpdate(
  updateId: number,
  redisUrl: string | undefined = process.env.REDIS_URL,
): Promise<boolean> {
  const connection = getRedis(redisUrl);
  if (connection === null) {
    logger.warn("REDIS_URL is not set; update deduplication is disabled");
    return true;
  }
  try {
    const result = await connection.set("update:" + String(updateId), "1", "EX", 86400, "NX");
    return result === "OK";
  } catch (error) {
    logger.error(
      { message: error instanceof Error ? error.message : "redis error" },
      "dedupe check failed; stopping update",
    );
    return false;
  }
}

export function dedupeMiddleware(
  redisUrl: string | undefined = process.env.REDIS_URL,
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (await claimUpdate(ctx.update.update_id, redisUrl)) {
      await next();
    }
  };
}
