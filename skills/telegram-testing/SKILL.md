---
name: telegram-testing
description: Use when writing deterministic tests for a Telegram bot, faking the Bot API, covering updates and security, or gating live Telegram tests.
---

# Testing Telegram bots

Default to offline tests. The network is not a test fixture, and a live bot token is
never a unit-test dependency.

## Test layers

| Layer       | What it proves                                      | Network         |
| ----------- | --------------------------------------------------- | --------------- |
| Unit        | Pure validation, formatting, authorization, parsing | None            |
| Handler     | An update produces the expected reply or API call   | None            |
| Webhook     | Secret rejection, body cap, health endpoint         | Local HTTP      |
| Integration | Storage, queues, migrations                         | Local services  |
| Live        | Credentials and real delivery                       | Telegram, gated |

Run the fast layers on every commit; run live only on demand.

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

- the reply text and `parse_mode`;
- the method name and payload (`sendMessage`, `answerCallbackQuery`);
- that a duplicate `update_id` does not produce a second side effect;
- that a `429` with `retry_after` is honored (fake timer, no real sleep);
- that an unknown update is ignored without throwing.

For webhook tests, start the server on an ephemeral port and post a body with a
wrong `X-Telegram-Bot-Api-Secret-Token`; assert 401 and no handler call. Post a body
over 1 MiB; assert 413 or 400.

## aiogram

Use `pytest`, `pytest-asyncio`, `AsyncMock`, and hand-built `Message` and
`CallbackQuery` objects. Bind a mock bot session or monkeypatch `message.answer`.

```python
from unittest.mock import AsyncMock

async def test_start_replies(monkeypatch):
    message = make_message(text="/start")
    message.answer = AsyncMock()
    await start(message)
    message.answer.assert_awaited_once()
```

For the webhook, use `aiohttp.test_utils.TestClient` and assert:

- missing secret → 401;
- wrong secret → 401;
- correct secret → 200 and one dispatcher feed;
- body over `client_max_size` → 413.

## Security tests

- Plant a token-shaped string in a source file; verification must fail
  `token.literal` and must not echo the full value.
- Remove the secret check; verification must fail `webhook.secret`.
- Delete `.gitignore` or add `.env`; verification must fail `env.ignored`.
- Create a symlink from inside the project to outside; scaffold and read must fail
  with `unauthorized_path`.
- Attempt `..`, an absolute path outside the root, and a NUL byte; all must fail.
- Send a wrong `admin` callback as a non-admin; assert denial and no side effect.
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

## Sources

Adapted from `nyxandro/telegram-bot-development-skill` (MIT),
`nzhulikov/telegram-bot-skills` (Apache-2.0), and Telegram Bot API documentation.
See `THIRD_PARTY_NOTICES.md`.
