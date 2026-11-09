import type { BotFeature, BotSpec } from "../../spec/bot-spec.ts";
import { pythonModuleName, slugToTitle } from "../../spec/bot-spec.ts";
import {
  renderBroadcastCommandPy,
  renderBroadcastJobPy,
  renderLlmEnqueuePy,
  renderLlmJobPy,
} from "../templates/jobs.ts";
import { renderMiniApp } from "../templates/miniapp.ts";
import { renderMiniAppSessionPy } from "../templates/miniapp-session.ts";
import { renderPaymentsPy } from "../templates/payments.ts";
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

const PAYMENTS_MODULE = `from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Any

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import LabeledPrice as TelegramLabeledPrice
from aiogram.types import Message, PreCheckoutQuery
from sqlalchemy import text

from app.runtime.payments import (
    PRODUCTS,
    LabeledPrice,
    PaymentError,
    SuccessfulPayment,
    cancel_subscription,
    create_invoice,
    record_successful_payment,
    refund_payment,
    validate_pre_checkout,
)
from app.runtime.payments import PreCheckoutQuery as RuntimePreCheckoutQuery
from app.services.i18n import t

PAYSUPPORT_TEXT = os.getenv(
    "PAYSUPPORT_TEXT",
    "Payments are processed by Telegram Stars. Contact the bot support for help.",
)
USAGE_TEXT = "Usage: /buy <product_id>. Available: "
ADMIN_ONLY_TEXT = "This command is available to administrators only."


class AiogramPayments:
    def __init__(self, bot: Bot) -> None:
        self._bot = bot

    async def send_invoice(
        self,
        chat_id: int,
        title: str,
        description: str,
        payload: str,
        currency: str,
        prices: Sequence[LabeledPrice],
        subscription_period: int | None = None,
    ) -> None:
        await self._bot.send_invoice(
            chat_id=chat_id,
            title=title,
            description=description,
            payload=payload,
            provider_token="",
            currency=currency,
            prices=[
                TelegramLabeledPrice(label=price.label, amount=price.amount)
                for price in prices
            ],
        )

    async def create_invoice_link(
        self,
        title: str,
        description: str,
        payload: str,
        currency: str,
        prices: Sequence[LabeledPrice],
        subscription_period: int | None = None,
    ) -> str:
        return await self._bot.create_invoice_link(
            title=title,
            description=description,
            payload=payload,
            provider_token="",
            currency=currency,
            prices=[
                TelegramLabeledPrice(label=price.label, amount=price.amount)
                for price in prices
            ],
        )

    async def refund_star_payment(self, user_id: int, charge_id: str) -> object:
        return await self._bot.refund_star_payment(
            user_id=user_id, telegram_payment_charge_id=charge_id
        )

    async def edit_user_star_subscription(
        self, user_id: int, charge_id: str, canceled: bool
    ) -> object:
        return await self._bot.edit_user_star_subscription(
            user_id=user_id,
            telegram_payment_charge_id=charge_id,
            is_canceled=canceled,
        )

    async def get_star_transactions(
        self, offset: int = 0, limit: int = 100
    ) -> Sequence[Any]:
        result = await self._bot.get_star_transactions(offset=offset, limit=limit)
        return result.transactions


def locale_of(user: Any) -> str | None:
    return getattr(user, "language_code", None) if user is not None else None


async def handle_buy(message: Message, bot: Bot, command: CommandObject) -> None:
    if message.from_user is None:
        return
    product_id = (command.args or "").strip()
    product = next((item for item in PRODUCTS if item.id == product_id), None)
    if product is None:
        await message.answer(USAGE_TEXT + ", ".join(item.id for item in PRODUCTS))
        return
    result = await create_invoice(
        AiogramPayments(bot), product, message.from_user.id, chat_id=message.chat.id
    )
    link = result.get("invoice_link")
    if link:
        await message.answer(link)


async def handle_paysupport(message: Message) -> None:
    await message.answer(PAYSUPPORT_TEXT)


async def handle_pre_checkout(query: PreCheckoutQuery, bot: Bot) -> None:
    if query.from_user is None:
        await query.answer(ok=False, error_message=t(None, "payments.precheckout_failed"))
        return
    check = validate_pre_checkout(
        RuntimePreCheckoutQuery(
            user_id=query.from_user.id,
            invoice_payload=query.invoice_payload,
            currency=query.currency,
            total_amount=query.total_amount,
        ),
        PRODUCTS,
    )
    if check.ok:
        await query.answer(ok=True)
        return
    await query.answer(
        ok=False,
        error_message=t(locale_of(query.from_user), "payments.precheckout_failed"),
    )


async def handle_successful_payment(
    message: Message, session_factory: Any, queue: Any
) -> None:
    payment = message.successful_payment
    user = message.from_user
    if payment is None or user is None:
        return
    raw = payment.model_dump(mode="json") if hasattr(payment, "model_dump") else {}
    display_name = " ".join(
        part for part in (user.first_name, user.last_name) if isinstance(part, str)
    )
    try:
        outcome = await record_successful_payment(
            session_factory,
            queue,
            SuccessfulPayment(
                user_id=user.id,
                charge_id=payment.telegram_payment_charge_id,
                invoice_payload=payment.invoice_payload,
                currency=payment.currency,
                total_amount=payment.total_amount,
                provider_charge_id=payment.provider_payment_charge_id,
                is_recurring=bool(payment.is_recurring),
                is_first_recurring=bool(payment.is_first_recurring),
                subscription_expiration_date=payment.subscription_expiration_date,
                username=user.username,
                display_name=display_name,
                raw=raw,
            ),
            PRODUCTS,
        )
    except PaymentError:
        await message.answer(t(locale_of(user), "errors.generic"))
        return
    if outcome["duplicate"]:
        return
    await message.answer(t(locale_of(user), "payments.thanks"))


async def handle_refund(
    message: Message, bot: Bot, session_factory: Any, settings: Any
) -> None:
    user = message.from_user
    if user is None or user.id not in settings.admin_id_set:
        await message.answer(ADMIN_ONLY_TEXT)
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) != 2 or not parts[1].strip():
        await message.answer("Usage: /refund <charge_id>")
        return
    charge_id = parts[1].strip()
    async with session_factory() as session:
        found = await session.execute(
            text("SELECT user_id FROM payments WHERE charge_id = :charge_id"),
            {"charge_id": charge_id},
        )
        row = found.mappings().first()
    if row is None:
        await message.answer("No payment found for that charge.")
        return
    try:
        outcome = await refund_payment(
            session_factory,
            AiogramPayments(bot),
            user_id=int(row["user_id"]),
            charge_id=charge_id,
        )
    except PaymentError:
        await message.answer("No payment found for that charge.")
        return
    if not outcome["refunded"]:
        await message.answer("Refund already completed.")
        return
    await message.answer("Refunded " + str(outcome["amount"]) + " stars.")


async def handle_subscriptions(message: Message, session_factory: Any) -> None:
    user = message.from_user
    if user is None:
        return
    async with session_factory() as session:
        found = await session.execute(
            text(
                "SELECT charge_id, expires_at FROM subscriptions "
                "WHERE user_id = :user_id AND canceled_at IS NULL "
                "AND expires_at > now() ORDER BY expires_at"
            ),
            {"user_id": user.id},
        )
        rows = found.mappings().all()
    if not rows:
        await message.answer("No active subscriptions.")
        return
    locale = locale_of(user)
    lines = [
        str(row["charge_id"])
        + " - "
        + t(locale, "subscription.active")
        + " until "
        + str(row["expires_at"])
        for row in rows
    ]
    await message.answer("\\n".join(lines))


async def handle_subscription_cancel(
    message: Message, bot: Bot, session_factory: Any, settings: Any
) -> None:
    user = message.from_user
    if user is None or user.id not in settings.admin_id_set:
        await message.answer(ADMIN_ONLY_TEXT)
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) != 2 or not parts[1].strip():
        await message.answer("Usage: /subscription_cancel <charge_id>")
        return
    charge_id = parts[1].strip()
    async with session_factory() as session:
        found = await session.execute(
            text("SELECT user_id FROM subscriptions WHERE charge_id = :charge_id"),
            {"charge_id": charge_id},
        )
        row = found.mappings().first()
    if row is None:
        await message.answer("No subscription found for that charge.")
        return
    try:
        outcome = await cancel_subscription(
            session_factory,
            AiogramPayments(bot),
            user_id=int(row["user_id"]),
            charge_id=charge_id,
        )
    except PaymentError:
        await message.answer("No subscription found for that charge.")
        return
    if not outcome["canceled"]:
        await message.answer("Subscription is already canceled.")
        return
    await message.answer(t(locale_of(user), "subscription.canceled"))


def register(dp: Dispatcher, _bot: Bot) -> None:
    router = Router(name="payments")
    router.message.register(handle_buy, Command("buy"))
    router.message.register(handle_paysupport, Command("paysupport"))
    router.pre_checkout_query.register(handle_pre_checkout)
    router.message.register(handle_successful_payment, F.successful_payment)
    router.message.register(handle_refund, Command("refund"))
    router.message.register(handle_subscriptions, Command("subscriptions"))
    router.message.register(handle_subscription_cancel, Command("subscription_cancel"))
    dp.include_router(router)
`;

