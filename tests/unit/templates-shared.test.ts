import assert from "node:assert/strict";
import test from "node:test";

import { renderCompose, renderEnvExample } from "../../src/core/projects/templates/shared.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import type { BotSpec } from "../../src/core/spec/bot-spec.ts";

const SPEC: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "compose_bot",
  displayName: "Compose Bot",
  stack: "grammy",
  features: ["commands"],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
  runtime: {
    queue: "none",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
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
  assert.match(
    compose,
    /DATABASE_URL: postgres:\/\/\$\{POSTGRES_USER:-bot\}:\$\{POSTGRES_PASSWORD:\?/,
  );
  assert.match(compose, /REDIS_URL: redis:\/\/:\$\{REDIS_PASSWORD:\?/);
  assert.match(compose, /^secrets:$/m);
  assert.match(compose, /^  bot_token:\n    file: \.\/secrets\/bot_token$/m);
  assert.match(compose, /BOT_TOKEN_FILE: \/run\/secrets\/bot_token/);
  assert.match(compose, /DATABASE_URL_FILE: \/run\/secrets\/database_url/);
  assert.match(compose, /REDIS_URL_FILE: \/run\/secrets\/redis_url/);
});

test("env example uses explicit placeholders, not working credentials", () => {
  const env = renderEnvExample(SPEC);
  assert.match(env, /^BOT_TOKEN=$/m);
  assert.match(env, /^POSTGRES_PASSWORD=$/m);
  assert.match(env, /^REDIS_PASSWORD=$/m);
  assert.doesNotMatch(env, /bot:bot@/);
  assert.doesNotMatch(env, /redis:\/\/redis:/);
  assert.match(env, /^DATABASE_URL=$/m);
  assert.match(env, /^REDIS_URL=$/m);
});
