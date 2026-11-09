import type { BotSpec } from "../../spec/bot-spec.ts";
import { resolveStack } from "../../targets/catalog.ts";
import type { TemplateFile } from "./shared.ts";
import { assertNoTokenLiteral, baseFiles } from "./shared.ts";

const ALEMBIC_INI = `[alembic]
script_location = migrations
prepend_sys_path = .
sqlalchemy.url =

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARNING
handlers = console

[logger_sqlalchemy]
level = WARNING
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
`;

const ALEMBIC_ENV = `from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import get_settings
from app.db.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    url = get_settings().database_url
    if url.startswith("postgres://"):
        return "postgresql+asyncpg://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url[len("postgresql://") :]
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = _database_url()
    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
`;

const MIGRATION_0001 = `"""initial schema

Revision ID: 0001_init
Revises:
Create Date: 2026-11-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("username", sa.String(length=64), nullable=True),
        sa.Column("display_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False, index=True),
        sa.Column("charge_id", sa.String(length=128), nullable=False, unique=True),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("total_amount", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("payments")
    op.drop_table("users")
`;

const APP_CONFIG = `from __future__ import annotations

import re
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

TOKEN_PATTERN = re.compile(r"^\\d{6,}:[A-Za-z0-9_-]{30,}$")
SECRET_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,256}$")
HTTPS_URL_PATTERN = re.compile(r"^https://\\S+$")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    bot_token: str
    webhook_secret: str = ""
    webhook_url: str = ""
    bot_mode: Literal["webhook", "polling"] = "polling"
    port: int = Field(default=8080, ge=1, le=65535)
    admin_ids: str = ""
    database_url: str = ""
    redis_url: str = ""
    llm_base_url: str = ""
    llm_model: str = ""
    llm_api_key: str = ""
    log_level: str = "info"

    @field_validator("bot_token")
    @classmethod
    def _validate_bot_token(cls, value: str) -> str:
        if not TOKEN_PATTERN.match(value):
            raise ValueError("BOT_TOKEN must look like <bot id>:<token>")
        return value

    @field_validator("webhook_secret")
    @classmethod
    def _validate_webhook_secret(cls, value: str) -> str:
        if value and not SECRET_PATTERN.match(value):
            raise ValueError(
                "WEBHOOK_SECRET must be 1-256 characters of A-Z, a-z, 0-9, _ or -"
            )
        return value

    @field_validator("webhook_url")
    @classmethod
    def _validate_webhook_url(cls, value: str) -> str:
        if value and not HTTPS_URL_PATTERN.match(value):
            raise ValueError("WEBHOOK_URL must be an https:// URL or empty")
        return value

    @property
    def admin_id_set(self) -> frozenset[int]:
        return frozenset(
            int(part) for part in self.admin_ids.split(",") if part.strip().isdigit()
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
`;

const APP_LOGGER = `from __future__ import annotations

import logging
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog

REDACTED_KEYS = frozenset(
    {"bot_token", "webhook_secret", "llm_api_key", "authorization"}
)
REDACTED = "<redacted>"


def redact_processor(
    _logger: Any, _method_name: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    for key in list(event_dict):
        if key.lower() in REDACTED_KEYS:
            event_dict[key] = REDACTED
        elif isinstance(event_dict[key], dict):
            event_dict[key] = {
                nested: (REDACTED if nested.lower() in REDACTED_KEYS else value)
                for nested, value in event_dict[key].items()
            }
    return event_dict


def configure_logging(level: str = "info") -> None:
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            redact_processor,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        cache_logger_on_first_use=True,
    )
`;

const APP_BOT = `from __future__ import annotations

import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import ErrorEvent
from redis.asyncio import Redis

from app.config import Settings
from app.db.session import create_session_factory
from app.handlers import register_handlers
from app.middlewares.allowlist import AllowlistMiddleware
from app.middlewares.dedupe import DedupeMiddleware
from app.middlewares.rate_limit import RateLimitMiddleware
from app.services.retry import is_retry_after_error, sleep_retry_after

logger = logging.getLogger(__name__)


async def handle_error(event: ErrorEvent) -> bool:
    exception = event.exception
    if is_retry_after_error(exception):
        delay = await sleep_retry_after(exception)
        logger.warning("flood control: retried after %s seconds", delay)
        return True
    logger.error("unhandled update error: %s", exception)
    return True


def create_bot(settings: Settings) -> Bot:
    return Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )


def create_redis(settings: Settings) -> Redis | None:
    if not settings.redis_url:
        logger.warning("REDIS_URL is empty; dedupe and rate limiting are disabled")
        return None
    return Redis.from_url(settings.redis_url, decode_responses=True)


def create_dispatcher(settings: Settings, bot: Bot, redis: Redis | None) -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.update.middleware(DedupeMiddleware(redis))
    dispatcher.message.middleware(RateLimitMiddleware(redis))
    dispatcher.message.middleware(AllowlistMiddleware(settings.admin_id_set))
    dispatcher.workflow_data["session_factory"] = create_session_factory(
        settings.database_url
    )
    dispatcher.errors.register(handle_error)
    register_handlers(dispatcher, bot)
    return dispatcher
`;

