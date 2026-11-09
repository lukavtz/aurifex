from __future__ import annotations

from importlib import import_module
from typing import Any

from aiogram import Bot, Dispatcher
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from aiohttp import web
from redis.asyncio import Redis
from sqlalchemy import text

from app.config import Settings
from app.runtime.health import healthz, metrics, readyz

try:
    from app.runtime.miniapp_session import SECURITY_HEADERS
except ModuleNotFoundError:  # miniapps feature is not enabled
    SECURITY_HEADERS = {}

MAX_BODY_BYTES = 1_048_576
WEBHOOK_PATH = "/webhook"


@web.middleware
async def security_headers_middleware(
    request: web.Request, handler: Any
) -> web.StreamResponse:
    try:
        response = await handler(request)
    except web.HTTPException as error:
        for name, value in SECURITY_HEADERS.items():
            error.headers.setdefault(name, value)
        raise
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response


def readiness_probes(
    dispatcher: Dispatcher, redis: Redis | None
) -> dict[str, Any]:
    probes: dict[str, Any] = {}
    session_factory = dispatcher.workflow_data.get("session_factory")
    if session_factory is not None:

        async def check_postgres() -> None:
            async with session_factory() as session:
                await session.execute(text("SELECT 1"))

        probes["postgres"] = check_postgres
    if redis is not None:

        async def check_redis() -> None:
            await redis.ping()

        probes["redis"] = check_redis
    return probes


def register_miniapp_routes(app: web.Application, settings: Settings) -> bool:
    try:
        module: Any = import_module("app.services.miniapp")
    except ModuleNotFoundError as error:
        if error.name != "app.services.miniapp":
            raise
        return False
    module.register_routes(app, settings)
    return True


def create_webhook_app(
    dispatcher: Dispatcher,
    bot: Bot,
    settings: Settings,
    redis: Redis | None = None,
) -> web.Application:
    if not settings.webhook_secret:
        raise RuntimeError("WEBHOOK_SECRET is required in webhook mode")
    app = web.Application(client_max_size=MAX_BODY_BYTES)
    app.middlewares.append(security_headers_middleware)
    app["settings"] = settings
    app["redis"] = redis
    app["readiness_probes"] = readiness_probes(dispatcher, redis)
    SimpleRequestHandler(
        dispatcher=dispatcher,
        bot=bot,
        secret_token=settings.webhook_secret,
    ).register(app, path=WEBHOOK_PATH)
    app.router.add_get("/healthz", healthz)
    app.router.add_get("/readyz", readyz)
    if settings.metrics_enabled:
        app.router.add_get("/metrics", metrics)
    register_miniapp_routes(app, settings)
    setup_application(app, dispatcher, bot=bot)
    return app
