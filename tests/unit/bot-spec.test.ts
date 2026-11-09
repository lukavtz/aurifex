import assert from "node:assert/strict";
import test from "node:test";

import {
  BOT_SPEC_VERSION,
  BotSpecError,
  assertFeature,
  botSpecHash,
  validateBotSpec,
  validateFeatureName,
} from "../../src/core/spec/bot-spec.ts";

interface TestSpec {
  schemaVersion: string;
  name: string;
  displayName: string;
  stack: string;
  features: string[];
  deployment: string;
  storage: { postgres: boolean; redis: boolean };
  i18n: { defaultLocale: string; en: boolean; ru: boolean };
  security: {
    webhookSecret: boolean;
    adminAllowlist: boolean;
    rateLimit: boolean;
    idempotency: boolean;
  };
  runtime: {
    queue: string;
    telemetry: { otlp: boolean; prometheus: boolean; sentry: boolean };
  };
}

function baseSpec(): TestSpec {
  return {
    schemaVersion: BOT_SPEC_VERSION,
    name: "demo_bot",
    displayName: "Demo Bot",
    stack: "grammy",
    features: ["commands", "llm"],
    deployment: "docker",
    storage: { postgres: true, redis: true },
    i18n: { defaultLocale: "en", en: true, ru: false },
    security: {
      webhookSecret: true,
      adminAllowlist: true,
      rateLimit: true,
      idempotency: true,
    },
    runtime: { queue: "postgres", telemetry: { otlp: false, prometheus: false, sentry: false } },
  };
}

function isSpecError(path?: string) {
  return (error: unknown): boolean =>
    error instanceof BotSpecError && (path === undefined || error.path === path);
}

test("valid spec round trips and hashes stably", () => {
  const spec = validateBotSpec(baseSpec());
  assert.equal(spec.schemaVersion, BOT_SPEC_VERSION);
  assert.equal(spec.name, "demo_bot");
  assert.equal(spec.security.webhookSecret, true);
  assert.deepEqual(validateBotSpec(spec), spec);
  assert.equal(botSpecHash(validateBotSpec(spec)), botSpecHash(spec));
});

test("rejects unknown top-level key", () => {
  const input: Record<string, unknown> = { ...baseSpec(), extra: true };
  assert.throws(() => validateBotSpec(input), isSpecError("spec.extra"));
});

test("rejects duplicate features", () => {
  const spec = baseSpec();
  spec.features = ["commands", "llm", "llm"];
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.features[2]"));
});

test("rejects missing commands feature", () => {
  const spec = baseSpec();
  spec.features = ["llm"];
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.features"));
});

test("rejects webhookSecret false", () => {
  const spec = baseSpec();
  spec.security.webhookSecret = false;
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.security.webhookSecret"));
});

test("rejects default locale that is not enabled", () => {
  const spec = baseSpec();
  spec.i18n = { defaultLocale: "ru", en: true, ru: false };
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.i18n.defaultLocale"));
});

test("rejects control characters", () => {
  const spec = baseSpec();
  spec.displayName = "Bad\u0007Bot";
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.displayName"));
});

test("validateFeatureName accepts a valid name", () => {
  assert.equal(validateFeatureName("my_feature"), "my_feature");
  assert.equal(validateFeatureName("a".repeat(32)), "a".repeat(32));
});

test("validateFeatureName rejects reserved names", () => {
  for (const name of ["index", "admin", "help"]) {
    assert.throws(() => validateFeatureName(name), isSpecError("feature.name"));
  }
});

test("validateFeatureName rejects too short and too long names", () => {
  assert.throws(() => validateFeatureName("a"), isSpecError("feature.name"));
  assert.throws(() => validateFeatureName("a".repeat(33)), isSpecError("feature.name"));
});

test("assertFeature returns known features and rejects unknown ones", () => {
  assert.equal(assertFeature("llm"), "llm");
  assert.equal(assertFeature("payments"), "payments");
  assert.throws(() => assertFeature("nope"), isSpecError("feature"));
});