const APP_MAIN = `from __future__ import annotations

import asyncio

from aiogram import Dispatcher
from aiohttp import web

from app.bot import create_bot, create_dispatcher, create_redis
from app.config import Settings, get_settings
from app.logger import configure_logging
from app.webhook import create_webhook_app


def allowed_updates(dispatcher: Dispatcher) -> list[str]:
    extra: list[str] = dispatcher.workflow_data.get("allowed_updates_extra", [])
    return sorted(set(dispatcher.resolve_used_update_types()) | set(extra))


async def run_polling(settings: Settings) -> None:
    bot = create_bot(settings)
    redis = create_redis(settings)
    dispatcher = create_dispatcher(settings, bot, redis)
    try:
        await dispatcher.start_polling(
            bot,
            allowed_updates=allowed_updates(dispatcher),
            drop_pending_updates=False,
        )
    finally:
        await bot.session.close()
        if redis is not None:
            await redis.aclose()


def run_webhook(settings: Settings) -> None:
    if not settings.webhook_url:
        raise RuntimeError("WEBHOOK_URL is required in webhook mode")
    bot = create_bot(settings)
    redis = create_redis(settings)
    dispatcher = create_dispatcher(settings, bot, redis)
    app = create_webhook_app(dispatcher, bot, settings)

    async def shutdown(_app: web.Application) -> None:
        await bot.session.close()
        if redis is not None:
            await redis.aclose()

    app.on_shutdown.append(shutdown)
    web.run_app(app, host="0.0.0.0", port=settings.port)


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    if settings.bot_mode == "webhook":
        run_webhook(settings)
    else:
        asyncio.run(run_polling(settings))


if __name__ == "__main__":
    main()
`;

const APP_WEBHOOK = `from __future__ import annotations

from importlib import import_module
from typing import Any

from aiogram import Bot, Dispatcher
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiohttp import web

from app.config import Settings

MAX_BODY_BYTES = 1_048_576
WEBHOOK_PATH = "/webhook"


async def healthz(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


def register_miniapp_routes(app: web.Application, settings: Settings) -> bool:
    try:
        module: Any = import_module("app.services.miniapp")
    except ModuleNotFoundError as error:
        if error.name != "app.services.miniapp":
            raise
        return False
    module.register_routes(app, settings.bot_token)
    return True


def create_webhook_app(
    dispatcher: Dispatcher, bot: Bot, settings: Settings
) -> web.Application:
    if not settings.webhook_secret:
        raise RuntimeError("WEBHOOK_SECRET is required in webhook mode")
    app = web.Application(client_max_size=MAX_BODY_BYTES)
    SimpleRequestHandler(
        dispatcher=dispatcher,
        bot=bot,
        secret_token=settings.webhook_secret,
    ).register(app, path=WEBHOOK_PATH)
    app.router.add_get("/healthz", healthz)
    register_miniapp_routes(app, settings)
    setup_application(app, dispatcher, bot=bot)
    return app
`;

const HANDLERS_INIT = `from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path

from aiogram import Bot, Dispatcher


def register_handlers(dp: Dispatcher, bot: Bot) -> None:
    package_dir = str(Path(__file__).parent)
    for info in pkgutil.iter_modules([package_dir]):
        if info.name.startswith("_"):
            continue
        module = importlib.import_module(f"{__name__}.{info.name}")
        register = getattr(module, "register", None)
        if callable(register):
            register(dp, bot)
`;

const HANDLERS_COMMANDS = `from __future__ import annotations

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command
from aiogram.types import Message

router = Router(name="commands")


@router.message(Command("start"))
async def start(message: Message) -> None:
    await message.answer("Hello! Use /help to list the available commands.")


@router.message(Command("help"))
async def help_command(message: Message) -> None:
    await message.answer(
        "Commands:\\n/start - start the bot\\n/help - show this message"
    )


def register(dp: Dispatcher, _bot: Bot) -> None:
    dp.include_router(router)
`;

const HANDLERS_ADMIN = `from __future__ import annotations

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command
from aiogram.types import Message

from app.middlewares.allowlist import is_admin

router = Router(name="admin")


@router.message(Command("admin"))
async def admin_panel(message: Message, admin_ids: frozenset[int]) -> None:
    user_id = message.from_user.id if message.from_user else None
    if not is_admin(user_id, admin_ids):
        await message.answer("This command is restricted to administrators.")
        return
    await message.answer("Admin panel is available.")


def register(dp: Dispatcher, _bot: Bot) -> None:
    dp.include_router(router)
`;

const MIDDLEWARES_INIT = `"""Middleware package."""
`;

