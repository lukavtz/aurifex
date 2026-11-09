import type { BotFeature, BotSpec } from "../../spec/bot-spec.ts";
import { slugToTitle } from "../../spec/bot-spec.ts";
import {
  renderBroadcastCommandTs,
  renderBroadcastJobTs,
  renderLlmEnqueueTs,
  renderLlmJobTs,
} from "../templates/jobs.ts";
import { renderMiniApp } from "../templates/miniapp.ts";
import { renderMiniAppSessionTs } from "../templates/miniapp-session.ts";
import { renderPaymentsTs } from "../templates/payments.ts";
import type { TemplateFile } from "../templates/shared.ts";

function file(path: string, content: string): TemplateFile {
  return { path, content };
}

function commandModule(name: string): string {
  return `import type { Bot } from "grammy";

export const COMMAND = ${JSON.stringify(`/${name}`)};

export function register(bot: Bot): void {
  bot.command(${JSON.stringify(name)}, async (ctx) => {
    await ctx.reply(${JSON.stringify(`${slugToTitle(name)} is not implemented yet.`)});
  });
}
`;
}

function commandTest(name: string): string {
  return `import assert from "node:assert/strict";
import { test } from "node:test";

import { register } from "../src/features/${name}.ts";

interface FakeContext {
  reply(text: string): Promise<void>;
}

type RegisterTarget = Parameters<typeof register>[0];

test(${JSON.stringify(`/${name} replies`)} , async () => {
  const handlers = new Map<string, (ctx: FakeContext) => Promise<void>>();
  const fake = {
    command(command: string, handler: (ctx: FakeContext) => Promise<void>): void {
      handlers.set(command, handler);
    },
  };
  register(fake as unknown as RegisterTarget);
  const handler = handlers.get(${JSON.stringify(name)});
  assert.ok(handler);
  const replies: string[] = [];
  await handler({
    reply: async (text: string) => {
      replies.push(text);
    },
  });
  assert.equal(replies.length, 1);
});
`;
}

const LLM_TEST = `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { KIND, WORKING_TEXT, enqueueLlm, register } from "../src/features/llm.ts";

interface EnqueueCall {
  readonly kind: string;
  readonly payload: unknown;
  readonly options?: { readonly idempotencyKey?: string };
}

type QueueTarget = Parameters<typeof enqueueLlm>[0];
type BotTarget = Parameters<typeof register>[0];

interface FakeContext {
  readonly match: string;
  readonly chat: { readonly id: number };
  readonly update: { readonly update_id: number };
  readonly message?: { readonly message_id: number };
  reply(text: string): Promise<void>;
}

function fakeQueue(calls: EnqueueCall[]): QueueTarget {
  return {
    enqueue: async (
      kind: string,
      payload: unknown,
      options?: EnqueueCall["options"],
    ): Promise<string> => {
      calls.push(options === undefined ? { kind, payload } : { kind, payload, options });
      return "job-1";
    },
  } as unknown as QueueTarget;
}

test("llm enqueues one job keyed by the update id", async () => {
  const calls: EnqueueCall[] = [];
  const id = await enqueueLlm(fakeQueue(calls), { chatId: 7, prompt: "hi", updateId: 42 });
  assert.equal(id, "job-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.kind, KIND);
  assert.equal(calls[0]?.options?.idempotencyKey, "llm:42");
});

test("llm webhook replies once without calling the model", async () => {
  const calls: EnqueueCall[] = [];
  const handlers = new Map<string, (ctx: FakeContext) => Promise<void>>();
  const bot = {
    command(name: string, handler: (ctx: FakeContext) => Promise<void>): void {
      handlers.set(name, handler);
    },
  } as unknown as BotTarget;
  register(bot, fakeQueue(calls));
  const handler = handlers.get("llm");
  assert.ok(handler);
  const replies: string[] = [];
  await handler({
    match: "  hello",
    chat: { id: 7 },
    update: { update_id: 42 },
    message: { message_id: 3 },
    reply: async (text: string) => {
      replies.push(text);
    },
  });
  assert.deepEqual(replies, [WORKING_TEXT]);
  assert.equal(calls.length, 1);

  const source = await readFile(new URL("../src/features/llm.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("fetch("));
  assert.ok(!source.includes("chat/completions"));
});
`;

const INLINE_MODULE = `import type { Bot } from "grammy";

export function register(bot: Bot): void {
  bot.on("inline_query", async (ctx) => {
    const text = ctx.inlineQuery.query.trim() === "" ? "Hello" : ctx.inlineQuery.query.trim();
    await ctx.answerInlineQuery(
      [
        {
          type: "article",
          id: "share",
          title: "Send this text",
          description: text,
          input_message_content: { message_text: text },
        },
      ],
      { cache_time: 0 },
    );
  });
}
`;

