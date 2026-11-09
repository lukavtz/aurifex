import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import { renderAiogramProject } from "../../src/core/projects/templates/aiogram.ts";
import { renderMiniAppSessionPy } from "../../src/core/projects/templates/miniapp-session.ts";
import { renderHealthPy, renderTelemetryPy } from "../../src/core/projects/templates/telemetry.ts";

const spec: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "miniapp_bot",
  displayName: "Mini App Bot",
  stack: "aiogram",
  features: ["commands", "miniapps"],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: {
    webhookSecret: true,
    adminAllowlist: true,
    rateLimit: false,
    idempotency: false,
  },
  runtime: {
    queue: "none",
    telemetry: { otlp: true, prometheus: true, sentry: true },
  },
  miniapps: { sessionTtlSeconds: 86400, allowedOrigins: [] },
};

const files = renderAiogramProject(spec);
const paths = files.map((file) => file.path);

function contentOf(path: string): string {
  const file = files.find((entry) => entry.path === path);
  assert.ok(file, `missing file ${path}`);
  return file.content;
}

test("renders observability runtime files from the shared renderers", () => {
  assert.ok(paths.includes("app/runtime/telemetry.py"));
  assert.ok(paths.includes("app/runtime/health.py"));
  assert.equal(contentOf("app/runtime/telemetry.py"), renderTelemetryPy());
  assert.equal(contentOf("app/runtime/health.py"), renderHealthPy());
});

test("main initializes telemetry behind a configuration guard and shuts down", () => {
  const main = contentOf("app/main.py");
  assert.match(main, /if settings\.otel_exporter_otlp_endpoint or settings\.sentry_dsn:/);
  assert.match(main, /init_telemetry\(/);
  assert.match(main, /otlp_endpoint=settings\.otel_exporter_otlp_endpoint/);
  assert.match(main, /sentry_dsn=settings\.sentry_dsn/);
  assert.match(main, /configure_telemetry\(settings\)/);
  assert.equal(main.match(/shutdown_telemetry\(\)/g)?.length, 2);
});

test("webhook registers health, readiness, and guarded metrics routes", () => {
  const webhook = contentOf("app/webhook.py");
  assert.match(webhook, /add_get\("\/healthz", healthz\)/);
  assert.match(webhook, /add_get\("\/readyz", readyz\)/);
  assert.match(webhook, /if settings\.metrics_enabled:/);
  assert.match(webhook, /add_get\("\/metrics", metrics\)/);
  assert.match(webhook, /app\["readiness_probes"\] = readiness_probes\(dispatcher, redis\)/);
});

test("readiness probes cover postgres and redis only when configured", () => {
  const webhook = contentOf("app/webhook.py");
  assert.match(webhook, /SELECT 1/);
  assert.match(webhook, /await redis\.ping\(\)/);
  assert.match(webhook, /if session_factory is not None:/);
  assert.match(webhook, /if redis is not None:/);
});

test("readiness returns the documented 503 shape", () => {
  const health = contentOf("app/runtime/health.py");
  assert.match(health, /status=200 if ok else 503/);
  assert.match(health, /"checks": \{"postgres": postgres, "redis": redis\}/);
});

test("metrics endpoint uses the Prometheus content type and metric names", () => {
  const health = contentOf("app/runtime/health.py");
  const telemetry = contentOf("app/runtime/telemetry.py");
  assert.match(health, /METRICS_CONTENT_TYPE = "text\/plain; version=0\.0\.4"/);
  assert.match(health, /generate_latest\(\)/);
  for (const name of [
    "bot_updates_total",
    "telegram_api_duration_seconds",
    "job_duration_seconds",
    "job_failures_total",
    "queue_depth",
    "miniapp_sessions_active",
  ]) {
    assert.match(telemetry, new RegExp(`"${name}"`));
  }
  assert.doesNotMatch(telemetry, /labels=/);
});

test("miniapp feature emits the session runtime and guarded routes", () => {
  assert.ok(paths.includes("app/runtime/miniapp_session.py"));
  assert.equal(contentOf("app/runtime/miniapp_session.py"), renderMiniAppSessionPy());
  const service = contentOf("app/services/miniapp.py");
  assert.match(service, /SESSION_PATH = "\/api\/miniapp\/session"/);
  assert.match(service, /ME_PATH = "\/api\/miniapp\/me"/);
  assert.match(service, /add_get\(ME_PATH, me_handler\)/);
  assert.match(service, /assert_mutation_authorized\(/);
  assert.match(service, /X-CSRF-Token/);
  assert.match(service, /Origin/);
  assert.match(service, /session_cookie\(/);
  assert.match(service, /SECURITY_HEADERS/);
});

test("miniapp responses carry CSP, nosniff, and referrer headers", () => {
  const webhook = contentOf("app/webhook.py");
  assert.match(webhook, /security_headers_middleware/);
  assert.match(webhook, /SECURITY_HEADERS/);
  assert.match(contentOf("app/runtime/miniapp_session.py"), /default-src 'self'/);
});

test("generated miniapp tests cover replay, expiry, headers, and CSRF", () => {
  const generated = contentOf("tests/test_miniapp.py");
  for (const expected of [
    "test_init_data_replay_is_rejected",
    "test_expired_session_is_rejected",
    "test_session_sets_cookie_and_security_headers",
    "test_mutation_requires_csrf_and_allowed_origin",
    "SameSite=Lax",
    "HttpOnly",
    "403",
    "401",
  ]) {
    assert.ok(generated.includes(expected), `missing ${expected}`);
  }
});

test("miniapp frontend keeps scripts external so CSP needs no unsafe-inline", () => {
  const html = contentOf("miniapp/index.html");
  assert.match(html, /<script type="module" src=/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
});
