import type { Bot, Context, MiddlewareFn } from "grammy";
import type { Sql } from "postgres";

const MAX_USERNAME = 32;
const MAX_DISPLAY_NAME = 64;

const USER_UPSERT_SQL =
  "INSERT INTO users (id, username, display_name) VALUES ($1, $2, $3) " +
  "ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, " +
  "display_name = EXCLUDED.display_name, updated_at = now();";

export interface UserSyncDeps {
  readonly sql: Sql;
}

export function userSyncMiddleware(sql: Sql): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const from = ctx.from;
    if (from !== undefined && from.id > 0) {
      const username = from.username === undefined ? null : from.username.slice(0, MAX_USERNAME);
      const displayName = [from.first_name, from.last_name]
        .filter(Boolean)
        .join(" ")
        .slice(0, MAX_DISPLAY_NAME);
      await sql.unsafe(USER_UPSERT_SQL, [from.id, username, displayName]);
    }
    await next();
  };
}

export function register(bot: Bot, deps: UserSyncDeps): void {
  bot.use(userSyncMiddleware(deps.sql));
}
