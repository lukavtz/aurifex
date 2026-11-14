# Bot API 10.4 surfaces in bot code

**Goal.** Use the 10.4 features from a 10.3-only SDK without inventing fields, and
wire them into handlers that already exist.

**Read this when.** The spec asks for interactive widgets, rich messages, ephemeral
replies, TON wallet cards, chat share themes, or unique gifts.

The full method and object tables live in `../../telegram-bot-api-104/SKILL.md` and
its `references/methods-104.md`. This file is the wiring: what to call, from where,
and what to validate.

## Steps

1. Put every 10.4 call behind one adapter module per stack; handlers import it and
   never call a raw method directly.
2. Validate the documented limits of the payload before the call: bytes for widget
   HTML, characters for rich text and captions, shape for wallet data.
3. Add the new update types (`widget_query`, `shared_widget_query`) to
   `allowed_updates`. Without that, the feature is silent.
4. Answer widget queries quickly; the client waits no longer than 15 seconds.
5. Keep the ephemeral path optional with a normal-message fallback.

## Version boundary

Bot API 10.4 shipped on 2026-11-09. grammY 1.46.0 and aiogram 3.31.0 are typed up
to 10.3 only. A 10.4 call therefore goes through a typed raw adapter in one module,
never scattered through handlers:

- TypeScript: assert the `raw` proxy once to a `Record<string, RawCall>` and export
  named wrappers.
- Python: one `TelegramMethod` subclass per method, exported from `api104`.

If an SDK upgrade adds the method, delete the wrapper and keep the call sites.

## Widgets

A widget is an HTML document with inline CSS and JS, rendered by Telegram. It has
no network and no window. State moves through widget data.

| Call                    | Required                   | Purpose                         |
| ----------------------- | -------------------------- | ------------------------------- |
| `sendWidget`            | `chat_id`, `html`          | New widget message              |
| `sendSharedWidget`      | `chat_id`, `widget_id`     | Reuse an existing shared widget |
| `answerWidgetQuery`     | `widget_query_id`          | Reply to an interaction         |
| `editMessageWidgetData` | message reference          | Change data of one message      |
| `editSharedWidgetData`  | `widget_id`, `public_data` | Change data of a shared widget  |

Validate before sending: `html` 1–32768 bytes and at most 4096 bytes after zlib at
maximum level, `public_data` and `chat_data` at most 1024 bytes each, caption at
most 1024 characters. Answer a widget query within 15 seconds; `data` is at most
1024 bytes.

```ts
export type RawCall = (payload: Record<string, unknown>) => Promise<unknown>;
const raw = bot.api.raw as unknown as Record<string, RawCall>;

export async function sendWidget(chatId: number, html: string, allowQueries = true) {
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes < 1 || bytes > 32768) throw new Error(`widget html is ${bytes} bytes`);
  if (zlib.deflateSync(html, { level: 9 }).byteLength > 4096) {
    throw new Error("widget html does not compress under 4096 bytes");
  }
  if (!raw.sendWidget) throw new Error("sendWidget unavailable");
  return raw.sendWidget({ chat_id: chatId, html, allow_queries: allowQueries });
}
```

```python
import zlib
from aiogram.methods.base import TelegramMethod

class SendWidget(TelegramMethod[dict]):
    __returning__ = dict
    __api_method__ = "sendWidget"
    chat_id: int
    html: str
    allow_queries: bool | None = None

class AnswerWidgetQuery(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "answerWidgetQuery"
    widget_query_id: str
    data: str | None = None

def check_widget_html(html: str) -> None:
    raw = html.encode()
    if not 1 <= len(raw) <= 32768:
        raise ValueError(f"widget html is {len(raw)} bytes")
    if len(zlib.compress(raw, 9)) > 4096:
        raise ValueError("widget html does not compress under 4096 bytes")
```

Widget queries arrive as **top-level update types**, not inside a message:

Neither SDK models this update type at 10.3, so intercept it before the typed
dispatch. In grammY, a middleware that inspects the raw update:

```ts
type WidgetQuery = { id: string; from: { id: number }; type: string; data: string };
type WidgetUpdate = { widget_query?: WidgetQuery; shared_widget_query?: WidgetQuery };

bot.use(async (ctx, next) => {
  const update = ctx.update as unknown as WidgetUpdate;
  const query = update.widget_query ?? update.shared_widget_query;
  if (query === undefined) return next();
  const answer = await widgets.handle(query.type, query.data, query.from.id);
  await raw.answerWidgetQuery!({ widget_query_id: query.id, data: answer });
});
```

In aiogram, inspect the raw request body before `feed_update` builds a typed
`Update`:

```python
from aiogram.types import Update

async def webhook(request: Request, bot: Bot, dp: Dispatcher, widgets: Widgets) -> Response:
    payload = await request.json()
    query = payload.get("widget_query") or payload.get("shared_widget_query")
    if query is not None:
        answer = await widgets.handle(query["type"], query["data"], query["from"]["id"])
        await bot(AnswerWidgetQuery(widget_query_id=query["id"], data=answer))
        return Response(status_code=204)
    await dp.feed_update(bot, Update.model_validate(payload))
    return Response(status_code=204)
```

If you use polling instead of a webhook, filter the same field in a custom
`getUpdates` loop; do not invent a typed router filter for an update type the SDK
does not know.

`shared_widget_query` is a separate update type with `id`, `from`, `type`, `data`,
`widget_id`. Register both types in `allowed_updates`; otherwise the events never
arrive.