const PAYMENT_FULFILL_JOB = `from __future__ import annotations

from sqlalchemy import text

from app.jobs import JobContext
from app.runtime.payments import SUBSCRIPTION_PERIOD_SECONDS
from app.runtime.queue import ClaimedJob

KIND = "payment.fulfill"

ENSURE_SUBSCRIPTION_SQL = text(
    """
    INSERT INTO subscriptions (charge_id, user_id, period_seconds, expires_at, canceled_at)
    SELECT p.charge_id, p.user_id, :period_seconds, p.subscription_expiration_date, NULL
    FROM payments p
    WHERE p.charge_id = :charge_id
      AND p.subscription_expiration_date IS NOT NULL
    ON CONFLICT (charge_id) DO NOTHING
    RETURNING charge_id
    """
)


async def handle(job: ClaimedJob, ctx: JobContext) -> None:
    payload = job.payload if isinstance(job.payload, dict) else {}
    charge_id = payload.get("chargeId")
    if not isinstance(charge_id, str) or not charge_id:
        raise ValueError("invalid payment.fulfill payload")
    async with ctx.session_factory() as session:
        async with session.begin():
            await session.execute(
                ENSURE_SUBSCRIPTION_SQL,
                {"charge_id": charge_id, "period_seconds": SUBSCRIPTION_PERIOD_SECONDS},
            )
`;

