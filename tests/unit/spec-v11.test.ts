import assert from "node:assert/strict";
import test from "node:test";

import {
  BOT_SPEC_VERSION,
  BotSpecError,
  botSpecHash,
  validateBotSpec,
} from "../../src/core/spec/bot-spec.ts";

interface TestProduct {
  id: string;
  title: string;
  description: string;
  stars: number;
  subscription: boolean;
}

interface TestSpec {
  schemaVersion: string;
  name: string;
  displayName: string;
  stack: string;
  features: string[];
  deployment: string;
  storage: { postgres: boolean; redis: boolean };
  i18n: { defaultLocale: string; en: boolean; ru: boolean; zh?: boolean };
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
  miniapps?: { sessionTtlSeconds?: number; allowedOrigins?: string[] };
  payments?: { products: TestProduct[] };
}

function baseSpec(): TestSpec {
  return {
    schemaVersion: BOT_SPEC_VERSION,
    name: "demo_bot",
    displayName: "Demo Bot",
    stack: "grammy",
    features: ["commands"],
    deployment: "docker",
    storage: { postgres: false, redis: false },
    i18n: { defaultLocale: "en", en: true, ru: false },
    security: {
      webhookSecret: true,
      adminAllowlist: false,
      rateLimit: false,
      idempotency: false,
    },
    runtime: { queue: "none", telemetry: { otlp: false, prometheus: false, sentry: false } },
  };
}

function legacySpec(): Record<string, unknown> {
  return {
    schemaVersion: "bot-spec-1.0.0",
    name: "legacy_bot",
    displayName: "Legacy Bot",
    stack: "grammy",
    features: ["commands", "llm"],
    deployment: "docker",
    storage: { postgres: true, redis: false },
    i18n: { defaultLocale: "en", en: true, ru: false },
    security: {
      webhookSecret: true,
      adminAllowlist: false,
      rateLimit: false,
      idempotency: false,
    },
  };
}

function isSpecError(path?: string) {
  return (error: unknown): boolean =>
    error instanceof BotSpecError && (path === undefined || error.path === path);
}

const STARS_OK: TestProduct = {
  id: "pro_month",
  title: "Pro",
  description: "Monthly Pro access",
  stars: 150,
  subscription: true,
};

test("accepts a valid 1.1 spec and preserves runtime", () => {
  const spec = validateBotSpec(baseSpec());
  assert.equal(spec.schemaVersion, "bot-spec-1.1.0");
  assert.deepEqual(spec.runtime, {
    queue: "none",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  });
  assert.equal(spec.i18n.zh, false);
  assert.deepEqual(validateBotSpec(spec), spec);
  assert.equal(botSpecHash(validateBotSpec(spec)), botSpecHash(spec));
});

test("rejects a 1.1 spec without runtime", () => {
  const { runtime: _runtime, ...rest } = baseSpec();
  assert.throws(() => validateBotSpec(rest), isSpecError("spec.runtime"));
});

test("rejects an incomplete runtime telemetry block", () => {
  const input = { ...baseSpec(), runtime: { queue: "none", telemetry: { otlp: false } } };
  assert.throws(() => validateBotSpec(input), isSpecError("spec.runtime.telemetry.prometheus"));
});

test("normalizes a 1.0 document with queued features to a postgres queue", () => {
  const spec = validateBotSpec(legacySpec());
  assert.equal(spec.schemaVersion, "bot-spec-1.1.0");
  assert.equal(spec.runtime.queue, "postgres");
  assert.deepEqual(spec.runtime.telemetry, {
    otlp: false,
    prometheus: false,
    sentry: false,
  });
  assert.equal(spec.i18n.zh, false);
});

test("normalizes a commands-only 1.0 document to no queue", () => {
  const legacy = legacySpec();
  legacy.features = ["commands"];
  legacy.storage = { postgres: false, redis: false };
  const spec = validateBotSpec(legacy);
  assert.equal(spec.runtime.queue, "none");
});

test("1.0 normalization failure keeps the path and adds the migration hint", () => {
  const legacy = legacySpec();
  legacy.name = "Bad-Name";
  try {
    validateBotSpec(legacy);
    assert.fail("expected a rejection");
  } catch (error) {
    assert.ok(error instanceof BotSpecError);
    assert.equal(error.path, "spec.name");
    assert.match(error.message, /run aurifex upgrade --apply/);
  }
});

