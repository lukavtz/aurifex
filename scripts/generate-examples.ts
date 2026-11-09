import { createPathPolicy } from "../src/core/security/path-policy.ts";
import { scaffoldBot } from "../src/core/projects/scaffold.ts";
import type { BotSpec } from "../src/core/spec/bot-spec.ts";

const BASE: BotSpec = {
  schemaVersion: "bot-spec-1.1.0",
  name: "example",
  displayName: "Example",
  stack: "grammy",
  features: ["commands"],
  deployment: "docker",
  storage: { postgres: false, redis: false },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: false, idempotency: false },
  runtime: {
    queue: "none",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

const EXAMPLES: readonly { name: string; spec: BotSpec }[] = [
  {
    name: "grammy_commands",
    spec: { ...BASE, name: "grammy_commands", displayName: "grammY Commands" },
  },
  {
    name: "aiogram_commands",
    spec: {
      ...BASE,
      name: "aiogram_commands",
      displayName: "aiogram Commands",
      stack: "aiogram",
    },
  },
  {
    name: "grammy_payments",
    spec: {
      ...BASE,
      name: "grammy_payments",
      displayName: "grammY Payments",
      features: ["commands", "payments"],
      storage: { postgres: true, redis: true },
      security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
      runtime: {
        queue: "postgres",
        telemetry: { otlp: false, prometheus: false, sentry: false },
      },
      payments: {
        products: [
          {
            id: "support",
            title: "Support",
            description: "Support the bot",
            stars: 1,
            subscription: false,
          },
        ],
      },
    },
  },
];

const policy = await createPathPolicy(process.cwd());
for (const example of EXAMPLES) {
  const result = await scaffoldBot(
    { destination: `examples/${example.name}`, spec: example.spec, overwrite: true },
    { policy, now: () => new Date("2026-11-09T00:00:00Z") },
  );
  if (result.status === "error") throw new Error(`${example.name}: ${result.error.detail}`);
  process.stdout.write(`${example.name}: ${result.value.files.length} files\n`);
}
