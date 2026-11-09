import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { PAYMENTS_SQL, renderPaymentsTs } from "../../src/core/projects/templates/payments.ts";
import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import {
  createSandbox,
  createSql,
  INFRA_SKIP,
  startPostgres,
  type Postgres,
  type Sandbox,
} from "./pg.ts";

const ENABLED = process.env.AURIFEX_INFRA === "1";

const PRODUCTS = [
  {
    id: "premium",
    title: "Premium",
    description: "Premium access",
    stars: 100,
    subscription: false,
  },
] as const;

const CHARGE = "charge_known";
const PAYLOAD = "product:premium:user:7:nonce:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

interface Recorded {
  readonly chargeId: string;
  readonly duplicate: boolean;
  readonly status: string;
  readonly amount: number;
}

interface Refunded {
  readonly refunded: boolean;
  readonly duplicate: boolean;
  readonly amount: number;
  readonly status: string;
}

interface ReconcileResult {
  readonly scanned: number;
  readonly inserted: number;
  readonly refunded: number;
  readonly chargebacks: number;
  readonly skipped: number;
}

interface PaymentsModule {
  recordSuccessfulPayment(
    sql: unknown,
    queue: unknown,
    input: { payment: unknown; products: unknown },
  ): Promise<Recorded>;
  refundPayment(
    sql: unknown,
    api: unknown,
    input: { userId: number; chargeId: string },
  ): Promise<Refunded>;
  reconcilePayments(
    sql: unknown,
    api: unknown,
    options?: { limit?: number; maxPages?: number },
  ): Promise<ReconcileResult>;
}

let postgres: Postgres | undefined;
let sandbox: Sandbox | undefined;
let payments: PaymentsModule | undefined;

function database(): Postgres {
  assert.ok(postgres, "postgres must be started");
  return postgres;
}

function module(): PaymentsModule {
  assert.ok(payments, "payments module must be loaded");
  return payments;
}

function payment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: 7,
    chargeId: CHARGE,
    invoicePayload: PAYLOAD,
    currency: "XTR",
    totalAmount: 100,
    raw: { id: CHARGE },
    ...overrides,
  };
}

function fakeQueue(): { calls: unknown[]; enqueue: (...args: unknown[]) => Promise<string> } {
  const calls: unknown[] = [];
  return {
    calls,
    async enqueue(...args) {
      calls.push(args);
      return `job-${calls.length}`;
    },
  };
}

function fakeApi(transactions: readonly unknown[] = []): {
  refunded: Array<[number, string]>;
  refundStarPayment(userId: number, chargeId: string): Promise<unknown>;
  getStarTransactions(input: { offset?: number; limit?: number }): Promise<{
    transactions: readonly unknown[];
  }>;
} {
  const refunded: Array<[number, string]> = [];
  return {
    refunded,
    async refundStarPayment(userId, chargeId) {
      refunded.push([userId, chargeId]);
      return true;
    },
    async getStarTransactions(input) {
      const offset = input.offset ?? 0;
      return { transactions: transactions.slice(offset) };
    },
  };
}

before(async () => {
  if (!ENABLED) return;
  postgres = await startPostgres();
  const spec = { payments: { products: PRODUCTS } } as unknown as BotSpec;
  sandbox = await createSandbox({ "payments.ts": renderPaymentsTs(spec) });
  payments = (await sandbox.import("payments.ts")) as unknown as PaymentsModule;
});

after(async () => {
  await sandbox?.dispose();
  await postgres?.stop();
});

beforeEach(async () => {
  if (!ENABLED) return;
  const db = database();
  await db.exec(
    "DROP TABLE IF EXISTS subscriptions; DROP TABLE IF EXISTS refunds; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS users;",
  );
  await db.exec(PAYMENTS_SQL);
});

test(
  "a duplicate successful_payment inserts one row and enqueues one fulfillment",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const sql = createSql(database());
    const queue = fakeQueue();
    const [first, second] = await Promise.all([
      module().recordSuccessfulPayment(sql, queue, { payment: payment(), products: PRODUCTS }),
      module().recordSuccessfulPayment(sql, queue, { payment: payment(), products: PRODUCTS }),
    ]);

    const duplicates = [first.duplicate, second.duplicate].filter(Boolean);
    assert.equal(duplicates.length, 1);
    assert.equal(first.chargeId, CHARGE);

    const rows = await database().unsafe("SELECT count(*) AS total FROM payments");
    assert.equal(Number(rows[0]?.total), 1);
    assert.equal(queue.calls.length, 1);
  },
);

test(
  "refund transitions paid -> refunded exactly once",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const sql = createSql(database());
    await module().recordSuccessfulPayment(sql, fakeQueue(), {
      payment: payment(),
      products: PRODUCTS,
    });
    const api = fakeApi();

    const refunded = await module().refundPayment(sql, api, {
      userId: 7,
      chargeId: CHARGE,
    });
    assert.deepEqual(refunded, {
      refunded: true,
      duplicate: false,
      amount: 100,
      status: "refunded",
    });

    const again = await module().refundPayment(sql, api, {
      userId: 7,
      chargeId: CHARGE,
    });
    assert.equal(again.refunded, false);
    assert.equal(again.duplicate, true);
    assert.equal(again.status, "refunded");
    assert.equal(api.refunded.length, 1);

    const paymentRows = await database().unsafe(
      "SELECT status FROM payments WHERE charge_id = $1",
      [CHARGE],
    );
    assert.equal(paymentRows[0]?.status, "refunded");
    const refundRows = await database().unsafe(
      "SELECT count(*) AS total FROM refunds WHERE charge_id = $1 AND status = 'completed'",
      [CHARGE],
    );
    assert.equal(Number(refundRows[0]?.total), 1);
  },
);

test(
  "reconcile inserts a missing payment and marks a known refund without duplicating",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const sql = createSql(database());
    await module().recordSuccessfulPayment(sql, fakeQueue(), {
      payment: payment(),
      products: PRODUCTS,
    });

    const api = fakeApi([
      { id: CHARGE, amount: 100, source: { id: 7 } },
      {
        id: "charge_missing",
        amount: 250,
        source: { id: 9 },
      },
      {
        id: "refund_1",
        amount: -100,
        transaction_type: { type: "refund", payment_charge_id: CHARGE },
      },
    ]);

    const result = await module().reconcilePayments(sql, api, { limit: 100 });
    assert.equal(result.scanned, 3);
    assert.equal(result.inserted, 1);
    assert.equal(result.refunded, 1);
    assert.equal(result.chargebacks, 0);
    assert.equal(result.skipped, 1);

    const count = await database().unsafe("SELECT count(*) AS total FROM payments");
    assert.equal(Number(count[0]?.total), 2);
    const known = await database().unsafe("SELECT status FROM payments WHERE charge_id = $1", [
      CHARGE,
    ]);
    assert.equal(known[0]?.status, "refunded");
  },
);
