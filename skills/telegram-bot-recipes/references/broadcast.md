# Broadcast and mass messaging

**Goal.** Deliver one message to many opted-in users without tripping limits, and
resume after a restart without duplicates.

**Read this when.** The spec asks for announcements, notifications to all users, a
digest, or a campaign.

Deployment and transport rules: `../../telegram-deploy/SKILL.md`. Rate-limit
numbers: `../../telegram-bot-api/SKILL.md`.

## Steps

1. **Store the audience first.** A broadcast row plus a recipients table with a
   stable ordering key. The list is materialised once, so a restart resumes the
   same set instead of recomputing it.
2. **Run in the worker, never in the handler.** The handler validates the request,
   creates the broadcast, and returns. The worker sends.
3. **Pace the sending.** Around 30 messages per second is the free ceiling; start
   lower, watch 429s, and stay well under it for chats with recent traffic.
4. **Honour `retry_after`.** On 429 sleep for the given seconds and retry that one
   recipient. Do not retry in a tight loop and do not drop the recipient.
5. **Handle permanent failures.** 403 means blocked or never started: mark the
   user unreachable and skip. 400 means a bad payload: stop the campaign for that
   renderer, fix it, do not hammer.
6. **Respect opt-out.** A user who stopped the bot or unsubscribed is excluded at
   send time, not only when the list was built.
7. **Resume from a cursor.** Commit the cursor after each successful send (or a
   small batch). A restart continues from the last committed position.
8. **Never broadcast from a webhook.** The request must finish in seconds and the
   campaign takes minutes.

## grammY / TypeScript

Worker loop with cursor and retry handling:

```ts
export async function runBroadcast(deps: {
  jobs: BroadcastRepo;
  api: Api;
  broadcastId: number;
}): Promise<void> {
  const broadcast = await deps.jobs.get(deps.broadcastId);
  if (broadcast.status !== "running") return;

  for (;;) {
    const batch = await deps.jobs.nextRecipients(broadcast.id, broadcast.cursor, 20);
    if (batch.length === 0) break;

    for (const recipient of batch) {
      try {
        await deps.api.sendMessage(recipient.chatId, broadcast.text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
        await deps.jobs.markSent(broadcast.id, recipient.id);
      } catch (error) {
        const status = errorCode(error);
        if (status === 429) {
          await sleep((retryAfter(error) ?? 1) * 1000); // then retry this recipient
        } else if (status === 403) {
          await deps.jobs.markUnreachable(broadcast.id, recipient.id);
        } else if (status === 400) {
          await deps.jobs.fail(broadcast.id, "bad_payload");
          return;
        } else {
          await deps.jobs.markFailed(broadcast.id, recipient.id, String(status));
        }
      }
      await deps.jobs.advanceCursor(broadcast.id, recipient.id); // durable, before next batch
      await sleep(1000 / 30); // ~30/s ceiling
    }
  }
  await deps.jobs.finish(broadcast.id);
}
```

Retry helper shape:

```ts
function retryAfter(error: unknown): number | null {
  const parameters = (error as { parameters?: { retry_after?: number } }).parameters;
  return typeof parameters?.retry_after === "number" ? parameters.retry_after : null;
}
```

## aiogram / Python

```python
import asyncio

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter

async def run_broadcast(bot: Bot, repo: BroadcastRepo, broadcast_id: int) -> None:
    broadcast = await repo.get(broadcast_id)
    if broadcast is None or broadcast.status != "running":
        return

    while True:
        batch = await repo.next_recipients(broadcast_id, broadcast.cursor, limit=20)
        if not batch:
            break
        for recipient in batch:
            try:
                await bot.send_message(recipient.chat_id, broadcast.text, parse_mode="HTML")
                await repo.mark_sent(broadcast_id, recipient.id)
            except TelegramRetryAfter as exc:
                await asyncio.sleep(exc.retry_after)
                continue  # same recipient on the next pass
            except TelegramForbiddenError:
                await repo.mark_unreachable(broadcast_id, recipient.id)
            except TelegramBadRequest:
                await repo.fail(broadcast_id, "bad_payload")
                return
            await repo.advance_cursor(broadcast_id, recipient.id)
            await asyncio.sleep(1 / 30)
    await repo.finish(broadcast_id)
```

## Schema

```sql
CREATE TABLE broadcasts (
  id bigserial PRIMARY KEY,
  text text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'running', 'done', 'failed')),
  cursor bigint NOT NULL DEFAULT 0,
  created_by bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE broadcast_recipients (
  broadcast_id bigint NOT NULL REFERENCES broadcasts(id),
  id bigint NOT NULL,
  chat_id bigint NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'sent', 'unreachable', 'failed')),
  PRIMARY KEY (broadcast_id, id)
);
```

Ordering is `id`, so the cursor is a strict "greater than" comparison and a resume
does not resend.

## Opt-out and consent

- Sending requires that the user started the bot and has not blocked it. There is
  no legal way to message arbitrary usernames.
- Offer `/stop` or a settings toggle; record it and exclude at send time.
- Do not use a broadcast to re-engage users who never asked. It converts accounts
  into 403s and reports.
- Paid broadcasts exist for very large volumes; do not enable them without an
  approved budget and a reason.

## Checks

- A campaign restarted mid-run sends no duplicate to an already-`sent` recipient.
- 429 for one recipient delays that send and the campaign continues.
- 403 marks the user unreachable and is excluded from the next campaign.
- A payload over the text limit is rejected before the campaign starts.
- The initiating handler returns in under two seconds; the worker does the sending.
- Opt-out recorded after list materialisation still excludes the user.
