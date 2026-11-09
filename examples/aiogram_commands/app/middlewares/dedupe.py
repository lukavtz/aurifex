from __future__ import annotations

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
            logger.warning("dedupe unavailable; stopping update %s", update_id)
            return None
        if not claimed:
            logger.info("duplicate update %s ignored", update_id)
            return None
        return await handler(event, data)
