import { expect, test } from "bun:test";
import type { Bot } from "grammy";
import type { Sql } from "postgres";
import type { Queue } from "../src/runtime/queue.ts";

import { register } from "../src/features/payments.ts";
import {
  PRODUCTS,
  invoicePayload,
  reconcilePayments,
  type TelegramPayments,
} from "../src/runtime/payments.ts";

interface FakeContext {
  readonly match?: string;
  readonly from?: { readonly id?: number; readonly first_name?: string };
  readonly chat?: { readonly id: number };
  readonly message?: { readonly successful_payment?: Readonly<Record<string, unknown>> };
  readonly preCheckoutQuery?: {
    readonly from: { readonly id: number };
    readonly invoice_payload: string;
    readonly currency: string;
    readonly total_amount: number;
  };
  readonly answerPreCheckoutQuery?: (ok: boolean, message?: string) => Promise<void>;
  readonly reply?: (text: string) => Promise<void>;
}

type Handler = (ctx: FakeContext) => Promise<void>;

interface FakeSqlOptions {
  readonly owners: Map<string, number>;
  readonly payments: Map<string, string>;
  readonly subscriptions: Map<string, string | null>;
}

function fakeSql(options: FakeSqlOptions): Sql {
  const db = {
    async begin<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
    async unsafe(query: string, params: readonly unknown[] = []): Promise<unknown[]> {
      if (query.includes("INSERT INTO users")) return [];
      if (query.includes("INSERT INTO payments")) {
        const chargeId = String(params[0]);
        if (options.payments.has(chargeId)) return [];
        options.payments.set(chargeId, "paid");
        options.owners.set(chargeId, Number(params[1]));
        return [
          {
            charge_id: chargeId,
            user_id: Number(params[1]),
            amount: Number(params[4]),
            currency: String(params[3]),
            status: "paid",
          },
        ];
      }
      if (query.includes("INSERT INTO subscriptions")) return [];
      if (query.includes("SELECT charge_id, user_id, amount, currency, status")) {
        const chargeId = String(params[0]);
        const status = options.payments.get(chargeId);
        if (status === undefined) return [];
        return [
          {
            charge_id: chargeId,
            user_id: options.owners.get(chargeId) ?? 0,
            amount: 0,
            currency: "XTR",
            status,
          },
        ];
      }
      if (query.includes("SELECT user_id FROM payments")) {
        const owner = options.owners.get(String(params[0]));
        return owner === undefined ? [] : [{ user_id: owner }];
      }
      if (query.includes("UPDATE payments SET status = 'refunded'")) {
        const chargeId = String(params[0]);
        if (options.payments.get(chargeId) !== "paid") return [];
        options.payments.set(chargeId, "refunded");
        return [{ amount: 0 }];
      }
      if (query.includes("SELECT status, amount FROM payments")) {
        const status = options.payments.get(String(params[0]));
        return status === undefined ? [] : [{ status, amount: 0 }];
      }
      if (query.includes("INSERT INTO refunds")) return [{ id: "refund" }];
      if (query.includes("SELECT charge_id, canceled_at FROM subscriptions")) {
        const chargeId = String(params[0]);
        if (!options.subscriptions.has(chargeId)) return [];
        return [{ charge_id: chargeId, canceled_at: options.subscriptions.get(chargeId) }];
      }
      if (query.includes("UPDATE subscriptions SET canceled_at")) {
        options.subscriptions.set(String(params[0]), new Date().toISOString());
        return [];
      }
      if (query.includes("SELECT charge_id, expires_at FROM subscriptions")) return [];
      throw new Error("unexpected query: " + query);
    },
  };
  return db as unknown as Sql;
}

function harness(): {
  bot: Bot;
  queue: { calls: string[]; enqueue: (kind: string) => Promise<string> };
  sql: Sql;
  commands: Map<string, Handler>;
  events: Map<string, Handler>;
  replies: string[];
  answers: unknown[][];
  calls: string[];
  owners: Map<string, number>;
  payments: Map<string, string>;
} {
  const commands = new Map<string, Handler>();
  const events = new Map<string, Handler>();
  const replies: string[] = [];
  const answers: unknown[][] = [];
  const calls: string[] = [];
  const owners = new Map<string, number>();
  const payments = new Map<string, string>();
  const bot = {
    command(name: string, handler: Handler): void {
      commands.set(name, handler);
    },
    on(name: string, handler: Handler): void {
      events.set(name, handler);
    },
    api: {
      async sendInvoice(): Promise<unknown> {
        calls.push("sendInvoice");
        return true;
      },
      async createInvoiceLink(): Promise<string> {
        calls.push("createInvoiceLink");
        return "https://t.me/invoice/sub";
      },
      async refundStarPayment(): Promise<unknown> {
        calls.push("refundStarPayment");
        return true;
      },
      async editUserStarSubscription(): Promise<unknown> {
        calls.push("editUserStarSubscription");
        return true;
      },
      async getStarTransactions(): Promise<{ transactions: readonly unknown[] }> {
        return { transactions: [] };
      },
    },
  } as unknown as Bot;
  const queue = {
    calls: [] as string[],
    async enqueue(kind: string): Promise<string> {
      this.calls.push(kind);
      return "job";
    },
  };
  const sql = fakeSql({ owners, payments, subscriptions: new Map() });
  return { bot, queue, sql, commands, events, replies, answers, calls, owners, payments };
}