const PAYMENT_RECONCILE_JOB = `from __future__ import annotations

import datetime as dt

from app.handlers.payments import AiogramPayments
from app.jobs import JobContext
from app.runtime.payments import reconcile_payments
from app.runtime.queue import ClaimedJob

KIND = "payment.reconcile"
INTERVAL = dt.timedelta(hours=6)


async def handle(_job: ClaimedJob, ctx: JobContext) -> None:
    await reconcile_payments(ctx.session_factory, AiogramPayments(ctx.bot))
    await ctx.queue.enqueue(
        KIND,
        {"scheduledAt": dt.datetime.now(dt.UTC).isoformat()},
        run_at=dt.datetime.now(dt.UTC) + INTERVAL,
    )
`;

const PAYMENTS_TEST = `from __future__ import annotations

import datetime as dt
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.handlers import payments as handlers
from app.jobs import payment_reconcile
from app.runtime.payments import (
    PRODUCTS,
    SUBSCRIPTION_PERIOD_SECONDS,
    create_invoice,
    invoice_payload,
)


def _user(user_id: int = 42) -> SimpleNamespace:
    return SimpleNamespace(
        id=user_id,
        username="buyer",
        first_name="Test",
        last_name=None,
        language_code="en",
    )


def _message(**kwargs: Any) -> SimpleNamespace:
    data: dict[str, Any] = {"answer": AsyncMock(), "from_user": _user()}
    data.update(kwargs)
    return SimpleNamespace(**data)


class FakeBot:
    def __init__(self) -> None:
        self.invoices: list[dict[str, Any]] = []
        self.links: list[dict[str, Any]] = []
        self.transactions: list[Any] = []

    async def send_invoice(self, **kwargs: Any) -> None:
        self.invoices.append(kwargs)

    async def create_invoice_link(self, **kwargs: Any) -> str:
        self.links.append(kwargs)
        return "https://t.me/invoice"

    async def refund_star_payment(self, **kwargs: Any) -> object:
        return True

    async def edit_user_star_subscription(self, **kwargs: Any) -> object:
        return True

    async def get_star_transactions(self, offset: int = 0, limit: int = 100) -> Any:
        return SimpleNamespace(transactions=list(self.transactions))


class FakeResult:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self._row = row

    def mappings(self) -> Any:
        rows = [] if self._row is None else [self._row]
        return SimpleNamespace(first=lambda: self._row, all=lambda: rows)


class FakeSession:
    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *_args: object) -> bool:
        return False

    async def execute(self, *_args: object, **_kwargs: object) -> FakeResult:
        return FakeResult({"user_id": 42, "expires_at": "2030-01-01"})


class FakeSessionFactory:
    def __call__(self) -> FakeSession:
        return FakeSession()


@pytest.mark.asyncio
async def test_subscription_uses_invoice_link() -> None:
    product = next((item for item in PRODUCTS if item.subscription), None)
    if product is None:
        pytest.skip("no subscription product configured")
    bot = FakeBot()
    result = await create_invoice(handlers.AiogramPayments(bot), product, 42)  # type: ignore[arg-type]
    assert result["invoice_link"] == "https://t.me/invoice"
    assert bot.invoices == []
    assert bot.links[0]["subscription_period"] == SUBSCRIPTION_PERIOD_SECONDS


@pytest.mark.asyncio
async def test_precheckout_rejects_wrong_amount() -> None:
    product = PRODUCTS[0]
    query = SimpleNamespace(
        from_user=_user(),
        invoice_payload=invoice_payload(
            product.id, 42, "123e4567-e89b-42d3-a456-426614174000"
        ),
        currency="XTR",
        total_amount=product.stars + 1,
        answer=AsyncMock(),
    )
    await handlers.handle_pre_checkout(query, FakeBot())  # type: ignore[arg-type]
    query.answer.assert_awaited_once()
    assert query.answer.await_args.kwargs["ok"] is False
    assert query.answer.await_args.kwargs["error_message"]


@pytest.mark.asyncio
async def test_duplicate_payment_is_not_thanked_twice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = AsyncMock(return_value={"duplicate": True})
    monkeypatch.setattr(handlers, "record_successful_payment", record)
    payment = SimpleNamespace(
        telegram_payment_charge_id="charge",
        provider_payment_charge_id="provider",
        invoice_payload="payload",
        currency="XTR",
        total_amount=1,
        is_recurring=False,
        is_first_recurring=False,
        subscription_expiration_date=None,
    )
    message = _message(successful_payment=payment)
    await handlers.handle_successful_payment(
        message, session_factory=object(), queue=object()
    )
    record.assert_awaited_once()
    message.answer.assert_not_awaited()


@pytest.mark.asyncio
async def test_refund_uses_the_full_recorded_amount(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refund = AsyncMock(
        return_value={
            "refunded": True,
            "duplicate": False,
            "amount": 100,
            "status": "refunded",
        }
    )
    monkeypatch.setattr(handlers, "refund_payment", refund)
    message = _message(text="/refund charge-1", from_user=_user(999))
    settings = SimpleNamespace(admin_id_set=frozenset({999}))
    await handlers.handle_refund(
        message, FakeBot(), FakeSessionFactory(), settings  # type: ignore[arg-type]
    )
    refund.assert_awaited_once()
    assert refund.await_args.kwargs["user_id"] == 42
    assert refund.await_args.kwargs["charge_id"] == "charge-1"
    assert "100" in message.answer.await_args.args[0]


@pytest.mark.asyncio
async def test_reconcile_reschedules_without_granting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reconcile = AsyncMock(return_value={"inserted": 0})
    monkeypatch.setattr(payment_reconcile, "reconcile_payments", reconcile)
    queue = SimpleNamespace(enqueue=AsyncMock())
    ctx = SimpleNamespace(session_factory=object(), bot=FakeBot(), queue=queue)
    before = dt.datetime.now(dt.UTC)
    await payment_reconcile.handle(SimpleNamespace(payload={}), ctx)  # type: ignore[arg-type]
    queue.enqueue.assert_awaited_once()
    assert queue.enqueue.await_args.args[0] == "payment.reconcile"
    run_at = queue.enqueue.await_args.kwargs["run_at"]
    assert run_at >= before + dt.timedelta(hours=5)
    assert all(
        call.args[0] != "payment.fulfill" for call in queue.enqueue.await_args_list
    )
`;