const INLINE_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";

import { register } from "../src/features/inline.ts";

interface FakeInlineQuery {
  readonly query: string;
}

interface FakeContext {
  readonly inlineQuery: FakeInlineQuery;
  answerInlineQuery(results: readonly { readonly type: string }[], other?: { cache_time?: number }): Promise<void>;
}

type RegisterTarget = Parameters<typeof register>[0];

test("inline query answers with one article", async () => {
  const handlers: ((ctx: FakeContext) => Promise<void>)[] = [];
  const fake = { on: (_event: string, handler: (ctx: FakeContext) => Promise<void>) => handlers.push(handler) };
  register(fake as unknown as RegisterTarget);
  const handler = handlers[0];
  assert.ok(handler);
  const answers: (readonly { readonly type: string }[])[] = [];
  await handler({
    inlineQuery: { query: "hello" },
    answerInlineQuery: async (results) => {
      answers.push(results);
    },
  });
  assert.equal(answers.length, 1);
  assert.equal(answers[0]?.length, 1);
});
`;

const PAYMENTS_MODULE = `import type { Bot } from "grammy";
import type { Sql } from "postgres";
import { t } from "../i18n/index.js";
import { isAdmin } from "../security/allowlist.js";
import type { Queue } from "../runtime/queue.js";
import {
  PRODUCTS,
  cancelSubscription,
  createInvoice,
  recordSuccessfulPayment,
  refundPayment,
  validatePreCheckout,
  type PaymentProduct,
  type TelegramPayments,
} from "../runtime/payments.js";

export const PRE_CHECKOUT_ERROR = "Payment could not be confirmed.";
export const ACCESS_DENIED = "Access denied.";
export const SUPPORT_TEXT_DEFAULT = "Contact the bot owner for payment support.";

export interface PaymentDeps {
  readonly sql: Sql | null;
  readonly queue: Queue | null;
}

// Bot API 10.4 is newer than the grammY 1.46.0 types, so payment fields that
// the framework may not know yet are read through one local shape.
interface SuccessfulPaymentInfo {
  readonly telegram_payment_charge_id: string;
  readonly provider_payment_charge_id?: string;
  readonly invoice_payload: string;
  readonly currency: string;
  readonly total_amount: number;
  readonly is_recurring?: boolean;
  readonly is_first_recurring?: boolean;
  readonly subscription_expiration_date?: number;
}

