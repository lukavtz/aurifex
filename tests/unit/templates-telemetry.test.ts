import assert from "node:assert/strict";
import test from "node:test";

import {
  renderHealthPy,
  renderHealthTs,
  renderTelemetryPy,
  renderTelemetryTs,
} from "../../src/core/projects/templates/telemetry.ts";

const METRICS = [
  "bot_updates_total",
  "telegram_api_duration_seconds",
  "job_duration_seconds",
  "job_failures_total",
  "queue_depth",
  "miniapp_sessions_active",
];

test("typescript telemetry declares every required metric exactly once", () => {
  const telemetry = renderTelemetryTs();
  for (const name of METRICS) {
    assert.match(telemetry, new RegExp(`name: "${name}"`));
  }
  assert.doesNotMatch(telemetry, /labelNames/);
  assert.doesNotMatch(telemetry, /BOT_TOKEN|WEBHOOK_SECRET|LLM_API_KEY/);
});

test("python telemetry declares every required metric exactly once", () => {
  const telemetry = renderTelemetryPy();
  for (const name of METRICS) {
    assert.match(telemetry, new RegExp(`"${name}"`));
  }
  assert.doesNotMatch(telemetry, /labels=|BOT_TOKEN|WEBHOOK_SECRET|LLM_API_KEY/);
});

test("typescript telemetry starts exporters only when configured", () => {
  const telemetry = renderTelemetryTs();
  assert.match(telemetry, /if \(otlpEndpoint !== ""\)/);
  assert.match(telemetry, /if \(sentryDsn !== ""\)/);
  assert.match(telemetry, /OTLPTraceExporter/);
  assert.match(telemetry, /service\.name/);
  assert.match(telemetry, /tracesSampleRate: 0\.1/);
  assert.match(telemetry, /export async function shutdownTelemetry/);
  assert.match(telemetry, /export function traceId/);
});

test("python telemetry starts exporters only when configured", () => {
  const telemetry = renderTelemetryPy();
  assert.match(telemetry, /if otlp_endpoint:/);
  assert.match(telemetry, /if sentry_dsn:/);
  assert.match(telemetry, /OTLPSpanExporter/);
  assert.match(telemetry, /service\.name/);
  assert.match(telemetry, /traces_sample_rate=0\.1/);
  assert.match(telemetry, /def shutdown_telemetry/);
  assert.match(telemetry, /def trace_id/);
});

test("typescript health routes cover health, readiness, and metrics", () => {
  const health = renderHealthTs();
  assert.match(health, /"\/healthz"/);
  assert.match(health, /"\/readyz"/);
  assert.match(health, /"\/metrics"/);
  assert.match(health, /text\/plain; version=0\.0\.4/);
  assert.match(health, /"ok":true/);
  assert.match(health, /ok \? 200 : 503/);
  assert.match(health, /checks: \{ postgres, redis \}/);
  assert.match(health, /"skip"/);
  assert.match(health, /export async function handleHealthRequest/);
});

test("python health routes cover health, readiness, and metrics", () => {
  const health = renderHealthPy();
  assert.match(health, /"\/healthz"/);
  assert.match(health, /"\/readyz"/);
  assert.match(health, /"\/metrics"/);
  assert.match(health, /text\/plain; version=0\.0\.4/);
  assert.match(health, /200 if ok else 503/);
  assert.match(health, /"checks": \{"postgres": postgres, "redis": redis\}/);
  assert.match(health, /return "skip"/);
  assert.match(health, /def register_health_routes/);
});