Treat widget `data` as untrusted: it can be any string of at most 64 bytes from the
page. The actor is `query.from.id`, the authority is your database.

## Rich messages

`sendRichMessage` carries a `rich_message` object; `sendRichMessageDraft` previews
one. Rich content supports up to 32768 characters, plus block limits (500 blocks,
16 levels of nesting, 50 media items, 20 columns) that are documented in
`../../telegram-bot-api/SKILL.md`.

- Drafts are allowed in private chats only.
- Never trust raw HTML inside a rich message. Build the structure from your own
  template and escape text nodes.
- Quote fields differ between plain and rich quotes; send one family, not a mix.

```ts
await raw.sendRichMessage!({
  chat_id: ctx.chat.id,
  rich_message: { blocks: [{ type: "paragraph", text: escapeRich(finalText) }] },
});
```

```python
class SendRichMessage(TelegramMethod[dict]):
    __returning__ = dict
    __api_method__ = "sendRichMessage"
    chat_id: int
    rich_message: dict

await bot(SendRichMessage(chat_id=message.chat.id,
                          rich_message={"blocks": [{"type": "paragraph", "text": escape_rich(final_text)}]}))
```

## Ephemeral messages

`sendMessage` gains `ephemeral_message_parameters`. The message is visible only to
the addressed user and disappears after 15 seconds. `receiver_user_id` is required
except when answering a callback, where `callback_query_id` identifies the
recipient; `replace_callback_query_message` shows it in place of the original.

```ts
await ctx.api.raw.sendMessage({
  chat_id: ctx.chat.id,
  text: "Это видно только вам.",
  ephemeral_message_parameters: { receiver_user_id: ctx.from.id },
});
```

```python
class SendEphemeral(TelegramMethod[dict]):
    __returning__ = dict
    __api_method__ = "sendMessage"
    chat_id: int
    text: str
    ephemeral_message_parameters: dict

await bot(SendEphemeral(chat_id=message.chat.id, text="Это видно только вам.",
                        ephemeral_message_parameters={"receiver_user_id": message.from_user.id}))
```

Never put the only copy of a confirmation there: 15 seconds is shorter than a user
reading a paragraph. Fall back to a normal message or a private deep link.

## TON wallet data

`ChatFullInfo.ton_wallet_card` exposes `address`, `amount` (decimal string in the
smallest units), `stickers`, and an optional `background_nft_address`.
`Message.ton_wallet_transfer` exposes `transaction_id`, `peer_address`, `amount`
(negative for outgoing), and an optional `comment`.

- Amounts are decimal strings. Parse to an integer type with decimals; never to a
  float, never with `Number()` on money if precision matters.
- Wallet data is display and verification input, not proof of payment. A transfer
  is settled only by your own ledger rule.
- Wallet query types on a widget (`data`, `sign_data`, `sent_transaction`) come in
  the widget query payload; validate the shape and reject unknown types.

```ts
const amountMinor = BigInt(wallet.amount); // decimal string, smallest units
const formatted = formatMinor(amountMinor, walletDecimals);
```

```python
from decimal import Decimal

amount_minor = int(wallet.amount)  # decimal string, smallest units
formatted = format_minor(amount_minor, wallet_decimals)
```

## Chat share themes

`getChatShareThemeBackdrops` takes no parameters and returns valid backdrop ids for
`ChatShareThemeEmoji`. Validate an id against that list before storing it; do not
accept an arbitrary id from a user.

```ts
const backdrops = (await raw.getChatShareThemeBackdrops!({})) as {
  backdrops: { id: string; name: string }[];
};
if (!backdrops.backdrops.some((item) => item.id === chosenId)) {
  throw new Error("unknown backdrop");
}
```

```python
class GetChatShareThemeBackdrops(TelegramMethod[dict]):
    __returning__ = dict
    __api_method__ = "getChatShareThemeBackdrops"

result = await bot(GetChatShareThemeBackdrops())
valid_ids = {item["id"] for item in result["backdrops"]}
```

## Unique gifts

`getUniqueGift({ name })` returns a `UniqueGift`. `deleteBusinessAccountGift`
requires `business_connection_id`, `owned_gift_id`, and the
`can_convert_gifts_to_stars` right on the business connection.

```ts
const gift = await raw.getUniqueGift!({ name: giftName });
await raw.deleteBusinessAccountGift!({
  business_connection_id: connectionId,
  owned_gift_id: gift.gift_id,
});
```

```python
class GetUniqueGift(TelegramMethod[dict]):
    __returning__ = dict
    __api_method__ = "getUniqueGift"
    name: str

gift = await bot(GetUniqueGift(name=gift_name))
```

Gift names come from users and links. Bound the length, reject control characters,
and treat a missing gift as a normal empty result, not an exception page.

## Checks

- Serialising a widget with `html` over 32768 bytes or over 4096 compressed bytes
  fails before the API call.
- A `widget_query` handler answers within 15 seconds and sets `allowed_updates` to
  include `widget_query` and `shared_widget_query`.
- An ephemeral call from a group renders for the addressed user only, and the
  fallback path sends a normal message.
- Rich message text over 32768 characters is split or rejected by the test.
- Money strings are parsed without floating point.
- An unknown backdrop id and an unknown gift name produce typed errors.
- The wrapper module is the only place in the codebase that references 10.4
  methods, so an SDK upgrade touches one file.
