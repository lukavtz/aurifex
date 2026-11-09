---
name: telegram-bot-api
description: Use when calling the Telegram Bot API directly, handling updates, webhooks, rate limits, or a method newer than the framework supports.
---

# Telegram Bot API

Current API: **10.4** (released 2026-11-09). Target frameworks test **10.3**
(grammY 1.46.0, aiogram 3.31.0). Treat 10.4-only methods as raw API calls, never as
native framework support.

## Endpoint and auth

- Base URL: `https://api.telegram.org/bot<BOT_TOKEN>/<method>`.
- The token is a credential. Read it from the environment, never from source.
- Never log the URL, the token, or the request body that contains it.
- Redact responses before logging. Bot API errors may echo parameters.

## Updates

Two mutually exclusive modes:

| Mode    | Call         | Notes                                                     |
| ------- | ------------ | --------------------------------------------------------- |
| Polling | `getUpdates` | No public HTTPS needed; single consumer only              |
| Webhook | `setWebhook` | Public HTTPS endpoint; Telegram retries failed deliveries |

Rules that prevent duplicate side effects:

1. Send `allowed_updates` explicitly. Do not rely on the full default update set.
2. Persist `update_id` and reject a repeated update before doing work.
3. Run at most one consumer per token. A webhook and `getUpdates` together cause
   `409 Conflict`.
4. `getUpdates` keeps updates for 24 hours. A long outage loses older updates.
5. Make side effects idempotent by a business key, not only by `update_id`.

## Webhook contract

`setWebhook` accepts:

```json
{
  "url": "https://bot.example.com/webhook",
  "secret_token": "<32+ random chars>",
  "allowed_updates": ["message", "callback_query", "pre_checkout_query"],
  "max_connections": 40,
  "drop_pending_updates": false
}
```

- `url` MUST be HTTPS.
- Telegram delivers on ports **443, 80, 88, or 8443** only.
- `secret_token` is 1–256 chars from `[A-Za-z0-9_-]`. Telegram sends it back in
  `X-Telegram-Bot-Api-Secret-Token`.
- Compare the header in constant time. Reject missing or wrong values with 401.
- Do not follow redirects for webhook URLs.
- Telegram retries non-2xx responses. Return 200 quickly and move slow work to a
  queue; keep handler time under 10 seconds where possible.

## Limits and backoff

- `429` includes `parameters.retry_after` in seconds. Sleep that long, then retry.
- Do not retry `400` or `403` without changing the request.
- Practical bulk limit: about 30 messages per second overall; about 1 per second
  per chat. Queue per chat to preserve order.
- Text limit 4096 characters; caption limit 1024. Split long text deliberately.
- `sendChatAction` lasts about 5 seconds.

## Message shape

An `Update` carries exactly one optional payload, for example `message`,
`edited_message`, `callback_query`, `inline_query`, `pre_checkout_query`, or
`message.successful_payment`. Branch on the field, not on text.

Callback data is limited to 64 bytes. Use a short opaque key in callback data and
store state server-side.

## Bot API 10.4 raw-method gap

Bot API 10.4 added first-class surfaces that grammY 1.46.0 and aiogram 3.31.0 do
not type: widgets, ephemeral callback replies, rich-message quotes, TON wallet data,
chat share themes, and `getUniqueGift`. Use each framework's raw transport; never
claim native support.

- **Widgets** — `sendWidget`, `sendSharedWidget`, `answerWidgetQuery`,
  `editMessageWidgetData`, `editSharedWidgetData`; updates `widget_query` and
  `shared_widget_query`. Answer a widget query within 15 seconds.
- **Ephemeral replies** — send `ephemeral_message_parameters` with
  `callback_query_id` to answer a callback privately in any chat except channel
  direct messages chats. Still call `answerCallbackQuery`.
- **Rich quotes** — `TextQuote.rich_texts`, `ReplyParameters.quote_rich_texts`.
- **TON wallet** — `TonWalletCard` on `ChatFullInfo`, `TonWalletTransfer` on
  `Message`, and wallet fields inside `widget_query`.
- **Share themes** — `ChatFullInfo.share_theme`, `getChatShareThemeBackdrops`.
- **Gifts** — `getUniqueGift(name)` returns a `UniqueGift`.

Raw grammY:

```ts
const raw = bot.api.raw as unknown as {
  sendWidget: (payload: Record<string, unknown>) => Promise<unknown>;
};
await raw.sendWidget({ chat_id: ctx.chat.id, html: "<b>hi</b>", allow_queries: true });
```

Raw aiogram:

```python
from aiogram.methods.base import TelegramMethod

class SendWidget(TelegramMethod[dict]):
    __returning__ = dict
    __api_method__ = "sendWidget"
    chat_id: int
    html: str
    allow_queries: bool = True

await bot(SendWidget(chat_id=message.chat.id, html="<b>hi</b>"))
```

Check the official method page before sending fields. If a field is not documented
for 10.4, do not guess it. Widget limits, query types, and exact fields are in
[`telegram-bot-api-104`](../telegram-bot-api-104/SKILL.md).

## Preflight

- `getMe` works and the token is valid.
- `getWebhookInfo` shows the intended URL, no `last_error_message`, and pending
  update count near zero.
- `allowed_updates` matches the handlers that exist.
- Secret-token rejection is covered by a test.
- A planted token is caught by verification.

## Sources

Adapted from Telegram Bot API 10.4 documentation (`core.telegram.org/bots/api`),
`nzhulikov/telegram-bot-skills` (Apache-2.0), `nyxandro/telegram-bot-development-skill`
(MIT), and the official grammY and aiogram repositories. See
`THIRD_PARTY_NOTICES.md`.
