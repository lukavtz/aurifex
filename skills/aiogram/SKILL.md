---
name: aiogram
description: Use when building, hardening, or debugging a Python Telegram bot on aiogram 3.31 with Python 3.11 to 3.14.
---

# aiogram 3.31

Target: Python `>=3.11,<3.15`, aiogram `3.31.0`, Bot API tested at 10.3. Use the raw
method class for 10.4-only calls.

## Project shape

```text
app/config.py          pydantic-settings, no secret defaults
app/bot.py             Bot and Dispatcher factory
app/main.py            webhook or polling, graceful shutdown
app/webhook.py         aiohttp app, body cap, /healthz
app/handlers/          routers, one module per command group
app/middlewares/       allowlist, dedupe, rate limit
app/db/                async SQLAlchemy session and models
tests/                 offline handlers and webhook secret tests
```

Pin exact versions in `pyproject.toml`. Required runtime packages:
`aiogram==3.31.0`, `pydantic-settings==2.16.2`, `asyncpg==0.32.0`,
`sqlalchemy==2.1.8`, `redis==8.1.0`, `alembic==1.20.1`,
`structlog==26.1.0`, `httpx==0.28.1`.

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
`WEBHOOK_SECRET` as `[A-Za-z0-9_-]{1,256}`. Parse `ADMIN_IDS` to a set of ints.
Never log `bot_token` or `webhook_secret`; `SecretStr` prints as `**********`.

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
await bot.delete_webhook(drop_pending_updates=True)
await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
```

One consumer per token. Delete the webhook before polling, or Telegram returns
`409 Conflict`. Shut down with `await dp.stop_polling()` and `await bot.session.close()`.

## Raw API for Bot API 10.4

aiogram 3.31.0 typed methods cover 10.3. Define a `TelegramMethod` for `sendWidget`,
`answerWidgetQuery`, ephemeral callback replies, rich-message quotes, and TON wallet
cards:

```python
from aiogram.methods.base import TelegramMethod

class SendWidget(TelegramMethod[dict]):
    __returning__ = dict
    __api_method__ = "sendWidget"
    chat_id: int

result = await bot(SendWidget(chat_id=message.chat.id))
```

`TelegramMethod` allows extra fields. Add only fields documented for the 10.4
method, and type the return value as `dict` until aiogram ships a model.

## Update safety

- Dedupe `update_id` with Redis `SET key 1 NX EX 86400` in an outer middleware.
  Missing Redis may fail open only in local mode, with a warning.
- Rate-limit per chat, about one message per second.
- On `TelegramRetryAfter`, read `e.retry_after` and sleep before retrying.
- Keep admin checks server-side on numeric Telegram user ids.
- Do not use `MemoryStorage` FSM state in production; use Redis or Postgres.

## Tests

Use `pytest` with `pytest-asyncio`, `AsyncMock`, and hand-built `Message` and
`CallbackQuery` fixtures. Assert handler replies and method calls; never call
Telegram. Add an `aiohttp.test_utils` test that posts a wrong secret to
`/webhook` and asserts 401.

Run `uv run ruff check .`, `uv run mypy app`, and `uv run pytest` in the project.

## Sources

Adapted from the official aiogram repository and documentation
(`github.com/aiogram/aiogram`, MIT), `nzhulikov/telegram-bot-skills` (Apache-2.0),
and `nyxandro/telegram-bot-development-skill` (MIT). See `THIRD_PARTY_NOTICES.md`.
