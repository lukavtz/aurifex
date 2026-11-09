---
name: telegram-bot-api-104
description: Use when implementing Bot API 10.4 widgets, ephemeral replies, rich-message quotes, TON wallet data, chat share themes, or getUniqueGift on a 10.3-only framework.
---

# Bot API 10.4 first-class surfaces

Bot API 10.4 shipped on 2026-11-09. grammY 1.46.0 and aiogram 3.31.0 still advertise
10.3, so every 10.4 call goes through a raw adapter. Verify each field against
`https://core.telegram.org/bots/api` before use; do not trust this summary for a
method added later.

## Widgets

A widget is one HTML document with inline CSS and JS, sent as a message. It has no
network, no window, and no server. The bot changes state through widget data.

| Method                  | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `sendWidget`            | Send `html` to a chat                              |
| `sendSharedWidget`      | Send an existing shared widget by `widget_id`      |
| `answerWidgetQuery`     | Answer `widget_query` or `shared_widget_query`     |
| `editMessageWidgetData` | Change `chat_data` or `public_data` of one message |
| `editSharedWidgetData`  | Change `public_data` of a shared widget everywhere |

### `sendWidget` contract

- `chat_id` is required. `message_thread_id` is optional.
- `html` is required, 1–32768 bytes. It MUST also be at most 4096 bytes after zlib
  compression at the maximum level, or the call fails.
- `width` is optional, clamped to 200 through the bubble maximum.
- `height` is optional, clamped to 50–600.
- `public_data` and `chat_data` are each 0–1024 bytes. `chat_data` belongs to one
  message; `public_data` is shared wherever the widget is shown.
- `caption` is 0–1024 characters after entity parsing.
- `allow_queries` must be `true` for the widget to send queries.
- `is_shared` creates a shared widget that `sendSharedWidget` can post again.

Production limits:

- Widgets can be sent only to **private chats**. Inline-query widgets are not
  enabled in production.
- Sent widgets automatically have protected content. They cannot be forwarded.
  `copyMessage` and `copyMessages` refuse widget messages.
- Client layers below 233 show an unsupported-media stub. Write a caption that
  makes sense without the widget.
- `can_send_other_messages` now also permits widgets in groups.

### Queries

`Update` carries `widget_query` for a widget sent by the bot or via the bot, and
`shared_widget_query` for a forwarded shared widget.

`WidgetQuery` fields: `id`, `from`, optional `chat`, `message_id`,
`inline_message_id`, `chat_instance`, optional `chat_type`, `type`, `data` (1–64
bytes), and optional `widget_id`.

`WidgetQueryType` is one of:

| `type`             | Extra fields           | Meaning                              |
| ------------------ | ---------------------- | ------------------------------------ |
| `data`             | optional `wallet_card` | Data for the bot                     |
| `sign_data`        | `wallet`, `sign_data`  | Data signed for domain `bot<bot_id>` |
| `sent_transaction` | `wallet`, `msg_hash`   | A TON transaction was sent           |

`WidgetQueryWallet` has `address`, `amount`, optional `public_key`, and optional
`state_init`. A user may send at most 5 widget queries per 5 seconds across all
widgets.

Answer within **15 seconds** with `answerWidgetQuery`:

```json
{ "widget_query_id": "<query id>", "data": "<0-1024 byte answer>" }
```

The answer goes only to the widget that asked. It does not change widget data; call
`editMessageWidgetData` or `editSharedWidgetData` for that.

`editMessageWidgetData` selects a message with `chat_id` plus `message_id`, or with
`inline_message_id`, then changes `public_data` and/or `chat_data`. `editSharedWidgetData`
requires `widget_id` and `public_data`, with optional `cache_time` from 5 to 3600
seconds. Shared public data can change at most once per second.

## Ephemeral callback replies

Add `ephemeral_message_parameters` to `sendMessage`, `sendRichMessage`,
`sendAnimation`, `sendAudio`, `sendContact`, `sendDocument`, `sendLivePhoto`,
`sendLocation`, `sendPhoto`, `sendSticker`, `sendVenue`, `sendVideo`,
`sendVideoNote`, or `sendVoice`.

