import type { BotFeature, BotSpec } from "../../spec/bot-spec.ts";
import { pythonModuleName, slugToTitle } from "../../spec/bot-spec.ts";
import { renderMiniApp } from "../templates/miniapp.ts";
import type { TemplateFile } from "../templates/shared.ts";

function file(path: string, content: string): TemplateFile {
  return { path, content };
}

function commandModule(name: string): string {
  return `from aiogram import Bot, Dispatcher, F, Router
from aiogram.types import Message

COMMAND = ${JSON.stringify(`/${name}`)}
TITLE = ${JSON.stringify(slugToTitle(name))}


async def handle_command(message: Message) -> None:
    await message.answer(TITLE + " is not implemented yet.")


def register(dp: Dispatcher, bot: Bot) -> None:
    router = Router(name=${JSON.stringify(name)})
    router.message.register(handle_command, F.text == COMMAND)
    dp.include_router(router)
`;
}

function commandTest(module: string): string {
  return `from unittest.mock import AsyncMock

import pytest

from app.handlers.${module} import handle_command


@pytest.mark.asyncio
async def test_command_replies() -> None:
    message = AsyncMock()
    await handle_command(message)
    message.answer.assert_awaited_once()
`;
}

const LLM_SERVICE = `import os
from typing import Any

import httpx

TIMEOUT_SECONDS = 8.0
MAX_TOKENS = 800
ERROR_TEXT = "The assistant is unavailable right now. Please try again later."


def _config() -> tuple[str, str, str] | None:
    base_url = os.getenv("LLM_BASE_URL", "").rstrip("/")
    model = os.getenv("LLM_MODEL", "")
    api_key = os.getenv("LLM_API_KEY", "")
    if not base_url or not model or not api_key:
        return None
    return base_url, model, api_key


def _content(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0]
    if not isinstance(first, dict):
        return None
    message = first.get("message")
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    return None


async def ask(prompt: str) -> str:
    config = _config()
    if config is None:
        return ERROR_TEXT
    base_url, model, api_key = config
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(
                base_url + "/chat/completions",
                headers={"Authorization": "Bearer " + api_key},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": MAX_TOKENS,
                },
            )
            response.raise_for_status()
            return _content(response.json()) or ERROR_TEXT
    except Exception:
        return ERROR_TEXT
`;

const LLM_HANDLER = `from aiogram import Bot, Dispatcher, F, Router
from aiogram.types import Message

from app.services.llm import ask

COMMAND = "/llm"


async def handle_llm(message: Message) -> None:
    prompt = (message.text or "").partition(" ")[2].strip()
    if not prompt:
        await message.answer("Usage: /llm <prompt>")
        return
    await message.answer(await ask(prompt))


def register(dp: Dispatcher, bot: Bot) -> None:
    router = Router(name="llm")
    router.message.register(handle_llm, F.text.startswith(COMMAND))
    dp.include_router(router)
`;

const LLM_TEST = `from unittest.mock import AsyncMock, patch

import pytest

from app.handlers.llm import handle_llm
from app.services.llm import ERROR_TEXT, ask


@pytest.mark.asyncio
async def test_llm_without_configuration_returns_static_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert await ask("hello") == ERROR_TEXT


@pytest.mark.asyncio
async def test_llm_without_prompt_replies_usage() -> None:
    message = AsyncMock()
    message.text = "/llm"
    with patch("app.handlers.llm.ask", new=AsyncMock(return_value="unused")):
        await handle_llm(message)
    message.answer.assert_awaited_once_with("Usage: /llm <prompt>")
`;

const INLINE_MODULE = `from aiogram import Bot, Dispatcher, Router
from aiogram.types import InlineQuery, InlineQueryResultArticle, InputTextMessageContent


async def handle_inline(query: InlineQuery) -> None:
    text = query.query.strip() or "Hello"
    await query.answer(
        results=[
            InlineQueryResultArticle(
                id="share",
                title="Send this text",
                description=text,
                input_message_content=InputTextMessageContent(message_text=text),
            )
        ],
        cache_time=0,
    )


def register(dp: Dispatcher, bot: Bot) -> None:
    router = Router(name="inline")
    router.inline_query.register(handle_inline)
    dp.include_router(router)
`;

