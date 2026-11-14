import assert from "node:assert/strict";
import { test } from "node:test";
import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import { renderGrammyFeature } from "../../src/core/projects/features/grammy.ts";
import { validateBotSpec, BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import { resolveStack, BOT_ALLOWED_UPDATES } from "../../src/core/targets/catalog.ts";

const spec = validateBotSpec({ schemaVersion: BOT_SPEC_VERSION, name: "widget_test", displayName: "Widgets", stack: "grammy", features: ["commands", "widgets"], deployment: "docker", storage: { postgres: false, redis: true }, i18n: { defaultLocale: "en", en: true, ru: false, zh: false }, security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true }, runtime: { queue: "none", telemetry: { otlp: false, prometheus: false, sentry: false } } });

test("widget emitter supports real grammY dispatch for scaffold and named additions", () => {
  const files = renderGrammyProject(spec, resolveStack("grammy").target);
  const source = files.find((f) => f.path === "src/features/widgets.ts")!.content;
  assert.equal(renderGrammyFeature("widgets", "custom_widgets", spec)[0]!.content, source);
  const main = files.find((f) => f.path === "src/main.ts")!.content;
  assert.ok(main.includes(JSON.stringify(BOT_ALLOWED_UPDATES)));
  // Runtime proof runs in the E2E owner; this assertion catches invalid 10.4 filters before installation.
  assert.ok(source.includes("bot.use("));
  assert.ok(!source.includes('onUpdate("widget_query"'));
});
