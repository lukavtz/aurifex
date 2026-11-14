# Inline buttons and callbacks

**Goal.** A keyboard where every press is cheap to acknowledge, safe to repeat,
and never carries authority.

**Read this when.** The spec asks for inline buttons, callback handling, card
actions, pagination, confirmation dialogs, or URL / Mini App buttons.

## Rules that decide the design

- **`callback_data` is 1–64 bytes of UTF-8**, not 64 characters. Measure the
  encoded length; a Cyrillic or emoji payload overflows far earlier than a Latin
  one. Prefer structured short ids: `action:object_id:version`.
- **Acknowledge immediately.** Call `answerCallbackQuery` before any database
  work, network call, or model call. Without an acknowledgement the client spins
  until it times out. The acknowledgement means "press received", not "operation
  succeeded".
- **Old buttons are untrusted.** A message can survive for months and a keyboard
  can be forwarded. Re-read the object and its state, then re-render the current
  card. Never act on the assumption that the button was still valid.
- **No entitlements in the payload.** Roles, prices, user ids, and permissions
  come from storage on every press. The payload only names an action and an
  object; authorization is resolved from the update actor.
- **One action per button.** A button either opens a URL, launches a Mini App,
  or sends a callback. Do not expect a URL button to produce a callback.

## Steps

1. Choose the button type from the table below: callback for an action over an
   object, URL for an external page, Mini App for a real form.
2. Build the payload as `action:object_id:version` and assert 1–64 encoded bytes
   while constructing the keyboard, not when the press arrives.
3. Answer the callback first, then load the object and check permissions.
4. Apply the transition inside one transaction with a version check.
5. Re-render the card from the database on success, on a stale press, and on a
   refusal.

## Button types

| Type          | Field                 | Behaviour                            | Use for                                       |
| ------------- | --------------------- | ------------------------------------ | --------------------------------------------- |
| Callback      | `callback_data`       | Sends `callback_query` to the bot    | Actions over a card, navigation, confirmation |
| URL           | `url`                 | Opens a link in the client           | External pages, deep links into another chat  |
| Mini App      | `web_app`             | Opens an HTTPS page inside Telegram  | Long forms, calendars, catalogs               |
| Switch inline | `switch_inline_query` | Opens inline mode in the chosen chat | Sharing a result                              |
| Pay           | `pay`                 | Starts a Stars payment               | Checkout button                               |

Limits and formatting: `../../telegram-bot-api/SKILL.md`. Ten-button rows and
unreadable captions are a UI decision, not an API one.

## grammY / TypeScript

```ts
import { InlineKeyboard } from "grammy";

const keyboard = new InlineKeyboard()
  .text("Подтвердить", `req:confirm:${request.id}:${request.version}`)
  .text("Изменить", `req:edit:${request.id}:${request.version}`)
  .row()
  .url("Правила", "https://example.com/terms");

await ctx.reply(`Заявка #${request.id}`, { reply_markup: keyboard });

bot.callbackQuery(/^req:(\w+):(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); // first, always
  const [, action, rawId, rawVersion] = ctx.match;
  const actorId = ctx.from.id; // identity from the update

  const result = await requests.apply(actorId, Number(rawId), Number(rawVersion), action);
  if (result.kind === "stale") {
    await ctx.editMessageText(renderCurrent(await requests.get(Number(rawId))), {
      reply_markup: keyboardFor(await requests.get(Number(rawId))),
    });
    return;
  }
  if (result.kind === "denied") {
    await ctx.answerCallbackQuery({ text: "Недоступно", show_alert: false });
    return;
  }
  await ctx.editMessageText(renderCurrent(result.request));
});
```

Byte measurement belongs next to keyboard construction:

```ts
export function assertCallbackData(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 1 || bytes > 64) throw new Error(`callback_data is ${bytes} bytes`);
  return value;
}
```

For inline mode the update carries `inline_message_id` instead of a reachable
message; edit with `ctx.editMessageText(..., { inline_message_id })` or answer
with an alert, and never assume `chat_id` is present.

A Mini App button is a separate type and never produces a callback:

```ts
const keyboard = new InlineKeyboard()
  .webApp("Открыть каталог", "https://app.example.com/catalog")
  .row()
  .url("Помощь", "https://example.com/help");
```

## aiogram / Python

```python
from aiogram import F
from aiogram.filters import Command
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup

def card(request: Request) -> InlineKeyboardMarkup:
    data = f"req:confirm:{request.id}:{request.version}".encode()
    assert 1 <= len(data) <= 64, f"callback_data is {len(data)} bytes"
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Подтвердить", callback_data=data.decode()),
        InlineKeyboardButton(text="Изменить", callback_data=f"req:edit:{request.id}:{request.version}"),
    ], [
        InlineKeyboardButton(text="Правила", url="https://example.com/terms"),
    ]])

@router.callback_query(F.data.startswith("req:"))
async def on_request(query: CallbackQuery) -> None:
    await query.answer()  # first, always
    _, action, raw_id, raw_version = (query.data or "").split(":", 3)
    result = await requests.apply(query.from_user.id, int(raw_id), int(raw_version), action)

    if result.kind == "stale":
        current = await requests.get(int(raw_id))
        await query.message.edit_text(render_current(current), reply_markup=card(current))
        return
    if result.kind == "denied":
        await query.answer("Недоступно", show_alert=False)
        return
    await query.message.edit_text(render_current(result.request))
```

Prefer `CallbackData` factories when the payload has fields, because they fail at
construction time instead of at the API:

```python
from aiogram.filters.callback_data import CallbackData

class RequestAction(CallbackData, prefix="req"):
    action: str
    request_id: int
    version: int
```

The three button types side by side:

```python
from aiogram.types import InlineKeyboardButton, WebAppInfo

InlineKeyboardButton(text="Открыть", callback_data="req:open:42")     # callback
InlineKeyboardButton(text="Помощь", url="https://example.com/help")   # URL
InlineKeyboardButton(text="Каталог", web_app=WebAppInfo(url="https://app.example.com/catalog"))
```

## Stale and duplicate presses

1. Read the row with its version.
2. Compare the version in the payload with the stored version.
3. Apply the transition only if the state still allows it, inside one transaction.
4. On mismatch return a stale result: re-render the current card, optionally with
   a neutral toast.
5. On a repeated press after success, show the already-done result; do not apply a
   second effect.

Deleting the message or disabling the button improves the interface but is not a
security control. The payload can be replayed by a client that kept it.

## Checks

- A payload of 64 bytes is accepted, 65 bytes is rejected by the test, and
  construction fails before the API call.
- A Cyrillic payload that is 40 characters but 80 bytes is rejected.
- Pressing a button twice applies one transition and shows the same outcome.
- Pressing a button whose object was deleted re-renders a stable screen, no error
  page.
- A button pressed by a user without the role is refused and no rollback is
  needed.
- `answerCallbackQuery` is called on every path, including the refused one.
