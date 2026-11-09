import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { BotSpecError, validateBotSpec } from "../../src/core/spec/bot-spec.ts";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default as new (options?: {
  strict?: boolean;
  allErrors?: boolean;
}) => {
  compile(schema: unknown): ((data: unknown) => boolean) & { errors?: unknown };
};

const schema = JSON.parse(
  readFileSync(new URL("../../schema/bot-spec-1.1.schema.json", import.meta.url), "utf8"),
) as unknown;
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

interface Product {
  id: string;
  title: string;
  description: string;
  stars: number;
  subscription: boolean;
}

interface MutableSpec {
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
  miniapps?: { sessionTtlSeconds?: number; allowedOrigins: string[] };
  payments?: { products: Product[] };
}

function minimal(): MutableSpec {
  return {
    schemaVersion: "bot-spec-1.1.0",
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

function full(): MutableSpec {
  return {
    schemaVersion: "bot-spec-1.1.0",
    name: "shop_bot",
    displayName: "Shop Bot",
    stack: "aiogram",
    features: ["commands", "llm", "payments", "miniapps", "broadcast"],
    deployment: "docker",
    storage: { postgres: true, redis: true },
    i18n: { defaultLocale: "ru", en: true, ru: true, zh: true },
    security: {
      webhookSecret: true,
      adminAllowlist: true,
      rateLimit: true,
      idempotency: true,
    },
    runtime: {
      queue: "postgres",
      telemetry: { otlp: true, prometheus: true, sentry: true },
    },
    miniapps: {
      sessionTtlSeconds: 3600,
      allowedOrigins: ["https://example.com", "https://app.example.com:8443"],
    },
    payments: {
      products: [
        {
          id: "pro_month",
          title: "Pro",
          description: "Monthly access",
          stars: 250,
          subscription: true,
        },
      ],
    },
  };
}

function productsOf(spec: MutableSpec): Product[] {
  assert.ok(spec.payments !== undefined, "fixture has no payments block");
  return spec.payments.products;
}

function assertBothAccept(spec: unknown): void {
  assert.equal(validate(spec), true, JSON.stringify(validate.errors));
  assert.doesNotThrow(() => validateBotSpec(spec));
}

function assertBothReject(spec: unknown): void {
  assert.equal(validate(spec), false, "schema accepted an invalid document");
  assert.throws(() => validateBotSpec(spec), BotSpecError);
}

test("the schema accepts a minimal valid 1.1 document", () => {
  assertBothAccept(minimal());
});

test("the schema accepts the full feature set", () => {
  assertBothAccept(full());
});

test("validator output always satisfies the schema", () => {
  for (const source of [minimal(), full()]) {
    const normalized = validateBotSpec(source);
    assert.equal(validate(normalized), true, JSON.stringify(validate.errors));
  }
});

test("one unknown top-level key fails", () => {
  assertBothReject({ ...minimal(), extra: true });
});

test("one unknown nested key fails", () => {
  const spec = minimal();
  const storage: Record<string, unknown> = { ...spec.storage, mysql: true };
  assertBothReject({ ...spec, storage });
});

test("runtime is required", () => {
  const { runtime: _runtime, ...spec } = minimal();
  assertBothReject(spec);
});

test("runtime queue must match the queued features", () => {
  const spec = minimal();
  spec.features = ["commands", "llm"];
  spec.storage.postgres = true;
  spec.runtime.queue = "none";
  assertBothReject(spec);
});

test("queued features require postgres storage", () => {
  const spec = minimal();
  spec.features = ["commands", "broadcast"];
  spec.runtime.queue = "postgres";
  assertBothReject(spec);
});

test("idempotency and miniapps require redis", () => {
  const idempotent = minimal();
  idempotent.security.idempotency = true;
  assertBothReject(idempotent);

  const miniapp = minimal();
  miniapp.miniapps = { sessionTtlSeconds: 900, allowedOrigins: [] };
  assertBothReject(miniapp);

  const limiter = minimal();
  limiter.security.rateLimit = true;
  assertBothReject(limiter);
});

test("invalid miniapp TTL values fail", () => {
  const tooShort = minimal();
  tooShort.storage.redis = true;
  tooShort.miniapps = { sessionTtlSeconds: 299, allowedOrigins: [] };
  assertBothReject(tooShort);

  const tooLong = minimal();
  tooLong.storage.redis = true;
  tooLong.miniapps = { sessionTtlSeconds: 2_592_001, allowedOrigins: [] };
  assertBothReject(tooLong);

  const fractional = minimal();
  fractional.storage.redis = true;
  fractional.miniapps = { sessionTtlSeconds: 900.5, allowedOrigins: [] };
  assertBothReject(fractional);
});

test("non-https and non-origin miniapp origins fail", () => {
  const origins = [
    "http://example.com",
    "https://example.com/path",
    "https://example.com?q=1",
    "https://example.com#frag",
  ];
  for (const origin of origins) {
    const spec = minimal();
    spec.storage.redis = true;
    spec.miniapps = { sessionTtlSeconds: 900, allowedOrigins: [origin] };
    assertBothReject(spec);
  }
});

test("payment products are validated", () => {
  const cases: Array<(products: Product[]) => void> = [
    (products) => products.splice(0, products.length),
    (products) => {
      products[0]!.stars = 0;
    },
    (products) => {
      products[0]!.stars = 10_001;
    },
    (products) => {
      products[0]!.id = "Pro";
    },
    (products) => {
      products[0]!.title = "";
    },
    (products) => {
      products[0]!.description = "";
    },
    (products) => products.push({ ...products[0]! }),
  ];
  for (const mutate of cases) {
    const spec = full();
    mutate(productsOf(spec));
    assertBothReject(spec);
  }
});

test("payments block requires the payments feature", () => {
  const spec = minimal();
  spec.payments = {
    products: [{ id: "pro", title: "Pro", description: "Plan", stars: 1, subscription: false }],
  };
  assertBothReject(spec);
});

test("features require commands and reject duplicates", () => {
  const noCommands = minimal();
  noCommands.features = ["llm"];
  noCommands.storage.postgres = true;
  noCommands.runtime.queue = "postgres";
  assertBothReject(noCommands);

  const duplicate = minimal();
  duplicate.features = ["commands", "commands"];
  assertBothReject(duplicate);
});

test("i18n requires an enabled default locale", () => {
  const spec = minimal();
  spec.i18n = { defaultLocale: "zh", en: true, ru: false, zh: false };
  assertBothReject(spec);

  const none = minimal();
  none.i18n = { defaultLocale: "en", en: false, ru: false };
  assertBothReject(none);
});

test("webhookSecret must be true", () => {
  const spec = minimal();
  spec.security.webhookSecret = false;
  assertBothReject(spec);
});

test("a 1.0 document is rejected by the 1.1 schema", () => {
  const spec = { ...minimal(), schemaVersion: "bot-spec-1.0.0" };
  assert.equal(validate(spec), false);
  assert.doesNotThrow(() => validateBotSpec(spec));
});

test("valid corpus: every validator-accepted spec is schema-accepted", () => {
  for (const build of [minimal, full]) {
    assertBothAccept(build());
  }
});