export function register(bot: Bot, deps: PaymentDeps): void {
  const { sql, queue } = deps;
  if (sql === null || queue === null) {
    throw new Error("the payments feature requires storage.postgres and runtime.queue");
  }
  const api = bot.api as unknown as TelegramPayments;

  bot.command("buy", async (ctx) => {
    const requested = ctx.match.trim();
    const productId = requested === "" ? (PRODUCTS[0]?.id ?? "") : requested;
    const product: PaymentProduct | undefined = PRODUCTS.find(
      (candidate) => candidate.id === productId,
    );
    const from = ctx.from;
    if (product === undefined) {
      await ctx.reply("Unknown product.");
      return;
    }
    if (from === undefined) return;
    const invoice = await createInvoice(api, product, from.id, { chatId: ctx.chat.id });
    // Subscriptions are only available as an invoice link; one-time products
    // are already sent by sendInvoice inside createInvoice.
    if (invoice.invoiceLink !== undefined) {
      await ctx.reply(invoice.invoiceLink);
    }
  });

  bot.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    const result = validatePreCheckout(
      {
        userId: query.from.id,
        invoicePayload: query.invoice_payload,
        currency: query.currency,
        totalAmount: query.total_amount,
      },
      PRODUCTS,
    );
    if (result.ok) {
      await ctx.answerPreCheckoutQuery(true);
      return;
    }
    await ctx.answerPreCheckoutQuery(false, PRE_CHECKOUT_ERROR);
  });

  bot.on("message:successful_payment", async (ctx) => {
    const info = ctx.message.successful_payment as unknown as SuccessfulPaymentInfo | undefined;
    const from = ctx.from;
    if (info === undefined || from === undefined) return;
    await recordSuccessfulPayment(sql, queue, {
      payment: {
        userId: from.id,
        chargeId: info.telegram_payment_charge_id,
        ...(info.provider_payment_charge_id === undefined
          ? {}
          : { providerChargeId: info.provider_payment_charge_id }),
        invoicePayload: info.invoice_payload,
        currency: info.currency,
        totalAmount: info.total_amount,
        ...(info.is_recurring === undefined ? {} : { isRecurring: info.is_recurring }),
        ...(info.is_first_recurring === undefined
          ? {}
          : { isFirstRecurring: info.is_first_recurring }),
        ...(info.subscription_expiration_date === undefined
          ? {}
          : { subscriptionExpirationDate: info.subscription_expiration_date }),
        ...(from.username === undefined ? {} : { username: from.username }),
        displayName: [from.first_name, from.last_name ?? ""]
          .filter((part) => part !== "")
          .join(" "),
        raw: info,
      },
      products: PRODUCTS,
    });
    // The insert commits before this reply, and a duplicate delivery only
    // repeats the acknowledgement: recordSuccessfulPayment never re-enqueues
    // fulfillment for an existing charge id.
    await ctx.reply(t(ctx.from?.language_code, "payments.thanks"));
  });

  bot.command("paysupport", async (ctx) => {
    await ctx.reply(process.env.PAYSUPPORT_TEXT ?? SUPPORT_TEXT_DEFAULT);
  });

  const chargeOwner = async (chargeId: string): Promise<number | null> => {
    const rows = (await sql.unsafe("SELECT user_id FROM payments WHERE charge_id = $1;", [
      chargeId,
    ])) as unknown as { readonly user_id: number }[];
    const row = rows[0];
    return row === undefined ? null : Number(row.user_id);
  };

  bot.command("refund", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply(ACCESS_DENIED);
      return;
    }
    const chargeId = ctx.match.trim();
    if (chargeId === "") {
      await ctx.reply("Usage: /refund <charge_id>");
      return;
    }
    const userId = await chargeOwner(chargeId);
    if (userId === null) {
      await ctx.reply("Payment not found.");
      return;
    }
    const result = await refundPayment(sql, api, { userId, chargeId });
    await ctx.reply(result.duplicate ? "Refund already recorded." : "Refund issued.");
  });

  bot.command("subscription_cancel", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply(ACCESS_DENIED);
      return;
    }
    const chargeId = ctx.match.trim();
    if (chargeId === "") {
      await ctx.reply("Usage: /subscription_cancel <charge_id>");
      return;
    }
    const userId = await chargeOwner(chargeId);
    if (userId === null) {
      await ctx.reply("Payment not found.");
      return;
    }
    const result = await cancelSubscription(sql, api, { userId, chargeId });
    await ctx.reply(result.duplicate ? "Subscription already canceled." : "Subscription canceled.");
  });

  bot.command("subscriptions", async (ctx) => {
    const from = ctx.from;
    if (from === undefined) return;
    const rows = (await sql.unsafe(
      "SELECT charge_id, expires_at FROM subscriptions WHERE user_id = $1" +
        " AND canceled_at IS NULL AND expires_at > now() ORDER BY expires_at;",
      [from.id],
    )) as unknown as { readonly charge_id: string; readonly expires_at: string | Date }[];
    if (rows.length === 0) {
      await ctx.reply("No active subscriptions.");
      return;
    }
    await ctx.reply(
      rows
        .map((row) => row.charge_id + " until " + new Date(row.expires_at).toISOString())
        .join("\\n"),
    );
  });
}
`;

const PAYMENTS_TEST = `import { expect, test } from "bun:test";
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
    reply: async (text: string): Promise<void> => { void state.replies.push(text); },
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
    reply: async (text: string): Promise<void> => { void state.replies.push(text); },
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
    reply: async (text: string): Promise<void> => { void state.replies.push(text); },
  });
  expect(state.calls).not.toContain("refundStarPayment");
  await handler?.({
    match: "charge-1",
    from: { id: 42 },
    reply: async (text: string): Promise<void> => { void state.replies.push(text); },
  });
  await handler?.({
    match: "charge-1",
    from: { id: 42 },
    reply: async (text: string): Promise<void> => { void state.replies.push(text); },
  });
  expect(state.calls).toEqual(["refundStarPayment"]);
  expect(state.replies).toContain("Refund issued.");
  expect(state.replies).toContain("Refund already recorded.");
});

test("reconciliation records without granting an entitlement", async () => {
  const state = harness();
  const result = await reconcilePayments(
    state.sql,
    state.bot.api as unknown as TelegramPayments,
    { limit: 100 },
  );
  expect(result.inserted).toBe(0);
  expect(state.queue.calls).toEqual([]);
});
`;

const MODERATION_MODULE = `import type { Bot } from "grammy";

const DEFAULT_BLOCKED = ["casino", "crypto giveaway"] as const;

export function blockedWords(): readonly string[] {
  const raw = process.env.MODERATION_BLOCKED_WORDS ?? "";
  const words = raw
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word !== "");
  return words.length === 0 ? DEFAULT_BLOCKED : words;
}

export function isBlocked(text: string): boolean {
  const lowered = text.toLowerCase();
  if (lowered.includes("http://") || lowered.includes("https://")) return true;
  return blockedWords().some((word) => lowered.includes(word));
}

