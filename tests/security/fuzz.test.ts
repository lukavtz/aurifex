import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { after, before, test } from "node:test";

import fc from "fast-check";

import { createPathPolicy, PathPolicyError } from "../../src/core/security/path-policy.ts";
import type { PathPolicy } from "../../src/core/security/path-policy.ts";
import { BOT_SPEC_VERSION, BotSpecError, validateBotSpec } from "../../src/core/spec/bot-spec.ts";

const SEED = 20_261_109;
const RUNS = 10_000;
const OPTIONS = { numRuns: RUNS, seed: SEED } as const;

const EXTRA_FEATURES = [
  "llm",
  "inline",
  "payments",
  "miniapps",
  "moderation",
  "broadcast",
  "widgets",
  "rich",
] as const;
const LOCALES = ["en", "ru", "zh"] as const;
const PRODUCT_IDS = ["pro", "vip", "basic", "annual"] as const;
const ORIGINS = [
  "https://example.com",
  "https://app.example.org",
  "https://shop.example.net:8443",
] as const;

interface Product {
  id: string;
  title: string;
  description: string;
  stars: number;
  subscription: boolean;
}

const productArb: fc.Arbitrary<Product> = fc.record({
  id: fc.constantFrom(...PRODUCT_IDS),
  title: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,30}$/),
  description: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 .,_-]{0,60}$/),
  stars: fc.integer({ min: 1, max: 10_000 }),
  subscription: fc.boolean(),
});

const validSpecArb: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    stack: fc.constantFrom("grammy", "aiogram"),
    extras: fc.uniqueArray(fc.constantFrom(...EXTRA_FEATURES), { maxLength: 4 }),
    adminAllowlist: fc.boolean(),
    rateLimit: fc.boolean(),
    idempotency: fc.boolean(),
    postgres: fc.boolean(),
    redis: fc.boolean(),
    otlp: fc.boolean(),
    prometheus: fc.boolean(),
    sentry: fc.boolean(),
    includeMiniapps: fc.boolean(),
    sessionTtlSeconds: fc.integer({ min: 300, max: 2_592_000 }),
    includeOrigins: fc.boolean(),
    products: fc.uniqueArray(productArb, {
      minLength: 1,
      maxLength: 3,
      selector: (product) => product.id,
    }),
    defaultLocale: fc.constantFrom(...LOCALES),
    localeFlags: fc.record({ en: fc.boolean(), ru: fc.boolean(), zh: fc.boolean() }),
    name: fc.constantFrom("demo_bot", "orders_bot", "shop_bot"),
    displayName: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,40}$/),
  })
  .map((value) => {
    const features = ["commands", ...value.extras];
    const queued = value.extras.some(
      (feature) => feature === "llm" || feature === "broadcast" || feature === "payments",
    );
    const wantsMiniapps = value.includeMiniapps && value.extras.includes("miniapps");
    const needsRedis = value.rateLimit || value.idempotency || wantsMiniapps;
    const document: Record<string, unknown> = {
      schemaVersion: BOT_SPEC_VERSION,
      name: value.name,
      displayName: value.displayName,
      stack: value.stack,
      features,
      deployment: "docker",
      storage: {
        postgres: queued ? true : value.postgres,
        redis: needsRedis ? true : value.redis,
      },
      i18n: {
        defaultLocale: value.defaultLocale,
        en: value.localeFlags.en || value.defaultLocale === "en",
        ru: value.localeFlags.ru || value.defaultLocale === "ru",
        zh: value.localeFlags.zh || value.defaultLocale === "zh",
      },
      security: {
        webhookSecret: true,
        adminAllowlist: value.adminAllowlist,
        rateLimit: value.rateLimit,
        idempotency: value.idempotency,
      },
      runtime: {
        queue: queued ? "postgres" : "none",
        telemetry: {
          otlp: value.otlp,
          prometheus: value.prometheus,
          sentry: value.sentry,
        },
      },
    };
    if (wantsMiniapps) {
      document.miniapps = {
        sessionTtlSeconds: value.sessionTtlSeconds,
        ...(value.includeOrigins ? { allowedOrigins: ORIGINS.slice(0, 2) } : {}),
      };
    }
    if (value.extras.includes("payments")) {
      document.payments = { products: value.products };
    }
    return document;
  });

