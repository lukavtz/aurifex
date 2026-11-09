from __future__ import annotations

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
    session_factory = create_session_factory(settings.database_url)
    dispatcher.workflow_data["session_factory"] = session_factory
    dispatcher.workflow_data["settings"] = settings
    dispatcher.update.middleware(DedupeMiddleware(redis))
    dispatcher.message.middleware(RateLimitMiddleware(redis))
    dispatcher.message.middleware(AllowlistMiddleware(settings.admin_id_set))
    dispatcher.errors.register(handle_error)
    register_handlers(dispatcher, bot)
    return dispatcher
