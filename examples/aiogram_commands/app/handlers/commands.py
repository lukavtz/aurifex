from __future__ import annotations

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command
from aiogram.types import Message

from app.services.i18n import t

router = Router(name="commands")


def locale_of(message: Message) -> str | None:
    return message.from_user.language_code if message.from_user else None


@router.message(Command("start"))
async def start(message: Message) -> None:
    await message.answer(t(locale_of(message), "start.welcome", bot="aiogram Commands"))


@router.message(Command("help"))
async def help_command(message: Message) -> None:
    locale = locale_of(message)
    await message.answer(t(locale, "help.title") + "\n" + t(locale, "help.commands"))


def register(dp: Dispatcher, _bot: Bot) -> None:
    dp.include_router(router)
