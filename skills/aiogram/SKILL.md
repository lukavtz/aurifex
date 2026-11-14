---
name: aiogram
description: Use when building, hardening, or debugging a Python Telegram bot on aiogram 3.31 with Python 3.11 to 3.14. Русские триггеры: aiogram, бот на Python, диспетчер aiogram, middleware, initData Python.
---

# aiogram 3.31

Target: Python `>=3.11,<3.15`, aiogram `3.31.0`, Bot API typed at 10.3. Use a raw
`TelegramMethod` for 10.4-only calls. File layout belongs to `telegram-bot-recipes`;
this skill covers aiogram behaviour only.

## Procedure

1. Pin `aiogram==3.31.0` and the rest of the runtime in `pyproject.toml`; commit
   `uv.lock`.
2. Load settings once through `pydantic-settings`; secrets are `SecretStr`.
3. Build `Bot` and `Dispatcher`, then include each router exactly once.
4. Register middleware in the order given below, on the dispatcher, not on a
   router that never sees the update.
5. Choose one transport: `dp.start_polling(...)` or `SimpleRequestHandler` with
   `setWebhook`.
6. Pass `allowed_updates=dp.resolve_used_update_types()` in both transports.
7. Handle `SIGTERM`/`SIGINT`, stop polling, close the session.
8. Run `uv run ruff check . && uv run mypy app && uv run pytest` before deploying.

## Configuration

```python
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    bot_token: SecretStr = Field(alias="BOT_TOKEN")
    webhook_secret: SecretStr = Field(alias="WEBHOOK_SECRET")
    webhook_url: str | None = Field(default=None, alias="WEBHOOK_URL")
    bot_mode: str = Field(default="polling", alias="BOT_MODE")
    port: int = Field(default=8080, alias="PORT", ge=1, le=65535)
    admin_ids: str = Field(default="", alias="ADMIN_IDS")
```

Validate `bot_mode` as `webhook|polling`, `webhook_url` as HTTPS when set, and
`WEBHOOK_SECRET` as `[A-Za-z0-9_-]{1,256}`. Parse `ADMIN_IDS` to a set of ints;
empty means no admins. Never log `bot_token` or `webhook_secret`; `SecretStr` prints
as `**********`.

## Handlers and routers

```python
from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, Message

router = Router()

@router.message(CommandStart())
async def start(message: Message) -> None:
    await message.answer("Ready.")

@router.message(Command("help"))
async def help_cmd(message: Message) -> None:
    await message.answer("Commands: /start /help")

@router.callback_query(F.data == "confirm")
async def confirm(callback: CallbackQuery) -> None:
    await callback.answer()
    if callback.message:
        await callback.message.edit_text("Confirmed.")
```

Include routers once: `dp.include_router(router)`. Use `F.from_user.id.in_(admin_ids)`
only as a fast path; the handler still checks the allowlist.

## Middleware order

Register on the dispatcher so every update passes through:

```python
dp.update.outer_middleware(dedupe)        # claim update_id first
dp.update.outer_middleware(rate_limit)    # throttle per chat
dp.update.outer_middleware(allowlist)     # reject unlisted users
dp.update.outer_middleware(moderation)    # drop banned chats
```

Order is dedupe → rate-limit → allowlist → moderation → handlers. A middleware file
that is never registered is dead code: the update reaches handlers unfiltered. Keep
the registration next to the middleware definition or in one `register_middlewares`
function called from `main`.

## Webhook mode

```python
from aiohttp import web
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application

app = web.Application(client_max_size=1_048_576)
handler = SimpleRequestHandler(
    dispatcher=dp,
    bot=bot,
    secret_token=settings.webhook_secret.get_secret_value(),
)
app.router.add_post("/webhook", handler.handle)
app.router.add_get("/healthz", lambda _: web.Response(text="ok"))
setup_application(app, dp, bot=bot)
```

`SimpleRequestHandler` checks `X-Telegram-Bot-Api-Secret-Token` in constant time.
Mount it directly; do not add a body parser before it.

Register out of band:

```python
await bot.set_webhook(
    url=settings.webhook_url,
    secret_token=settings.webhook_secret.get_secret_value(),
    allowed_updates=dp.resolve_used_update_types(),
    max_connections=40,
    drop_pending_updates=False,
)
```

Use HTTPS only, on port 443, 80, 88, or 8443.

## Polling mode

```python
await bot.delete_webhook(drop_pending_updates=False)
await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
```

One consumer per token. Delete an active webhook before polling, or Telegram returns
`409 Conflict`. Shut down with `await dp.stop_polling()` and `await bot.session.close()`.

## Task handling and retries

`dp.run_polling(..., handle_as_tasks=False)` awaits the handler inside the polling
loop. It does **not** guarantee a retry: an exception is logged and the update is
gone once the offset advances. Webhook mode has the same shape. If an update must
survive handler failure, make the handler write to durable storage first, or run the
work in a queue keyed by `update_id`.

## Raw API for Bot API 10.4

aiogram 3.31.0 typed methods cover 10.3. Define a `TelegramMethod` per 10.4 method:

```python
from aiogram.methods.base import TelegramMethod

class SendWidget(TelegramMethod[dict]):
    __returning__ = dict
    __api_method__ = "sendWidget"
    chat_id: int
    html: str
    allow_queries: bool = True

result = await bot(SendWidget(chat_id=message.chat.id, html="<b>hi</b>", allow_queries=True))
```

`bot(method, **params)` is the same call path; either form passes through the
session and its middleware. `TelegramMethod` allows extra fields. Add only fields
documented for the 10.4 method, and type the return value as `dict` until aiogram
ships a model. Exact parameters are in `telegram-bot-api-104`.

## Update safety

- Dedupe `update_id` with Redis `SET key 1 NX EX 86400` in an outer middleware.
  Missing Redis may fail open only in local mode, with a warning. On webhook, an
  exception there means a 500 and a redelivery.
- Rate-limit per chat, about one message per second.
- On `TelegramRetryAfter`, read `e.retry_after` and sleep before retrying.
- Keep admin checks server-side on numeric Telegram user ids.
- Do not use `MemoryStorage` FSM state in production; use Redis or Postgres.

## Tests

Use `dp.feed_update(bot, update)` as the only entry into the dispatcher; calling a
handler function directly skips filters and middleware and proves nothing.

```python
from unittest.mock import AsyncMock

async def test_start_replies(monkeypatch):
    bot = make_bot()
    update = make_message_update(text="/start")
    bot.session = AsyncMock()
    await dp.feed_update(bot, update)
    bot.session.assert_awaited()  # sendMessage reached the fake session
```

For the webhook, use `aiohttp.test_utils.TestClient` and assert 401 on a missing or
wrong secret, 200 and one dispatch on the right one, and 413 over
`client_max_size`. Do not call Telegram.

## Gotchas

- `safe_parse_webapp_init_data` verifies the HMAC but does not validate `auth_date`.
  Check the age yourself; a captured `initData` is otherwise valid forever.
- `dp.feed_update` requires the bot you pass to be the dispatcher's bot; passing a
  second instance loses the session and middleware.
- Middleware registered on `router.message` never sees callback queries. Register
  update-level middleware on `dp.update`.
- `handle_as_tasks=True` runs handlers concurrently, so per-chat ordering is lost.
- `callback.message` is optional in types. Guard it.
- `MemoryStorage` loses conversation state on restart and per replica.

## Sources

- https://docs.aiogram.dev/en/latest/
- https://docs.aiogram.dev/en/latest/dispatcher/webhook.html
- https://docs.aiogram.dev/en/latest/utils/web_app.html
- https://github.com/aiogram/aiogram