const MIDDLEWARES_ALLOWLIST = `from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import Message, TelegramObject

logger = logging.getLogger(__name__)

ADMIN_COMMANDS = frozenset({"/admin", "/broadcast"})


def is_admin(user_id: int | None, admin_ids: frozenset[int]) -> bool:
    return user_id is not None and user_id in admin_ids


class AllowlistMiddleware(BaseMiddleware):
    def __init__(self, admin_ids: frozenset[int]) -> None:
        self.admin_ids = admin_ids
        if not admin_ids:
            logger.warning("ADMIN_IDS is empty; every admin command is denied")

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        data["admin_ids"] = self.admin_ids
        message = event if isinstance(event, Message) else None
        if message is None or message.from_user is None:
            return await handler(event, data)
        text = (message.text or "").strip()
        command = ""
        if text.startswith("/"):
            command = text.split(maxsplit=1)[0].split("@", 1)[0]
        if command in ADMIN_COMMANDS and not is_admin(
            message.from_user.id, self.admin_ids
        ):
            await message.answer("This command is restricted to administrators.")
            return None
        return await handler(event, data)
`;

const MIDDLEWARES_DEDUPE = `from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject, Update
from redis.asyncio import Redis

logger = logging.getLogger(__name__)

DEDUPE_TTL_SECONDS = 86_400


class DedupeMiddleware(BaseMiddleware):
    def __init__(self, redis: Redis | None) -> None:
        self.redis = redis
        if redis is None:
            logger.warning("dedupe disabled: REDIS_URL is not set")

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        update_id = event.update_id if isinstance(event, Update) else None
        if update_id is None or self.redis is None:
            return await handler(event, data)
        try:
            claimed = await self.redis.set(
                f"update:{update_id}", "1", nx=True, ex=DEDUPE_TTL_SECONDS
            )
        except Exception:
            logger.warning("dedupe unavailable; processing update %s", update_id)
            return await handler(event, data)
        if not claimed:
            logger.info("duplicate update %s ignored", update_id)
            return None
        return await handler(event, data)
`;

const MIDDLEWARES_RATE_LIMIT = `from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.enums import ChatType
from aiogram.types import Message, TelegramObject
from redis.asyncio import Redis

logger = logging.getLogger(__name__)

PRIVATE_LIMIT = 1
GROUP_LIMIT = 20


class RateLimitMiddleware(BaseMiddleware):
    def __init__(self, redis: Redis | None) -> None:
        self.redis = redis
        if redis is None:
            logger.warning("rate limiting disabled: REDIS_URL is not set")

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        message = event if isinstance(event, Message) else None
        if message is None or self.redis is None:
            return await handler(event, data)
        now = time.time()
        if message.chat.type == ChatType.PRIVATE:
            key = f"rl:private:{message.chat.id}:{int(now)}"
            limit = PRIVATE_LIMIT
            ttl = 1
        else:
            key = f"rl:group:{message.chat.id}:{int(now // 60)}"
            limit = GROUP_LIMIT
            ttl = 60
        try:
            async with self.redis.pipeline(transaction=True) as pipe:
                pipe.incr(key)
                pipe.expire(key, ttl)
                count, _ = await pipe.execute()
        except Exception:
            logger.warning("rate limiting unavailable; allowing message")
            return await handler(event, data)
        if int(count) > limit:
            logger.info("rate limit hit for chat %s", message.chat.id)
            return None
        return await handler(event, data)
`;

const DB_INIT = `"""Database package."""
`;

const DB_SESSION = `from __future__ import annotations

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

SessionFactory = async_sessionmaker[AsyncSession]


def normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        return "postgresql+asyncpg://" + database_url[len("postgres://") :]
    if database_url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + database_url[len("postgresql://") :]
    return database_url


def create_engine(database_url: str) -> AsyncEngine | None:
    if not database_url:
        return None
    return create_async_engine(normalize_database_url(database_url), pool_pre_ping=True)


def create_session_factory(database_url: str) -> SessionFactory | None:
    engine = create_engine(database_url)
    if engine is None:
        return None
    return async_sessionmaker(engine, expire_on_commit=False)
`;

const DB_MODELS = `from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    display_name: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    charge_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    currency: Mapped[str] = mapped_column(String(8))
    total_amount: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
`;

const TEST_COMMANDS = `from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.handlers import commands


@pytest.mark.asyncio
async def test_start_replies() -> None:
    message = MagicMock()
    message.answer = AsyncMock()
    await commands.start(message)
    message.answer.assert_awaited_once()
    text = message.answer.await_args.args[0]
    assert "help" in text.lower()


@pytest.mark.asyncio
async def test_help_lists_commands() -> None:
    message = MagicMock()
    message.answer = AsyncMock()
    await commands.help_command(message)
    text = message.answer.await_args.args[0]
    assert "/start" in text
    assert "/help" in text
`;

