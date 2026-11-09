import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";
import {
  PAYMENTS_SQL,
  renderPaymentsDrizzleTs,
  renderPaymentsModelsPy,
  renderPaymentsPy,
  renderPaymentsTs,
} from "../../src/core/projects/templates/payments.ts";
import { BOT_SPEC_VERSION, validateBotSpec } from "../../src/core/spec/bot-spec.ts";

const SPEC = validateBotSpec({
  schemaVersion: BOT_SPEC_VERSION,
  name: "shop_bot",
  displayName: "Shop",
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
});

const PLAIN_SPEC = validateBotSpec({
  schemaVersion: BOT_SPEC_VERSION,
  name: "plain_bot",
  displayName: "Plain",
  stack: "grammy",
  features: ["commands"],
  deployment: "docker",
  storage: { postgres: false, redis: false },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: {
    webhookSecret: true,
    adminAllowlist: false,
    rateLimit: false,
    idempotency: false,
  },
  runtime: {
    queue: "none",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
});

const NONCE = "123e4567-e89b-42d3-a456-426614174000";
const PAYLOAD = "product:pro:user:42:nonce:" + NONCE;

interface Product {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly stars: number;
  readonly subscription: boolean;
}

interface Validation {
  readonly ok: boolean;
  readonly reason?: string;
}

interface StarTransaction {
  readonly id: string;
  readonly amount: number;
  readonly source?: { readonly id?: number };
  readonly transaction_type?: { readonly type?: string; readonly payment_charge_id?: string };
}

interface FakeCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

class FakeApi {
  readonly calls: FakeCall[] = [];
  readonly pages: (readonly StarTransaction[])[] = [];

  async sendInvoice(...args: readonly unknown[]): Promise<unknown> {
    this.calls.push({ method: "sendInvoice", args });
    return true;
  }

  async createInvoiceLink(...args: readonly unknown[]): Promise<string> {
    this.calls.push({ method: "createInvoiceLink", args });
    return "https://t.me/invoice/test";
  }

  async refundStarPayment(...args: readonly unknown[]): Promise<unknown> {
    this.calls.push({ method: "refundStarPayment", args });
    return true;
  }

  async editUserStarSubscription(...args: readonly unknown[]): Promise<unknown> {
    this.calls.push({ method: "editUserStarSubscription", args });
    return true;
  }

  async getStarTransactions(input: { offset?: number; limit?: number }): Promise<{
    transactions: readonly StarTransaction[];
  }> {
    this.calls.push({ method: "getStarTransactions", args: [input] });
    const index = Math.floor((input.offset ?? 0) / (input.limit ?? 100));
    return { transactions: this.pages[index] ?? [] };
  }

  methods(): string[] {
    return this.calls.map((call) => call.method);
  }
}

class FakeQueue {
  readonly calls: { kind: string; payload: unknown; idempotencyKey?: string }[] = [];

  async enqueue(
    kind: string,
    payload: unknown,
    options?: { idempotencyKey?: string },
  ): Promise<string> {
    const call: { kind: string; payload: unknown; idempotencyKey?: string } = {
      kind,
      payload,
    };
    if (options?.idempotencyKey !== undefined) call.idempotencyKey = options.idempotencyKey;
    this.calls.push(call);
    return "job-id";
  }
}

interface PaymentRowState {
  charge_id: string;
  user_id: number;
  amount: number;
  currency: string;
  status: string;
}

class FakeSql {
  readonly payments = new Map<string, PaymentRowState>();
  readonly users = new Set<number>();
  readonly refunds: { chargeId: string; userId: number; amount: number; status: string }[] = [];
  readonly subscriptions = new Map<string, { userId: number; canceledAt: unknown }>();
  readonly queries: string[] = [];

  async begin<T>(fn: (tx: FakeSql) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async unsafe(query: string, params: readonly unknown[] = []): Promise<Record<string, unknown>[]> {
    this.queries.push(query);
    const p = params;
    if (query.includes("UPDATE payments SET status = 'refunded'")) {
      const chargeId = String(p[0]);
      const row = this.payments.get(chargeId);
      if (row === undefined || row.user_id !== Number(p[1]) || row.status !== "paid") return [];
      row.status = "refunded";
      return [{ amount: row.amount }];
    }
    if (query.includes("SELECT status, amount FROM payments")) {
      const row = this.payments.get(String(p[0]));
      if (row === undefined || row.user_id !== Number(p[1])) return [];
      return [{ status: row.status, amount: row.amount }];
    }
    if (query.includes("UPDATE payments SET status = 'paid'")) {
      const row = this.payments.get(String(p[0]));
      if (row !== undefined) row.status = "paid";
      return [];
    }
    if (query.includes("INSERT INTO refunds")) {
      this.refunds.push({
        chargeId: String(p[0]),
        userId: Number(p[1]),
        amount: Number(p[2]),
        status: String(p[3]),
      });
      return [{ id: "refund-id" }];
    }
    if (query.includes("SELECT charge_id, canceled_at FROM subscriptions")) {
      const row = this.subscriptions.get(String(p[0]));
      if (row === undefined || row.userId !== Number(p[1])) return [];
      return [{ charge_id: String(p[0]), canceled_at: row.canceledAt }];
    }
    if (query.includes("UPDATE subscriptions SET canceled_at = now()")) {
      const row = this.subscriptions.get(String(p[0]));
      if (row !== undefined) row.canceledAt = new Date();
      return [];
    }
    if (query.includes("'reconcile'")) {
      const chargeId = String(p[0]);
      if (this.payments.has(chargeId)) return [];
      this.payments.set(chargeId, {
        charge_id: chargeId,
        user_id: Number(p[1]),
        amount: Number(p[2]),
        currency: "XTR",
        status: "paid",
      });
      return [{ charge_id: chargeId }];
    }
    if (query.includes("UPDATE payments SET status = $2")) {
      const row = this.payments.get(String(p[0]));
      if (row === undefined || row.status !== "paid") return [];
      row.status = String(p[1]);
      return [{ charge_id: row.charge_id }];
    }
    if (query.includes("INSERT INTO users")) {
      this.users.add(Number(p[0]));
      return [];
    }
    if (query.includes("INSERT INTO payments")) {
      const chargeId = String(p[0]);
      if (this.payments.has(chargeId)) return [];
      const row: PaymentRowState = {
        charge_id: chargeId,
        user_id: Number(p[1]),
        amount: Number(p[4]),
        currency: String(p[3]),
        status: "paid",
      };
      this.payments.set(chargeId, row);
      return [{ ...row }];
    }
    if (query.includes("SELECT charge_id, user_id, amount, currency, status")) {
      const row = this.payments.get(String(p[0]));
      return row === undefined ? [] : [{ ...row }];
    }
    if (query.includes("INSERT INTO subscriptions")) {
      this.subscriptions.set(String(p[0]), {
        userId: Number(p[1]),
        canceledAt: null,
      });
      return [];
    }
    throw new Error("unexpected query: " + query);
  }
}

interface SuccessfulPaymentInput {
  readonly userId: number;
  readonly chargeId: string;
  readonly invoicePayload: string;
  readonly currency: string;
  readonly totalAmount: number;
  readonly isRecurring?: boolean;
  readonly isFirstRecurring?: boolean;
  readonly subscriptionExpirationDate?: number;
  readonly username?: string;
  readonly displayName?: string;
  readonly raw?: unknown;
}

interface GeneratedPayments {
  PRODUCTS: readonly Product[];
  CURRENCY: string;
  SUBSCRIPTION_PERIOD_SECONDS: number;
  PaymentError: new (code: string, message: string) => Error & { code: string };
  invoicePayload(productId: string, userId: number, nonce: string): string;
  parseInvoicePayload(
    payload: string,
    products: readonly Product[],
  ): { product: Product; userId: number; nonce: string };
  validatePreCheckout(
    query: {
      userId: number;
      invoicePayload: string;
      currency: string;
      totalAmount: number;
    },
    products: readonly Product[],
  ): Validation;
  validateSuccessfulPayment(
    payment: SuccessfulPaymentInput,
    products: readonly Product[],
  ): Validation;
  createInvoice(
    api: FakeApi,
    product: Product,
    userId: number,
    options?: { chatId?: number; nonce?: string },
  ): Promise<{ payload: string; invoiceLink?: string }>;
  recordSuccessfulPayment(
    sql: FakeSql,
    queue: FakeQueue,
    input: { payment: SuccessfulPaymentInput; products: readonly Product[] },
  ): Promise<{
    chargeId: string;
    userId: number;
    amount: number;
    currency: string;
    status: string;
    duplicate: boolean;
  }>;
  refundPayment(
    sql: FakeSql,
    api: FakeApi,
    input: { userId: number; chargeId: string },
  ): Promise<{ refunded: boolean; duplicate: boolean; amount: number; status: string }>;
  cancelSubscription(
    sql: FakeSql,
    api: FakeApi,
    input: { userId: number; chargeId: string },
  ): Promise<{ canceled: boolean; duplicate: boolean }>;
  classifyStarTransaction(tx: StarTransaction): {
    kind: string;
    chargeId: string;
    userId?: number;
    amount: number;
  };
  reconcilePayments(
    sql: FakeSql,
    api: FakeApi,
    options?: { offset?: number; limit?: number; maxPages?: number },
  ): Promise<{
    scanned: number;
    inserted: number;
    refunded: number;
    chargebacks: number;
    skipped: number;
  }>;
}

const dir = mkdtempSync(join(tmpdir(), "aurifex-payments-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const tsPath = join(dir, "payments.ts");
const generatedSource = renderPaymentsTs(SPEC);
writeFileSync(tsPath, generatedSource, "utf8");
// Static import is impossible: the module only exists after this test renders it.
const payments = (await import(pathToFileURL(tsPath).href)) as GeneratedPayments;

function validPayment(overrides: Partial<SuccessfulPaymentInput> = {}): SuccessfulPaymentInput {
  return {
    userId: 42,
    chargeId: "charge-1",
    invoicePayload: PAYLOAD,
    currency: "XTR",
    totalAmount: 100,
    isRecurring: true,
    isFirstRecurring: true,
    subscriptionExpirationDate: 1_800_000_000,
    username: "buyer",
    displayName: "Buyer",
    raw: { telegram_payment_charge_id: "charge-1" },
    ...overrides,
  };
}

describe("PAYMENTS_SQL", () => {
  it("creates every payments table with the approved columns", () => {
    for (const fragment of [
      "id bigint PRIMARY KEY",
      "charge_id text PRIMARY KEY",
      "user_id bigint NOT NULL REFERENCES users(id)",
      "status text NOT NULL DEFAULT 'paid'",
      "CHECK (status IN ('paid','refunded','chargeback'))",
      "is_recurring boolean NOT NULL DEFAULT false",
      "is_first_recurring boolean NOT NULL DEFAULT false",
      "subscription_expiration_date timestamptz",
      "provider_charge_id text",
      "raw jsonb NOT NULL",
      "CREATE TABLE refunds",
      "amount integer NOT NULL",
      "CHECK (status IN ('requested','completed','failed'))",
      "CREATE TABLE subscriptions",
      "period_seconds integer NOT NULL",
      "expires_at timestamptz NOT NULL",
      "canceled_at timestamptz",
    ]) {
      assert.ok(PAYMENTS_SQL.includes(fragment), `missing SQL fragment: ${fragment}`);
    }
  });

  it("references payments from refunds and subscriptions", () => {
    assert.match(
      PAYMENTS_SQL,
      /CREATE TABLE refunds \(\n  id uuid PRIMARY KEY[\s\S]*?REFERENCES payments\(charge_id\)/,
    );
    assert.match(
      PAYMENTS_SQL,
      /CREATE TABLE subscriptions \(\n  charge_id text PRIMARY KEY REFERENCES payments\(charge_id\)/,
    );
  });
});

describe("schema and model renderers", () => {
  it("mirror every payments column in the Drizzle schema", () => {
    const source = renderPaymentsDrizzleTs();
    for (const fragment of [
      'bigint("id", { mode: "number" }).primaryKey()',
      'text("charge_id").primaryKey()',
      'bigint("user_id", { mode: "number" })',
      ".references(() => users.id)",
      'boolean("is_recurring")',
      'boolean("is_first_recurring")',
      'jsonb("raw").notNull()',
      'uuid("id").primaryKey().defaultRandom()',
      'integer("period_seconds").notNull()',
      'timestamp("canceled_at", { withTimezone: true })',
    ]) {
      assert.ok(source.includes(fragment), `missing drizzle fragment: ${fragment}`);
    }
  });

  it("mirror every payments column in the SQLAlchemy models", () => {
    const source = renderPaymentsModelsPy();
    for (const fragment of [
      '__tablename__ = "users"',
      '__tablename__ = "payments"',
      '__tablename__ = "refunds"',
      '__tablename__ = "subscriptions"',
      "CheckConstraint(\n            \"status IN ('paid','refunded','chargeback')\"",
      'ForeignKey("payments.charge_id")',
      "JSONB, nullable=False",
    ]) {
      assert.ok(source.includes(fragment), `missing model fragment: ${fragment}`);
    }
  });
});

describe("renderPaymentsTs", () => {
  it("renders deterministically and embeds spec products", () => {
    assert.equal(generatedSource, renderPaymentsTs(SPEC));
    assert.equal(payments.PRODUCTS.length, 2);
    assert.deepEqual(
      payments.PRODUCTS.map((product) => product.id),
      ["pro", "tip"],
    );
    assert.equal(payments.CURRENCY, "XTR");
    assert.equal(payments.SUBSCRIPTION_PERIOD_SECONDS, 2592000);
  });

  it("renders no products when the spec has none", () => {
    const source = renderPaymentsTs(PLAIN_SPEC);
    assert.ok(source.includes("export const PRODUCTS: readonly PaymentProduct[] = [];"));
  });

  it("never interpolates product or payload values into SQL", () => {
    assert.ok(
      !generatedSource.includes("${"),
      "generated code must not contain template interpolation",
    );
  });
});

describe("invoice payload", () => {
  it("round-trips product, user, and nonce", () => {
    const payload = payments.invoicePayload("pro", 42, NONCE);
    assert.equal(payload, PAYLOAD);
    const parsed = payments.parseInvoicePayload(payload, payments.PRODUCTS);
    assert.equal(parsed.product.id, "pro");
    assert.equal(parsed.userId, 42);
    assert.equal(parsed.nonce, NONCE);
  });

  it("rejects malformed, unknown-product, and invalid-user payloads", () => {
    for (const payload of [
      "",
      "pro:42",
      "product:pro:user:42",
      "product:pro:user:42:nonce:not-a-uuid",
      "product:pro:user:0:nonce:" + NONCE,
      "product:pro:user:42:nonce:" + NONCE + ":extra",
    ]) {
      assert.throws(
        () => payments.parseInvoicePayload(payload, payments.PRODUCTS),
        (error: Error & { code?: string }) =>
          error.code === "invalid_payload" || error.code === "invalid_user",
        `expected rejection for ${payload}`,
      );
    }
    assert.throws(
      () => payments.parseInvoicePayload("product:nope:user:42:nonce:" + NONCE, payments.PRODUCTS),
      (error: Error & { code?: string }) => error.code === "unknown_product",
    );
  });

  it("rejects non-uuid nonces and invalid products at creation", () => {
    assert.throws(() => payments.invoicePayload("pro", 42, "nonce"), /nonce/);
    assert.throws(() => payments.invoicePayload("Nope", 42, NONCE), /product/);
  });
});

describe("pre-checkout validation", () => {
  const query = {
    userId: 42,
    invoicePayload: PAYLOAD,
    currency: "XTR",
    totalAmount: 100,
  };

  it("accepts a matching query", () => {
    assert.deepEqual(payments.validatePreCheckout(query, payments.PRODUCTS), { ok: true });
  });

  it("rejects a mismatched user", () => {
    assert.deepEqual(payments.validatePreCheckout({ ...query, userId: 7 }, payments.PRODUCTS), {
      ok: false,
      reason: "user_mismatch",
    });
  });

  it("rejects a wrong currency and a wrong amount", () => {
    assert.deepEqual(
      payments.validatePreCheckout({ ...query, currency: "USD" }, payments.PRODUCTS),
      { ok: false, reason: "wrong_currency" },
    );
    assert.deepEqual(
      payments.validatePreCheckout({ ...query, totalAmount: 99 }, payments.PRODUCTS),
      { ok: false, reason: "wrong_amount" },
    );
  });

  it("rejects an unknown product without throwing", () => {
    assert.deepEqual(
      payments.validatePreCheckout(
        { ...query, invoicePayload: "product:nope:user:42:nonce:" + NONCE },
        payments.PRODUCTS,
      ),
      { ok: false, reason: "unknown_product" },
    );
  });
});

describe("createInvoice", () => {
  const subscription = payments.PRODUCTS[0];
  const oneTime = payments.PRODUCTS[1];
  assert.ok(subscription);
  assert.ok(oneTime);

  it("uses createInvoiceLink only for subscriptions", async () => {
    const api = new FakeApi();
    const result = await payments.createInvoice(api, subscription, 42, { nonce: NONCE });
    assert.equal(result.payload, PAYLOAD);
    assert.equal(result.invoiceLink, "https://t.me/invoice/test");
    assert.deepEqual(api.methods(), ["createInvoiceLink"]);
    const args = api.calls[0]?.args ?? [];
    assert.equal(args[2], PAYLOAD);
    assert.equal(args[3], "XTR");
    assert.deepEqual(args[4], [{ label: "Pro", amount: 100 }]);
    assert.deepEqual(args[5], { subscription_period: 2592000 });
  });

  it("uses sendInvoice with the chat id for one-time products", async () => {
    const api = new FakeApi();
    const result = await payments.createInvoice(api, oneTime, 42, {
      chatId: 99,
      nonce: NONCE,
    });
    assert.equal(result.invoiceLink, undefined);
    assert.equal(result.payload, "product:tip:user:42:nonce:" + NONCE);
    assert.deepEqual(api.methods(), ["sendInvoice"]);
    const args = api.calls[0]?.args ?? [];
    assert.equal(args[0], 99);
    assert.equal(args[3], "product:tip:user:42:nonce:" + NONCE);
    assert.equal(args[4], "XTR");
    assert.deepEqual(args[5], [{ label: "Tip", amount: 1 }]);
  });

  it("requires a chat id for a one-time invoice", async () => {
    await assert.rejects(
      payments.createInvoice(new FakeApi(), oneTime, 42, { nonce: NONCE }),
      /chatId/,
    );
  });
});

describe("recordSuccessfulPayment", () => {
  it("inserts user and payment, then enqueues exactly one fulfillment", async () => {
    const sql = new FakeSql();
    const queue = new FakeQueue();
    const result = await payments.recordSuccessfulPayment(sql, queue, {
      payment: validPayment({ chargeId: "charge-new" }),
      products: payments.PRODUCTS,
    });
    assert.equal(result.chargeId, "charge-new");
    assert.equal(result.duplicate, false);
    assert.equal(result.amount, 100);
    assert.ok(sql.users.has(42));
    assert.equal(sql.payments.get("charge-new")?.status, "paid");
    assert.equal(sql.subscriptions.get("charge-new")?.userId, 42);
    assert.deepEqual(queue.calls, [
      {
        kind: "payment.fulfill",
        payload: { chargeId: "charge-new", userId: 42, productId: "pro" },
        idempotencyKey: "payment:charge-new",
      },
    ]);
  });

  it("returns the existing payment without enqueueing or re-granting", async () => {
    const sql = new FakeSql();
    const queue = new FakeQueue();
    const first = await payments.recordSuccessfulPayment(sql, queue, {
      payment: validPayment({ chargeId: "charge-dup" }),
      products: payments.PRODUCTS,
    });
    assert.equal(first.duplicate, false);
    queue.calls.length = 0;
    const second = await payments.recordSuccessfulPayment(sql, queue, {
      payment: validPayment({ chargeId: "charge-dup" }),
      products: payments.PRODUCTS,
    });
    assert.equal(second.duplicate, true);
    assert.equal(second.status, "paid");
    assert.equal(second.amount, 100);
    assert.equal(queue.calls.length, 0, "duplicate delivery must not enqueue");
    assert.equal(sql.payments.size, 1);
  });

  it("validates before touching the database", async () => {
    const sql = new FakeSql();
    const queue = new FakeQueue();
    await assert.rejects(
      payments.recordSuccessfulPayment(sql, queue, {
        payment: validPayment({ totalAmount: 1 }),
        products: payments.PRODUCTS,
      }),
      /wrong_amount/,
    );
    assert.deepEqual(sql.queries, []);
    assert.equal(queue.calls.length, 0);
  });
});

describe("refundPayment", () => {
  it("refunds the full amount once and then reports a duplicate idempotently", async () => {
    const sql = new FakeSql();
    const api = new FakeApi();
    sql.payments.set("charge-1", {
      charge_id: "charge-1",
      user_id: 42,
      amount: 100,
      currency: "XTR",
      status: "paid",
    });
    const first = await payments.refundPayment(sql, api, { userId: 42, chargeId: "charge-1" });
    assert.deepEqual(first, {
      refunded: true,
      duplicate: false,
      amount: 100,
      status: "refunded",
    });
    assert.deepEqual(api.methods(), ["refundStarPayment"]);
    assert.deepEqual(api.calls[0]?.args, [42, "charge-1"]);
    assert.equal(sql.refunds.length, 1);
    assert.equal(sql.refunds[0]?.amount, 100);
    assert.equal(sql.refunds[0]?.status, "completed");

    const second = await payments.refundPayment(sql, api, { userId: 42, chargeId: "charge-1" });
    assert.equal(second.refunded, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.amount, 100);
    assert.deepEqual(api.methods(), ["refundStarPayment"]);
    assert.equal(sql.refunds.length, 1);
  });

  it("refuses an unknown charge", async () => {
    await assert.rejects(
      payments.refundPayment(new FakeSql(), new FakeApi(), { userId: 42, chargeId: "nope" }),
      /no payment/,
    );
  });
});

describe("cancelSubscription", () => {
  it("calls editUserStarSubscription once and is idempotent", async () => {
    const sql = new FakeSql();
    const api = new FakeApi();
    sql.subscriptions.set("charge-1", { userId: 42, canceledAt: null });
    const first = await payments.cancelSubscription(sql, api, {
      userId: 42,
      chargeId: "charge-1",
    });
    assert.deepEqual(first, { canceled: true, duplicate: false });
    assert.deepEqual(api.calls[0]?.args, [42, "charge-1", true]);
    const second = await payments.cancelSubscription(sql, api, {
      userId: 42,
      chargeId: "charge-1",
    });
    assert.deepEqual(second, { canceled: false, duplicate: true });
    assert.equal(api.calls.length, 1);
  });
});

describe("reconcilePayments", () => {
  it("classifies incoming, refund, chargeback, and unknown transactions", () => {
    assert.deepEqual(
      payments.classifyStarTransaction({ id: "tx-1", amount: 100, source: { id: 42 } }),
      { kind: "payment", chargeId: "tx-1", userId: 42, amount: 100 },
    );
    assert.deepEqual(payments.classifyStarTransaction({ id: "tx-2", amount: -100 }), {
      kind: "refund",
      chargeId: "tx-2",
      amount: -100,
    });
    assert.deepEqual(
      payments.classifyStarTransaction({
        id: "tx-3",
        amount: -100,
        transaction_type: { type: "chargeback", payment_charge_id: "charge-1" },
      }),
      { kind: "chargeback", chargeId: "charge-1", amount: -100 },
    );
    assert.deepEqual(payments.classifyStarTransaction({ id: "tx-4", amount: 0 }), {
      kind: "skip",
      chargeId: "tx-4",
      amount: 0,
    });
  });

  it("inserts a missing payment, marks a refund, and never grants", async () => {
    const sql = new FakeSql();
    const api = new FakeApi();
    sql.payments.set("charge-refund", {
      charge_id: "charge-refund",
      user_id: 7,
      amount: 50,
      currency: "XTR",
      status: "paid",
    });
    api.pages.push([
      { id: "tx-new", amount: 100, source: { id: 42 } },
      { id: "tx-refund", amount: -50, transaction_type: { payment_charge_id: "charge-refund" } },
      { id: "tx-bonus", amount: 0 },
    ]);
    const result = await payments.reconcilePayments(sql, api);
    assert.equal(result.scanned, 3);
    assert.equal(result.inserted, 1);
    assert.equal(result.refunded, 1);
    assert.equal(result.skipped, 1);
    assert.equal(sql.payments.get("tx-new")?.status, "paid");
    assert.equal(sql.payments.get("charge-refund")?.status, "refunded");
    assert.equal(
      sql.queries.some((query) => query.includes("payment.fulfill")),
      false,
    );
  });

  it("does not duplicate a known payment on a second pass", async () => {
    const sql = new FakeSql();
    const api = new FakeApi();
    const page = [{ id: "tx-new", amount: 100, source: { id: 42 } }];
    api.pages.push(page, page);
    const first = await payments.reconcilePayments(sql, api, { maxPages: 1 });
    assert.equal(first.inserted, 1);
    assert.equal(sql.payments.size, 1);
    const second = await payments.reconcilePayments(sql, api, { maxPages: 1 });
    assert.equal(second.inserted, 0);
    assert.equal(second.skipped, 1);
    assert.equal(sql.payments.size, 1);
  });
});

describe("renderPaymentsPy", () => {
  const source = renderPaymentsPy(SPEC);

  it("renders deterministically with dataclasses, Protocols, and spec products", () => {
    assert.equal(source, renderPaymentsPy(SPEC));
    for (const fragment of [
      "@dataclass(frozen=True)\nclass PaymentProduct:",
      "class TelegramPayments(Protocol):",
      "class PaymentQueue(Protocol):",
      'id="pro"',
      'id="tip"',
      "subscription=True",
      "async def create_invoice_link(",
      "async def refund_star_payment(",
      "async def edit_user_star_subscription(",
      "async def get_star_transactions(",
      "ON CONFLICT (charge_id) DO NOTHING",
      "status = 'refunded'",
      "CAST(:raw AS jsonb)",
    ]) {
      assert.ok(source.includes(fragment), `missing python fragment: ${fragment}`);
    }
  });

  it("parses as Python 3", () => {
    const parsed = spawnSync("python3", ["-c", "import ast, sys; ast.parse(sys.stdin.read())"], {
      input: source,
      encoding: "utf8",
    });
    assert.equal(parsed.status, 0, parsed.stderr);
  });
});
