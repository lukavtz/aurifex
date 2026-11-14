---
name: telegram-testing
description: Use when writing deterministic tests for a Telegram bot, faking the Bot API, covering updates, concurrency and security, or deciding whether a local test proves production behaviour. Русские триггеры: тесты бота, как тестировать телеграм-бота, фейковый Bot API, матрица сценариев, повтор update.
---

# Testing Telegram bots

Default to offline tests. The network is not a test fixture, and a live bot token is
never a unit-test dependency.

## Procedure

1. Pick the layer that can fail: unit for pure logic, handler for update →
   reply, webhook for transport, integration for storage, live only on demand.
2. Build the fixture from a real update shape, with a unique `update_id` per test.
3. Replace the transport (fake API session or `bot.api.config.use`), not the
   handler.
4. Assert on the method and payload that reach the transport, plus the durable
   state. Do not assert on user-visible copy or button counts.
5. Cover the scenario matrix below, once per feature that touches it.
6. Record which level of evidence the run provides.

## Evidence levels

| Level | Evidence                                              | Proves                            |
| ----- | ----------------------------------------------------- | --------------------------------- |
| L0    | read the code                                         | nothing                           |
| L1    | static checks (`telegram_bot_verify`, linters)        | shapes and rules, not behaviour   |
| L2    | local tests, fake transport                           | handler behaviour in this process |
| L3    | real delivery in production or a staging Telegram bot | Telegram accepted and delivered   |

**L2 is not L3.** A green local suite cannot prove that a webhook secret is
registered, that `allowed_updates` includes the needed types, that the token has
the right rights, or that a 429 is handled against the real API. State the level
honestly when reporting; never call a local test a production verification.

## Test layers

| Layer       | What it proves                                      | Network         |
| ----------- | --------------------------------------------------- | --------------- |
| Unit        | Pure validation, formatting, authorization, parsing | None            |
| Handler     | An update produces the expected reply or API call   | None            |
| Webhook     | Secret rejection, body cap, health endpoint         | Local HTTP      |
| Integration | Storage, queues, migrations                         | Local services  |
| Live        | Credentials and real delivery                       | Telegram, gated |

Run the fast layers on every commit; run live only on demand.

## Scenario matrix

Eleven scenarios, each with an observable assertion. A feature that touches one of
these needs a test for it.

| #   | Scenario                                    | Assert                                                  |
| --- | ------------------------------------------- | ------------------------------------------------------- |
| 1   | Main path                                   | one business result, one reply method                   |
| 2   | Invalid input                               | a rejection reply, no state change                      |
| 3   | Back / cancel                               | conversation state cleared, no side effect              |
| 4   | Another user's object or role               | denial, and the object is untouched                     |
| 5   | Role revoked while the button is still live | re-check at click time denies                           |
| 6   | Duplicate update and double click           | exactly one side effect                                 |
| 7   | Two concurrent claimants                    | one wins, one gets a clean refusal                      |
| 8   | Restart between inbox write and processing  | work resumes, no double grant                           |
| 9   | 429 and 403                                 | sleep per `retry_after`; 403 marks the chat unreachable |
| 10  | Special characters and emoji                | text survives, length is measured in UTF-16             |
| 11  | Channel access lost                         | send fails closed, state reflects it                    |

Scenario 7 needs two workers or two transactions; a single-threaded fake proves
nothing. Scenario 8 needs the queue and the storage to be real enough to restart.

## Fixtures

Store raw update JSON under `fixtures/updates/`:

- `start.json` — private `/start`
- `callback.json` — callback query with short data
- `inline.json` — inline query
- `pre_checkout.json` — `pre_checkout_query`
- `successful_payment.json` — payment with a charge id
- `webapp_data.json` — Mini App `web_app_data`

Keep fixtures small, valid, and free of real user data. Use a fixed clock and fixed
ids so assertions are stable. Build updates with a helper that always sets a unique
`update_id`; do not share ids between tests unless the test is about duplicates.

## grammY

Call `bot.handleUpdate(update)` and replace the API transport:

```ts
const calls: Array<{ method: string; payload: unknown }> = [];
bot.api.config.use((prev, method, payload) => {
  calls.push({ method, payload });
  return Promise.resolve({ ok: true, result: true } as never);
});
await bot.handleUpdate(fixture);
```