export function register(bot: Bot): void {
  bot.on("message:text", async (ctx, next) => {
    if (!isBlocked(ctx.message.text)) {
      await next();
      return;
    }
    try {
      await ctx.deleteMessage();
    } catch {
      // The bot may lack delete rights; the warning below still applies.
    }
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Message removed by moderation.");
    }
  });
}
`;

const MODERATION_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";

import { isBlocked } from "../src/features/moderation.ts";

test("moderation blocks links", () => {
  assert.equal(isBlocked("buy at https://example.com"), true);
  assert.equal(isBlocked("hello there"), false);
});
`;

const BROADCAST_TEST = `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("broadcast audience is the users table, not the admin list", async () => {
  const job = await readFile(new URL("../src/jobs/broadcast.ts", import.meta.url), "utf8");
  assert.match(job, /FROM users/);
  assert.ok(!job.includes("ADMIN_IDS"));
});

test("broadcast command inserts one row and enqueues one idempotent job", async () => {
  const command = await readFile(new URL("../src/features/broadcast.ts", import.meta.url), "utf8");
  assert.match(command, /idempotencyKey: "broadcast:" \\+ broadcastId/);
  assert.match(command, /INSERT INTO broadcasts/);
  assert.ok(!command.includes("sendMessage"));
});
`;