const TEST_SECURITY = `from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from aiogram.types import Update
from pydantic import ValidationError

from app.config import Settings
from app.middlewares.allowlist import is_admin
from app.middlewares.dedupe import DedupeMiddleware

VALID_TOKEN = "123456:" + "A" * 30


def test_config_accepts_valid_token() -> None:
    settings = Settings(bot_token=VALID_TOKEN, webhook_secret="secret_1", _env_file=None)
    assert settings.bot_mode == "polling"
    assert settings.port == 8080


def test_config_rejects_bad_token() -> None:
    with pytest.raises(ValidationError):
        Settings(bot_token="not-a-token", _env_file=None)


def test_config_rejects_plain_http_webhook() -> None:
    with pytest.raises(ValidationError):
        Settings(
            bot_token=VALID_TOKEN,
            webhook_url="http://example.com/hook",
            _env_file=None,
        )


def test_config_rejects_out_of_range_port() -> None:
    with pytest.raises(ValidationError):
        Settings(bot_token=VALID_TOKEN, port=70000, _env_file=None)


def test_admin_id_set_parses_csv() -> None:
    settings = Settings(bot_token=VALID_TOKEN, admin_ids="1, 2,bad", _env_file=None)
    assert settings.admin_id_set == frozenset({1, 2})


def test_is_admin() -> None:
    admins = frozenset({1, 2})
    assert is_admin(1, admins) is True
    assert is_admin(3, admins) is False
    assert is_admin(None, admins) is False


@pytest.mark.asyncio
async def test_dedupe_disabled_passes_through() -> None:
    middleware = DedupeMiddleware(None)
    handler = AsyncMock(return_value="ok")
    result = await middleware(handler, Update(update_id=42), {})
    assert result == "ok"
    handler.assert_awaited_once()
`;

const TEST_WEBHOOK_SECRET = `from __future__ import annotations

from typing import cast

import pytest
from aiogram import Bot, Dispatcher
from aiohttp.test_utils import TestClient, TestServer

from app.config import Settings
from app.webhook import create_webhook_app

VALID_TOKEN = "123456:" + "A" * 30


def _settings() -> Settings:
    return Settings(
        bot_token=VALID_TOKEN, webhook_secret="secret_1", _env_file=None
    )


def _bot() -> Bot:
    return Bot(token=VALID_TOKEN)


@pytest.mark.asyncio
async def test_webhook_rejects_missing_secret_header() -> None:
    dispatcher = Dispatcher()
    app = create_webhook_app(dispatcher, _bot(), _settings())
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/webhook", json={"update_id": 1})
        assert response.status == 401


@pytest.mark.asyncio
async def test_healthz() -> None:
    dispatcher = Dispatcher()
    app = create_webhook_app(dispatcher, _bot(), _settings())
    async with TestClient(TestServer(app)) as client:
        response = await client.get("/healthz")
        assert response.status == 200
        assert await response.json() == {"ok": True}


def test_webhook_requires_secret_in_webhook_mode() -> None:
    dispatcher = Dispatcher()
    settings = Settings(bot_token=VALID_TOKEN, _env_file=None)
    with pytest.raises(RuntimeError):
        create_webhook_app(dispatcher, cast(Bot, object()), settings)
`;

const SERVICES_INIT = `"""Service package."""
`;

const RETRY_SERVICE = `from __future__ import annotations

import asyncio

DEFAULT_RETRY_AFTER = 1.0
MAX_RETRY_AFTER = 30.0


def get_retry_after(exception: BaseException) -> float | None:
    value = getattr(exception, "retry_after", None)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def is_retry_after_error(exception: BaseException) -> bool:
    return get_retry_after(exception) is not None


async def sleep_retry_after(exception: BaseException) -> float:
    delay = get_retry_after(exception) or DEFAULT_RETRY_AFTER
    delay = max(DEFAULT_RETRY_AFTER, min(delay, MAX_RETRY_AFTER))
    await asyncio.sleep(delay)
    return delay
`;

