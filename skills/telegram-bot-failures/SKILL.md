---
name: telegram-bot-failures
description: "Use when a Telegram bot misbehaves: missing updates, duplicated actions, buttons that do nothing, failed payments, Mini App auth rejected. Русские триггеры: бот не отвечает, дубли сообщений, кнопка не работает, ошибка initData, платёж не проходит."
---

# Failure catalogue

Work from the symptom, not from a hunch. Find the row, apply the fix, then run the
stated check. A fix without its check is a guess with extra steps.

Rules of this skill:

- Read the code before applying a fix. The symptom names the area, not the line.
- Apply the fix at the shared function, not at the one caller named in the report.
  A guard in a helper covers every sibling caller; a guard in one handler does not.
- After the fix, run the check and label the result with its evidence level
  (L2 = local test, L3 = observed in a live client). See `telegram-bot`.
- If the check needs a live bot and there is none, say the behavior is unverified.

## Procedure

### 1. Telegram-level problems

#### 1.1 A widget query never arrives

**Symptom:** the bot sends a widget, the user interacts, nothing happens; the handler
on `message` never fires.

**Cause:** `widget_query` and `shared_widget_query` arrive at the **top level** of
`Update`, next to `message` and `callback_query`, not under `message`.

**Fix:** register the handler on the top-level update field, and include the types in
`allowed_updates`. Answer within the query window (15 s) or the client shows a
failure.

**Verify:** send a widget from a test chat, log the raw update, and confirm the field
name at the top level. L2/L3.

#### 1.2 Mini App `initData` validation fails at random

**Symptom:** the same Mini App works for some users and returns "auth failed" for
others, or works until the clock moves.

**Cause:** the data-check-string is built in the wrong order. It must be the pairs
sorted **by key**, each as `key=value` joined by `\n`, excluding `hash`. Sorting whole
`key=value` strings gives a different order. A second cause: `auth_date` is never
validated by the SDK, so an old `initData` keeps working.

**Fix:** build the check string from entries sorted by key; compute HMAC-SHA256 with
the key derived from `WebAppData`; compare in constant time; enforce your own
`auth_date` TTL; check the bot id and the production/test environment. Exchange the
validated `initData` for a short server session.

**Verify:** unit test with a known-good vector, a tampered `hash`, and an expired
`auth_date`. All three must behave as specified. L2.

#### 1.3 A moderation middleware never runs

**Symptom:** the moderation file exists, is imported, has tests, and violations still
pass through.

**Cause:** the middleware was never registered on the dispatcher or router. In
aiogram, outer/inner middleware must be attached to `dp` or the router that owns the
handler; in grammY, `bot.use()` must run before the handlers it should guard.

**Fix:** register it explicitly, before the handler group, and add a startup assertion
or a test that proves it ran.

**Verify:** send a message that the middleware should block and assert it is blocked;
a log line inside the middleware must appear. L2.

### 2. Delivery and idempotency

#### 2.1 Updates are lost on webhook

**Symptom:** occasional missing actions; the log shows HTTP 500 for the webhook, and
Telegram later redelivers or gives up.

**Cause:** two opposite mistakes. An exception inside the dedupe step returns 500, so
Telegram retries and the update may be processed twice after the state changed. A
silent `false` (catch-and-return) acknowledges the update and loses it because nothing
was recorded.

**Fix:** fail closed in a defined way: on a storage error, return a non-2xx so
Telegram retries, and make the handler idempotent so the retry is safe. Never swallow
a dedupe error into a 200.

**Verify:** force the storage layer to throw in a test; assert the response is not 2xx,
then assert a retry with a healthy store processes exactly once. L2.

#### 2.2 aiogram never retries a handler that raised

**Symptom:** a handler error loses the business action; polling moves on.

**Cause:** `handle_as_tasks=False` waits for the handler but does not guarantee a retry
after an exception. Internal `_process_update` logs the exception and treats the
update as handled; the offset can advance.

**Fix:** if the action must not be lost, persist the update in a durable inbox before
dispatch and recover pending rows, or drive `getUpdates` yourself and advance the
offset only after a durable commit.

**Verify:** make the handler raise, restart, and confirm the pending row is
reprocessed. L2.

#### 2.3 Duplicate replies and double charges

**Symptom:** a user taps once and gets two confirmations, or is charged twice.

**Cause:** no dedupe on `update_id`, or dedupe recorded after the side effect, or two
consumers on one token.

**Fix:** dedupe `(bot_id, update_id)` in the same transaction as the domain change;
add a domain key (order id, one-time token, version); confirm one consumer.

**Verify:** feed the same update twice into the real dispatcher; assert one row and one
outbound message. L2.

#### 2.4 Events silently missing after a deploy

**Symptom:** `message_reaction`, `my_chat_member`, `chat_join_request`, or a payment
update never reaches the bot in production but works locally.

**Cause:** `allowed_updates` omits the type. Telegram then does not deliver it at all.

**Fix:** set `allowed_updates` explicitly to the full set the handlers need, in both
polling and `setWebhook`, and keep it in sync with handler registration.

**Verify:** trigger the event in a test chat and confirm the handler fires; log the
configured `allowed_updates` at startup. L3.

### 3. Buttons and callbacks

#### 3.1 Buttons spin forever

**Symptom:** tapping a button shows a loading spinner until it times out.

**Cause:** `answerCallbackQuery` was not called on that branch — usually the refusal or
the stale-button branch.

**Fix:** answer at the start of every branch, including errors and expired state. Use
`text` for a short notice and `show_alert` only when it must block.

**Verify:** a test that invokes each branch and asserts one `answerCallbackQuery` call.
L2.

#### 3.2 An old button performs a privileged action