const MINIAPP_MODULE = `import { createHash } from "node:crypto";

import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";

import {
  MiniAppAuthError,
  SECURITY_HEADERS,
  SESSION_COOKIE,
  assertMutationAuthorized,
  clearSessionCookie,
  createSession,
  readSession,
  sessionCookie,
  validateInitData,
  type CreatedSession,
  type InitDataUser,
  type MiniAppRedis,
} from "../runtime/miniapp-session.js";

export const SESSION_PATH = "/api/miniapp/session";
export const ME_PATH = "/api/miniapp/me";
const PROFILE_KEY_PREFIX = "miniapp:profile:";

export interface MiniAppConfig {
  readonly MINIAPP_SESSION_TTL_SECONDS: number;
  readonly MINIAPP_ALLOWED_ORIGINS: string;
}

export interface MiniAppRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string | null;
  readonly headers: {
    readonly cookie?: string;
    readonly origin?: string;
    readonly host?: string;
    readonly csrfToken?: string;
  };
  readonly secure: boolean;
  readonly botToken: string;
  readonly redis: unknown;
  readonly config: MiniAppConfig;
}

export interface MiniAppRouteResult {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface MiniAppRoute {
  readonly method: string;
  readonly path: string;
  handler(request: MiniAppRouteRequest): Promise<MiniAppRouteResult>;
}

interface SessionStore extends MiniAppRedis {
  del(...keys: string[]): Promise<unknown>;
}

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(...args: unknown[]): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del?(...keys: string[]): Promise<unknown>;
}

// ioredis takes positional SET options; the session runtime takes the object
// form. One adapter keeps both contracts honest.
function toStore(client: unknown): SessionStore | null {
  if (typeof client !== "object" || client === null) return null;
  const raw = client as RedisClient;
  if (
    typeof raw.get !== "function" ||
    typeof raw.set !== "function" ||
    typeof raw.setex !== "function"
  ) {
    return null;
  }
  return {
    get: (key) => raw.get(key),
    set: (key, value, options) => raw.set(key, value, "EX", options.EX, "NX"),
    setex: (key, seconds, value) => raw.setex(key, seconds, value),
    del: (...keys) => (typeof raw.del === "function" ? raw.del(...keys) : Promise.resolve(0)),
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionKey(sessionId: string): string {
  return "miniapp:session:" + sha256Hex(sessionId);
}

function profileKey(sessionId: string): string {
  return PROFILE_KEY_PREFIX + sha256Hex(sessionId);
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (header === undefined || header === "") return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    if (value !== "") return value;
  }
  return null;
}

function displayNameOf(user: InitDataUser): string {
  return [user.firstName, user.lastName ?? ""].filter((part) => part !== "").join(" ");
}

function allowedOrigins(config: MiniAppConfig): readonly string[] {
  return config.MINIAPP_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim().replace(/\\/$/, ""))
    .filter((origin) => origin !== "");
}

function json(
  payload: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): MiniAppRouteResult {
  return { status, body: payload, headers: { ...SECURITY_HEADERS, ...headers } };
}

function authorizationOf(
  headers: MiniAppRouteRequest["headers"],
): { origin?: string; host?: string; csrfToken?: string } {
  const request: { origin?: string; host?: string; csrfToken?: string } = {};
  if (headers.origin !== undefined) request.origin = headers.origin;
  if (headers.host !== undefined) request.host = headers.host;
  if (headers.csrfToken !== undefined) request.csrfToken = headers.csrfToken;
  return request;
}

export async function createSessionHandler(
  request: MiniAppRouteRequest,
): Promise<MiniAppRouteResult> {
  let payload: unknown;
  try {
    payload = request.body === null ? undefined : JSON.parse(request.body);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const initData =
    typeof payload === "object" && payload !== null
      ? (payload as { initData?: unknown }).initData
      : undefined;
  if (typeof initData !== "string" || initData === "") {
    return json({ error: "invalid_request" }, 400);
  }
  try {
    validateInitData(initData, request.botToken, {
      ttlSeconds: request.config.MINIAPP_SESSION_TTL_SECONDS,
      now: Date.now(),
    });
  } catch (error) {
    if (error instanceof MiniAppAuthError) return json({ error: "invalid_init_data" }, 401);
    throw error;
  }
  const store = toStore(request.redis);
  if (store === null) return json({ error: "session_store_unavailable" }, 503);
  let created: CreatedSession;
  try {
    created = await createSession(initData, request.botToken, store, {
      ttlSeconds: request.config.MINIAPP_SESSION_TTL_SECONDS,
      now: Date.now(),
    });
  } catch (error) {
    if (error instanceof MiniAppAuthError) return json({ error: "invalid_init_data" }, 401);
    throw error;
  }
  const displayName = displayNameOf(created.user);
  await store.setex(profileKey(created.sessionId), created.ttlSeconds, displayName);
  return json(
    { user: { id: created.user.id, displayName }, csrfToken: created.csrfToken },
    200,
    { "Set-Cookie": sessionCookie(created.sessionId, created.ttlSeconds, request.secure) },
  );
}

export async function meHandler(request: MiniAppRouteRequest): Promise<MiniAppRouteResult> {
  const store = toStore(request.redis);
  if (store === null) return json({ error: "session_store_unavailable" }, 503);
  const sessionId = cookieValue(request.headers.cookie, SESSION_COOKIE);
  if (sessionId === null) return json({ error: "unauthorized" }, 401);
  const session = await readSession(store, sessionId);
  if (session === null) return json({ error: "unauthorized" }, 401);
  const displayName = (await store.get(profileKey(sessionId))) ?? "";
  return json({ user: { id: session.userId, displayName } });
}

export async function logoutHandler(request: MiniAppRouteRequest): Promise<MiniAppRouteResult> {
  const store = toStore(request.redis);
  if (store === null) return json({ error: "session_store_unavailable" }, 503);
  const sessionId = cookieValue(request.headers.cookie, SESSION_COOKIE);
  const session = sessionId === null ? null : await readSession(store, sessionId);
  try {
    assertMutationAuthorized(
      authorizationOf(request.headers),
      session,
      allowedOrigins(request.config),
    );
  } catch (error) {
    if (error instanceof MiniAppAuthError) return json({ error: "forbidden" }, 403);
    throw error;
  }
  if (sessionId !== null) {
    await store.del(sessionKey(sessionId), profileKey(sessionId));
  }
  return {
    status: 204,
    body: null,
    headers: { ...SECURITY_HEADERS, "Set-Cookie": clearSessionCookie(request.secure) },
  };
}

export const routes: readonly MiniAppRoute[] = [
  { method: "POST", path: SESSION_PATH, handler: createSessionHandler },
  { method: "GET", path: ME_PATH, handler: meHandler },
  { method: "DELETE", path: SESSION_PATH, handler: logoutHandler },
];

export function register(bot: Bot): void {
  bot.command("miniapp", async (ctx) => {
    const url = process.env.MINIAPP_URL ?? process.env.WEBHOOK_URL ?? "";
    if (!url.startsWith("https://")) {
      await ctx.reply("Set WEBHOOK_URL to an HTTPS URL to open the mini app.");
      return;
    }
    await ctx.reply("Open the mini app:", {
      reply_markup: new InlineKeyboard().webApp("Open", url),
    });
  });
}
`;

