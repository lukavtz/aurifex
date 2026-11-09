from __future__ import annotations

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
