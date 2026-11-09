import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { renderAiogramProject } from "../../src/core/projects/templates/aiogram.ts";
import { renderPaymentsPy } from "../../src/core/projects/templates/payments.ts";
import { renderSchemaPy } from "../../src/core/projects/templates/runtime-schema.ts";
import { BOT_SPEC_VERSION, validateBotSpec } from "../../src/core/spec/bot-spec.ts";

const spec = validateBotSpec({
  schemaVersion: BOT_SPEC_VERSION,
  name: "shop_bot",
  displayName: "Shop Bot",
  stack: "aiogram",
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
});

const files = renderAiogramProject(spec);
const paths = files.map((file) => file.path);

function contentOf(path: string): string {
  const file = files.find((entry) => entry.path === path);
  assert.ok(file, `missing ${path}`);
  return file.content;
}

test("renders payment runtime, handler, jobs, and tests exactly once", () => {
  assert.equal(new Set(paths).size, paths.length);
  for (const path of [
    "app/runtime/payments.py",
    "app/handlers/payments.py",
    "app/jobs/payment_fulfill.py",
    "app/jobs/payment_reconcile.py",
    "tests/test_payments.py",
  ]) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
});

test("payments runtime and models are the shared renderers", () => {
  assert.equal(contentOf("app/runtime/payments.py"), renderPaymentsPy(spec));
  assert.equal(contentOf("app/db/models.py"), renderSchemaPy(spec));
});

test("models replace the legacy tables instead of duplicating them", () => {
  const models = contentOf("app/db/models.py");
  for (const table of [
    "class User(Base):",
    "class Payment(Base):",
    "class Refund(Base):",
    "class Subscription(Base):",
    "class Job(Base):",
  ]) {
    assert.ok(models.includes(table), `missing ${table}`);
    assert.equal(models.split(table).length - 1, 1, `duplicate ${table}`);
  }
  assert.ok(models.includes("charge_id: Mapped[str] = mapped_column(Text, primary_key=True)"));
  assert.ok(!models.includes("total_amount"));
});

test("handler uses workflow dependencies and the runtime service", () => {
  const handler = contentOf("app/handlers/payments.py");
  assert.match(handler, /from app\.runtime\.payments import/);
  assert.match(handler, /session_factory: Any/);
  assert.match(handler, /queue: Any/);
  assert.match(handler, /settings: Any/);
  assert.match(handler, /router\.message\.register\(handle_buy, Command\("buy"\)\)/);
  assert.match(handler, /Command\("paysupport"\)/);
  assert.match(handler, /Command\("refund"\)/);
  assert.match(handler, /Command\("subscriptions"\)/);
  assert.match(handler, /Command\("subscription_cancel"\)/);
  assert.match(handler, /router\.pre_checkout_query\.register\(handle_pre_checkout\)/);
  assert.match(
    handler,
    /router\.message\.register\(handle_successful_payment, F\.successful_payment\)/,
  );
  // Pre-checkout validation answers false with a static message and writes no row.
  assert.match(handler, /validate_pre_checkout\(/);
  assert.match(handler, /ok=False,/);
  assert.match(handler, /payments\.precheckout_failed/);
  assert.ok(!handler.includes("INSERT INTO"));
  // Successful payments map Telegram fields once and never re-grant duplicates.
  assert.match(handler, /payment\.telegram_payment_charge_id/);
  assert.match(handler, /payment\.provider_payment_charge_id/);
  assert.match(handler, /record_successful_payment\(/);
  assert.match(handler, /if outcome\["duplicate"\]:\n        return/);
  assert.match(handler, /payments\.thanks/);
  // Admin-only refund and cancellation are idempotent through the runtime.
  assert.match(handler, /user\.id not in settings\.admin_id_set/);
  assert.match(handler, /refund_payment\(/);
  assert.match(handler, /cancel_subscription\(/);
  assert.ok(!handler.includes("PAYMENTS_PATH"));
  assert.ok(!handler.includes("jsonl"));
});

test("subscription purchases send an invoice link instead of an invoice", () => {
  const handler = contentOf("app/handlers/payments.py");
  assert.match(handler, /async def create_invoice_link\(/);
  assert.match(handler, /create_invoice_link\(/);
  assert.match(handler, /link = result\.get\("invoice_link"\)/);
  assert.match(handler, /await message\.answer\(link\)/);
});

test("fulfil job marks a subscription idempotently", () => {
  const job = contentOf("app/jobs/payment_fulfill.py");
  assert.equal(job.match(/^KIND = /gm)?.length, 1);
  assert.match(job, /KIND = "payment\.fulfill"/);
  assert.match(job, /async def handle\(job: ClaimedJob, ctx: JobContext\)/);
  assert.match(job, /INSERT INTO subscriptions/);
  assert.match(job, /ON CONFLICT \(charge_id\) DO NOTHING/);
});

test("reconcile job reschedules itself and never grants", () => {
  const job = contentOf("app/jobs/payment_reconcile.py");
  assert.equal(job.match(/^KIND = /gm)?.length, 1);
  assert.match(job, /KIND = "payment\.reconcile"/);
  assert.match(job, /async def handle\(_job: ClaimedJob, ctx: JobContext\)/);
  assert.match(job, /await reconcile_payments\(/);
  assert.match(job, /run_at=dt\.datetime\.now\(dt\.UTC\) \+ INTERVAL/);
  assert.ok(!job.includes("payment.fulfill"));
  assert.ok(!job.includes("subscriptions"));
});

test("generated payment tests cover subscription, precheckout, duplicate, refund, reconcile", () => {
  const tests = contentOf("tests/test_payments.py");
  for (const name of [
    "test_subscription_uses_invoice_link",
    "test_precheckout_rejects_wrong_amount",
    "test_duplicate_payment_is_not_thanked_twice",
    "test_refund_uses_the_full_recorded_amount",
    "test_reconcile_reschedules_without_granting",
  ]) {
    assert.match(tests, new RegExp(`async def ${name}\\(`));
  }
});

test("every generated payment module parses as Python 3", () => {
  for (const path of [
    "app/runtime/payments.py",
    "app/handlers/payments.py",
    "app/jobs/payment_fulfill.py",
    "app/jobs/payment_reconcile.py",
    "tests/test_payments.py",
    "app/db/models.py",
  ]) {
    const parsed = spawnSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], {
      input: contentOf(path),
      encoding: "utf8",
    });
    assert.equal(parsed.status, 0, `${path}: ${parsed.stderr}`);
  }
});

test("non-payment features stay unchanged", () => {
  const commandSpec = validateBotSpec({
    ...spec,
    features: ["commands"],
    storage: { postgres: false, redis: false },
    runtime: { queue: "none", telemetry: { otlp: false, prometheus: false, sentry: false } },
    payments: undefined,
  });
  const commandFiles = renderAiogramProject(commandSpec);
  const handlerPaths = commandFiles
    .map((file) => file.path)
    .filter((path) => path.startsWith("app/handlers/"));
  assert.ok(handlerPaths.includes("app/handlers/commands.py"));
  assert.ok(!handlerPaths.includes("app/handlers/payments.py"));
});