Assert:

- the method name and payload (`sendMessage`, `answerCallbackQuery`);
- the durable state after the handler;
- that a duplicate `update_id` does not produce a second side effect;
- that a `429` with `retry_after` is honored (fake timer, no real sleep);
- that an unknown update is ignored without throwing.

For webhook tests, start the server on an ephemeral port and post a body with a
wrong `X-Telegram-Bot-Api-Secret-Token`; assert 401 and no handler call. Post a body
over 1 MiB; assert 413 or 400.

## aiogram

Use `dp.feed_update(bot, update)` as the only dispatcher entry, so filters and
middleware run. `pytest`, `pytest-asyncio`, `AsyncMock`, and a fake session.

```python
async def test_start_replies():
    bot = make_bot()
    bot.session = AsyncMock()
    await dp.feed_update(bot, make_message_update(text="/start"))
    method = bot.session.call_args.args[0]
    assert method.__api_method__ == "sendMessage"
```

Assert the method and its fields, not the reply wording. For the webhook, use
`aiohttp.test_utils.TestClient` and assert:

- missing secret → 401;
- wrong secret → 401;
- correct secret → 200 and one dispatcher feed;
- body over `client_max_size` → 413.

## Assertions that survive copy changes

- Assert method names, payload fields, and stored rows. Do not assert button labels
  or the number of buttons; copy changes and keyboard layout edits would break the
  suite without a behaviour change.
- When a label is genuinely the contract (a deep link button, a command name),
  assert the callback data or the command, not the visible text.
- Assert that a reply exists and contains no unescaped markup rather than matching
  the whole string.
- Use a fixed clock and fixed ids; never assert on `Date.now()` output.

## Security tests

- Plant a token-shaped string in a source file; verification must fail
  `token.literal` and must not echo the full value.
- Remove the secret check; verification must fail `webhook.secret`.
- Delete `.gitignore` or add `.env`; verification must fail `env.ignored`.
- Send a wrong `admin` callback as a non-admin; assert denial and no side effect.
- Revoke the admin role between keyboard render and click; assert denial.
- Validate Mini App `initData` with a stale `auth_date` and a wrong hash.

## Payments

Test the unhappy paths:

- pre-checkout rejected with a reason;
- pre-checkout answered after the limit (fake clock);
- `successful_payment` delivered twice grants once;
- delivery failure after payment leaves a refundable record;
- refund revokes the grant keyed by charge id.

Never assert that a pre-checkout alone granted access.

## Broadcasts and retries

- Use a fake clock for `retry_after`; assert no real sleep.
- Assert per-chat serialization with two concurrent jobs for one chat.
- Assert a resume does not resend to users already marked sent.
- Assert the stop switch halts new sends.

## Live tests

Live tests require all of:

- `AURIFEX_LIVE=1`
- `TELEGRAM_TEST_BOT_TOKEN`
- `TELEGRAM_TEST_CHAT_ID`

Without all three, skip with an explicit message and exit 0. With them, call
`getMe`, `getWebhookInfo`, and `sendMessage` once; assert `ok: true` and that a
message id exists. Never print the token. Never call `setWebhook` against a
production bot; use a dedicated test bot.

## Commands

- TypeScript: `bun run typecheck && bun test`
- Python: `uv run ruff check . && uv run mypy app && uv run pytest`
- Single test: `bun test tests/features.test.ts` or
  `uv run pytest tests/test_commands.py -q`

## Gotchas

- Calling a handler function directly skips filters, middleware, and the
  dispatcher. It passes while production rejects the update.
- A fake clock that does not advance makes retry tests hang or pass vacuously.
- `AsyncMock` accepts any call; assert the method name and arguments or the test
  proves nothing.
- Shared `update_id` across tests silently turns every test after the first into a
  duplicate.
- A test that asserts full reply text fails on every copy edit and gets deleted.
- A 429 test that really sleeps makes the suite slow and flaky; patch the clock.
- Live tests that write to a shared chat leave state the next run trips over.

## Sources

- https://core.telegram.org/bots/api
- https://grammy.dev/guide/testing
- https://docs.aiogram.dev/en/latest/dispatcher/index.html
- https://docs.pytest.org/en/stable/