const MINIAPP_TEST = `import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";

import {
  ME_PATH,
  SESSION_PATH,
  createSessionHandler,
  logoutHandler,
  meHandler,
  type MiniAppRouteRequest,
} from "../src/features/miniapp.ts";
import {
  SESSION_COOKIE,
  assertMutationAuthorized,
  type StoredSession,
} from "../src/runtime/miniapp-session.ts";

const TOKEN = "unit-test-token";
const TTL = 86_400;
const CONFIG = { MINIAPP_SESSION_TTL_SECONDS: TTL, MINIAPP_ALLOWED_ORIGINS: "" };

class FakeRedis {
  readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string, ...options: unknown[]): Promise<unknown> {
    const nx = options.includes("NX");
    if (nx && this.data.has(key)) return null;
    this.data.set(key, value);
    return "OK";
  }

  async setex(key: string, _seconds: number, value: string): Promise<unknown> {
    this.data.set(key, value);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.data.delete(key)) removed += 1;
    }
    return removed;
  }
}

function signedInitData(authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "query",
    user: JSON.stringify({ id: 7, first_name: "Test", last_name: "User" }),
  });
  const checkString = [...params.entries()]
    .map(([key, value]) => key + "=" + value)
    .sort()
    .join("\\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

function request(overrides: Partial<MiniAppRouteRequest> = {}): MiniAppRouteRequest {
  return {
    method: "POST",
    path: SESSION_PATH,
    body: null,
    headers: {},
    secure: false,
    botToken: TOKEN,
    redis: new FakeRedis(),
    config: CONFIG,
    ...overrides,
  };
}

function freshInitData(): string {
  return signedInitData(Math.floor(Date.now() / 1000) - 60);
}

function cookieOf(response: { headers?: Readonly<Record<string, string>> }): string {
  const header = response.headers?.["Set-Cookie"] ?? "";
  const end = header.indexOf(";");
  return end === -1 ? header : header.slice(0, end);
}

test("session sets an HttpOnly cookie and security headers", async () => {
  const response = await createSessionHandler(
    request({ body: JSON.stringify({ initData: freshInitData() }) }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers?.["Set-Cookie"] ?? "";
  assert.ok(cookie.startsWith(SESSION_COOKIE + "="));
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("SameSite=Lax"));
  assert.ok(cookie.includes("Path=/"));
  assert.ok(cookie.includes("Max-Age=" + String(TTL)));
  assert.equal(response.headers?.["X-Content-Type-Options"], "nosniff");
  assert.equal(response.headers?.["Referrer-Policy"], "no-referrer");
  assert.match(response.headers?.["Content-Security-Policy"] ?? "", /default-src 'self'/);
  const body = response.body as {
    user: { id: number; displayName: string };
    csrfToken: string;
  };
  assert.equal(body.user.id, 7);
  assert.equal(body.user.displayName, "Test User");
  assert.ok(body.csrfToken.length > 0);
});

test("me returns the same user as the session", async () => {
  const store = new FakeRedis();
  const created = await createSessionHandler(
    request({ body: JSON.stringify({ initData: freshInitData() }), redis: store }),
  );
  const response = await meHandler(
    request({ method: "GET", path: ME_PATH, headers: { cookie: cookieOf(created) }, redis: store }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual((response.body as { user: unknown }).user, {
    id: 7,
    displayName: "Test User",
  });
});

test("replayed initData is rejected", async () => {
  const initData = freshInitData();
  const redis = new FakeRedis();
  assert.equal(
    (await createSessionHandler(request({ redis, body: JSON.stringify({ initData }) }))).status,
    200,
  );
  assert.equal(
    (await createSessionHandler(request({ redis, body: JSON.stringify({ initData }) }))).status,
    401,
  );
});

test("expired session is rejected", async () => {
  const redis = new FakeRedis();
  const created = await createSessionHandler(
    request({ redis, body: JSON.stringify({ initData: freshInitData() }) }),
  );
  const sessionId = cookieOf(created).slice(SESSION_COOKIE.length + 1);
  redis.data.delete("miniapp:session:" + createHash("sha256").update(sessionId).digest("hex"));
  const response = await meHandler(
    request({ method: "GET", path: ME_PATH, redis, headers: { cookie: cookieOf(created) } }),
  );
  assert.equal(response.status, 401);
});

test("mutation requires csrf and an allowed origin", async () => {
  const redis = new FakeRedis();
  const created = await createSessionHandler(
    request({ redis, body: JSON.stringify({ initData: freshInitData() }) }),
  );
  const cookie = cookieOf(created);
  const csrfToken = (created.body as { csrfToken: string }).csrfToken;

  const withoutCsrf = await logoutHandler(
    request({ method: "DELETE", path: SESSION_PATH, redis, headers: { cookie } }),
  );
  assert.equal(withoutCsrf.status, 403);

  const foreignOrigin = await logoutHandler(
    request({
      method: "DELETE",
      path: SESSION_PATH,
      redis,
      headers: {
        cookie,
        csrfToken,
        origin: "https://evil.example",
        host: "app.example",
      },
    }),
  );
  assert.equal(foreignOrigin.status, 403);

  const sameOrigin = await logoutHandler(
    request({
      method: "DELETE",
      path: SESSION_PATH,
      redis,
      headers: {
        cookie,
        csrfToken,
        origin: "https://app.example",
        host: "app.example",
      },
    }),
  );
  assert.equal(sameOrigin.status, 204);
});

test("assertMutationAuthorized accepts a same-origin request", () => {
  const session: StoredSession = { userId: 7, authDate: 1, csrf: "token", createdAt: 1 };
  const authorized = assertMutationAuthorized(
    { origin: "https://app.example", host: "app.example", csrfToken: "token" },
    session,
    [],
  );
  assert.equal(authorized.userId, 7);
});
`;

