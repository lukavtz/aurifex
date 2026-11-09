import assert from "node:assert/strict";
import { test } from "node:test";

import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import { renderMiniApp } from "../../src/core/projects/templates/miniapp.ts";
import { renderMiniAppSessionTs } from "../../src/core/projects/templates/miniapp-session.ts";
import { renderHealthTs, renderTelemetryTs } from "../../src/core/projects/templates/telemetry.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";

const spec: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "miniapp_bot",
  displayName: "Mini App Bot",
  stack: "grammy",
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

const files = renderGrammyProject(spec, resolveStack("grammy").target);
const paths = files.map((file) => file.path);

function contentOf(path: string): string {
  const file = files.find((entry) => entry.path === path);
  assert.ok(file, `missing file ${path}`);
  return file.content;
}

test("renders observability runtime files from the shared renderers", () => {
  assert.ok(paths.includes("src/runtime/telemetry.ts"));
  assert.ok(paths.includes("src/runtime/health.ts"));
  assert.equal(contentOf("src/runtime/telemetry.ts"), renderTelemetryTs());
  assert.equal(contentOf("src/runtime/health.ts"), renderHealthTs());
});

test("telemetry starts only behind the endpoint guard", () => {
  const telemetry = contentOf("src/runtime/telemetry.ts");
  assert.match(telemetry, /if \(otlpEndpoint !== ""\)/);
  assert.match(telemetry, /if \(sentryDsn !== ""\)/);
  assert.match(telemetry, /tracesSampleRate: 0\.1/);
  for (const metric of [
    "bot_updates_total",
    "telegram_api_duration_seconds",
    "job_duration_seconds",
    "job_failures_total",
    "queue_depth",
    "miniapp_sessions_active",
  ]) {
    assert.ok(telemetry.includes(metric), `missing metric ${metric}`);
  }
});

test("main initializes telemetry before the bot and shuts it down", () => {
  const main = contentOf("src/main.ts");
  assert.match(main, /await initTelemetry\(\{/);
  assert.match(main, /serviceName: config\.OTEL_SERVICE_NAME \|\| "Mini App Bot"/);
  assert.match(main, /otlpEndpoint: config\.OTEL_EXPORTER_OTLP_ENDPOINT/);
  assert.match(main, /sentryDsn: config\.SENTRY_DSN/);
  assert.ok(main.indexOf("await initTelemetry") < main.indexOf("const bot = createBot()"));
  assert.equal(main.match(/await shutdownTelemetry\(\)/g)?.length, 1);
});

test("server answers health, readiness, and metrics before the webhook", () => {
  const server = contentOf("src/server.ts");
  assert.match(server, /handleHealthRequest\(req, res, \{/);
  assert.match(server, /await sql`SELECT 1`/);
  assert.match(server, /redis\.ping\(\)/);
  assert.match(server, /metricsEnabled: miniAppConfig\?\.METRICS_ENABLED \?\? true/);
  assert.match(server, /if \(handled\) return;/);
  assert.ok(server.indexOf("if (handled) return;") < server.indexOf("/telegram/webhook"));
});

test("readiness returns the documented 503 shape", () => {
  const health = contentOf("src/runtime/health.ts");
  assert.match(health, /ok \? 200 : 503/);
  assert.match(health, /checks: \{ postgres, redis \}/);
});

test("miniapp feature emits the session runtime and guarded routes", () => {
  assert.ok(paths.includes("src/runtime/miniapp-session.ts"));
  assert.equal(contentOf("src/runtime/miniapp-session.ts"), renderMiniAppSessionTs());
  const feature = contentOf("src/features/miniapp.ts");
  assert.match(feature, /export const SESSION_PATH = "\/api\/miniapp\/session"/);
  assert.match(feature, /export const ME_PATH = "\/api\/miniapp\/me"/);
  assert.match(feature, /method: "GET", path: ME_PATH/);
  assert.match(feature, /assertMutationAuthorized\(/);
  assert.match(feature, /csrfToken/);
  assert.match(feature, /Origin|origin/);
  assert.match(feature, /sessionCookie\(/);
  assert.match(feature, /SECURITY_HEADERS/);
  assert.match(feature, /"Set-Cookie"/);
  assert.ok(!feature.includes("export const route ="));
});

test("miniapp responses carry CSP, nosniff, and referrer headers", () => {
  const session = contentOf("src/runtime/miniapp-session.ts");
  assert.match(session, /default-src 'self'/);
  assert.match(session, /"X-Content-Type-Options": "nosniff"/);
  assert.match(session, /"Referrer-Policy": "no-referrer"/);
});

test("generated miniapp tests cover cookies, CSRF, origin, and replay", () => {
  const generated = contentOf("tests/miniapp.test.ts");
  for (const expected of [
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=",
    "replayed initData is rejected",
    "mutation requires csrf and an allowed origin",
    "expired session is rejected",
    "Content-Security-Policy",
    "403",
    "401",
  ]) {
    assert.ok(generated.includes(expected), `missing ${expected}`);
  }
});

test("miniapp frontend keeps scripts external so CSP needs no unsafe-inline", () => {
  const html = renderMiniApp(spec).find((file) => file.path === "miniapp/index.html");
  assert.ok(html, "missing miniapp/index.html");
  assert.match(html.content, /<script type="module" src=/);
  assert.doesNotMatch(html.content, /<script(?![^>]*\bsrc=)[^>]*>/);
});
