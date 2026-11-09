from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from aiogram.exceptions import TelegramRetryAfter
from aiogram.methods import GetMe

from app.services.retry import get_retry_after, is_retry_after_error, sleep_retry_after


def _retry_after(retry_after: int) -> TelegramRetryAfter:
    return TelegramRetryAfter(
        method=GetMe(), message="flood control", retry_after=retry_after
    )


def test_retry_after_is_parsed() -> None:
    exception = _retry_after(7)
    assert get_retry_after(exception) == 7.0
    assert is_retry_after_error(exception) is True
    assert is_retry_after_error(RuntimeError("boom")) is False


@pytest.mark.asyncio
async def test_sleep_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep = AsyncMock()
    monkeypatch.setattr("app.services.retry.asyncio.sleep", sleep)
    delay = await sleep_retry_after(_retry_after(7))
    assert delay == 7.0
    sleep.assert_awaited_once_with(7.0)


@pytest.mark.asyncio
async def test_sleep_retry_after_is_clamped(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep = AsyncMock()
    monkeypatch.setattr("app.services.retry.asyncio.sleep", sleep)
    assert await sleep_retry_after(_retry_after(3600)) == 30.0
    assert await sleep_retry_after(RuntimeError("boom")) == 1.0