const WIDGETS_MODULE = `import type { Bot } from "grammy";

import { api104 } from "../telegram/api104.js";

const ANSWER_TIMEOUT_MS = 15_000;

export function widgetQueryId(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return null;
  for (const field of ["widget_query", "shared_widget_query"] as const) {
    if (!(field in message)) continue;
    const query = (message as Record<string, unknown>)[field];
    if (typeof query !== "object" || query === null || !("id" in query)) continue;
    if (typeof query.id === "string" && query.id !== "") return query.id;
  }
  return null;
}

export function register(bot: Bot): void {
  const api = api104(bot);
  bot.on("message", async (ctx, next) => {
    const queryId = widgetQueryId(ctx.message);
    if (queryId === null) {
      await next();
      return;
    }
    const startedAt = Date.now();
    await api.answerWidgetQuery({ widget_query_id: queryId, data: "ack" });
    if (Date.now() - startedAt > ANSWER_TIMEOUT_MS) return;
  });
}
`;

function widgetsTest(name: string): string {
  return `import assert from "node:assert/strict";
import { test } from "node:test";

import { register, widgetQueryId } from "../src/features/${name}.ts";

test("widget query id is read from both update shapes", () => {
  assert.equal(widgetQueryId({ widget_query: { id: "one" } }), "one");
  assert.equal(widgetQueryId({ shared_widget_query: { id: "two" } }), "two");
  assert.equal(widgetQueryId({}), null);
  assert.equal(widgetQueryId("nope"), null);
});

test("register is exported", () => {
  assert.equal(typeof register, "function");
});
`;
}

const RICH_MODULE = `import type { Bot } from "grammy";

import { api104 } from "../telegram/api104.js";

export function promptFrom(text: string | undefined): string {
  const value = text ?? "";
  const index = value.indexOf(" ");
  return (index === -1 ? "" : value.slice(index + 1)).trim();
}

export function richMessage(markdown: string): { readonly markdown: string } {
  return { markdown };
}

export function register(bot: Bot): void {
  const api = api104(bot);
  bot.command("rich", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const markdown = promptFrom(ctx.message?.text);
    if (markdown === "") {
      await ctx.reply("Usage: /rich <text>");
      return;
    }
    await api.sendRichMessageDraft({
      chat_id: chatId,
      draft_id: Date.now(),
      rich_message: richMessage(markdown),
    });
    await api.sendRichMessage({ chat_id: chatId, rich_message: richMessage(markdown) });
  });
}
`;

function richTest(name: string): string {
  return `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { promptFrom, register, richMessage } from "../src/features/${name}.ts";

test("rich prompt strips the command", () => {
  assert.equal(promptFrom("/rich hello *world*"), "hello *world*");
  assert.equal(promptFrom("/rich"), "");
  assert.equal(promptFrom(undefined), "");
});

test("rich payload uses rich_message", async () => {
  assert.deepEqual(richMessage("*hi*"), { markdown: "*hi*" });
  const source = await readFile(new URL("../src/features/${name}.ts", import.meta.url), "utf8");
  assert.match(source, /rich_message: richMessage\\(/);
});

test("register is exported", () => {
  assert.equal(typeof register, "function");
});
`;
}