const INLINE_TEST = `from unittest.mock import AsyncMock

import pytest

from app.handlers.inline import handle_inline


@pytest.mark.asyncio
async def test_inline_answers_with_one_article() -> None:
    query = AsyncMock()
    query.query = "hello"
    await handle_inline(query)
    query.answer.assert_awaited_once()
    results = query.answer.await_args.kwargs["results"]
    assert len(results) == 1
`;

const PAYMENTS_MODULE = `import asyncio
import json
import os
from pathlib import Path

from aiogram import Bot, Dispatcher, F, Router
from aiogram.types import LabeledPrice, Message, PreCheckoutQuery

PRICE_STARS = 1
TITLE = "Support the bot"


def store_path() -> Path:
    return Path(os.getenv("PAYMENTS_PATH", "data/payments.jsonl"))


def record_payment(charge_id: str, total_amount: int, user_id: int) -> None:
    path = store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"chargeId": charge_id, "totalAmount": total_amount, "userId": user_id}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload) + "\\n")


async def handle_buy(message: Message, bot: Bot) -> None:
    if message.from_user is None:
        return
    await bot.send_invoice(
        chat_id=message.chat.id,
        title=TITLE,
        description="One star",
        payload="stars:" + str(message.from_user.id),
        provider_token="",
        currency="XTR",
        prices=[LabeledPrice(label=TITLE, amount=PRICE_STARS)],
    )


async def handle_pre_checkout(query: PreCheckoutQuery, bot: Bot) -> None:
    await bot.answer_pre_checkout_query(query.id, ok=True)


async def handle_payment(message: Message) -> None:
    payment = message.successful_payment
    if payment is None or message.from_user is None:
        return
    await asyncio.to_thread(
        record_payment,
        payment.telegram_payment_charge_id,
        payment.total_amount,
        message.from_user.id,
    )
    await message.answer("Payment received. Thank you!")


def register(dp: Dispatcher, bot: Bot) -> None:
    router = Router(name="payments")
    router.message.register(handle_buy, F.text == "/buy")
    router.pre_checkout_query.register(handle_pre_checkout)
    router.message.register(handle_payment, F.successful_payment)
    dp.include_router(router)
`;

const PAYMENTS_TEST = `from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.handlers.payments import handle_pre_checkout, record_payment


def test_record_payment_appends(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "payments.jsonl"
    monkeypatch.setenv("PAYMENTS_PATH", str(target))
    record_payment("charge", 1, 7)
    lines = target.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    assert '"userId": 7' in lines[0]


@pytest.mark.asyncio
async def test_pre_checkout_is_answered() -> None:
    query = AsyncMock()
    query.id = "query"
    bot = AsyncMock()
    await handle_pre_checkout(query, bot)
    bot.answer_pre_checkout_query.assert_awaited_once_with("query", ok=True)
`;

