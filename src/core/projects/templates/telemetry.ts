// Rendered runtime modules for observability and readiness.
//
// Every export below returns the text of one generated project file. This
// module never imports the generated dependencies (OpenTelemetry, prom-client,
// Sentry); those imports live inside the rendered strings only.

const TELEMETRY_TS = `import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { Counter, Gauge, Histogram } from "prom-client";
import * as Sentry from "@sentry/node";

export interface TelemetryConfig {
  readonly serviceName: string;
  readonly otlpEndpoint?: string | undefined;
  readonly sentryDsn?: string | undefined;
}

let sdk: NodeSDK | undefined;
let sentryStarted = false;

export async function initTelemetry(config: TelemetryConfig): Promise<void> {
  const otlpEndpoint = config.otlpEndpoint ?? "";
  if (otlpEndpoint !== "") {
    sdk = new NodeSDK({
      resource: resourceFromAttributes({ "service.name": config.serviceName }),
      traceExporter: new OTLPTraceExporter({ url: otlpEndpoint }),
    });
    sdk.start();
  }
  const sentryDsn = config.sentryDsn ?? "";
  if (sentryDsn !== "") {
    Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0.1 });
    sentryStarted = true;
  }
}

export async function shutdownTelemetry(): Promise<void> {
  const active = sdk;
  sdk = undefined;
  if (active !== undefined) {
    await active.shutdown();
  }
  if (sentryStarted) {
    sentryStarted = false;
    await Sentry.close(2000);
  }
}

export function traceId(): string | undefined {
  const span = trace.getActiveSpan();
  return span === undefined ? undefined : span.spanContext().traceId;
}

// No labels: metric cardinality stays bounded and no user or secret value can
// ever become a label.
export const metrics = {
  botUpdatesTotal: new Counter({
    name: "bot_updates_total",
    help: "Telegram updates received, by outcome",
  }),
  telegramApiDurationSeconds: new Histogram({
    name: "telegram_api_duration_seconds",
    help: "Telegram Bot API call duration in seconds",
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  }),
  jobDurationSeconds: new Histogram({
    name: "job_duration_seconds",
    help: "Queued job execution duration in seconds",
    buckets: [0.1, 0.5, 1, 5, 15, 60],
  }),
  jobFailuresTotal: new Counter({
    name: "job_failures_total",
    help: "Queued job failures",
  }),
  queueDepth: new Gauge({
    name: "queue_depth",
    help: "Pending jobs in the queue",
  }),
  miniappSessionsActive: new Gauge({
    name: "miniapp_sessions_active",
    help: "Active Mini App sessions",
  }),
} as const;
`;

const HEALTH_TS = `import type { IncomingMessage, ServerResponse } from "node:http";
import { register } from "prom-client";

export const HEALTH_PATH = "/healthz";
export const READY_PATH = "/readyz";
export const METRICS_PATH = "/metrics";
export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4";

export interface ReadinessProbes {
  readonly postgres?: (() => Promise<void>) | undefined;
  readonly redis?: (() => Promise<void>) | undefined;
  readonly metricsEnabled?: boolean | undefined;
}

export type CheckStatus = "ok" | "fail" | "skip";

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

export function healthHandler(_req: IncomingMessage, res: ServerResponse): void {
  send(res, 200, "application/json", '{"ok":true}');
}

async function probe(check: (() => Promise<void>) | undefined): Promise<CheckStatus> {
  if (check === undefined) {
    return "skip";
  }
  try {
    await check();
    return "ok";
  } catch {
    return "fail";
  }
}

export async function readyHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  probes: ReadinessProbes = {},
): Promise<void> {
  const postgres = await probe(probes.postgres);
  const redis = await probe(probes.redis);
  const ok = postgres !== "fail" && redis !== "fail";
  send(res, ok ? 200 : 503, "application/json", JSON.stringify({ ok, checks: { postgres, redis } }));
}

export async function metricsHandler(res: ServerResponse): Promise<void> {
  send(res, 200, METRICS_CONTENT_TYPE, await register.metrics());
}

// Server wiring: returns false for any non-health request so the caller keeps
// its own routing and 404 handling.
export async function handleHealthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  probes: ReadinessProbes = {},
): Promise<boolean> {
  if (req.method !== "GET") {
    return false;
  }
  if (req.url === HEALTH_PATH) {
    healthHandler(req, res);
    return true;
  }
  if (req.url === READY_PATH) {
    await readyHandler(req, res, probes);
    return true;
  }
  if (req.url === METRICS_PATH && probes.metricsEnabled !== false) {
    await metricsHandler(res);
    return true;
  }
  return false;
}
`;

const TELEMETRY_PY = `from __future__ import annotations

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from prometheus_client import Counter, Gauge, Histogram
import sentry_sdk

_provider: TracerProvider | None = None
_sentry_started = False


def init_telemetry(
    service_name: str,
    otlp_endpoint: str = "",
    sentry_dsn: str = "",
) -> None:
    global _provider, _sentry_started
    if otlp_endpoint:
        provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=otlp_endpoint)))
        trace.set_tracer_provider(provider)
        _provider = provider
    if sentry_dsn:
        sentry_sdk.init(dsn=sentry_dsn, traces_sample_rate=0.1)
        _sentry_started = True


def shutdown_telemetry() -> None:
    global _provider, _sentry_started
    if _provider is not None:
        _provider.shutdown()
        _provider = None
    if _sentry_started:
        sentry_sdk.flush()
        _sentry_started = False


def trace_id() -> str | None:
    span_context = trace.get_current_span().get_span_context()
    if not span_context.is_valid:
        return None
    return format(span_context.trace_id, "032x")


# No labels: metric cardinality stays bounded and no user or secret value can
# ever become a label.
BOT_UPDATES_TOTAL = Counter("bot_updates_total", "Telegram updates received, by outcome")
TELEGRAM_API_DURATION_SECONDS = Histogram(
    "telegram_api_duration_seconds", "Telegram Bot API call duration in seconds"
)
JOB_DURATION_SECONDS = Histogram("job_duration_seconds", "Queued job execution duration in seconds")
JOB_FAILURES_TOTAL = Counter("job_failures_total", "Queued job failures")
QUEUE_DEPTH = Gauge("queue_depth", "Pending jobs in the queue")
MINIAPP_SESSIONS_ACTIVE = Gauge("miniapp_sessions_active", "Active Mini App sessions")
`;

const HEALTH_PY = `from __future__ import annotations

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
`;

export function renderTelemetryTs(): string {
  return TELEMETRY_TS;
}

export function renderHealthTs(): string {
  return HEALTH_TS;
}

export function renderTelemetryPy(): string {
  return TELEMETRY_PY;
}

export function renderHealthPy(): string {
  return HEALTH_PY;
}