`EphemeralMessageParameters`:

- `callback_query_id` — the callback that triggered the reply.
- `receiver_user_id` — optional. If omitted with `callback_query_id`, the message is
  visible only to the user who pressed the button.
- `replace_callback_query_message` — show the ephemeral message in place of the
  original. Must be false for callbacks from ephemeral messages.

`chat_id` becomes optional for those send methods. Ephemeral replies work in any
chat except channel direct messages chats. The bot MUST still call
`answerCallbackQuery`; the ephemeral message does not acknowledge the callback.

Reply to an ephemeral message with `reply_parameters.ephemeral_message_id` within
15 seconds. The reply must itself be ephemeral. Use the `editEphemeralMessage*`
family for edits.

## Quotes from rich messages

`TextQuote` gains `rich_texts`, an array of `RichText`. `text` may be empty when the
quote came from a rich message. `position` then indexes the joined plain texts of
quotable texts, separated by line feeds.

`ReplyParameters` gains `quote_rich_texts`, one element per quoted text in order.
Allowed rich text types are plain text, bold, italic, underline, strikethrough,
spoiler, subscript, superscript, date-time, custom emoji, mathematical expression,
and arrays of them.

Plain `quote` stays 0–1024 characters and must be an exact substring. Send either the
plain quote fields or the rich quote fields, not a mix that disagrees.

## TON wallet, share themes, gifts

- `ChatFullInfo.ton_wallet_card` exposes `address`, `amount` (decimal string in
  smallest units), `stickers`, and optional `background_nft_address`.
- `Message.ton_wallet_transfer` exposes `transaction_id`, `peer_address`, `amount`
  (negative for outgoing), and optional `comment`. Never parse money strings into
  floats.
- `ChatFullInfo.share_theme` is `ChatShareThemeEmoji` (`emojis`, optional
  `background_backdrop_id`) or `ChatShareThemeUniqueGift` (`gift`).
  `getChatShareThemeBackdrops` returns valid backdrop ids.
- `getUniqueGift({ name })` returns a `UniqueGift`: `gift_id`, `base_name`, `name`,
  `number`, `model`, `symbol`, `backdrop`, optional `is_premium`, `is_burned`,
  `is_from_blockchain`, `colors`, `publisher_chat`.

Exact fields for these objects are in [`references/methods-104.md`](references/methods-104.md).

## Raw adapters

grammY 1.46.0 types 10.3 only. The `raw` proxy accepts an unknown method at runtime,
but the type system rejects it. Assert at one boundary:

```ts
type RawCall = (payload: Record<string, unknown>) => Promise<unknown>;
const raw = bot.api.raw as unknown as Record<string, RawCall>;

const sendWidget = raw.sendWidget;
if (!sendWidget) throw new Error("sendWidget unavailable");
await sendWidget({ chat_id: ctx.chat.id, html, allow_queries: true });
```

aiogram 3.31.0 needs a `TelegramMethod` subclass:

```python
from aiogram.methods.base import TelegramMethod

class AnswerWidgetQuery(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "answerWidgetQuery"
    widget_query_id: str
    data: str | None = None

await bot(AnswerWidgetQuery(widget_query_id=query.id, data="ok"))
```

Wrap these adapters in one module, validate the documented fields, and cover the
error path. Keep the raw call out of handlers so a framework upgrade is a one-file
change.

## Tests and preflight

- Measure widget HTML: raw bytes ≤ 32768 and zlib level 9 bytes ≤ 4096.
- Send a widget only to a private test chat; test a query answered after 16 seconds.
- Test ephemeral reply visibility with two users in one group.
- Test rich quote round-trip and a plain quote that is not a substring.
- Confirm `getUniqueGift` rejects an unknown name.

## Sources

Adapted from Telegram Bot API 10.4 documentation (`core.telegram.org/bots/api`),
`nzhulikov/telegram-bot-skills` (Apache-2.0), `serejaris/telegram-skills` (MIT), and
the official grammY and aiogram repositories. See `THIRD_PARTY_NOTICES.md`.