function fullDocument(): Record<string, unknown> {
  return {
    schemaVersion: BOT_SPEC_VERSION,
    name: "demo_bot",
    displayName: "Demo Bot",
    stack: "grammy",
    features: ["commands", "payments", "miniapps"],
    deployment: "docker",
    storage: { postgres: true, redis: true },
    i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
    security: {
      webhookSecret: true,
      adminAllowlist: false,
      rateLimit: false,
      idempotency: false,
    },
    runtime: {
      queue: "postgres",
      telemetry: { otlp: false, prometheus: false, sentry: false },
    },
    miniapps: { sessionTtlSeconds: 86_400, allowedOrigins: ["https://example.com"] },
    payments: {
      products: [
        { id: "pro", title: "Pro", description: "Pro access", stars: 100, subscription: false },
      ],
    },
  };
}

type NestTarget =
  | "root"
  | "storage"
  | "i18n"
  | "security"
  | "runtime"
  | "telemetry"
  | "miniapps"
  | "payments"
  | "product";

const NEST_TARGETS: readonly NestTarget[] = [
  "root",
  "storage",
  "i18n",
  "security",
  "runtime",
  "telemetry",
  "miniapps",
  "payments",
  "product",
];

const UNKNOWN_KEYS = ["extra_field", "unexpected_key", "nested_unknown"] as const;

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function containerFor(
  document: Record<string, unknown>,
  target: NestTarget,
): { node: Record<string, unknown>; prefix: string } {
  switch (target) {
    case "root":
      return { node: document, prefix: "spec" };
    case "storage":
      return { node: asRecord(document.storage), prefix: "spec.storage" };
    case "i18n":
      return { node: asRecord(document.i18n), prefix: "spec.i18n" };
    case "security":
      return { node: asRecord(document.security), prefix: "spec.security" };
    case "runtime":
      return { node: asRecord(document.runtime), prefix: "spec.runtime" };
    case "telemetry":
      return {
        node: asRecord(asRecord(document.runtime).telemetry),
        prefix: "spec.runtime.telemetry",
      };
    case "miniapps":
      return { node: asRecord(document.miniapps), prefix: "spec.miniapps" };
    case "payments":
      return { node: asRecord(document.payments), prefix: "spec.payments" };
    case "product": {
      const payments = asRecord(document.payments);
      assert.ok(Array.isArray(payments.products));
      const product = asRecord(payments.products[0]);
      return { node: product, prefix: "spec.payments.products[0]" };
    }
  }
}

test("validateBotSpec only throws BotSpecError for arbitrary JSON", () => {
  fc.assert(
    fc.property(fc.jsonValue(), (input) => {
      let spec;
      try {
        spec = validateBotSpec(input);
      } catch (error) {
        assert.ok(
          error instanceof BotSpecError,
          `unexpected ${String(error)} for ${JSON.stringify(input)}`,
        );
        return;
      }
      const reparsed = validateBotSpec(JSON.parse(JSON.stringify(spec)));
      assert.deepEqual(reparsed, spec);
    }),
    OPTIONS,
  );
});

test("generated valid specs are accepted and round-trip", () => {
  fc.assert(
    fc.property(validSpecArb, (document) => {
      const spec = validateBotSpec(document);
      const reparsed = validateBotSpec(JSON.parse(JSON.stringify(spec)));
      assert.deepEqual(reparsed, spec);
    }),
    OPTIONS,
  );
});

test("validateBotSpec rejects unknown top-level and nested keys", () => {
  assert.doesNotThrow(() => validateBotSpec(fullDocument()));
  fc.assert(
    fc.property(
      fc.constantFrom(...NEST_TARGETS),
      fc.constantFrom(...UNKNOWN_KEYS),
      fc.jsonValue(),
      (target, key, value) => {
        const document = structuredClone(fullDocument());
        const { node, prefix } = containerFor(document, target);
        node[key] = value;
        assert.throws(
          () => validateBotSpec(document),
          (error) => error instanceof BotSpecError && error.path === `${prefix}.${key}`,
          `expected ${prefix}.${key} to be rejected for target ${target}`,
        );
      },
    ),
    OPTIONS,
  );
});

let root = "";
let policy: PathPolicy;

function isInside(container: string, candidate: string): boolean {
  const rel = relative(container, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "aurifex-fuzz-"));
  policy = await createPathPolicy(root);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

