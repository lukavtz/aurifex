from __future__ import annotations

from typing import cast

import pytest
from aiogram import Bot, Dispatcher
from aiohttp.test_utils import TestClient, TestServer

from app.config import Settings
from app.webhook import create_webhook_app

VALID_TOKEN = "123456:" + "A" * 30


def _settings() -> Settings:
    return Settings(
        bot_token=VALID_TOKEN, webhook_secret="secret_1", _env_file=None
    )


def _bot() -> Bot:
    return Bot(token=VALID_TOKEN)


@pytest.mark.asyncio
async def test_webhook_rejects_missing_secret_header() -> None:
    dispatcher = Dispatcher()
    app = create_webhook_app(dispatcher, _bot(), _settings())
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/webhook", json={"update_id": 1})
        assert response.status == 401


@pytest.mark.asyncio
async def test_healthz() -> None:
    dispatcher = Dispatcher()
    app = create_webhook_app(dispatcher, _bot(), _settings())
    async with TestClient(TestServer(app)) as client:
        response = await client.get("/healthz")
        assert response.status == 200
        assert await response.json() == {"ok": True}


def test_webhook_requires_secret_in_webhook_mode() -> None:
    dispatcher = Dispatcher()
    settings = Settings(bot_token=VALID_TOKEN, _env_file=None)
    with pytest.raises(RuntimeError):
        create_webhook_app(dispatcher, cast(Bot, object()), settings)