const MINIAPP_SERVICE = `"""Mini App HTTP routes backed by the session runtime.

initData signatures are verified in app.runtime.miniapp_session with the
Telegram b"WebAppData" HMAC secret; this module only wires HTTP responses.
"""

from __future__ import annotations

import hashlib
from typing import Any

from aiohttp import web

from app.config import Settings
from app.runtime.miniapp_session import (
    SECURITY_HEADERS,
    SESSION_COOKIE,
    MiniAppAuthError,
    assert_mutation_authorized,
    clear_session_cookie,
    create_session,
    read_session,
    session_cookie,
)

SESSION_PATH = "/api/miniapp/session"
ME_PATH = "/api/miniapp/me"
PROFILE_KEY_PREFIX = "miniapp:profile:"
DEFAULT_SESSION_TTL_SECONDS = 86400


def _redis(request: web.Request) -> Any:
    return request.app.get("redis")


def _allowed_origins(settings: Settings) -> list[str]:
    return [
        origin.strip().rstrip("/")
        for origin in settings.miniapp_allowed_origins.split(",")
        if origin.strip()
    ]


def _secure(request: web.Request) -> bool:
    return bool(request.secure)


def _display_name(user: Any) -> str:
    parts = [user.first_name, user.last_name]
    return " ".join(part for part in parts if isinstance(part, str) and part)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _session_key(session_id: str) -> str:
    return "miniapp:session:" + _sha256(session_id)


def _profile_key(session_id: str) -> str:
    return PROFILE_KEY_PREFIX + _sha256(session_id)


def _json(
    payload: dict[str, Any],
    status: int = 200,
    headers: dict[str, str] | None = None,
) -> web.Response:
    merged = dict(SECURITY_HEADERS)
    if headers:
        merged.update(headers)
    return web.json_response(payload, status=status, headers=merged)


async def create_session_handler(request: web.Request) -> web.Response:
    redis = _redis(request)
    if redis is None:
        return _json({"error": "session_store_unavailable"}, status=503)
    try:
        body = await request.json()
    except Exception:
        return _json({"error": "invalid_json"}, status=400)
    init_data = body.get("initData") if isinstance(body, dict) else None
    if not isinstance(init_data, str) or not init_data:
        return _json({"error": "invalid_request"}, status=400)
    settings: Settings = request.app["settings"]
    try:
        created = await create_session(
            init_data,
            settings.bot_token,
            redis,
            ttl_seconds=settings.miniapp_session_ttl_seconds,
        )
    except MiniAppAuthError:
        return _json({"error": "invalid_init_data"}, status=401)
    display_name = _display_name(created.user)
    await redis.setex(
        _profile_key(created.session_id),
        created.ttl_seconds,
        display_name,
    )
    cookie = session_cookie(
        created.session_id, created.ttl_seconds, _secure(request)
    )
    return _json(
        {
            "user": {"id": created.user.id, "displayName": display_name},
            "csrfToken": created.csrf_token,
        },
        headers={"Set-Cookie": cookie},
    )


async def me_handler(request: web.Request) -> web.Response:
    redis = _redis(request)
    if redis is None:
        return _json({"error": "session_store_unavailable"}, status=503)
    session_id = request.cookies.get(SESSION_COOKIE)
    if not session_id:
        return _json({"error": "unauthorized"}, status=401)
    session = await read_session(redis, session_id)
    if session is None:
        return _json({"error": "unauthorized"}, status=401)
    profile = await redis.get(_profile_key(session_id))
    return _json({"user": {"id": session.user_id, "displayName": profile or ""}})


async def logout_handler(request: web.Request) -> web.Response:
    redis = _redis(request)
    if redis is None:
        return _json({"error": "session_store_unavailable"}, status=503)
    session_id = request.cookies.get(SESSION_COOKIE)
    session = await read_session(redis, session_id) if session_id else None
    settings: Settings = request.app["settings"]
    try:
        assert_mutation_authorized(
            {
                "origin": request.headers.get("Origin"),
                "host": request.headers.get("Host"),
                "csrf_token": request.headers.get("X-CSRF-Token"),
            },
            session,
            _allowed_origins(settings),
        )
    except MiniAppAuthError:
        return _json({"error": "forbidden"}, status=403)
    await redis.delete(_session_key(str(session_id)))
    await redis.delete(_profile_key(str(session_id)))
    return web.Response(
        status=204,
        headers={
            **SECURITY_HEADERS,
            "Set-Cookie": clear_session_cookie(_secure(request)),
        },
    )


async def handle_miniapp(message: Any) -> None:
    import os

    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo

    url = os.getenv("MINIAPP_URL", os.getenv("WEBHOOK_URL", ""))
    if not url.startswith("https://"):
        await message.answer("Set WEBHOOK_URL to an HTTPS URL to open the mini app.")
        return
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Open", web_app=WebAppInfo(url=url))]]
    )
    await message.answer("Open the mini app:", reply_markup=keyboard)


def register_routes(app: web.Application, settings: Settings) -> None:
    app["settings"] = settings
    app.router.add_post(SESSION_PATH, create_session_handler)
    app.router.add_get(ME_PATH, me_handler)
    app.router.add_delete(SESSION_PATH, logout_handler)


def register(dp: Any, bot: Any) -> None:
    from aiogram import F, Router

    router = Router(name="miniapp")
    router.message.register(handle_miniapp, F.text == "/miniapp")
    dp.include_router(router)
`;

