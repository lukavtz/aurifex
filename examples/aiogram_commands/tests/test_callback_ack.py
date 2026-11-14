from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
from aiogram.types import CallbackQuery

from app.middlewares.callback_ack import CallbackAckMiddleware


def _event() -> MagicMock:
    event = MagicMock(spec=CallbackQuery)
    event.answer = AsyncMock()
    return event


@pytest.mark.asyncio
async def test_fast_failure_answers_once_and_reraises() -> None:
    middleware = CallbackAckMiddleware(timeout=10)
    event = _event()

    async def handler(_event: object, _data: dict[str, object]) -> None:
        raise ValueError("boom")

    with pytest.raises(ValueError):
        await middleware(handler, event, {})
    event.answer.assert_awaited_once()


@pytest.mark.asyncio
async def test_success_does_not_answer() -> None:
    middleware = CallbackAckMiddleware(timeout=10)
    event = _event()

    async def handler(_event: object, _data: dict[str, object]) -> str:
        return "ok"

    assert await middleware(handler, event, {}) == "ok"
    event.answer.assert_not_awaited()


@pytest.mark.asyncio
async def test_slow_handler_is_answered_once() -> None:
    middleware = CallbackAckMiddleware(timeout=0.01)
    event = _event()

    async def handler(_event: object, _data: dict[str, object]) -> None:
        await asyncio.sleep(0.05)

    await middleware(handler, event, {})
    event.answer.assert_awaited_once()
