from __future__ import annotations

from collections.abc import Awaitable, Callable

from aiohttp import web
from prometheus_client import generate_latest

HEALTH_PATH = "/healthz"
READY_PATH = "/readyz"
METRICS_PATH = "/metrics"
METRICS_CONTENT_TYPE = "text/plain; version=0.0.4"

Probe = Callable[[], Awaitable[None]]


async def healthz(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


async def _probe(check: Probe | None) -> str:
    if check is None:
        return "skip"
    try:
        await check()
    except Exception:
        return "fail"
    return "ok"


async def readyz(request: web.Request) -> web.Response:
    probes: dict[str, Probe | None] = request.app.get("readiness_probes", {})
    postgres = await _probe(probes.get("postgres"))
    redis = await _probe(probes.get("redis"))
    ok = postgres != "fail" and redis != "fail"
    return web.json_response(
        {"ok": ok, "checks": {"postgres": postgres, "redis": redis}},
        status=200 if ok else 503,
    )


async def metrics(_request: web.Request) -> web.Response:
    return web.Response(
        body=generate_latest(),
        headers={"Content-Type": METRICS_CONTENT_TYPE},
    )


def register_health_routes(
    app: web.Application, probes: dict[str, Probe | None] | None = None
) -> None:
    app["readiness_probes"] = probes or {}
    app.router.add_get(HEALTH_PATH, healthz)
    app.router.add_get(READY_PATH, readyz)
    app.router.add_get(METRICS_PATH, metrics)
