from __future__ import annotations

import sentry_sdk
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from prometheus_client import Counter, Gauge, Histogram

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
