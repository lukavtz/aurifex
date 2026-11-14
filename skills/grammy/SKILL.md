---
name: grammy
description: Use when building, hardening, or debugging a TypeScript Telegram bot on grammY 1.46 with Node 24. Русские триггеры: grammY, бот на TypeScript, node бот, вебхук grammY, allowed_updates.
---

# grammY 1.46

Target: Node `>=24.9.0`, grammY `1.46.0`, Bot API typed at 10.3. Use the raw API for
10.4-only methods. File layout belongs to `telegram-bot-recipes`; this skill covers
grammY behaviour only.

## Procedure

1. Pin `grammy` to `1.46.0` and `@types/node` to the running Node line; commit the
   lockfile.
2. Validate the environment once at startup, before constructing `Bot`.
3. Create one `Bot`, register handlers, and register a `bot.catch` error handler.
4. Choose exactly one transport: `bot.start({ allowed_updates })` or
   `webhookCallback` plus an out-of-band `setWebhook`.
5. Declare `allowed_updates` explicitly from the handlers that exist, with the cast
   in the section below.
6. Install an API transformer for redaction, retries, or metrics.
7. Wire `SIGTERM`/`SIGINT` to a graceful stop.
8. Run `bun run typecheck && bun test` before deploying.

## Environment

```ts
import { z } from "zod";
const Env = z.object({
  BOT_TOKEN: z.string().min(1),
  WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
  WEBHOOK_URL: z.string().url().startsWith("https://").optional(),
  BOT_MODE: z.enum(["webhook", "polling"]).default("polling"),
});
export const config = Env.parse(process.env);
```

Validate the token by shape at runtime against a real `getMe`, not with a regex
literal that looks like a live token. Never print `config` or the raw request URL.
Log the token only as a redacted identifier.

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

Use `ctx.chat?.id`, `ctx.from?.id`, `ctx.match`, and `ctx.api`. Do not build HTML by
concatenating user input; use `parse_mode: "HTML"` only with escaped values, or
plain text.

## `BOT_INFO`

grammY 1.46 initializes from a compiled `BOT_INFO` constant unless you call
`bot.init()`. When you construct `Bot` yourself, the value must carry a `username`
or initialization fails:

```ts
const bot = new Bot(config.BOT_TOKEN, {
  botInfo: {
    id: 0,
    is_bot: true,
    first_name: "Bot",
    username: "example_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  },
});
```

Missing `can_connect_to_business` or `has_main_web_app` breaks typecheck against
1.46 types. `id` and `first_name` are overwritten by `bot.init()`; the username is
not, so keep it accurate or call `await bot.init()` before serving.

## Polling

```ts
await bot.api.deleteWebhook({ drop_pending_updates: false });
await bot.start({ allowed_updates });
```

`bot.stop()` is safe in a signal handler. Polling allows exactly one consumer. Do
not run polling beside a webhook on the same token. `bot.catch` covers errors from
polling updates; with a webhook it runs only for errors inside the same process
dispatch path, not for delivery failures Telegram sees.

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
  allowed_updates,
  max_connections: 40,
  drop_pending_updates: false,
});
```

Use HTTPS only, on port 443, 80, 88, or 8443.

## `allowed_updates`

List every update type a handler needs. grammY types lag the API here, so assert once:

```ts
import type { AllowedUpdate } from "grammy/types";

const allowed_updates = [
  "message",
  "edited_message",
  "callback_query",
  "inline_query",
  "pre_checkout_query",
  "message_reaction",
  "my_chat_member",
  "widget_query",
  "shared_widget_query",
] as unknown as readonly AllowedUpdate[];

await bot.start({ allowed_updates });
```

`as unknown as` is deliberate: it is the single boundary where a newer update name
enters the typed API. Keep it in one exported constant shared by `setWebhook`,
`deleteWebhook`, and `start`, so the three cannot drift. Omitting the list keeps the
previous value at Telegram and silently drops events.

## API transformer

One signature, no nested function:

```ts
bot.api.config.use((prev, method, payload, signal) => prev(method, payload, signal));
```

The parameters are `prev`, `method`, `payload`, `signal`; the result is a
`Promise<ApiResponse>`. Return `prev(...)` to pass through. Use one transformer for
redaction, retries, or metrics, not one per concern. A transformer that throws
propagates to the caller of the API method.

## Graceful shutdown

```ts
let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log("stopping", signal);
  await bot.stop();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
```

Stop accepting new work, let in-flight handlers finish, close storage, then exit.
Do not `process.exit(0)` in the update handler.

## Raw API for Bot API 10.4

grammY 1.46.0 types cover 10.3. For `sendWidget`, `answerWidgetQuery`, ephemeral
callback replies, rich messages, and TON wallet cards, call the raw transport with a
checked payload:

```ts
type RawCall = (payload: Record<string, unknown>) => Promise<unknown>;
const raw = bot.api.raw as unknown as Record<string, RawCall>;
await raw.sendWidget({ chat_id: ctx.chat.id });
```

Keep the assertion at the boundary and validate the documented fields yourself.
Wrap errors the same way as typed calls. Exact parameters are in
[`telegram-bot-api-104`](../telegram-bot-api-104/SKILL.md).

## Update safety

- Deduplicate by `update_id` with Redis `SET key 1 NX EX 86400`; return early on a
  duplicate. A missing Redis in local mode may fail open, but log a warning. On a
  webhook, a dedupe exception means a 500 and a redelivery; a silent `false` means an
  ACK and a lost update. Choose and test one.
- Apply a per-chat token bucket, about 1 message/second.
- On `429`, read `err.parameters?.retry_after` and sleep before retrying.
- Run admin commands through `isAdmin(ctx.from?.id)`. The check is server-side; a
  hidden keyboard button is not authorization.
- Never keep production state in an in-memory `session`.

## Tests

Use `bot.handleUpdate(update)` with a fake API transport. Assert the API method and
payload, not the button text or count. Add one test that posts a wrong secret to the
webhook handler and asserts 401. Do not call Telegram in unit tests; scenario matrix
lives in `telegram-testing`.

```ts
await bot.handleUpdate({ update_id: 1, message: {/* fixture */} });
```

## Gotchas

- `bot.api.config.use` must return `prev(method, payload, signal)`. A callback that
  returns another function is the wrong shape and fails at runtime.
- Two transformers each calling `prev` send the request twice.
- `bot.catch` does not retry. It logs; delivery retries are Telegram's.
- `deleteWebhook({ drop_pending_updates: true })` loses queued updates. Default to
  `false`.
- Long handlers in webhook mode exceed the timeout; enqueue and return 200.
- `ctx.chat` is optional in grammY types. Guard it; a widget query or inline query
  has no chat.

## Sources

- https://grammy.dev/guide/
- https://grammy.dev/plugins/webhook
- https://grammy.dev/advanced/transformers
- https://github.com/grammyjs/grammY
