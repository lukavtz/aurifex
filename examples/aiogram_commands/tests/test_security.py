from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from aiogram.types import Update
from pydantic import ValidationError

from app.config import Settings
from app.middlewares.allowlist import is_admin
from app.middlewares.dedupe import DedupeMiddleware

VALID_TOKEN = "123456:" + "A" * 30


def test_config_accepts_valid_token() -> None:
    settings = Settings(bot_token=VALID_TOKEN, webhook_secret="secret_1", _env_file=None)
    assert settings.bot_mode == "polling"
    assert settings.port == 8080


def test_config_rejects_bad_token() -> None:
    with pytest.raises(ValidationError):
        Settings(bot_token="not-a-token", _env_file=None)


def test_config_rejects_plain_http_webhook() -> None:
    with pytest.raises(ValidationError):
        Settings(
            bot_token=VALID_TOKEN,
            webhook_url="http://example.com/hook",
            _env_file=None,
        )


def test_config_rejects_out_of_range_port() -> None:
    with pytest.raises(ValidationError):
        Settings(bot_token=VALID_TOKEN, port=70000, _env_file=None)


def test_admin_id_set_parses_csv() -> None:
    settings = Settings(bot_token=VALID_TOKEN, admin_ids="1, 2,bad", _env_file=None)
    assert settings.admin_id_set == frozenset({1, 2})


def test_is_admin() -> None:
    admins = frozenset({1, 2})
    assert is_admin(1, admins) is True
    assert is_admin(3, admins) is False
    assert is_admin(None, admins) is False


@pytest.mark.asyncio
async def test_dedupe_disabled_passes_through() -> None:
    middleware = DedupeMiddleware(None)
    handler = AsyncMock(return_value="ok")
    result = await middleware(handler, Update(update_id=42), {})
    assert result == "ok"
    handler.assert_awaited_once()
