from __future__ import annotations

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
