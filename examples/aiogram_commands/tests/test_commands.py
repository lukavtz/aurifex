from __future__ import annotations

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