const API104 = `"""Typed raw adapter for Bot API 10.4 methods missing from aiogram 3.31.0."""

from __future__ import annotations

from typing import Any

from aiogram import Bot
from aiogram.methods.base import TelegramMethod
from aiogram.types import (
    Chat,
    ChatIdUnion,
    InputRichMessage,
    Message,
    MessageEntity,
    ReplyMarkupUnion,
    ReplyParameters,
    SuggestedPostParameters,
    User,
)
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class EphemeralMessageParameters(BaseModel):
    model_config = ConfigDict(extra="allow")

    receiver_user_id: int | None = None
    callback_query_id: str | None = None
    replace_callback_query_message: bool | None = None


class WidgetQuery(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    from_: User = Field(alias="from")
    chat: Chat | None = None
    message_id: int | None = None
    inline_message_id: str | None = None
    chat_instance: str = ""
    chat_type: str | None = None
    type: dict[str, Any] = Field(default_factory=dict)
    data: str = ""
    widget_id: str | None = None


class SharedWidgetQuery(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    from_: User = Field(alias="from")
    type: dict[str, Any] = Field(default_factory=dict)
    data: str = ""
    widget_id: str


class SendWidget(TelegramMethod[Message]):
    __returning__ = Message
    __api_method__ = "sendWidget"

    chat_id: ChatIdUnion
    html: str = Field(min_length=1, max_length=32768)
    message_thread_id: int | None = None
    width: int | None = None
    height: int | None = None
    public_data: str | None = Field(default=None, max_length=1024)
    chat_data: str | None = Field(default=None, max_length=1024)
    caption: str | None = Field(default=None, max_length=1024)
    parse_mode: str | None = None
    caption_entities: list[MessageEntity] | None = None
    show_caption_above_media: bool | None = None
    allow_queries: bool | None = None
    is_shared: bool | None = None
    disable_notification: bool | None = None
    protect_content: bool | None = None
    allow_paid_broadcast: bool | None = None
    message_effect_id: str | None = None
    reply_parameters: ReplyParameters | None = None
    reply_markup: ReplyMarkupUnion | None = None


class SendSharedWidget(TelegramMethod[Message]):
    __returning__ = Message
    __api_method__ = "sendSharedWidget"

    chat_id: ChatIdUnion
    widget_id: str
    message_thread_id: int | None = None
    chat_data: str | None = Field(default=None, max_length=1024)
    caption: str | None = Field(default=None, max_length=1024)
    parse_mode: str | None = None
    caption_entities: list[MessageEntity] | None = None
    show_caption_above_media: bool | None = None
    disable_notification: bool | None = None
    protect_content: bool | None = None
    allow_paid_broadcast: bool | None = None
    message_effect_id: str | None = None
    reply_parameters: ReplyParameters | None = None
    reply_markup: ReplyMarkupUnion | None = None


class AnswerWidgetQuery(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "answerWidgetQuery"

    widget_query_id: str
    data: str | None = Field(default=None, max_length=1024)


class EditMessageWidgetData(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "editMessageWidgetData"

    chat_id: ChatIdUnion | None = None
    message_id: int | None = None
    inline_message_id: str | None = None
    public_data: str | None = Field(default=None, max_length=1024)
    chat_data: str | None = Field(default=None, max_length=1024)

    @model_validator(mode="after")
    def _require_target(self) -> EditMessageWidgetData:
        if self.inline_message_id is None and (
            self.chat_id is None or self.message_id is None
        ):
            raise ValueError(
                "chat_id and message_id are required unless inline_message_id is set"
            )
        return self


class EditSharedWidgetData(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "editSharedWidgetData"

    widget_id: str
    public_data: str = Field(max_length=1024)
    cache_time: int | None = Field(default=None, ge=5, le=3600)


class SendRichMessage(TelegramMethod[Message]):
    __returning__ = Message
    __api_method__ = "sendRichMessage"

    business_connection_id: str | None = None
    chat_id: ChatIdUnion | None = None
    message_thread_id: int | None = None
    direct_messages_topic_id: int | None = None
    ephemeral_message_parameters: EphemeralMessageParameters | None = None
    rich_message: InputRichMessage
    disable_notification: bool | None = None
    protect_content: bool | None = None
    allow_paid_broadcast: bool | None = None
    message_effect_id: str | None = None
    suggested_post_parameters: SuggestedPostParameters | None = None
    reply_parameters: ReplyParameters | None = None
    reply_markup: ReplyMarkupUnion | None = None

    @model_validator(mode="after")
    def _require_target(self) -> SendRichMessage:
        if self.chat_id is None:
            parameters = self.ephemeral_message_parameters
            if parameters is None or parameters.callback_query_id is None:
                raise ValueError(
                    "chat_id is required unless the message replies to a callback query"
                )
        return self


class SendRichMessageDraft(TelegramMethod[bool]):
    __returning__ = bool
    __api_method__ = "sendRichMessageDraft"

    chat_id: int
    draft_id: int
    rich_message: InputRichMessage
    message_thread_id: int | None = None
    can_stop: bool | None = None
    keep_on_stop: bool | None = None

    @field_validator("draft_id")
    @classmethod
    def _validate_draft_id(cls, value: int) -> int:
        if value == 0:
            raise ValueError("draft_id must be non-zero")
        return value


def _build_rich_message(
    rich_message: InputRichMessage | None,
    html: str | None,
    markdown: str | None,
) -> InputRichMessage:
    if rich_message is not None:
        return rich_message
    if (html is None) == (markdown is None):
        raise ValueError("provide exactly one of rich_message, html, or markdown")
    return InputRichMessage(html=html, markdown=markdown)


async def send_widget(
    bot: Bot,
    *,
    chat_id: int | str,
    html: str,
    width: int | None = None,
    height: int | None = None,
    public_data: str | None = None,
    chat_data: str | None = None,
    caption: str | None = None,
    allow_queries: bool = False,
    is_shared: bool = False,
    reply_markup: ReplyMarkupUnion | None = None,
) -> Message:
    return await bot(
        SendWidget(
            chat_id=chat_id,
            html=html,
            width=width,
            height=height,
            public_data=public_data,
            chat_data=chat_data,
            caption=caption,
            allow_queries=allow_queries,
            is_shared=is_shared,
            reply_markup=reply_markup,
        )
    )


async def send_shared_widget(
    bot: Bot,
    *,
    chat_id: int | str,
    widget_id: str,
    chat_data: str | None = None,
    caption: str | None = None,
    reply_markup: ReplyMarkupUnion | None = None,
) -> Message:
    return await bot(
        SendSharedWidget(
            chat_id=chat_id,
            widget_id=widget_id,
            chat_data=chat_data,
            caption=caption,
            reply_markup=reply_markup,
        )
    )


async def answer_widget_query(
    bot: Bot, *, widget_query_id: str, data: str = ""
) -> bool:
    return await bot(AnswerWidgetQuery(widget_query_id=widget_query_id, data=data))


async def edit_message_widget_data(
    bot: Bot,
    *,
    chat_id: int | str | None = None,
    message_id: int | None = None,
    inline_message_id: str | None = None,
    public_data: str | None = None,
    chat_data: str | None = None,
) -> bool:
    return await bot(
        EditMessageWidgetData(
            chat_id=chat_id,
            message_id=message_id,
            inline_message_id=inline_message_id,
            public_data=public_data,
            chat_data=chat_data,
        )
    )


async def edit_shared_widget_data(
    bot: Bot,
    *,
    widget_id: str,
    public_data: str,
    cache_time: int | None = None,
) -> bool:
    return await bot(
        EditSharedWidgetData(
            widget_id=widget_id,
            public_data=public_data,
            cache_time=cache_time,
        )
    )


async def send_rich_message(
    bot: Bot,
    *,
    chat_id: int | str | None = None,
    rich_message: InputRichMessage | None = None,
    html: str | None = None,
    markdown: str | None = None,
    reply_markup: ReplyMarkupUnion | None = None,
    ephemeral_message_parameters: EphemeralMessageParameters | None = None,
) -> Message:
    return await bot(
        SendRichMessage(
            chat_id=chat_id,
            rich_message=_build_rich_message(rich_message, html, markdown),
            reply_markup=reply_markup,
            ephemeral_message_parameters=ephemeral_message_parameters,
        )
    )


async def send_rich_message_draft(
    bot: Bot,
    *,
    chat_id: int,
    draft_id: int,
    rich_message: InputRichMessage | None = None,
    html: str | None = None,
    markdown: str | None = None,
    can_stop: bool = False,
    keep_on_stop: bool = False,
) -> bool:
    return await bot(
        SendRichMessageDraft(
            chat_id=chat_id,
            draft_id=draft_id,
            rich_message=_build_rich_message(rich_message, html, markdown),
            can_stop=can_stop,
            keep_on_stop=keep_on_stop,
        )
    )
`;

