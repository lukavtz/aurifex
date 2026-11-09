import assert from "node:assert/strict";
import test from "node:test";

import { renderCompose, renderEnvExample } from "../../src/core/projects/templates/shared.ts";
import type { BotSpec } from "../../src/core/spec/bot-spec.ts";

const SPEC: BotSpec = {
  schemaVersion: "bot-spec-1.0.0",
  name: "compose_bot",
  displayName: "Compose Bot",
  stack: "grammy",
  features: ["commands"],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
};

test("compose never ships fixed database passwords or publishes the bot port", () => {
  const compose = renderCompose(SPEC);
  assert.doesNotMatch(compose, /POSTGRES_PASSWORD:\s*bot/);
  assert.doesNotMatch(compose, /POSTGRES_USER:\s*bot\n\s+POSTGRES_PASSWORD:\s*bot/);
  assert.doesNotMatch(compose, /"8080:8080"/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/);
  assert.match(compose, /REDIS_PASSWORD: \$\{REDIS_PASSWORD:\?/);
  assert.match(compose, /expose:\n\s+- "8080"/);
  assert.match(compose, /caddy:2\.10-alpine/);
});

test("env example uses explicit placeholders, not working credentials", () => {
  const env = renderEnvExample(SPEC);
  assert.match(env, /^BOT_TOKEN=$/m);
  assert.match(env, /^POSTGRES_PASSWORD=$/m);
  assert.match(env, /^REDIS_PASSWORD=$/m);
  assert.doesNotMatch(env, /bot:bot@/);
  assert.doesNotMatch(env, /redis:\/\/redis:/);
});