test("rejects queued features without postgres", () => {
  const spec = baseSpec();
  spec.features = ["commands", "llm"];
  spec.runtime.queue = "postgres";
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.storage.postgres"));
  spec.features = ["commands", "broadcast"];
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.storage.postgres"));
  spec.features = ["commands", "payments"];
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.storage.postgres"));
});

test("rejects a postgres queue when no queued feature is enabled", () => {
  const spec = baseSpec();
  spec.runtime.queue = "postgres";
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.runtime.queue"));
});

test("rejects a none queue when a queued feature is enabled", () => {
  const spec = baseSpec();
  spec.features = ["commands", "llm"];
  spec.storage.postgres = true;
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.runtime.queue"));
});

test("accepts a postgres queue for every queued feature", () => {
  for (const feature of ["llm", "broadcast", "payments"]) {
    const spec = baseSpec();
    spec.features = ["commands", feature];
    spec.storage.postgres = true;
    if (feature === "payments") spec.payments = { products: [STARS_OK] };
    spec.runtime.queue = "postgres";
    assert.equal(validateBotSpec(spec).runtime.queue, "postgres");
  }
});

test("rejects idempotency and rate limit without redis", () => {
  const idempotency = baseSpec();
  idempotency.security.idempotency = true;
  assert.throws(() => validateBotSpec(idempotency), isSpecError("spec.storage.redis"));

  const rateLimit = baseSpec();
  rateLimit.security.rateLimit = true;
  assert.throws(() => validateBotSpec(rateLimit), isSpecError("spec.storage.redis"));
});

test("accepts idempotency and rate limit with redis", () => {
  const spec = baseSpec();
  spec.storage.redis = true;
  spec.security.idempotency = true;
  spec.security.rateLimit = true;
  assert.equal(validateBotSpec(spec).security.idempotency, true);
});

test("rejects miniapps without redis", () => {
  const spec = baseSpec();
  spec.miniapps = {};
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.storage.redis"));
});

test("miniapps defaults session ttl and origins", () => {
  const spec = baseSpec();
  spec.storage.redis = true;
  spec.miniapps = {};
  const parsed = validateBotSpec(spec);
  assert.deepEqual(parsed.miniapps, { sessionTtlSeconds: 86400, allowedOrigins: [] });
});

test("rejects miniapp session ttl outside 300..2592000", () => {
  const spec = baseSpec();
  spec.storage.redis = true;
  spec.miniapps = { sessionTtlSeconds: 299 };
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.miniapps.sessionTtlSeconds"));
  spec.miniapps.sessionTtlSeconds = 2_592_001;
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.miniapps.sessionTtlSeconds"));
  spec.miniapps.sessionTtlSeconds = 300;
  assert.equal(validateBotSpec(spec).miniapps?.sessionTtlSeconds, 300);
});

test("accepts https origins without path, query, or fragment", () => {
  const spec = baseSpec();
  spec.storage.redis = true;
  spec.miniapps = { allowedOrigins: ["https://app.example.com"] };
  assert.deepEqual(validateBotSpec(spec).miniapps?.allowedOrigins, ["https://app.example.com"]);
});

test("rejects miniapp origins that are not bare https origins", () => {
  const spec = baseSpec();
  spec.storage.redis = true;
  for (const origin of [
    "http://app.example.com",
    "app.example.com",
    "https://app.example.com/",
    "https://app.example.com/screen",
    "https://app.example.com?x=1",
    "https://app.example.com#top",
  ]) {
    spec.miniapps = { allowedOrigins: [origin] };
    assert.throws(
      () => validateBotSpec(spec),
      isSpecError("spec.miniapps.allowedOrigins[0]"),
      origin,
    );
  }
});

test("rejects payments without the payments feature", () => {
  const spec = baseSpec();
  spec.storage.postgres = true;
  spec.payments = { products: [STARS_OK] };
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.payments"));
});

test("rejects empty or missing payment products", () => {
  const spec = baseSpec();
  spec.features = ["commands", "payments"];
  spec.storage.postgres = true;
  spec.runtime.queue = "postgres";
  spec.payments = { products: [] };
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.payments.products"));
  const input: Record<string, unknown> = { ...spec, payments: {} };
  assert.throws(() => validateBotSpec(input), isSpecError("spec.payments.products"));
});