**Symptom:** a user whose role was revoked still opens the admin screen from an old
message.

**Cause:** authorization was decided when the message was rendered, and
`callback_data` was trusted as proof.

**Fix:** re-read the role and the object state in the callback handler; refuse with an
ACK and a notice when the rights are gone. Never encode permission in `callback_data`.

**Verify:** revoke the role, replay the callback, assert refusal and no state change.
L2.

### 4. Payments

#### 4.1 Payment fails or is never delivered

**Symptom:** the invoice opens, the user pays, and access is not granted; or checkout
fails immediately.

**Cause:** `pre_checkout_query` was not answered, answered after 10 seconds, or
answered `ok=false` because of a transient error (fail-open or fail-slow). Another
cause: empty product list, so no invoice is created; or delivery keyed on something
that changes between retries.

**Fix:** answer `pre_checkout_query` within 10 seconds; on any validation or storage
error answer `ok=false` (fail closed) so the user is not charged; grant access
idempotently by `telegram_payment_charge_id`.

**Verify:** test the rejected pre-checkout path and a duplicated
`successful_payment` update; assert exactly one grant. L2, then L3 with a test payer.

### 5. Text, media, and rendering

#### 5.1 `sendMessage` returns 400 "message is too long"

**Symptom:** a message with many entities is rejected although the visible text looks
short.

**Cause:** the 4096 limit applies to the text **after** entity parsing, not to the raw
source, and entities consume characters. Rich messages are a different limit: 32768
UTF-8 bytes.

**Fix:** count after parsing and split deliberately, closing and reopening tags. Use
`tg_text.py length` and `tg_text.py split --html` from `telegram-bot-api`. Choose rich
messages when the content is structurally long.

**Verify:** run the splitter on the failing input and assert every chunk passes
`telegram_payload.py`. L1/L2.

#### 5.2 Streaming edits look broken in groups

**Symptom:** rate limits, flicker, "message not modified", or a message that jumps
position.

**Cause:** streaming implemented as an `editMessageText` loop per token in a group.

**Fix:** stream drafts only in private chats (`sendMessageDraft`) with throttled
updates and one final message. In groups, send one answer and a typing indicator;
do not edit per token.

**Verify:** count API calls per response in a test transport; the group path must not
edit repeatedly. L2.

#### 5.3 Inline results leak between users

**Symptom:** user A's personal results appear for user B in inline mode.

**Cause:** results were returned without `is_personal=true`, so the cache serves them
to everyone for the cache window.

**Fix:** set `is_personal=true` for anything derived from the requesting user.

**Verify:** query with two different users in a test and assert cache partitioning is
declared in the request. L1/L2.

### 6. Framework wiring

#### 6.1 grammY 1.46 fails on `BOT_INFO`

**Symptom:** type error or runtime failure when constructing with a partial
`BOT_INFO`.

**Cause:** in grammY 1.46 the `BOT_INFO` object requires `username`,
`can_connect_to_business`, and `has_main_web_app`.

**Fix:** supply all three fields; do not cast a partial object.

**Verify:** typecheck passes with the full object and fails with one missing field. L1.

#### 6.2 A grammY transformer never applies

**Symptom:** the transformer is installed but no call is modified.

**Cause:** the transformer is wrapped in an extra function. The expected signature is
`(prev, method, payload, signal) => Promise<ApiResponse>`; returning a function
instead of a promise makes grammY ignore it or throw.

**Fix:** implement the transformer directly with that signature, call `prev(method,
payload, signal)`, and return its response.

**Verify:** a test transformer that records the method name; assert it saw the call.
L1/L2.

#### 6.3 `bot.catch` does not fire in production

**Symptom:** errors are unlogged while running as a webhook.

**Cause:** in grammY, `bot.catch` handles updates from polling; under a webhook the
framework adapter surface differs, so the error handler is not the one you expect.

**Fix:** wrap the webhook handler and log there too, or run the same error handler from
both paths.

**Verify:** force a handler error under the webhook test adapter and assert one log
entry with the update id. L2.

### 7. Ownership and roles

#### 7.1 The wrong user is the admin

**Symptom:** an early tester has owner rights in production, or nobody does.

**Cause:** the owner was assigned on the first `/start`.

**Fix:** seed the owner from trusted configuration by numeric id (`ADMIN_IDS`), and
never assign on start. Re-verify the role on every privileged action.

**Verify:** start the bot as a second user and assert no owner rights; assert the
configured id does. L2.

## Gotchas

- **Symptom and cause are usually two layers apart.** "No reply" is often a missing
  `allowed_updates` entry, not a broken handler.
- **One consistent reproduction beats five theories.** Log the raw update, the
  handler entry, the storage write, and the API response for one failing case.
- **The fix must cover every caller.** Grep the function you touch; patching only the
  reported path leaves siblings broken.
- **A local pass is not a live pass.** L2 proves logic, not Telegram delivery; say so.
- **Do not "fix" by adding retries around a non-idempotent action.** That converts one
  lost action into duplicates.

## Sources

- Bot API reference (updates, webhook, payments, limits): https://core.telegram.org/bots/api
- Bot API changelog (10.3 to 10.4 changes): https://core.telegram.org/bots/api-changelog
- Mini Apps and `initData` validation: https://core.telegram.org/bots/webapps
- grammY documentation: https://grammy.dev/
- grammY releases (1.46.0): https://github.com/grammyjs/grammY/releases
- aiogram documentation: https://docs.aiogram.dev/en/latest/
- aiogram releases (3.31.0): https://github.com/aiogram/aiogram/releases
- Adapted from the internal `telegram-engineering` knowledge base and its audit catalogue. See `THIRD_PARTY_NOTICES.md`.
