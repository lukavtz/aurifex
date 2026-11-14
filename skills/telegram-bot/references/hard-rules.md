# The 12 hard rules, expanded

Each rule: what it means, a counter-example that ships bugs, and the correct move.

## 1. Identity comes only from the update object

The acting user is `update.message.from.id`, `update.callback_query.from.id`, or the
verified `initData.user.id`. Nothing else identifies a person.

Counter-example: a handler reads `callback_data.split(":")[1]` as the user id and
then shows that user's balance. Anyone can craft callback data for another user.

Correct: take the id from the update, look the account up in the database, and use
the database row for everything else.

## 2. Authorization comes only from stored data

Roles, ownership, and access are read from the database at request time.

Counter-example: the admin panel is protected by an inline button that only admins
see. A user who kept an old message, or who replays the callback, gets in.

Correct: the callback handler re-checks the role from storage, then checks access to
the specific object, then checks its current state. `callback_data`, text, username,
a hidden menu, and a command scope are navigation, not credentials. The owner comes
from trusted configuration by numeric ID; the first `/start` must not confer it.

## 3. Every update is idempotent

Telegram retries. Users double-click. Two workers may process the same delivery.

Counter-example: the dedupe row is written, the handler then throws, and the action
never happens; or the action runs, the process dies before the ack, and Telegram
delivers the update again, so the action runs twice.

Correct: dedupe `(bot_id, update_id)` in the same transaction as the domain change,
plus a domain key (order id, one-time token, version) so a repeated business action
is still refused. Confirm the polling offset or a 2xx only after a durable commit.

## 4. Conversation state lives in a database

Multi-step flows survive a restart, a redeploy, and a second process.

Counter-example: a checkout flow stores the selected product in a module-level map.
The container restarts and the user's payment step disappears.

Correct: persist the state with the user id and a version; transition with a
transaction that conditions on the version, so two concurrent taps cannot both win.

## 5. Outbound work goes through an outbox

The database commit and the Telegram send cannot be one atomic operation.

Counter-example: the handler commits the order and then calls `sendMessage`. The send
fails with a network error and the user never hears about a paid order.

Correct: write the outgoing message to an outbox in the same transaction, then a
worker sends it with retries and marks it done. Duplicate sends are possible, so make
the message idempotent or cheap to repeat. Never claim exactly-once delivery.

## 6. Answer callbacks immediately

Every callback branch calls `answerCallbackQuery`, including refusals and stale
buttons. Otherwise the client shows a spinner until it times out.

Counter-example: the handler validates first and answers only on success, so a
rejected tap leaves the button spinning and the user taps again.

Correct: answer first (optionally with `text` and `show_alert`), then do the work. An
ACK is not success; report the outcome in the message or a follow-up.

## 7. Render user text through the target escaper

Choose the parse mode, then escape every interpolated value for it.

Counter-example: `sendMessage(parse_mode="HTML", text=f"<b>{name}</b>")` with a name
containing `<` breaks the message or injects a link.

Correct: escape with the helper of that parse mode (`escape-html`, `escape-mdv2`)
before interpolating. Rich messages take their own input format; escape for that one.
See `telegram-bot-api` for the helpers.

## 8. Untrusted text never becomes markup

Text from a user, a model, or a fetched document is data, not structure.

Counter-example: an LLM answer is sent as rich Markdown, so the model can emit a
button or a link the operator never approved.

Correct: render model and user text as escaped text inside a structure you built. If
markup is required, produce it from a fixed template and escape the payload.

## 9. Secrets come only from the environment

Token, webhook secret, model API key, session strings.

Counter-example: the token is pasted into a config file, or the Bot API URL with the
token is logged on error.

Correct: read from `env` or a `*_FILE` path; never print them; redact URLs and request
bodies before logging. Never ask the user to paste a secret into chat.

## 10. Rendering has no side effects

A function that builds text or a keyboard only builds it.

Counter-example: `render_menu()` also calls `sendMessage` and writes a counter, so a
preview doubles the side effects and a retry sends twice.

Correct: separate render from send. Pure render functions are testable and safe to
call twice.

## 11. Never invent a Bot API method or field

Counter-example: a remembered `sendTable` call, or a `drop_pending_updates` flag on a
method that does not accept it. The API returns 400 and the developer blames the SDK.

Correct: check the contract with `telegram-bot-sources` (`tg_docs.py method NAME`),
then the installed SDK typings. If the check is impossible offline, say the fact is
unverified; do not present it as checked.

## 12. Preserve the project's existing stack

Counter-example: a Python project on `python-telegram-bot` is rewritten in aiogram
because the skill's examples are in aiogram. The diff is enormous and unrelated to
the request.

Correct: keep the stack, apply the pattern. Add Redis, a queue, a Mini App, an admin
web UI, or multi-tenancy only when a stated requirement needs it, and record that
decision.

## Handoff template

Use this shape for the final report:

```text
Done: what the user can do now (1-2 sentences)
Files: key created and changed paths
Run: install, .env from .env.example, migrations, start, checks
Roles and admin: how the owner is set, how roles are granted and revoked, where settings live
Verified: L2 - commands and observed result; L3 - what is visible in the client, or "not checked: no test bot"
Remaining: external prerequisites (token, domain, provider, BotFather settings) and known limits
```
