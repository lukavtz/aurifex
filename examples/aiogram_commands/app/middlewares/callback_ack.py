from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, TelegramObject

logger = logging.getLogger(__name__)

ACK_TIMEOUT_SECONDS = 2.0


class CallbackAckMiddleware(BaseMiddleware):
    """Answer a callback query when its handler fails before replying.

    The timer starts when the update arrives. A failure answers once and
    re-raises; success cancels the timer. The answered flag and the task live in
    this invocation, so bots never share state and cannot answer twice.
    """

    def __init__(self, timeout: float = ACK_TIMEOUT_SECONDS) -> None:
        self.timeout = timeout

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        if not isinstance(event, CallbackQuery):
            return await handler(event, data)
        answered = False

        async def answer_once() -> None:
            nonlocal answered
            if answered:
                return
            answered = True
            try:
                await event.answer()
            except Exception:
                logger.debug("callback answer failed", exc_info=True)

        async def answer_late() -> None:
            await asyncio.sleep(self.timeout)
            await answer_once()

        task = asyncio.create_task(answer_late())
        try:
            return await handler(event, data)
        except Exception:
            await answer_once()
            raise
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