function deps(sql: Sql, queue: { enqueue: (kind: string) => Promise<string> }) {
  return { sql, queue: queue as unknown as Queue };
}

test("/buy uses createInvoiceLink for a subscription product", async () => {
  const state = harness();
  register(state.bot, deps(state.sql, state.queue));
  const product = PRODUCTS.find((candidate) => candidate.subscription);
  if (product === undefined) return;
  const handler = state.commands.get("buy");
  expect(handler).toBeDefined();
  await handler?.({
    match: product.id,
    from: { id: 42, first_name: "Buyer" },
    chat: { id: 42 },
    reply: async (text: string): Promise<void> => {
      void state.replies.push(text);
    },
  });
  expect(state.calls).toContain("createInvoiceLink");
  expect(state.replies).toContain("https://t.me/invoice/sub");
});

test("pre-checkout with a wrong amount answers false", async () => {
  const state = harness();
  register(state.bot, deps(state.sql, state.queue));
  const product = PRODUCTS[0];
  expect(product).toBeDefined();
  const payload = invoicePayload(product?.id ?? "", 42, "123e4567-e89b-42d3-a456-426614174000");
  const handler = state.events.get("pre_checkout_query");
  expect(handler).toBeDefined();
  await handler?.({
    preCheckoutQuery: {
      from: { id: 42 },
      invoice_payload: payload,
      currency: "XTR",
      total_amount: (product?.stars ?? 0) + 1,
    },
    answerPreCheckoutQuery: async (ok: boolean, message?: string) => {
      state.answers.push([ok, message]);
    },
  });
  expect(state.answers[0]).toEqual([false, "Payment could not be confirmed."]);
});

test("successful payment inserts once and enqueues fulfillment once", async () => {
  const state = harness();
  register(state.bot, deps(state.sql, state.queue));
  const product = PRODUCTS[0];
  expect(product).toBeDefined();
  const payload = invoicePayload(product?.id ?? "", 42, "123e4567-e89b-42d3-a456-426614174000");
  const handler = state.events.get("message:successful_payment");
  expect(handler).toBeDefined();
  const ctx = {
    from: { id: 42, first_name: "Buyer" },
    message: {
      successful_payment: {
        telegram_payment_charge_id: "charge-1",
        invoice_payload: payload,
        currency: "XTR",
        total_amount: product?.stars ?? 0,
      },
    },
    reply: async (text: string): Promise<void> => {
      void state.replies.push(text);
    },
  };
  await handler?.(ctx);
  await handler?.(ctx);
  expect(state.queue.calls).toEqual(["payment.fulfill"]);
  expect(state.replies.length).toBe(2);
  expect(state.replies[0]).toBe("Thanks for your payment!");
});

test("refund is admin-only and idempotent", async () => {
  const state = harness();
  state.owners.set("charge-1", 42);
  state.payments.set("charge-1", "paid");
  register(state.bot, deps(state.sql, state.queue));
  const handler = state.commands.get("refund");
  expect(handler).toBeDefined();
  process.env.ADMIN_IDS = "42";
  await handler?.({
    match: "charge-1",
    from: { id: 7 },
    reply: async (text: string): Promise<void> => {
      void state.replies.push(text);
    },
  });
  expect(state.calls).not.toContain("refundStarPayment");
  await handler?.({
    match: "charge-1",
    from: { id: 42 },
    reply: async (text: string): Promise<void> => {
      void state.replies.push(text);
    },
  });
  await handler?.({
    match: "charge-1",
    from: { id: 42 },
    reply: async (text: string): Promise<void> => {
      void state.replies.push(text);
    },
  });
  expect(state.calls).toEqual(["refundStarPayment"]);
  expect(state.replies).toContain("Refund issued.");
  expect(state.replies).toContain("Refund already recorded.");
});

test("reconciliation records without granting an entitlement", async () => {
  const state = harness();
  const result = await reconcilePayments(state.sql, state.bot.api as unknown as TelegramPayments, {
    limit: 100,
  });
  expect(result.inserted).toBe(0);
  expect(state.queue.calls).toEqual([]);
});