const MINIAPP_SERVICE = `import hashlib
import hmac
import json
import os
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import parse_qsl

from aiogram import Bot, Dispatcher, F, Router
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo
from aiohttp import web

MAX_AGE_SECONDS = 86400
SESSION_PATH = "/api/miniapp/session"


def validate_init_data(
    init_data: str, bot_token: str, now: int | None = None
) -> dict[str, Any] | None:
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received = pairs.pop("hash", "")
    if not received:
        return None
    check_string = "\\n".join(key + "=" + pairs[key] for key in sorted(pairs))
    secret = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received.lower()):
        return None
    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError:
        return None
    current = int(time.time()) if now is None else now
    if auth_date <= 0 or current - auth_date > MAX_AGE_SECONDS:
        return None
    raw_user = pairs.get("user")
    if raw_user is None:
        return None
    try:
        user = json.loads(raw_user)
    except json.JSONDecodeError:
        return None
    if not isinstance(user, dict) or not isinstance(user.get("id"), int):
        return None
    return {"user": user, "authDate": auth_date}


def create_session_handler(bot_token: str) -> Callable[[web.Request], Awaitable[web.Response]]:
    async def handler(request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "invalid_json"}, status=400)
        init_data = body.get("initData") if isinstance(body, dict) else None
        if not isinstance(init_data, str) or not init_data:
            return web.json_response({"error": "invalid_request"}, status=400)
        session = validate_init_data(init_data, bot_token)
        if session is None:
            return web.json_response({"error": "invalid_init_data"}, status=401)
        user = session["user"]
        parts = [user.get("first_name"), user.get("last_name")]
        display_name = " ".join(part for part in parts if isinstance(part, str))
        return web.json_response({"user": {"id": user["id"], "displayName": display_name}})

    return handler


def register_routes(app: web.Application, bot_token: str) -> None:
    app.router.add_post(SESSION_PATH, create_session_handler(bot_token))


async def handle_miniapp(message: Message) -> None:
    url = os.getenv("MINIAPP_URL", os.getenv("WEBHOOK_URL", ""))
    if not url.startswith("https://"):
        await message.answer("Set WEBHOOK_URL to an HTTPS URL to open the mini app.")
        return
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Open", web_app=WebAppInfo(url=url))]]
    )
    await message.answer("Open the mini app:", reply_markup=keyboard)


def register(dp: Dispatcher, bot: Bot) -> None:
    router = Router(name="miniapp")
    router.message.register(handle_miniapp, F.text == "/miniapp")
    dp.include_router(router)
`;

const MINIAPP_TEST = `import hashlib
import hmac
import json
from urllib.parse import urlencode

from app.services.miniapp import validate_init_data

TOKEN = "unit-test-token"


def signed_init_data(auth_date: int) -> str:
    pairs = {
        "auth_date": str(auth_date),
        "query_id": "query",
        "user": json.dumps({"id": 7, "first_name": "Test"}),
    }
    check_string = "\\n".join(key + "=" + pairs[key] for key in sorted(pairs))
    secret = hmac.new(b"WebAppData", TOKEN.encode("utf-8"), hashlib.sha256).digest()
    digest = hmac.new(secret, check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    pairs["hash"] = digest
    return urlencode(pairs)


def test_valid_init_data_is_accepted() -> None:
    now = 1_800_000_000
    session = validate_init_data(signed_init_data(now - 60), TOKEN, now)
    assert session is not None
    assert session["user"]["id"] == 7


def test_stale_init_data_is_rejected() -> None:
    now = 1_800_000_000
    assert validate_init_data(signed_init_data(now - 90_000), TOKEN, now) is None


def test_tampered_init_data_is_rejected() -> None:
    now = 1_800_000_000
    tampered = signed_init_data(now - 60).replace("id%22%3A+7", "id%22%3A+8")
    assert validate_init_data(tampered, TOKEN, now) is None
`;

const MODERATION_MODULE = `import os
from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import Message, TelegramObject

DEFAULT_BLOCKED = ("casino", "crypto giveaway")


def blocked_words() -> tuple[str, ...]:
    raw = os.getenv("MODERATION_BLOCKED_WORDS", "")
    words = tuple(word.strip().lower() for word in raw.split(",") if word.strip())
    return words or DEFAULT_BLOCKED


def is_blocked(text: str) -> bool:
    lowered = text.lower()
    if "http://" in lowered or "https://" in lowered:
        return True
    return any(word in lowered for word in blocked_words())


class ModerationMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        if isinstance(event, Message) and event.text and is_blocked(event.text):
            try:
                await event.delete()
            except Exception:
                pass
            return None
        return await handler(event, data)
`;

const MODERATION_TEST = `from app.middlewares.moderation import is_blocked


def test_moderation_blocks_links() -> None:
    assert is_blocked("buy at https://example.com") is True
    assert is_blocked("hello there") is False
`;

