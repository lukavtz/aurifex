from __future__ import annotations

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