const HANDLERS_WIDGETS = `from __future__ import annotations

from typing import Any

from aiogram import Bot, Dispatcher
from aiogram.filters import Filter
from aiogram.types import Update

from app.services.api104 import SharedWidgetQuery, WidgetQuery, answer_widget_query

WIDGET_ACK = "ack"


class UpdateFieldFilter(Filter):
    def __init__(self, field: str) -> None:
        self.field = field

    async def __call__(self, update: Update) -> bool:
        extra = update.model_extra or {}
        return extra.get(self.field) is not None


def _raw(update: Update, field: str) -> dict[str, Any] | None:
    extra = update.model_extra or {}
    value = extra.get(field)
    return value if isinstance(value, dict) else None


async def on_widget_query(update: Update, bot: Bot) -> None:
    raw = _raw(update, "widget_query")
    if raw is None:
        return
    query = WidgetQuery.model_validate(raw)
    await answer_widget_query(bot, widget_query_id=query.id, data=WIDGET_ACK)


async def on_shared_widget_query(update: Update, bot: Bot) -> None:
    raw = _raw(update, "shared_widget_query")
    if raw is None:
        return
    query = SharedWidgetQuery.model_validate(raw)
    await answer_widget_query(bot, widget_query_id=query.id, data=WIDGET_ACK)


def register(dp: Dispatcher, _bot: Bot) -> None:
    dp.update.register(on_widget_query, UpdateFieldFilter("widget_query"))
    dp.update.register(on_shared_widget_query, UpdateFieldFilter("shared_widget_query"))
    extra: list[str] = dp.workflow_data.setdefault("allowed_updates_extra", [])
    extra.extend(["widget_query", "shared_widget_query"])
`;