const BROADCAST_MODULE = `import asyncio
import os
from collections.abc import Iterable

from aiogram import Bot

from app.services.retry import is_retry_after_error, sleep_retry_after

GLOBAL_PER_SECOND = 30


def idempotency_key(broadcast_id: str, user_id: int) -> str:
    return "broadcast:" + broadcast_id + ":" + str(user_id)


class BroadcastService:
    def __init__(self, bot: Bot) -> None:
        self._bot = bot
        self._locks: dict[int, asyncio.Lock] = {}
        self._sent: set[str] = set()
        self._next_slot = 0.0

    async def _throttle(self) -> None:
        interval = 1.0 / GLOBAL_PER_SECOND
        loop = asyncio.get_running_loop()
        now = loop.time()
        slot = max(now, self._next_slot)
        self._next_slot = slot + interval
        if slot > now:
            await asyncio.sleep(slot - now)

    async def _send(self, chat_id: int, text: str) -> None:
        try:
            await self._bot.send_message(chat_id, text)
        except Exception as error:
            if not is_retry_after_error(error):
                raise
            await sleep_retry_after(error)
            await self._bot.send_message(chat_id, text)

    async def send_one(self, chat_id: int, text: str, broadcast_id: str) -> bool:
        key = idempotency_key(broadcast_id, chat_id)
        lock = self._locks.setdefault(chat_id, asyncio.Lock())
        async with lock:
            if key in self._sent:
                return False
            await self._throttle()
            await self._send(chat_id, text)
            self._sent.add(key)
            return True

    async def broadcast(self, chat_ids: Iterable[int], text: str, broadcast_id: str) -> int:
        results = await asyncio.gather(
            *(self.send_one(chat_id, text, broadcast_id) for chat_id in chat_ids),
            return_exceptions=True,
        )
        return sum(1 for result in results if result is True)


def admin_ids() -> tuple[int, ...]:
    values = (value.strip() for value in os.getenv("ADMIN_IDS", "").split(","))
    return tuple(int(value) for value in values if value.isdigit())
`;

const BROADCAST_TEST = `from unittest.mock import AsyncMock

import pytest

from app.services.broadcast import BroadcastService, idempotency_key


def test_idempotency_key_is_stable() -> None:
    assert idempotency_key("b1", 7) == "broadcast:b1:7"


@pytest.mark.asyncio
async def test_broadcast_skips_repeated_recipients() -> None:
    bot = AsyncMock()
    service = BroadcastService(bot)
    assert await service.broadcast([1, 2], "hello", "b1") == 2
    assert await service.broadcast([1, 2], "hello", "b1") == 0
    assert bot.send_message.await_count == 2
`;

const WIDGETS_MODULE = `from aiogram import Bot, Dispatcher, Router
from aiogram.types import Message

from app.services.api104 import answer_widget_query

ANSWER_TIMEOUT_SECONDS = 15


def widget_query_id(message: Message) -> str | None:
    for field in ("widget_query", "shared_widget_query"):
        query = getattr(message, field, None)
        value = getattr(query, "id", None)
        if isinstance(value, str) and value:
            return value
    return None


async def handle_widget_query(message: Message, bot: Bot) -> None:
    query_id = widget_query_id(message)
    if query_id is None:
        return
    await answer_widget_query(bot, widget_query_id=query_id, data="ack")


async def is_widget_query(message: Message) -> bool:
    return widget_query_id(message) is not None


def register(dp: Dispatcher, bot: Bot) -> None:
    router = Router(name="widgets")
    router.message.register(handle_widget_query, is_widget_query)
    dp.include_router(router)
`;

function widgetsTest(module: string): string {
  return `from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.handlers.${module} import handle_widget_query, widget_query_id


def test_widget_query_id_reads_both_shapes() -> None:
    assert widget_query_id(SimpleNamespace(widget_query=SimpleNamespace(id="one"))) == "one"
    assert widget_query_id(SimpleNamespace(shared_widget_query=SimpleNamespace(id="two"))) == "two"
    assert widget_query_id(SimpleNamespace()) is None


@pytest.mark.asyncio
async def test_widget_query_is_answered() -> None:
    message = SimpleNamespace(widget_query=SimpleNamespace(id="query"))
    bot = AsyncMock()
    with patch("app.handlers.${module}.answer_widget_query", new=AsyncMock()) as answer:
        await handle_widget_query(message, bot)
    answer.assert_awaited_once_with(bot, widget_query_id="query", data="ack")
`;
}

