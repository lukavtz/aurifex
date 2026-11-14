from __future__ import annotations

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