const HANDLERS_RICH = `from __future__ import annotations

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command
from aiogram.types import Message

from app.services.api104 import send_rich_message, send_rich_message_draft

router = Router(name="rich")

RICH_DRAFT_ID = 1
RICH_DRAFT_HTML = "<b>Generating rich message…</b>"
RICH_FINAL_HTML = "<b>Rich message</b>\\nThis message was sent with <code>sendRichMessage</code>."


@router.message(Command("rich"))
async def rich_demo(message: Message, bot: Bot) -> None:
    chat_id = message.chat.id
    await send_rich_message_draft(
        bot,
        chat_id=chat_id,
        draft_id=RICH_DRAFT_ID,
        html=RICH_DRAFT_HTML,
    )
    await send_rich_message(bot, chat_id=chat_id, html=RICH_FINAL_HTML)


def register(dp: Dispatcher, _bot: Bot) -> None:
    dp.include_router(router)
`;

const TEST_API104 = `from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest
from aiogram.types import Message
from pydantic import ValidationError

from app.services import api104


def test_widget_method_metadata() -> None:
    assert api104.SendWidget.__api_method__ == "sendWidget"
    assert api104.SendWidget.__returning__ is Message
    assert api104.SendSharedWidget.__api_method__ == "sendSharedWidget"
    assert api104.AnswerWidgetQuery.__api_method__ == "answerWidgetQuery"
    assert api104.EditMessageWidgetData.__api_method__ == "editMessageWidgetData"
    assert api104.EditSharedWidgetData.__api_method__ == "editSharedWidgetData"
    assert api104.SendRichMessage.__api_method__ == "sendRichMessage"
    assert api104.SendRichMessageDraft.__api_method__ == "sendRichMessageDraft"


def test_send_widget_bounds() -> None:
    assert api104.SendWidget(chat_id=1, html="<b>x</b>").html == "<b>x</b>"
    with pytest.raises(ValidationError):
        api104.SendWidget(chat_id=1, html="")
    with pytest.raises(ValidationError):
        api104.SendWidget(chat_id=1, html="x" * 32769)
    with pytest.raises(ValidationError):
        api104.SendWidget(chat_id=1, html="<b>x</b>", public_data="x" * 1025)


def test_edit_shared_widget_cache_time_bounds() -> None:
    method = api104.EditSharedWidgetData(
        widget_id="w", public_data="data", cache_time=5
    )
    assert method.cache_time == 5
    with pytest.raises(ValidationError):
        api104.EditSharedWidgetData(widget_id="w", public_data="data", cache_time=4)
    with pytest.raises(ValidationError):
        api104.EditSharedWidgetData(widget_id="w", public_data="data", cache_time=3601)


def test_answer_widget_query_data_bound() -> None:
    assert api104.AnswerWidgetQuery(widget_query_id="q", data="x" * 1024).data
    with pytest.raises(ValidationError):
        api104.AnswerWidgetQuery(widget_query_id="q", data="x" * 1025)


def test_edit_message_widget_data_requires_target() -> None:
    with pytest.raises(ValidationError):
        api104.EditMessageWidgetData(public_data="x")
    assert api104.EditMessageWidgetData(inline_message_id="i", public_data="x")


def test_rich_message_requires_chat_or_callback_reply() -> None:
    with pytest.raises(ValidationError):
        api104.SendRichMessage(rich_message={"html": "<b>x</b>"})
    assert api104.SendRichMessage(
        rich_message={"html": "<b>x</b>"},
        ephemeral_message_parameters={"callback_query_id": "cb"},
    )


def test_rich_draft_rejects_zero_id() -> None:
    with pytest.raises(ValidationError):
        api104.SendRichMessageDraft(
            chat_id=1, draft_id=0, rich_message={"html": "<b>x</b>"}
        )


@pytest.mark.asyncio
async def test_answer_widget_query_helper_calls_bot() -> None:
    bot: Any = AsyncMock(return_value=True)
    result = await api104.answer_widget_query(bot, widget_query_id="q", data="ack")
    assert result is True
    method = bot.await_args.args[0]
    assert isinstance(method, api104.AnswerWidgetQuery)
    assert method.widget_query_id == "q"
`;

const TEST_WIDGETS = `from __future__ import annotations

from typing import Any

import pytest
from aiogram.types import Update

from app.handlers import widgets


@pytest.mark.asyncio
async def test_update_field_filter_matches_widget_query() -> None:
    filter_ = widgets.UpdateFieldFilter("widget_query")
    update = Update(update_id=1, widget_query={"id": "q"})
    assert await filter_(update) is True
    assert await filter_(Update(update_id=2)) is False


@pytest.mark.asyncio
async def test_widget_query_is_answered(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    async def fake_answer(bot: Any, *, widget_query_id: str, data: str = "") -> bool:
        seen["id"] = widget_query_id
        seen["data"] = data
        return True

    monkeypatch.setattr(widgets, "answer_widget_query", fake_answer)
    update = Update(
        update_id=1,
        widget_query={
            "id": "query-1",
            "from": {"id": 7, "is_bot": False, "first_name": "Tester"},
            "data": "payload",
        },
    )
    await widgets.on_widget_query(update, object())
    assert seen == {"id": "query-1", "data": "ack"}
`;