const MINIAPP_TEST = `from __future__ import annotations

import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from app.runtime.miniapp_session import (
    SESSION_COOKIE,
    StoredSession,
    assert_mutation_authorized,
)
from app.services.miniapp import ME_PATH, SESSION_PATH, register_routes

TOKEN = "123456:unit-test-token"
TTL = 86400


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(
        self,
        key: str,
        value: str,
        *,
        nx: bool = False,
        ex: int | None = None,
    ) -> bool:
        if nx and key in self.data:
            return False
        self.data[key] = value
        return True

    async def setex(self, key: str, seconds: int, value: str) -> None:
        self.data[key] = value

    async def delete(self, key: str) -> None:
        self.data.pop(key, None)


def signed_init_data(auth_date: int) -> str:
    pairs = {
        "auth_date": str(auth_date),
        "query_id": "query",
        "user": json.dumps(
            {"id": 7, "first_name": "Test", "last_name": "User"}
        ),
    }
    check_string = "\\n".join(key + "=" + pairs[key] for key in sorted(pairs))
    secret = hmac.new(b"WebAppData", TOKEN.encode("utf-8"), hashlib.sha256).digest()
    digest = hmac.new(secret, check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    pairs["hash"] = digest
    return urlencode(pairs)


def make_app() -> web.Application:
    app = web.Application()
    app["redis"] = FakeRedis()
    app["settings"] = SimpleNamespace(
        bot_token=TOKEN,
        miniapp_session_ttl_seconds=TTL,
        miniapp_allowed_origins="",
    )
    register_routes(app, app["settings"])
    return app


@pytest.mark.asyncio
async def test_session_sets_cookie_and_security_headers() -> None:
    async with TestClient(TestServer(make_app())) as client:
        response = await client.post(
            SESSION_PATH, json={"initData": signed_init_data(int(time.time()) - 60)}
        )
        assert response.status == 200
        cookie = response.headers["Set-Cookie"]
        assert SESSION_COOKIE + "=" in cookie
        assert "HttpOnly" in cookie
        assert "SameSite=Lax" in cookie
        assert "Path=/" in cookie
        assert "Max-Age=" + str(TTL) in cookie
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Referrer-Policy"] == "no-referrer"
        assert "default-src 'self'" in response.headers["Content-Security-Policy"]
        body = await response.json()
        assert body["user"] == {"id": 7, "displayName": "Test User"}
        assert body["csrfToken"]


@pytest.mark.asyncio
async def test_me_returns_the_same_user() -> None:
    async with TestClient(TestServer(make_app())) as client:
        created = await client.post(
            SESSION_PATH, json={"initData": signed_init_data(int(time.time()) - 60)}
        )
        user = (await created.json())["user"]
        response = await client.get(ME_PATH)
        assert response.status == 200
        assert (await response.json())["user"] == user


@pytest.mark.asyncio
async def test_init_data_replay_is_rejected() -> None:
    init_data = signed_init_data(int(time.time()) - 60)
    async with TestClient(TestServer(make_app())) as client:
        assert (
            await client.post(SESSION_PATH, json={"initData": init_data})
        ).status == 200
        assert (
            await client.post(SESSION_PATH, json={"initData": init_data})
        ).status == 401


@pytest.mark.asyncio
async def test_expired_session_is_rejected() -> None:
    async with TestClient(TestServer(make_app())) as client:
        created = await client.post(
            SESSION_PATH, json={"initData": signed_init_data(int(time.time()) - 60)}
        )
        session_id = created.cookies[SESSION_COOKIE].value
        app = client.server.app
        await app["redis"].delete(
            "miniapp:session:" + hashlib.sha256(session_id.encode()).hexdigest()
        )
        assert (await client.get(ME_PATH)).status == 401


@pytest.mark.asyncio
async def test_mutation_requires_csrf_and_allowed_origin() -> None:
    async with TestClient(TestServer(make_app())) as client:
        created = await client.post(
            SESSION_PATH, json={"initData": signed_init_data(int(time.time()) - 60)}
        )
        csrf = (await created.json())["csrfToken"]
        assert (await client.delete(SESSION_PATH)).status == 403
        assert (
            await client.delete(
                SESSION_PATH,
                headers={"X-CSRF-Token": csrf, "Origin": "https://evil.example"},
            )
        ).status == 403


def test_assert_mutation_authorized_accepts_same_origin() -> None:
    session = StoredSession(user_id=7, auth_date=1, csrf="token", created_at=1)
    authorized = assert_mutation_authorized(
        {
            "origin": "https://app.example",
            "host": "app.example",
            "csrf_token": "token",
        },
        session,
        [],
    )
    assert authorized.user_id == 7
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
        file("app/handlers/llm.py", renderLlmEnqueuePy()),
        file("app/jobs/llm.py", renderLlmJobPy(spec)),
      ];
    case "inline":
      return [
        file("app/handlers/inline.py", INLINE_MODULE),
        file("tests/test_inline.py", INLINE_TEST),
      ];
    case "payments":
      return [
        file("app/runtime/payments.py", renderPaymentsPy(spec)),
        file("app/handlers/payments.py", PAYMENTS_MODULE),
        file("app/jobs/payment_fulfill.py", PAYMENT_FULFILL_JOB),
        file("app/jobs/payment_reconcile.py", PAYMENT_RECONCILE_JOB),
        file("tests/test_payments.py", PAYMENTS_TEST),
      ];
    case "miniapps":
      return [
        ...renderMiniApp(spec),
        file("app/runtime/miniapp_session.py", renderMiniAppSessionPy()),
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
        file("app/handlers/broadcast.py", renderBroadcastCommandPy()),
        file("app/jobs/broadcast.py", renderBroadcastJobPy()),
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
