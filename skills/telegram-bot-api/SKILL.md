---
name: telegram-bot-api
description: Use when calling the Telegram Bot API directly, handling updates, webhooks, rate limits, text escaping, or a method newer than the installed SDK supports. Русские триггеры: Bot API, лимиты телеграма, вебхук телеграма, экранирование текста, ошибка 429.
---

# Telegram Bot API

Current API: **10.4** (released 2026-11-09). Target frameworks test **10.3**
(grammY 1.46.0, aiogram 3.31.0). Treat 10.4-only methods as raw API calls, never as
native framework support.

## Procedure

1. Open the method page on `core.telegram.org/bots/api` before writing the call.
   Absence from a summary page is not proof that a parameter does not exist; check
   the changelog too. `telegram-bot-sources` owns the retrieval procedure.
2. Decide the transport once: `getUpdates` or `setWebhook`, never both.
3. Build the payload with the smallest set of documented fields. Do not invent
   fields; unknown fields are ignored or rejected, and both cases hide the bug.
4. Escape inserted values with `tg_text.py` (below), then check the payload shape
   offline with `telegram_payload.py` before a real send.
5. Send, then branch on the error: retry only `429` (after `retry_after`) and
   network errors; `400` and `403` need a changed request.
6. Record `update_id` and any business key before side effects, so a redelivery
   cannot repeat work.

## Endpoint and auth

- Base URL: `https://api.telegram.org/bot<BOT_TOKEN>/<method>`.
- The token is a credential. Read it from the environment, never from source.
- Never log the URL, the token, or a request body that contains it.
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

## Limits

Units matter. "Characters" means after entity parsing; byte limits are UTF-8.

| Surface                      | Limit                                                           |
| ---------------------------- | --------------------------------------------------------------- |
| Message text                 | 4096 characters                                                 |
| Media caption                | 1024 characters                                                 |
| Rich message                 | 32768 bytes; 500 blocks; nesting depth 16; 50 media; 20 columns |
| `callback_data`              | 1–64 bytes                                                      |
| `answerCallbackQuery.text`   | 200 characters                                                  |
| Command name                 | 1–32 characters                                                 |
| `setMyCommands`              | ≤100 commands per scope                                         |
| Deep-link payload            | 64 characters                                                   |
| Inline query results         | 50 per answer; `next_offset` ≤64 bytes                          |
| Media album                  | 2–10 items                                                      |
| Upload                       | 50 MB per file; 10 MB per photo                                 |
| `getFile` download           | 20 MB                                                           |
| `getUpdates.limit`           | 1–100                                                           |
| Server-side update retention | ≤24 hours                                                       |
| Webhook ports                | 443, 80, 88, 8443                                               |
| `max_connections`            | 1–100                                                           |
| `secret_token`               | 1–256 characters                                                |
| Throughput (rough)           | 1/second per chat; 20/minute per group; 30/second for broadcast |
| `sendChatAction` effect      | 5 seconds                                                       |
| Ephemeral message lifetime   | 15 seconds to reply                                             |
| `pre_checkout_query` answer  | 10 seconds                                                      |
| `deleteMessage` window       | 48 hours                                                        |
| Mini App `sendData`          | 4096 bytes                                                      |
| CloudStorage                 | 1024 keys; 4096 characters per value                            |

Widget payloads have their own limits (`html` 32768 bytes raw, 4096 bytes after zlib
level 9); see `telegram-bot-api-104`.

## Text and payload helpers

Two stdlib-only scripts ship with this skill. They never touch the network.

`python3 skills/telegram-bot-api/scripts/tg_text.py`:

- `escape-html` — escape `&`, `<`, `>` for `parse_mode=HTML`.
- `escape-html-attr` — escape a value used inside an attribute (`"` too).
- `escape-mdv2 --context text|code|url` — MarkdownV2 escaping per context.
- `length` — visible length in UTF-16 code units (emoji outside the BMP count 2).
- `split --html --limit 4096 --json` — split into chunks, closing and reopening
  balanced HTML tags at chunk boundaries.
- `neutralize-markdown-html` — make model output safe to show as plain text.

Input comes from stdin or `--file`. Escape inserted values only, then place them in
a finished template.

`python3 skills/telegram-bot-api/scripts/telegram_payload.py`:

```bash
python3 skills/telegram-bot-api/scripts/telegram_payload.py \
  --method sendMessage --file request.json --json
```

Validates request shapes for seven methods: `sendMessage`, `sendRichMessage`,
`editMessageText`, `editEphemeralMessageText`, `answerCallbackQuery`,
`sendMessageDraft`, `sendRichMessageDraft`. Exit codes: 0 clean, 1 findings, 2
invocation or JSON failure. It catches length, byte, and markup-shape errors offline;
the server parser remains authoritative.

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

Exact 10.4 fields, including the empty-parameter methods, are in
[`telegram-bot-api-104`](../telegram-bot-api-104/SKILL.md).

## Gotchas

- `429` carries `parameters.retry_after` in seconds. Sleeping a fixed backoff
  instead still gets the next call rejected.
- Retrying `400` or `403` without changing the request burns the rate limit and
  never succeeds.
- A 200 response means "accepted", not "the user saw it". A blocked bot returns
  `403` on send.
- `getUpdates` with an offset acknowledges everything below it. Advancing the
  offset before the work commits loses updates on a crash.
- `drop_pending_updates=true` discards queued updates, including paid ones. It is
  not a startup step.
- Redelivery is normal: webhook retries, `getUpdates` re-fetch, and user double
  taps are all real. Deduplicate before side effects.
- `parse_mode` applies to the whole text. One unescaped `<` from user input breaks
  the send with `400 can't parse entities`.
- Length is counted in UTF-16 units, so an emoji outside the BMP costs 2. Measure
  with `tg_text.py length`, not `len()`.

## Sources

- https://core.telegram.org/bots/api
- https://core.telegram.org/bots/api-changelog
- https://core.telegram.org/bots/webhooks
- https://core.telegram.org/bots/faq
