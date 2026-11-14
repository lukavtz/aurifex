import { trace } from "@opentelemetry/api";
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