const TRAVERSAL_ATOMS = [
  "..",
  "../",
  "..\\",
  "/",
  "\\",
  "\0",
  ".",
  "./",
  "~",
  "//",
  "%2e%2e",
  "C:\\",
  "é",
  "😀",
  "a",
  " ",
] as const;

const pathAtom = fc.oneof(
  fc.constantFrom(...TRAVERSAL_ATOMS),
  fc.string({ maxLength: 8 }),
  fc.string({ unit: "binary", maxLength: 8 }),
);

const pathArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 32 }),
  fc.string({ unit: "binary", maxLength: 32 }),
  fc.array(pathAtom, { maxLength: 6 }).map((parts) => parts.join("")),
  fc
    .tuple(fc.string({ maxLength: 8 }), fc.constantFrom("\\", "\0", "../", "/", ".."))
    .map(([head, tail]) => head + tail),
  fc.constantFrom("../outside", "../../etc/passwd", "/etc/passwd", "C:\\outside", "\0", ""),
);

test("PathPolicy.resolve never escapes the root", () => {
  fc.assert(
    fc.property(pathArb, (input) => {
      let resolved: string;
      try {
        resolved = policy.resolve(input);
      } catch (error) {
        assert.ok(
          error instanceof PathPolicyError,
          `unexpected ${String(error)} for ${JSON.stringify(input)}`,
        );
        return;
      }
      assert.ok(
        isInside(policy.root, resolved),
        `escaped root: ${JSON.stringify(input)} -> ${resolved}`,
      );
    }),
    OPTIONS,
  );
});

test(
  "PathPolicy rejects backslash and NUL on POSIX",
  { skip: process.platform === "win32" },
  () => {
    const forbidden: fc.Arbitrary<string> = fc.oneof(
      fc.string().map((value) => `${value}\\`),
      fc.string().map((value) => `${value}\0`),
      fc.string({ unit: "binary" }).map((value) => `${value}\0`),
    );
    fc.assert(
      fc.property(forbidden, (input) => {
        assert.throws(
          () => policy.resolve(input),
          (error) => error instanceof PathPolicyError && error.code === "invalid_path",
          `expected invalid_path for ${JSON.stringify(input)}`,
        );
      }),
      OPTIONS,
    );
  },
);

test("PathPolicy.readText only reads inside the root", async () => {
  await fc.assert(
    fc.asyncProperty(pathArb, async (input) => {
      let resolved: string;
      try {
        resolved = policy.resolve(input);
      } catch (error) {
        assert.ok(
          error instanceof PathPolicyError,
          `unexpected ${String(error)} for ${JSON.stringify(input)}`,
        );
        return;
      }
      assert.ok(isInside(policy.root, resolved));
      try {
        const text = await policy.readText(input);
        assert.equal(typeof text, "string");
      } catch (error) {
        assert.ok(
          error instanceof PathPolicyError,
          `unexpected read error ${String(error)} for ${JSON.stringify(input)}`,
        );
      }
    }),
    OPTIONS,
  );
});

test("PathPolicy.writeFile only writes inside the root", async () => {
  const absoluteInside: fc.Arbitrary<string> = fc
    .tuple(fc.constant(root), fc.stringMatching(/^[a-z]{1,8}$/))
    .map(([base, name]) => join(base, name));
  await fc.assert(
    fc.asyncProperty(fc.oneof(pathArb, absoluteInside), async (input) => {
      let resolved: string;
      try {
        resolved = policy.resolve(input);
      } catch (error) {
        assert.ok(
          error instanceof PathPolicyError,
          `unexpected ${String(error)} for ${JSON.stringify(input)}`,
        );
        return;
      }
      assert.ok(isInside(policy.root, resolved));
      let written;
      try {
        written = await policy.writeFile(input, "fuzz", { overwrite: true, mode: 0o600 });
      } catch (error) {
        if (error instanceof PathPolicyError) return;
        const code = (error as NodeJS.ErrnoException).code;
        assert.equal(typeof code, "string", `unexpected write error ${String(error)}`);
        return;
      }
      assert.ok(!isAbsolute(written.path));
      assert.ok(!written.path.startsWith("../"), `escaped write: ${written.path}`);
      const canonical = await realpath(join(policy.root, written.path));
      assert.ok(isInside(policy.root, canonical), `write escaped root: ${canonical}`);
    }),
    OPTIONS,
  );
});