// Payment work runs in the worker, never in the webhook. The loader maps one
// kind per module, so fulfillment and reconciliation are separate files.
export function renderPaymentsJobsTs(): TemplateFile[] {
  return [
    file(
      "src/jobs/payments.ts",
      `import { logger } from "../logger.js";
import { SUBSCRIPTION_PERIOD_SECONDS } from "../runtime/payments.js";
import type { ClaimedJob } from "../runtime/queue.js";
import type { JobContext } from "./index.js";

export const kind = "payment.fulfill";

export interface FulfillPayload {
  readonly chargeId: string;
  readonly userId: number;
  readonly productId: string;
}

function parsePayload(payload: unknown): FulfillPayload {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("invalid payment.fulfill payload");
  }
  const value = payload as Record<string, unknown>;
  if (
    typeof value.chargeId !== "string" ||
    !Number.isSafeInteger(value.userId) ||
    typeof value.productId !== "string"
  ) {
    throw new Error("invalid payment.fulfill payload");
  }
  return {
    chargeId: value.chargeId,
    userId: value.userId as number,
    productId: value.productId,
  };
}

// Fulfillment is idempotent by charge id. The paid payment row is the grant,
// and a subscription payment also owns a subscriptions row. The generated
// project has no application-specific entitlement table: applications that
// need one extend this handler instead of adding a second grant path.
export async function handle(job: ClaimedJob, ctx: JobContext): Promise<void> {
  const payload = parsePayload(job.payload);
  const rows = (await ctx.sql.unsafe(
    "UPDATE payments SET status = 'paid' WHERE charge_id = $1 AND user_id = $2" +
      " AND status = 'paid' RETURNING subscription_expiration_date;",
    [payload.chargeId, payload.userId],
  )) as unknown as { readonly subscription_expiration_date: string | Date | null }[];
  const row = rows[0];
  if (row === undefined) {
    logger.info({ chargeId: payload.chargeId }, "payment already refunded or missing");
    return;
  }
  if (row.subscription_expiration_date !== null) {
    await ctx.sql.unsafe(
      "INSERT INTO subscriptions (charge_id, user_id, period_seconds, expires_at, canceled_at)" +
        " VALUES ($1, $2, $3, $4, NULL) ON CONFLICT (charge_id) DO NOTHING;",
      [
        payload.chargeId,
        payload.userId,
        SUBSCRIPTION_PERIOD_SECONDS,
        row.subscription_expiration_date,
      ],
    );
  }
  logger.info({ chargeId: payload.chargeId, productId: payload.productId }, "payment fulfilled");
}
`,
    ),
    file(
      "src/jobs/payments-reconcile.ts",
      `import { logger } from "../logger.js";
import { reconcilePayments, type TelegramPayments } from "../runtime/payments.js";
import type { ClaimedJob } from "../runtime/queue.js";
import type { JobContext } from "./index.js";

export const kind = "payment.reconcile";

const INTERVAL_MS = 6 * 60 * 60 * 1000;

// Reconciliation only records Telegram's transactions; it never enqueues
// fulfillment and never grants an entitlement.
export async function handle(_job: ClaimedJob, ctx: JobContext): Promise<void> {
  const api = ctx.bot.api as unknown as TelegramPayments;
  const result = await reconcilePayments(ctx.sql, api, { limit: 100 });
  logger.info(
    {
      scanned: result.scanned,
      inserted: result.inserted,
      refunded: result.refunded,
      chargebacks: result.chargebacks,
      skipped: result.skipped,
    },
    "payments reconciled",
  );
  const nextBucket = Math.floor(Date.now() / INTERVAL_MS) + 1;
  await ctx.queue.enqueue(
    "payment.reconcile",
    {},
    {
      runAt: new Date(nextBucket * INTERVAL_MS),
      idempotencyKey: "reconcile:" + String(nextBucket),
    },
  );
}
`,
    ),
  ];
}

export function renderGrammyFeature(
  feature: BotFeature,
  name: string,
  spec: BotSpec,
): TemplateFile[] {
  switch (feature) {
    case "commands":
      return [
        file(`src/features/${name}.ts`, commandModule(name)),
        file(`tests/${name}.test.ts`, commandTest(name)),
      ];
    case "llm":
      return [
        file("src/features/llm.ts", renderLlmEnqueueTs()),
        file("src/jobs/llm.ts", renderLlmJobTs(spec)),
        file("tests/llm.test.ts", LLM_TEST),
      ];
    case "inline":
      return [
        file("src/features/inline.ts", INLINE_MODULE),
        file("tests/inline.test.ts", INLINE_TEST),
      ];
    case "payments":
      return [
        file("src/runtime/payments.ts", renderPaymentsTs(spec)),
        file("src/features/payments.ts", PAYMENTS_MODULE),
        file("tests/payments.test.ts", PAYMENTS_TEST),
        ...renderPaymentsJobsTs(),
      ];
    case "miniapps":
      return [
        ...renderMiniApp(spec),
        file("src/runtime/miniapp-session.ts", renderMiniAppSessionTs()),
        file("src/features/miniapp.ts", MINIAPP_MODULE),
        file("tests/miniapp.test.ts", MINIAPP_TEST),
      ];
    case "moderation":
      return [
        file("src/features/moderation.ts", MODERATION_MODULE),
        file("tests/moderation.test.ts", MODERATION_TEST),
      ];
    case "broadcast":
      return [
        file("src/features/broadcast.ts", renderBroadcastCommandTs()),
        file("src/jobs/broadcast.ts", renderBroadcastJobTs()),
        file("tests/broadcast.test.ts", BROADCAST_TEST),
      ];
    case "widgets":
      return [
        file(`src/features/${name}.ts`, WIDGETS_MODULE),
        file(`tests/${name}.test.ts`, widgetsTest(name)),
      ];
    case "rich":
      return [
        file(`src/features/${name}.ts`, RICH_MODULE),
        file(`tests/${name}.test.ts`, richTest(name)),
      ];
  }
}
