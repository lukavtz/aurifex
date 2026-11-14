# LLM answers: streaming, neutralization, tools

**Goal.** A model-backed answer that streams in private chats, survives restart,
cannot be turned into markup or authority, and has a bounded cost.

**Read this when.** The spec asks for an AI assistant, a chat with a model, RAG,
summarization, generated documents, or any answer produced by an LLM.

Limits for text length and splitting: `../../telegram-bot-api/SKILL.md`. Bot API
10.4 raw calls: `../bot-api-104.md`.

## Pipeline

```
update -> dedupe -> actor + quota -> generation row (pending)
       -> worker -> model stream -> throttled draft updates
       -> final message -> completed | cancelled | failed + usage
```

Never hold a webhook open for the whole generation. Persist the request, acknowledge
the transport, and let the worker produce the answer.

## Steps

1. **One generation per trigger.** Unique `(bot_id, update_id)`. A repeated update
   returns the existing status instead of calling the model again.
2. **One active generation per conversation** by default. A new message while an
   answer streams is either queued, cancels the previous one, or is refused; choose
   and show it.
3. **Quota before the call.** Reserve the budget atomically, settle after. Record
   tokens and cost on the generation row.
4. **Stream with a debounce.** `sendMessageDraft` only in a private chat, draft id
   stable per answer, at most roughly one update per second. Plain text for
   intermediate frames; a full rendered payload only at the end.
5. **Neutralize the output.** The model echoes user text, documents, and tool
   results. Send plain text or escape and add your own markup. Strip or escape
   angle brackets, links to non-http schemes, `@mentions` and `/commands@bot` in
   groups.
6. **Cap the context.** System prompt plus summary plus the last N turns, measured
   in tokens, not messages. Store turns in the database; the context is rebuilt,
   not accumulated in memory.
7. **Never let the model act directly.** It returns an intent; the server checks
   the actor's role, resolves the object, and creates a single-use token. The
   button carries only that token.

## grammY / TypeScript

```ts
import type { Context } from "grammy";

async function streamAnswer(
  ctx: Context,
  chatId: number,
  draftId: number,
  chunks: AsyncIterable<string>,
) {
  let text = "";
  let lastSent = 0;
  let pauseUntil = 0;

  await ctx.api.raw.sendMessageDraft({
    chat_id: chatId,
    draft_id: draftId,
    text: "",
    can_stop: true,
  });

  for await (const piece of chunks) {
    text += piece;
    const now = Date.now();
    if (now - lastSent < 1000 || now < pauseUntil) continue;
    try {
      await ctx.api.raw.sendMessageDraft({
        chat_id: chatId,
        draft_id: draftId,
        text: tail(text, 2000), // plain text tail; 2000 code points stays under 4096 UTF-16
        can_stop: true,
      });
      lastSent = now;
    } catch (error) {
      const retryAfter = retryAfterSeconds(error);
      if (retryAfter === null) throw error;
      pauseUntil = now + retryAfter * 1000;
    }
  }
  return text;
}
```

Rules encoded here: private chat only (call it from a private-chat handler), one
stable `draft_id`, plain text frames, `retry_after` respected, final text returned
for rendering.

## aiogram / Python

```python
import asyncio
import time

from aiogram import Bot
from aiogram.exceptions import TelegramRetryAfter

async def stream_answer(bot: Bot, chat_id: int, thread_id: int | None, draft_id: int,
                        chunks, cancelled: asyncio.Event) -> str:
    text, last_sent, pause_until = "", 0.0, 0.0
    await bot.send_message_draft(chat_id=chat_id, draft_id=draft_id, text="",
                                 message_thread_id=thread_id, can_stop=True)
    async for piece in chunks:
        if cancelled.is_set():
            break
        text += piece
        now = time.monotonic()
        if now - last_sent >= 1.0 and now >= pause_until:
            try:
                await bot.send_message_draft(chat_id=chat_id, draft_id=draft_id,
                                             text=text[-2000:], parse_mode=None,
                                             message_thread_id=thread_id, can_stop=True)
                last_sent = now
            except TelegramRetryAfter as exc:
                pause_until = now + exc.retry_after
    return text
```

Stop handling: `can_stop=True` produces a `stopped_message_generation` update.
Cancel the generation atomically (status check inside the transaction), abort the
model stream, and send no final message unless the product keeps partial text.

## Rendering the final answer

```ts
import { escapeHtml } from "./escape.ts"; // scripts/tg_text.py has the reference helper

const safe = escapeHtml(finalText);
await ctx.reply(`<b>Ответ</b>\n${safe}`, { parse_mode: "HTML" });
```

```python
from html import escape

await message.answer(f"<b>Ответ</b>\n{escape(final_text)}", parse_mode="HTML")
```

When the length exceeds the message limit, use rich messages (32768 characters) if
the bot supports them, or split on paragraph boundaries while keeping tags
balanced. Sending a sliced HTML string breaks the parse.

## Output as untrusted input

- Plain text is the safe default. Any markup is added by your template around an
  escaped value, never parsed from the model.
- Links: allow `https` and `http` only, show the domain, disable previews for
  unknown hosts. Drop `tg://` and deep links invented by the model.
- Mentions and commands in groups: neutralize `@name` and `/cmd@bot` so the answer
  cannot ping people or trigger other bots in a loop.
- Buttons proposed by the model: create a server-side token with user, chat,
  action, arguments, and expiry; put `ai:<token>` in `callback_data`. Validate the
  action against an allowlist on press.

## Tools and cost

- A tool runs as the actor from the update, with the same permission checks as a
  callback. Never as a user named inside the text.
- Confirmation for money, deletion, broadcast, or messaging a third party happens
  through a server button with an exact preview.
- Bound the tool loop by iterations, wall clock, and budget. A loop without a cap
  is an outage waiting for a prompt.
- Keys stay in the environment. Provider errors retry with backoff before any
  output; after partial output, send an explicit "answer interrupted" with a retry
  button and do not charge twice.

## Checks

- The same update delivered twice produces one generation and one model call.
- A second message during streaming follows the chosen policy and keeps one draft.
- Stop mid-stream cancels the stream and records `cancelled`; stop after the final
  message is a no-op.
- Model output containing `<b>`, `[x](tg://x)`, and `@admin` arrives as inert text.
- A 30k-character answer is rendered through rich messages or a balanced split.
- Quota exhaustion answers without calling the model.
- A tool call with a foreign `user_id` in the prompt is refused.