const RICH_MODULE = `from aiogram import Bot, Dispatcher, F, Router
from aiogram.types import Message

from app.services.api104 import send_rich_message, send_rich_message_draft


def prompt_from(text: str | None) -> str:
    value = text or ""
    _, separator, rest = value.partition(" ")
    return rest.strip() if separator else ""


async def handle_rich(message: Message, bot: Bot) -> None:
    markdown = prompt_from(message.text)
    if not markdown:
        await message.answer("Usage: /rich <text>")
        return
    await send_rich_message_draft(
        bot,
        chat_id=message.chat.id,
        draft_id=message.message_id,
        markdown=markdown,
    )
    await send_rich_message(bot, chat_id=message.chat.id, markdown=markdown)


def register(dp: Dispatcher, bot: Bot) -> None:
    router = Router(name="rich")
    router.message.register(handle_rich, F.text.startswith("/rich"))
    dp.include_router(router)
`;

function richTest(module: string): string {
  return `from unittest.mock import AsyncMock

import pytest

from app.handlers.${module} import handle_rich, prompt_from


def test_rich_prompt_strips_the_command() -> None:
    assert prompt_from("/rich hello *world*") == "hello *world*"
    assert prompt_from("/rich") == ""
    assert prompt_from(None) == ""


@pytest.mark.asyncio
async def test_rich_without_text_replies_usage() -> None:
    message = AsyncMock()
    message.text = "/rich"
    message.chat.id = 1
    message.message_id = 2
    await handle_rich(message, AsyncMock())
    message.answer.assert_awaited_once_with("Usage: /rich <text>")
`;
}

export function renderAiogramFeature(
  feature: BotFeature,
  name: string,
  spec: BotSpec,
): TemplateFile[] {
  switch (feature) {
    case "commands": {
      const module = pythonModuleName(name);
      return [
        file(`app/handlers/${module}.py`, commandModule(module)),
        file(`tests/test_${module}.py`, commandTest(module)),
      ];
    }
    case "llm":
      return [
        file("app/services/llm.py", LLM_SERVICE),
        file("app/handlers/llm.py", LLM_HANDLER),
        file("tests/test_llm.py", LLM_TEST),
      ];
    case "inline":
      return [
        file("app/handlers/inline.py", INLINE_MODULE),
        file("tests/test_inline.py", INLINE_TEST),
      ];
    case "payments":
      return [
        file("app/handlers/payments.py", PAYMENTS_MODULE),
        file("tests/test_payments.py", PAYMENTS_TEST),
      ];
    case "miniapps":
      return [
        ...renderMiniApp(spec),
        file("app/services/miniapp.py", MINIAPP_SERVICE),
        file("tests/test_miniapp.py", MINIAPP_TEST),
      ];
    case "moderation":
      return [
        file("app/middlewares/moderation.py", MODERATION_MODULE),
        file("tests/test_moderation.py", MODERATION_TEST),
      ];
    case "broadcast":
      return [
        file("app/services/broadcast.py", BROADCAST_MODULE),
        file("tests/test_broadcast.py", BROADCAST_TEST),
      ];
    case "widgets":
      return [
        file(`app/handlers/${pythonModuleName(name)}.py`, WIDGETS_MODULE),
        file(`tests/test_${pythonModuleName(name)}.py`, widgetsTest(pythonModuleName(name))),
      ];
    case "rich":
      return [
        file(`app/handlers/${pythonModuleName(name)}.py`, RICH_MODULE),
        file(`tests/test_${pythonModuleName(name)}.py`, richTest(pythonModuleName(name))),
      ];
  }
}
