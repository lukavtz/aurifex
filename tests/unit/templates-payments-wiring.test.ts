import assert from "node:assert/strict";
import { test } from "node:test";

import { renderPaymentsJobsTs } from "../../src/core/projects/features/grammy.ts";
import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import { renderPaymentsTs } from "../../src/core/projects/templates/payments.ts";
import type { TemplateFile } from "../../src/core/projects/templates/shared.ts";
import { BOT_SPEC_VERSION, type BotSpec } from "../../src/core/spec/bot-spec.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";

const target = resolveStack("grammy").target;

const PAYMENTS_SPEC: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "shop_bot",
  displayName: "Shop Bot",
  stack: "grammy",
  features: ["commands", "payments"],
  deployment: "docker",
  storage: { postgres: true, redis: false },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: {
    webhookSecret: true,
    adminAllowlist: true,
    rateLimit: false,
    idempotency: false,
  },
  runtime: {
    queue: "postgres",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
  payments: {
    products: [
      { id: "pro", title: "Pro", description: "Pro plan", stars: 100, subscription: true },
      { id: "tip", title: "Tip", description: "One star", stars: 1, subscription: false },
    ],
  },
};

const PLAIN_SPEC: BotSpec = {
  ...PAYMENTS_SPEC,
  features: ["commands"],
  storage: { postgres: false, redis: false },
  runtime: {
    queue: "none",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

function find(files: readonly TemplateFile[], path: string): TemplateFile {
  const file = files.find((candidate) => candidate.path === path);
  assert.ok(file, `missing generated file: ${path}`);
  return file;
}

test("payments feature renders the runtime, handlers, jobs, and tests", () => {
  const files = renderGrammyProject(PAYMENTS_SPEC, target);
  const runtime = find(files, "src/runtime/payments.ts");
  assert.equal(runtime.content, renderPaymentsTs(PAYMENTS_SPEC));
  find(files, "src/features/payments.ts");
  find(files, "src/jobs/payments.ts");
  find(files, "src/jobs/payments-reconcile.ts");
  find(files, "tests/payments.test.ts");
});

test("buy creates a subscription invoice link and the handler replies with it", () => {
  const files = renderGrammyProject(PAYMENTS_SPEC, target);
  const feature = find(files, "src/features/payments.ts").content;
  const runtime = find(files, "src/runtime/payments.ts").content;
  assert.match(feature, /createInvoice\(api, product, from\.id, \{ chatId: ctx\.chat\.id \}\)/);
  assert.match(feature, /if \(invoice\.invoiceLink !== undefined\)/);
  assert.match(runtime, /api\.createInvoiceLink\(/);
  assert.match(runtime, /api\.sendInvoice\(/);
});

test("pre-checkout validation fails closed with a static reason", () => {
  const files = renderGrammyProject(PAYMENTS_SPEC, target);
  const feature = find(files, "src/features/payments.ts").content;
  assert.match(feature, /validatePreCheckout\(/);
  assert.match(feature, /invoicePayload: query\.invoice_payload/);
  assert.match(feature, /currency: query\.currency/);
  assert.match(feature, /totalAmount: query\.total_amount/);
  assert.match(feature, /answerPreCheckoutQuery\(true\)/);
  assert.match(feature, /answerPreCheckoutQuery\(false, PRE_CHECKOUT_ERROR\)/);
  assert.match(feature, /Payment could not be confirmed\./);
});

test("successful payments persist, enqueue fulfillment, and acknowledge", () => {
  const files = renderGrammyProject(PAYMENTS_SPEC, target);
  const feature = find(files, "src/features/payments.ts").content;
  assert.match(feature, /recordSuccessfulPayment\(sql, queue, \{/);
  assert.match(feature, /telegram_payment_charge_id/);
  assert.match(feature, /t\(ctx\.from\?\.language_code, "payments\.thanks"\)/);
});

test("refund and subscription cancel are admin-only and idempotent", () => {
  const files = renderGrammyProject(PAYMENTS_SPEC, target);
  const feature = find(files, "src/features/payments.ts").content;
  assert.match(feature, /if \(!isAdmin\(ctx\.from\?\.id\)\)/);
  assert.match(feature, /refundPayment\(sql, api, \{ userId, chargeId \}\)/);
  assert.match(feature, /cancelSubscription\(sql, api, \{ userId, chargeId \}\)/);
  assert.match(feature, /Refund already recorded\./);
  assert.match(feature, /Subscription already canceled\./);
  assert.match(feature, /bot\.command\("subscriptions"/);
  assert.match(feature, /PAYSUPPORT_TEXT/);
});

test("fulfillment job is idempotent and reconciliation never grants", () => {
  const files = renderGrammyProject(PAYMENTS_SPEC, target);
  const fulfill = find(files, "src/jobs/payments.ts").content;
  const reconcile = find(files, "src/jobs/payments-reconcile.ts").content;
  assert.match(fulfill, /export const kind = "payment\.fulfill"/);
  assert.match(fulfill, /ON CONFLICT \(charge_id\) DO NOTHING/);
  assert.match(fulfill, /AND status = 'paid'/);
  assert.match(fulfill, /INSERT INTO subscriptions/);
  assert.match(reconcile, /export const kind = "payment\.reconcile"/);
  assert.match(reconcile, /reconcilePayments\(ctx\.sql, api, \{ limit: 100 \}\)/);
  assert.ok(!reconcile.includes("payment.fulfill"));
  assert.match(reconcile, /runAt: new Date\(nextBucket \* INTERVAL_MS\)/);
  assert.match(reconcile, /idempotencyKey: "reconcile:"/);
});

test("the scaffold schedules one bootstrap reconciliation", () => {
  const files = renderGrammyProject(PAYMENTS_SPEC, target);
  const main = find(files, "src/main.ts").content;
  assert.match(main, /queue\.enqueue\("payment\.reconcile", \{\}, \{/);
  assert.match(main, /runAt: new Date\(Date\.now\(\) \+ 60_000\)/);
  assert.match(main, /idempotencyKey: "reconcile:bootstrap"/);
});

test("the generated test covers the payment contracts", () => {
  const content = find(
    renderGrammyProject(PAYMENTS_SPEC, target),
    "tests/payments.test.ts",
  ).content;
  for (const name of [
    "/buy uses createInvoiceLink for a subscription product",
    "pre-checkout with a wrong amount answers false",
    "successful payment inserts once and enqueues fulfillment once",
    "refund is admin-only and idempotent",
    "reconciliation records without granting an entitlement",
  ]) {
    assert.ok(content.includes(name), `missing generated test: ${name}`);
  }
});

test("jobs renderer returns exactly the two payment job modules", () => {
  const paths = renderPaymentsJobsTs().map((file) => file.path);
  assert.deepEqual(paths.toSorted(), ["src/jobs/payments-reconcile.ts", "src/jobs/payments.ts"]);
});

test("bots without the payments feature carry no payment runtime or jobs", () => {
  const paths = renderGrammyProject(PLAIN_SPEC, target).map((file) => file.path);
  assert.ok(!paths.includes("src/runtime/payments.ts"));
  assert.ok(!paths.includes("src/features/payments.ts"));
  assert.ok(!paths.includes("src/jobs/payments.ts"));
  assert.ok(!paths.includes("src/jobs/payments-reconcile.ts"));
  assert.ok(!paths.includes("tests/payments.test.ts"));
});
