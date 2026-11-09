---
name: grammy
description: Use when building, hardening, or debugging a TypeScript Telegram bot on grammY 1.46 with Node 24.
---

# grammY 1.46

Target: Node `>=24.9.0`, grammY `1.46.0`, Bot API tested at 10.3. Use the raw API
for 10.4-only methods.

## Project shape

```text
src/config.ts        env validation, no secrets in defaults
src/bot.ts           Bot instance plus feature registration
src/main.ts          mode switch, signals, error handler
src/server.ts        webhook HTTP server, body cap, /healthz
src/features/        one handler module per command
src/security/        allowlist, dedupe, rate limit
tests/               offline transport tests
```

Pin dependencies exactly in `package.json`. Read the token only after validation:

```ts
import { z } from "zod";
const Env = z.object({
  BOT_TOKEN: z.string().regex(/^\d{6,}:[A-Za-z0-9_-]{30,}$/),
  WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  WEBHOOK_URL: z.string().url().startsWith("https://").optional(),
  BOT_MODE: z.enum(["webhook", "polling"]).default("polling"),
});
export const config = Env.parse(process.env);
```

Never print `config` or the raw request URL. Log `BOT_TOKEN` as redacted.

## Bot basics

```ts
import { Bot, GrammyError, HttpError } from "grammy";

const bot = new Bot(config.BOT_TOKEN);

bot.command("start", (ctx) => ctx.reply("Ready."));
bot.command("help", (ctx) => ctx.reply("Commands: /start /help"));
bot.callbackQuery("confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Confirmed.");
});

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error("api", e.error_code, e.method);
  else if (e instanceof HttpError) console.error("network", e.message);
  else console.error("handler", e);
});
```

Use `ctx.chat.id`, `ctx.from?.id`, `ctx.match`, and `ctx.api`. Do not build HTML by
concatenating user input; use `parse_mode: "HTML"` only with escaped values, or
plain text.

## Polling

```ts
await bot.api.deleteWebhook({ drop_pending_updates: true });
await bot.start({ allowed_updates: ["message", "callback_query"] });
```

`bot.stop()` is safe in a signal handler. Polling allows exactly one consumer.
Do not run polling beside a webhook on the same token.

## Webhook

```ts
import { webhookCallback } from "grammy";

const handle = webhookCallback(bot, "http", {
  secretToken: config.WEBHOOK_SECRET,
  timeoutMilliseconds: 9000,
  onTimeout: "return",
});
```

The `secretToken` option is mandatory. It makes grammY check
`X-Telegram-Bot-Api-Secret-Token` before dispatch. The Node adapter reads the raw
request body; do not add a JSON parser in front of it.

Server essentials:

- cap request bodies at 1 MiB;
- answer `/healthz` with 200 and no secrets;
- return 401 for a missing or wrong secret;
- return 200 after enqueueing slow work, not after the work finishes;
- `bot.init()` before serving if you start the bot manually instead of `bot.start()`.

Register the webhook out of band:

```ts
await bot.api.setWebhook(config.WEBHOOK_URL, {
  secret_token: config.WEBHOOK_SECRET,
  allowed_updates: ["message", "callback_query", "pre_checkout_query"],
  max_connections: 40,
  drop_pending_updates: false,
});
```

Use HTTPS only, on port 443, 80, 88, or 8443.

## Raw API for Bot API 10.4

grammY 1.46.0 types cover 10.3. For `sendWidget`, `answerWidgetQuery`, ephemeral
callback replies, rich-message quotes, and TON wallet cards, call the raw
transport with a checked payload:

```ts
type RawCall = (payload: Record<string, unknown>) => Promise<unknown>;
const raw = bot.api.raw as unknown as Record<string, RawCall>;
await raw.sendWidget({ chat_id: ctx.chat.id });
```

Keep the assertion at the boundary and validate the documented fields yourself.
Wrap errors the same way as typed calls.

## Update safety

- Deduplicate by `update_id` with Redis `SET key 1 NX EX 86400`; return early on a
  duplicate. A missing Redis in local mode may fail open, but log a warning.
- Apply a per-chat token bucket, about 1 message/second.
- On `429`, read `err.parameters?.retry_after` and sleep before retrying.
- Run admin commands through `isAdmin(ctx.from?.id)`. The check is server-side; a
  hidden keyboard button is not authorization.
- Never keep production state in an in-memory `session`.

## Tests

Use `bot.handleUpdate(update)` with a fake API transport. Assert the reply text and
the API method called. Add one test that posts a wrong secret to the webhook handler
and asserts 401. Do not call Telegram in unit tests.

```ts
await bot.handleUpdate({ update_id: 1, message: {/* fixture */} });
```

Run `bun run typecheck && bun test` in the generated project.

## Sources

Adapted from the official grammY repository and documentation
(`github.com/grammyjs/grammY`, MIT), `nzhulikov/telegram-bot-skills` (Apache-2.0),
and `nyxandro/telegram-bot-development-skill` (MIT). See `THIRD_PARTY_NOTICES.md`.
