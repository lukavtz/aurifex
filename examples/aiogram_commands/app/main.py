from __future__ import annotations

import asyncio

from aiogram import Dispatcher
from aiohttp import web

from app.bot import create_bot, create_dispatcher, create_redis
from app.config import Settings, get_settings
from app.logger import configure_logging
from app.runtime.telemetry import init_telemetry, shutdown_telemetry
from app.webhook import create_webhook_app

SERVICE_NAME = "aiogram Commands"


def configure_telemetry(settings: Settings) -> None:
    if settings.otel_exporter_otlp_endpoint or settings.sentry_dsn:
        init_telemetry(
            settings.otel_service_name or SERVICE_NAME,
            otlp_endpoint=settings.otel_exporter_otlp_endpoint,
            sentry_dsn=settings.sentry_dsn,
        )


def allowed_updates(dispatcher: Dispatcher) -> list[str]:
    extra: list[str] = dispatcher.workflow_data.get("allowed_updates_extra", [])
    return sorted(set(dispatcher.resolve_used_update_types()) | set(extra))


async def run_polling(settings: Settings) -> None:
    bot = create_bot(settings)
    redis = create_redis(settings)
    dispatcher = create_dispatcher(settings, bot, redis)
    try:
        await dispatcher.start_polling(
            bot,
            allowed_updates=allowed_updates(dispatcher),
            drop_pending_updates=False,
        )
    finally:
        shutdown_telemetry()
        await bot.session.close()
        if redis is not None:
            await redis.aclose()


def run_webhook(settings: Settings) -> None:
    if not settings.webhook_url:
        raise RuntimeError("WEBHOOK_URL is required in webhook mode")
    bot = create_bot(settings)
    redis = create_redis(settings)
    dispatcher = create_dispatcher(settings, bot, redis)
    app = create_webhook_app(dispatcher, bot, settings, redis)

    async def shutdown(_app: web.Application) -> None:
        shutdown_telemetry()
        await bot.session.close()
        if redis is not None:
            await redis.aclose()

    app.on_shutdown.append(shutdown)
    web.run_app(app, host="0.0.0.0", port=settings.port)


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    configure_telemetry(settings)
    if settings.bot_mode == "webhook":
        run_webhook(settings)
    else:
        asyncio.run(run_polling(settings))


if __name__ == "__main__":
    main()