test("accepts valid payment products", () => {
  const spec = baseSpec();
  spec.features = ["commands", "payments"];
  spec.storage.postgres = true;
  spec.runtime.queue = "postgres";
  spec.payments = { products: [STARS_OK, { ...STARS_OK, id: "tip", subscription: false }] };
  assert.equal(validateBotSpec(spec).payments?.products.length, 2);
});

test("rejects duplicate payment product ids", () => {
  const spec = baseSpec();
  spec.features = ["commands", "payments"];
  spec.storage.postgres = true;
  spec.runtime.queue = "postgres";
  spec.payments = { products: [STARS_OK, { ...STARS_OK }] };
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.payments.products[1].id"));
});

test("rejects malformed payment product fields", () => {
  const spec = baseSpec();
  spec.features = ["commands", "payments"];
  spec.storage.postgres = true;
  spec.runtime.queue = "postgres";

  const cases: Array<[Partial<TestProduct>, string]> = [
    [{ id: "Pro" }, "spec.payments.products[0].id"],
    [{ id: "p" }, "spec.payments.products[0].id"],
    [{ id: "a".repeat(33) }, "spec.payments.products[0].id"],
    [{ title: "" }, "spec.payments.products[0].title"],
    [{ title: "t".repeat(33) }, "spec.payments.products[0].title"],
    [{ description: "" }, "spec.payments.products[0].description"],
    [{ description: "d".repeat(256) }, "spec.payments.products[0].description"],
    [{ stars: 0 }, "spec.payments.products[0].stars"],
    [{ stars: 10_001 }, "spec.payments.products[0].stars"],
    [{ stars: 1.5 }, "spec.payments.products[0].stars"],
    [{ subscription: "yes" as unknown as boolean }, "spec.payments.products[0].subscription"],
  ];
  for (const [patch, path] of cases) {
    spec.payments = { products: [{ ...STARS_OK, ...patch }] };
    assert.throws(() => validateBotSpec(spec), isSpecError(path), JSON.stringify(patch));
  }
});

test("accepts zh as the default locale only when enabled", () => {
  const spec = baseSpec();
  spec.i18n = { defaultLocale: "zh", en: false, ru: false, zh: true };
  assert.equal(validateBotSpec(spec).i18n.defaultLocale, "zh");

  spec.i18n = { defaultLocale: "zh", en: true, ru: false, zh: false };
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.i18n.defaultLocale"));

  spec.i18n = { defaultLocale: "zh", en: false, ru: false };
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.i18n"));
});

test("rejects unknown locales and empty locale sets", () => {
  const spec = baseSpec();
  spec.i18n = { defaultLocale: "de", en: true, ru: false };
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.i18n.defaultLocale"));
  spec.i18n = { defaultLocale: "en", en: false, ru: false, zh: false };
  assert.throws(() => validateBotSpec(spec), isSpecError("spec.i18n"));
});

test("rejects unknown nested keys", () => {
  const runtime = {
    ...baseSpec().runtime,
    extra: true,
  };
  assert.throws(
    () => validateBotSpec({ ...baseSpec(), runtime }),
    isSpecError("spec.runtime.extra"),
  );

  const telemetry = { ...baseSpec().runtime.telemetry, extra: true };
  assert.throws(
    () => validateBotSpec({ ...baseSpec(), runtime: { queue: "none", telemetry } }),
    isSpecError("spec.runtime.telemetry.extra"),
  );

  const miniapps = { sessionTtlSeconds: 3600, extra: true };
  assert.throws(
    () => validateBotSpec({ ...baseSpec(), miniapps, storage: { postgres: false, redis: true } }),
    isSpecError("spec.miniapps.extra"),
  );

  const product = { ...STARS_OK, extra: true };
  const spec = baseSpec();
  spec.features = ["commands", "payments"];
  spec.storage.postgres = true;
  spec.runtime.queue = "postgres";
  assert.throws(
    () => validateBotSpec({ ...spec, payments: { products: [product] } }),
    isSpecError("spec.payments.products[0].extra"),
  );

  assert.throws(
    () => validateBotSpec({ ...spec, payments: { products: [STARS_OK], extra: true } }),
    isSpecError("spec.payments.extra"),
  );
});

test("rejects unknown top-level keys including legacy-only shapes", () => {
  const input: Record<string, unknown> = { ...baseSpec(), extra: true };
  assert.throws(() => validateBotSpec(input), isSpecError("spec.extra"));
});