const TEST_RETRY = `from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from aiogram.exceptions import TelegramRetryAfter
from aiogram.methods import GetMe

from app.services.retry import get_retry_after, is_retry_after_error, sleep_retry_after


def _retry_after(retry_after: int) -> TelegramRetryAfter:
    return TelegramRetryAfter(
        method=GetMe(), message="flood control", retry_after=retry_after
    )


def test_retry_after_is_parsed() -> None:
    exception = _retry_after(7)
    assert get_retry_after(exception) == 7.0
    assert is_retry_after_error(exception) is True
    assert is_retry_after_error(RuntimeError("boom")) is False


@pytest.mark.asyncio
async def test_sleep_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep = AsyncMock()
    monkeypatch.setattr("app.services.retry.asyncio.sleep", sleep)
    delay = await sleep_retry_after(_retry_after(7))
    assert delay == 7.0
    sleep.assert_awaited_once_with(7.0)


@pytest.mark.asyncio
async def test_sleep_retry_after_is_clamped(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep = AsyncMock()
    monkeypatch.setattr("app.services.retry.asyncio.sleep", sleep)
    assert await sleep_retry_after(_retry_after(3600)) == 30.0
    assert await sleep_retry_after(RuntimeError("boom")) == 1.0
`;

const README_104 = `## Bot API 10.4 typed raw adapter

\`app/services/api104.py\` implements typed \`TelegramMethod\` wrappers for Bot API 10.4
methods that aiogram 3.31.0 does not ship: \`sendWidget\`, \`sendSharedWidget\`,
\`answerWidgetQuery\`, \`editMessageWidgetData\`, \`editSharedWidgetData\`,
\`sendRichMessage\`, and \`sendRichMessageDraft\`. Call them as \`await bot(method)\` or
through the matching helper coroutine. Widget queries must be answered within 15
seconds; rich message drafts are temporary 30-second previews and must be replaced by
a final \`sendRichMessage\` call.
`;

export function renderAiogramProject(spec: BotSpec): TemplateFile[] {
  const target = resolveStack("aiogram").target;
  const features = new Set(spec.features.map((feature) => String(feature)));
  const files: TemplateFile[] = baseFiles(spec, target).map((file) =>
    file.path === "README.md" ? { ...file, content: `${file.content}\n${README_104}` } : file,
  );
  files.push(
    { path: "alembic.ini", content: ALEMBIC_INI },
    { path: "migrations/env.py", content: ALEMBIC_ENV },
    { path: "migrations/versions/0001_init.py", content: MIGRATION_0001 },
    { path: "app/__init__.py", content: '"""Telegram bot package."""\n' },
    { path: "app/config.py", content: APP_CONFIG },
    { path: "app/logger.py", content: APP_LOGGER },
    { path: "app/bot.py", content: APP_BOT },
    { path: "app/main.py", content: APP_MAIN },
    { path: "app/webhook.py", content: APP_WEBHOOK },
    { path: "app/handlers/__init__.py", content: HANDLERS_INIT },
    { path: "app/handlers/commands.py", content: HANDLERS_COMMANDS },
    { path: "app/handlers/admin.py", content: HANDLERS_ADMIN },
    { path: "app/middlewares/__init__.py", content: MIDDLEWARES_INIT },
    { path: "app/middlewares/allowlist.py", content: MIDDLEWARES_ALLOWLIST },
    { path: "app/middlewares/dedupe.py", content: MIDDLEWARES_DEDUPE },
    { path: "app/middlewares/rate_limit.py", content: MIDDLEWARES_RATE_LIMIT },
    { path: "app/services/__init__.py", content: SERVICES_INIT },
    { path: "app/services/api104.py", content: API104 },
    { path: "app/services/retry.py", content: RETRY_SERVICE },
    { path: "app/db/__init__.py", content: DB_INIT },
    { path: "app/db/session.py", content: DB_SESSION },
    { path: "app/db/models.py", content: DB_MODELS },
    { path: "tests/test_commands.py", content: TEST_COMMANDS },
    { path: "tests/test_security.py", content: TEST_SECURITY },
    { path: "tests/test_webhook_secret.py", content: TEST_WEBHOOK_SECRET },
    { path: "tests/test_api104.py", content: TEST_API104 },
    { path: "tests/test_retry.py", content: TEST_RETRY },
  );
  if (features.has("widgets")) {
    files.push(
      { path: "app/handlers/widgets.py", content: HANDLERS_WIDGETS },
      { path: "tests/test_widgets.py", content: TEST_WIDGETS },
    );
  }
  if (features.has("rich")) {
    files.push({ path: "app/handlers/rich.py", content: HANDLERS_RICH });
  }
  assertNoTokenLiteral(files);
  return files;
}
