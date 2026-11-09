/**
 * Generated Star payments runtime, shared by both stacks.
 *
 * Product data always comes from `spec.payments.products`; it is embedded as a
 * literal at render time and is never read from the client. The SQL below is the
 * single schema of record for users, payments, refunds, and subscriptions.
 */

import type { BotSpec } from "../../spec/bot-spec.ts";

export const PAYMENTS_SQL = `CREATE TABLE users (
  id bigint PRIMARY KEY,
  username text,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payments (
  charge_id text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id),
  payload text NOT NULL,
  currency text NOT NULL,
  amount integer NOT NULL,
  status text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid','refunded','chargeback')),
  is_recurring boolean NOT NULL DEFAULT false,
  is_first_recurring boolean NOT NULL DEFAULT false,
  subscription_expiration_date timestamptz,
  provider_charge_id text,
  raw jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id text NOT NULL REFERENCES payments(charge_id),
  user_id bigint NOT NULL,
  amount integer NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE subscriptions (
  charge_id text PRIMARY KEY REFERENCES payments(charge_id),
  user_id bigint NOT NULL,
  period_seconds integer NOT NULL,
  expires_at timestamptz NOT NULL,
  canceled_at timestamptz
);
`;

function pythonProducts(spec: BotSpec): string {
  const products = spec.payments?.products ?? [];
  if (products.length === 0) return "    # no products configured\n";
  return products
    .map(
      (product) =>
        `    PaymentProduct(\n` +
        `        id=${JSON.stringify(product.id)},\n` +
        `        title=${JSON.stringify(product.title)},\n` +
        `        description=${JSON.stringify(product.description)},\n` +
        `        stars=${product.stars},\n` +
        `        subscription=${product.subscription ? "True" : "False"},\n` +
        `    ),\n`,
    )
    .join("");
}

/** Drizzle schema mirroring `PAYMENTS_SQL` column for column. */
export function renderPaymentsDrizzleTs(): string {
  return `import { bigint, boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  username: text("username"),
  displayName: text("display_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  chargeId: text("charge_id").primaryKey(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => users.id),
  payload: text("payload").notNull(),
  currency: text("currency").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("paid"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  isFirstRecurring: boolean("is_first_recurring").notNull().default(false),
  subscriptionExpirationDate: timestamp("subscription_expiration_date", { withTimezone: true }),
  providerChargeId: text("provider_charge_id"),
  raw: jsonb("raw").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  chargeId: text("charge_id")
    .notNull()
    .references(() => payments.chargeId),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  chargeId: text("charge_id")
    .primaryKey()
    .references(() => payments.chargeId),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  periodSeconds: integer("period_seconds").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
});
`;
}

/** SQLAlchemy models mirroring `PAYMENTS_SQL` column for column. */
export function renderPaymentsModelsPy(): string {
  return `from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str | None] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('paid','refunded','chargeback')", name="payments_status_check"
        ),
    )

    charge_id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    currency: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="paid")
    is_recurring: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    is_first_recurring: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    subscription_expiration_date: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    provider_charge_id: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Refund(Base):
    __tablename__ = "refunds"
    __table_args__ = (
        CheckConstraint(
            "status IN ('requested','completed','failed')", name="refunds_status_check"
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    charge_id: Mapped[str] = mapped_column(
        Text, ForeignKey("payments.charge_id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Subscription(Base):
    __tablename__ = "subscriptions"

    charge_id: Mapped[str] = mapped_column(
        Text, ForeignKey("payments.charge_id"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    period_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    canceled_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
`;
}

export function renderPaymentsTs(spec: BotSpec): string {
  const products = JSON.stringify(spec.payments?.products ?? [], null, 2);
  return `import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

export interface PaymentProduct {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly stars: number;
  readonly subscription: boolean;
}

export const CURRENCY = "XTR";
export const SUBSCRIPTION_PERIOD_SECONDS = 2592000;
export const PRODUCTS: readonly PaymentProduct[] = ${products};

const PRODUCT_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const NONCE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAYLOAD_RE =
  /^product:([a-z][a-z0-9_]{1,31}):user:(\\d{1,20}):nonce:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export class PaymentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}

export interface LabeledPrice {
  readonly label: string;
  readonly amount: number;
}

export interface StarTransaction {
  readonly id: string;
  readonly amount: number;
  readonly date?: number;
  readonly source?: { readonly id?: number };
  readonly receiver?: { readonly id?: number };
  readonly transaction_type?: {
    readonly type?: string;
    readonly payment_charge_id?: string;
  };
}

export interface TelegramPayments {
  sendInvoice(
    chatId: number,
    title: string,
    description: string,
    payload: string,
    currency: string,
    prices: readonly LabeledPrice[],
    options?: { readonly subscription_period?: number },
  ): Promise<unknown>;
  createInvoiceLink(
    title: string,
    description: string,
    payload: string,
    currency: string,
    prices: readonly LabeledPrice[],
    options?: { readonly subscription_period?: number },
  ): Promise<string>;
  refundStarPayment(userId: number, chargeId: string): Promise<unknown>;
  editUserStarSubscription(
    userId: number,
    chargeId: string,
    canceled: boolean,
  ): Promise<unknown>;
  getStarTransactions(input: {
    offset?: number;
    limit?: number;
  }): Promise<{ transactions: readonly StarTransaction[] }>;
}

export interface PreCheckoutQuery {
  readonly userId: number;
  readonly invoicePayload: string;
  readonly currency: string;
  readonly totalAmount: number;
}

export interface SuccessfulPayment {
  readonly userId: number;
  readonly chargeId: string;
  readonly providerChargeId?: string;
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

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface InvoiceResult {
  readonly payload: string;
  readonly invoiceLink?: string;
}

export interface ParsedPayload {
  readonly product: PaymentProduct;
  readonly userId: number;
  readonly nonce: string;
}

export function invoicePayload(
  productId: string,
  userId: number,
  nonce: string,
): string {
  if (!PRODUCT_ID_RE.test(productId)) {
    throw new PaymentError("invalid_product", "invalid product id");
  }
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new PaymentError("invalid_user", "invalid user id");
  }
  if (!NONCE_RE.test(nonce)) {
    throw new PaymentError("invalid_nonce", "nonce must be a uuid");
  }
  return "product:" + productId + ":user:" + String(userId) + ":nonce:" + nonce;
}

export function parseInvoicePayload(
  payload: string,
  products: readonly PaymentProduct[],
): ParsedPayload {
  const match = PAYLOAD_RE.exec(payload);
  if (match === null) {
    throw new PaymentError("invalid_payload", "malformed invoice payload");
  }
  const productId = match[1];
  const rawUserId = match[2];
  const nonce = match[3];
  if (productId === undefined || rawUserId === undefined || nonce === undefined) {
    throw new PaymentError("invalid_payload", "malformed invoice payload");
  }
  const userId = Number(rawUserId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new PaymentError("invalid_user", "invalid user id");
  }
  const product = products.find((candidate) => candidate.id === productId);
  if (product === undefined) {
    throw new PaymentError("unknown_product", "unknown product: " + productId);
  }
  return { product, userId, nonce };
}

function validatePayment(
  payload: string,
  userId: number,
  currency: string,
  amount: number,
  products: readonly PaymentProduct[],
): ValidationResult {
  let parsed: ParsedPayload;
  try {
    parsed = parseInvoicePayload(payload, products);
  } catch (error) {
    if (error instanceof PaymentError) {
      return { ok: false, reason: error.code };
    }
    return { ok: false, reason: "invalid_payload" };
  }
  if (parsed.userId !== userId) return { ok: false, reason: "user_mismatch" };
  if (currency !== CURRENCY) return { ok: false, reason: "wrong_currency" };
  if (amount !== parsed.product.stars) return { ok: false, reason: "wrong_amount" };
  return { ok: true };
}

export function validatePreCheckout(
  query: PreCheckoutQuery,
  products: readonly PaymentProduct[],
): ValidationResult {
  return validatePayment(
    query.invoicePayload,
    query.userId,
    query.currency,
    query.totalAmount,
    products,
  );
}

export function validateSuccessfulPayment(
  payment: SuccessfulPayment,
  products: readonly PaymentProduct[],
): ValidationResult {
  if (payment.chargeId === "") return { ok: false, reason: "invalid_charge" };
  return validatePayment(
    payment.invoicePayload,
    payment.userId,
    payment.currency,
    payment.totalAmount,
    products,
  );
}

export async function createInvoice(
  api: TelegramPayments,
  product: PaymentProduct,
  userId: number,
  options: { chatId?: number; nonce?: string } = {},
): Promise<InvoiceResult> {
  const payload = invoicePayload(product.id, userId, options.nonce ?? randomUUID());
  const prices: LabeledPrice[] = [{ label: product.title, amount: product.stars }];
  const extra = product.subscription
    ? { subscription_period: SUBSCRIPTION_PERIOD_SECONDS }
    : undefined;
  if (product.subscription) {
    const invoiceLink = await api.createInvoiceLink(
      product.title,
      product.description,
      payload,
      CURRENCY,
      prices,
      extra,
    );
    return { payload, invoiceLink };
  }
  const chatId = options.chatId;
  if (chatId === undefined) {
    throw new PaymentError("missing_chat", "chatId is required for a one-time invoice");
  }
  await api.sendInvoice(
    chatId,
    product.title,
    product.description,
    payload,
    CURRENCY,
    prices,
    extra,
  );
  return { payload };
}

export interface PaymentQueue {
  enqueue(
    kind: string,
    payload: unknown,
    options?: { idempotencyKey?: string },
  ): Promise<string>;
}

export interface PaymentRow {
  readonly charge_id: string;
  readonly user_id: number;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
}

export interface RecordedPayment {
  readonly chargeId: string;
  readonly userId: number;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly duplicate: boolean;
}

export interface RecordPaymentInput {
  readonly payment: SuccessfulPayment;
  readonly products: readonly PaymentProduct[];
}

function sqlLines(...lines: string[]): string {
  return lines.join("\\n");
}

const UPSERT_USER_SQL = sqlLines(
  "INSERT INTO users (id, username, display_name, updated_at)",
  "VALUES ($1, $2, $3, now())",
  "ON CONFLICT (id) DO UPDATE SET",
  "  username = COALESCE(EXCLUDED.username, users.username),",
  "  display_name = EXCLUDED.display_name,",
  "  updated_at = now();",
);

const INSERT_PAYMENT_SQL = sqlLines(
  "INSERT INTO payments (charge_id, user_id, payload, currency, amount,",
  "  is_recurring, is_first_recurring, subscription_expiration_date,",
  "  provider_charge_id, raw)",
  "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)",
  "ON CONFLICT (charge_id) DO NOTHING",
  "RETURNING charge_id, user_id, amount, currency, status;",
);

const SELECT_PAYMENT_SQL = sqlLines(
  "SELECT charge_id, user_id, amount, currency, status",
  "FROM payments WHERE charge_id = $1;",
);

const INSERT_SUBSCRIPTION_SQL = sqlLines(
  "INSERT INTO subscriptions (charge_id, user_id, period_seconds, expires_at, canceled_at)",
  "VALUES ($1, $2, $3, $4, NULL)",
  "ON CONFLICT (charge_id) DO NOTHING;",
);

const GUARD_REFUND_SQL = sqlLines(
  "UPDATE payments SET status = 'refunded'",
  "WHERE charge_id = $1 AND user_id = $2 AND status = 'paid'",
  "RETURNING amount;",
);

const SELECT_PAYMENT_STATUS_SQL = sqlLines(
  "SELECT status, amount FROM payments WHERE charge_id = $1 AND user_id = $2;",
);

const INSERT_REFUND_SQL = sqlLines(
  "INSERT INTO refunds (charge_id, user_id, amount, status)",
  "VALUES ($1, $2, $3, $4)",
  "RETURNING id;",
);

const RESTORE_PAYMENT_SQL = sqlLines(
  "UPDATE payments SET status = 'paid' WHERE charge_id = $1;",
);

const SELECT_SUBSCRIPTION_SQL = sqlLines(
  "SELECT charge_id, canceled_at FROM subscriptions",
  "WHERE charge_id = $1 AND user_id = $2;",
);

const CANCEL_SUBSCRIPTION_SQL = sqlLines(
  "UPDATE subscriptions SET canceled_at = now()",
  "WHERE charge_id = $1 AND canceled_at IS NULL;",
);

const RECONCILE_INSERT_PAYMENT_SQL = sqlLines(
  "INSERT INTO payments (charge_id, user_id, payload, currency, amount, raw)",
  "VALUES ($1, $2, 'reconcile', 'XTR', $3, $4::jsonb)",
  "ON CONFLICT (charge_id) DO NOTHING",
  "RETURNING charge_id;",
);

const RECONCILE_MARK_REFUND_SQL = sqlLines(
  "UPDATE payments SET status = $2",
  "WHERE charge_id = $1 AND status = 'paid'",
  "RETURNING charge_id;",
);

export async function recordSuccessfulPayment(
  sql: Sql,
  queue: PaymentQueue,
  input: RecordPaymentInput,
): Promise<RecordedPayment> {
  const { payment, products } = input;
  const check = validateSuccessfulPayment(payment, products);
  if (!check.ok) {
    throw new PaymentError(check.reason, "successful payment rejected: " + check.reason);
  }
  const parsed = parseInvoicePayload(payment.invoicePayload, products);
  const expiresAt =
    payment.subscriptionExpirationDate === undefined
      ? null
      : new Date(payment.subscriptionExpirationDate * 1000);

  const inserted = await sql.begin(async (tx) => {
    await tx.unsafe(UPSERT_USER_SQL, [
      payment.userId,
      payment.username ?? null,
      payment.displayName ?? "",
    ]);
    const rows = (await tx.unsafe(INSERT_PAYMENT_SQL, [
      payment.chargeId,
      payment.userId,
      payment.invoicePayload,
      payment.currency,
      payment.totalAmount,
      payment.isRecurring ?? false,
      payment.isFirstRecurring ?? false,
      expiresAt,
      payment.providerChargeId ?? null,
      JSON.stringify(payment.raw ?? {}),
    ])) as unknown as PaymentRow[];
    const row = rows[0];
    if (row === undefined) return null;
    if (parsed.product.subscription && expiresAt !== null) {
      await tx.unsafe(INSERT_SUBSCRIPTION_SQL, [
        payment.chargeId,
        payment.userId,
        SUBSCRIPTION_PERIOD_SECONDS,
        expiresAt,
      ]);
    }
    return row;
  });

  if (inserted === null) {
    const existing = (await sql.unsafe(SELECT_PAYMENT_SQL, [
      payment.chargeId,
    ])) as unknown as PaymentRow[];
    const row = existing[0];
    if (row === undefined) {
      throw new PaymentError("payment_lost", "conflicting payment row disappeared");
    }
    return {
      chargeId: row.charge_id,
      userId: Number(row.user_id),
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      duplicate: true,
    };
  }

  await queue.enqueue(
    "payment.fulfill",
    {
      chargeId: payment.chargeId,
      userId: payment.userId,
      productId: parsed.product.id,
    },
    { idempotencyKey: "payment:" + payment.chargeId },
  );
  return {
    chargeId: inserted.charge_id,
    userId: Number(inserted.user_id),
    amount: Number(inserted.amount),
    currency: inserted.currency,
    status: inserted.status,
    duplicate: false,
  };
}

export interface RefundInput {
  readonly userId: number;
  readonly chargeId: string;
}

export interface RefundResult {
  readonly refunded: boolean;
  readonly duplicate: boolean;
  readonly amount: number;
  readonly status: string;
}

// Admin-only at the handler layer. Telegram refunds the whole charge, so the
// recorded refund amount is always the stored payment amount.
export async function refundPayment(
  sql: Sql,
  api: TelegramPayments,
  input: RefundInput,
): Promise<RefundResult> {
  const guarded = (await sql.unsafe(GUARD_REFUND_SQL, [
    input.chargeId,
    input.userId,
  ])) as unknown as { readonly amount: number }[];
  const guardRow = guarded[0];
  if (guardRow === undefined) {
    const existing = (await sql.unsafe(SELECT_PAYMENT_STATUS_SQL, [
      input.chargeId,
      input.userId,
    ])) as unknown as { readonly status: string; readonly amount: number }[];
    const row = existing[0];
    if (row === undefined) {
      throw new PaymentError(
        "payment_not_found",
        "no payment for charge " + input.chargeId,
      );
    }
    return {
      refunded: false,
      duplicate: true,
      amount: Number(row.amount),
      status: row.status,
    };
  }
  const amount = Number(guardRow.amount);
  try {
    await api.refundStarPayment(input.userId, input.chargeId);
  } catch (error) {
    await sql.unsafe(RESTORE_PAYMENT_SQL, [input.chargeId]);
    await sql.unsafe(INSERT_REFUND_SQL, [
      input.chargeId,
      input.userId,
      amount,
      "failed",
    ]);
    throw error;
  }
  await sql.unsafe(INSERT_REFUND_SQL, [
    input.chargeId,
    input.userId,
    amount,
    "completed",
  ]);
  return { refunded: true, duplicate: false, amount, status: "refunded" };
}

export interface CancelResult {
  readonly canceled: boolean;
  readonly duplicate: boolean;
}

// Admin-only at the handler layer.
export async function cancelSubscription(
  sql: Sql,
  api: TelegramPayments,
  input: RefundInput,
): Promise<CancelResult> {
  const rows = (await sql.unsafe(SELECT_SUBSCRIPTION_SQL, [
    input.chargeId,
    input.userId,
  ])) as unknown as { readonly charge_id: string; readonly canceled_at: unknown }[];
  const row = rows[0];
  if (row === undefined) {
    throw new PaymentError(
      "subscription_not_found",
      "no subscription for charge " + input.chargeId,
    );
  }
  if (row.canceled_at !== null) return { canceled: false, duplicate: true };
  await api.editUserStarSubscription(input.userId, input.chargeId, true);
  await sql.unsafe(CANCEL_SUBSCRIPTION_SQL, [input.chargeId]);
  return { canceled: true, duplicate: false };
}

export type TransactionKind = "payment" | "refund" | "chargeback" | "skip";

export interface ClassifiedTransaction {
  readonly kind: TransactionKind;
  readonly chargeId: string;
  readonly userId?: number;
  readonly amount: number;
}

export function classifyStarTransaction(tx: StarTransaction): ClassifiedTransaction {
  if (!Number.isFinite(tx.amount) || tx.amount === 0) {
    return { kind: "skip", chargeId: tx.id, amount: 0 };
  }
  if (tx.amount > 0) {
    const userId = tx.source?.id;
    if (userId === undefined) return { kind: "skip", chargeId: tx.id, amount: tx.amount };
    return { kind: "payment", chargeId: tx.id, userId, amount: tx.amount };
  }
  const chargeId = tx.transaction_type?.payment_charge_id ?? tx.id;
  if (tx.transaction_type?.type === "chargeback") {
    return { kind: "chargeback", chargeId, amount: tx.amount };
  }
  return { kind: "refund", chargeId, amount: tx.amount };
}

export interface ReconcileOptions {
  readonly offset?: number;
  readonly limit?: number;
  readonly maxPages?: number;
}

export interface ReconcileResult {
  readonly scanned: number;
  readonly inserted: number;
  readonly refunded: number;
  readonly chargebacks: number;
  readonly skipped: number;
}

interface MutableReconcileResult {
  scanned: number;
  inserted: number;
  refunded: number;
  chargebacks: number;
  skipped: number;
}

// Reconciliation only records reality: it never enqueues fulfillment and never
// grants an entitlement.
export async function reconcilePayments(
  sql: Sql,
  api: TelegramPayments,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
  const maxPages = options.maxPages ?? 100;
  const result: MutableReconcileResult = {
    scanned: 0,
    inserted: 0,
    refunded: 0,
    chargebacks: 0,
    skipped: 0,
  };
  let offset = options.offset ?? 0;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await api.getStarTransactions({ offset, limit });
    const transactions = response.transactions;
    if (transactions.length === 0) break;
    for (const tx of transactions) {
      result.scanned += 1;
      const classified = classifyStarTransaction(tx);
      if (classified.kind === "skip") {
        result.skipped += 1;
        continue;
      }
      if (classified.kind === "payment") {
        const userId = classified.userId;
        if (userId === undefined) {
          result.skipped += 1;
          continue;
        }
        await sql.unsafe(UPSERT_USER_SQL, [userId, null, ""]);
        const rows = (await sql.unsafe(RECONCILE_INSERT_PAYMENT_SQL, [
          classified.chargeId,
          userId,
          classified.amount,
          JSON.stringify(tx),
        ])) as unknown as unknown[];
        if (rows.length > 0) result.inserted += 1;
        else result.skipped += 1;
        continue;
      }
      const status = classified.kind === "chargeback" ? "chargeback" : "refunded";
      const updated = (await sql.unsafe(RECONCILE_MARK_REFUND_SQL, [
        classified.chargeId,
        status,
      ])) as unknown as unknown[];
      if (updated.length === 0) {
        result.skipped += 1;
      } else if (classified.kind === "chargeback") {
        result.chargebacks += 1;
      } else {
        result.refunded += 1;
      }
    }
    if (transactions.length < limit) break;
    offset += transactions.length;
  }
  return result;
}
`;
}

export function renderPaymentsPy(spec: BotSpec): string {
  return `from __future__ import annotations

import datetime as dt
import json
import logging
import re
import uuid
from dataclasses import dataclass
from typing import Any, Mapping, Protocol, Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

logger = logging.getLogger(__name__)

CURRENCY = "XTR"
SUBSCRIPTION_PERIOD_SECONDS = 2592000

PRODUCT_ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,31}$")
NONCE_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
PAYLOAD_RE = re.compile(
    r"^product:(?P<product_id>[a-z][a-z0-9_]{1,31})"
    r":user:(?P<user_id>\\d{1,20})"
    r":nonce:(?P<nonce>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"
)


@dataclass(frozen=True)
class PaymentProduct:
    id: str
    title: str
    description: str
    stars: int
    subscription: bool


PRODUCTS: tuple[PaymentProduct, ...] = (
${pythonProducts(spec)})


@dataclass(frozen=True)
class LabeledPrice:
    label: str
    amount: int


@dataclass(frozen=True)
class PreCheckoutQuery:
    user_id: int
    invoice_payload: str
    currency: str
    total_amount: int


@dataclass(frozen=True)
class SuccessfulPayment:
    user_id: int
    charge_id: str
    invoice_payload: str
    currency: str
    total_amount: int
    provider_charge_id: str | None = None
    is_recurring: bool = False
    is_first_recurring: bool = False
    subscription_expiration_date: int | None = None
    username: str | None = None
    display_name: str = ""
    raw: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    reason: str | None = None


@dataclass(frozen=True)
class ParsedPayload:
    product: PaymentProduct
    user_id: int
    nonce: str


class PaymentError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class TelegramPayments(Protocol):
    async def send_invoice(
        self,
        chat_id: int,
        title: str,
        description: str,
        payload: str,
        currency: str,
        prices: Sequence[LabeledPrice],
        subscription_period: int | None = None,
    ) -> object: ...

    async def create_invoice_link(
        self,
        title: str,
        description: str,
        payload: str,
        currency: str,
        prices: Sequence[LabeledPrice],
        subscription_period: int | None = None,
    ) -> str: ...

    async def refund_star_payment(self, user_id: int, charge_id: str) -> object: ...

    async def edit_user_star_subscription(
        self, user_id: int, charge_id: str, canceled: bool
    ) -> object: ...

    async def get_star_transactions(
        self, offset: int = 0, limit: int = 100
    ) -> Sequence[Any]: ...


class PaymentQueue(Protocol):
    async def enqueue(
        self,
        kind: str,
        payload: Any,
        *,
        idempotency_key: str | None = None,
    ) -> str: ...


def invoice_payload(product_id: str, user_id: int, nonce: str) -> str:
    if PRODUCT_ID_RE.match(product_id) is None:
        raise PaymentError("invalid_product", "invalid product id")
    if user_id <= 0:
        raise PaymentError("invalid_user", "invalid user id")
    if NONCE_RE.match(nonce) is None:
        raise PaymentError("invalid_nonce", "nonce must be a uuid")
    return f"product:{product_id}:user:{user_id}:nonce:{nonce}"


def parse_invoice_payload(
    payload: str, products: Sequence[PaymentProduct]
) -> ParsedPayload:
    match = PAYLOAD_RE.match(payload)
    if match is None:
        raise PaymentError("invalid_payload", "malformed invoice payload")
    product_id = match.group("product_id")
    user_id = int(match.group("user_id"))
    nonce = match.group("nonce")
    if user_id <= 0:
        raise PaymentError("invalid_user", "invalid user id")
    product = next((item for item in products if item.id == product_id), None)
    if product is None:
        raise PaymentError("unknown_product", f"unknown product: {product_id}")
    return ParsedPayload(product=product, user_id=user_id, nonce=nonce)


def _validate_payment(
    payload: str,
    user_id: int,
    currency: str,
    amount: int,
    products: Sequence[PaymentProduct],
) -> ValidationResult:
    try:
        parsed = parse_invoice_payload(payload, products)
    except PaymentError as error:
        return ValidationResult(ok=False, reason=error.code)
    if parsed.user_id != user_id:
        return ValidationResult(ok=False, reason="user_mismatch")
    if currency != CURRENCY:
        return ValidationResult(ok=False, reason="wrong_currency")
    if amount != parsed.product.stars:
        return ValidationResult(ok=False, reason="wrong_amount")
    return ValidationResult(ok=True)


def validate_pre_checkout(
    query: PreCheckoutQuery, products: Sequence[PaymentProduct]
) -> ValidationResult:
    return _validate_payment(
        query.invoice_payload, query.user_id, query.currency, query.total_amount, products
    )


def validate_successful_payment(
    payment: SuccessfulPayment, products: Sequence[PaymentProduct]
) -> ValidationResult:
    if payment.charge_id == "":
        return ValidationResult(ok=False, reason="invalid_charge")
    return _validate_payment(
        payment.invoice_payload,
        payment.user_id,
        payment.currency,
        payment.total_amount,
        products,
    )


async def create_invoice(
    api: TelegramPayments,
    product: PaymentProduct,
    user_id: int,
    *,
    chat_id: int | None = None,
    nonce: str | None = None,
) -> dict[str, Any]:
    payload = invoice_payload(product.id, user_id, nonce or str(uuid.uuid4()))
    prices = [LabeledPrice(label=product.title, amount=product.stars)]
    period = SUBSCRIPTION_PERIOD_SECONDS if product.subscription else None
    if product.subscription:
        invoice_link = await api.create_invoice_link(
            product.title,
            product.description,
            payload,
            CURRENCY,
            prices,
            period,
        )
        return {"payload": payload, "invoice_link": invoice_link}
    if chat_id is None:
        raise PaymentError("missing_chat", "chat_id is required for a one-time invoice")
    await api.send_invoice(
        chat_id,
        product.title,
        product.description,
        payload,
        CURRENCY,
        prices,
        period,
    )
    return {"payload": payload}


UPSERT_USER_SQL = text(
    """
    INSERT INTO users (id, username, display_name, updated_at)
    VALUES (:user_id, :username, :display_name, now())
    ON CONFLICT (id) DO UPDATE SET
      username = COALESCE(EXCLUDED.username, users.username),
      display_name = EXCLUDED.display_name,
      updated_at = now()
    """
)

INSERT_PAYMENT_SQL = text(
    """
    INSERT INTO payments (charge_id, user_id, payload, currency, amount,
      is_recurring, is_first_recurring, subscription_expiration_date,
      provider_charge_id, raw)
    VALUES (:charge_id, :user_id, :payload, :currency, :amount,
      :is_recurring, :is_first_recurring, :expires_at,
      :provider_charge_id, CAST(:raw AS jsonb))
    ON CONFLICT (charge_id) DO NOTHING
    RETURNING charge_id, user_id, amount, currency, status
    """
)

SELECT_PAYMENT_SQL = text(
    """
    SELECT charge_id, user_id, amount, currency, status
    FROM payments WHERE charge_id = :charge_id
    """
)

INSERT_SUBSCRIPTION_SQL = text(
    """
    INSERT INTO subscriptions (charge_id, user_id, period_seconds, expires_at, canceled_at)
    VALUES (:charge_id, :user_id, :period_seconds, :expires_at, NULL)
    ON CONFLICT (charge_id) DO NOTHING
    """
)

GUARD_REFUND_SQL = text(
    """
    UPDATE payments SET status = 'refunded'
    WHERE charge_id = :charge_id AND user_id = :user_id AND status = 'paid'
    RETURNING amount
    """
)

SELECT_PAYMENT_STATUS_SQL = text(
    "SELECT status, amount FROM payments WHERE charge_id = :charge_id AND user_id = :user_id"
)

INSERT_REFUND_SQL = text(
    """
    INSERT INTO refunds (charge_id, user_id, amount, status)
    VALUES (:charge_id, :user_id, :amount, :status)
    RETURNING id
    """
)

RESTORE_PAYMENT_SQL = text(
    "UPDATE payments SET status = 'paid' WHERE charge_id = :charge_id"
)

SELECT_SUBSCRIPTION_SQL = text(
    """
    SELECT charge_id, canceled_at FROM subscriptions
    WHERE charge_id = :charge_id AND user_id = :user_id
    """
)

CANCEL_SUBSCRIPTION_SQL = text(
    """
    UPDATE subscriptions SET canceled_at = now()
    WHERE charge_id = :charge_id AND canceled_at IS NULL
    """
)

RECONCILE_INSERT_PAYMENT_SQL = text(
    """
    INSERT INTO payments (charge_id, user_id, payload, currency, amount, raw)
    VALUES (:charge_id, :user_id, 'reconcile', 'XTR', :amount, CAST(:raw AS jsonb))
    ON CONFLICT (charge_id) DO NOTHING
    RETURNING charge_id
    """
)

RECONCILE_MARK_REFUND_SQL = text(
    """
    UPDATE payments SET status = :status
    WHERE charge_id = :charge_id AND status = 'paid'
    RETURNING charge_id
    """
)


async def record_successful_payment(
    session_factory: async_sessionmaker[AsyncSession],
    queue: PaymentQueue,
    payment: SuccessfulPayment,
    products: Sequence[PaymentProduct],
) -> dict[str, Any]:
    check = validate_successful_payment(payment, products)
    if not check.ok:
        raise PaymentError(check.reason or "invalid_payment", "successful payment rejected")
    parsed = parse_invoice_payload(payment.invoice_payload, products)
    expires_at = (
        dt.datetime.fromtimestamp(payment.subscription_expiration_date, tz=dt.timezone.utc)
        if payment.subscription_expiration_date is not None
        else None
    )
    async with session_factory() as session:
        async with session.begin():
            await session.execute(
                UPSERT_USER_SQL,
                {
                    "user_id": payment.user_id,
                    "username": payment.username,
                    "display_name": payment.display_name,
                },
            )
            result = await session.execute(
                INSERT_PAYMENT_SQL,
                {
                    "charge_id": payment.charge_id,
                    "user_id": payment.user_id,
                    "payload": payment.invoice_payload,
                    "currency": payment.currency,
                    "amount": payment.total_amount,
                    "is_recurring": payment.is_recurring,
                    "is_first_recurring": payment.is_first_recurring,
                    "expires_at": expires_at,
                    "provider_charge_id": payment.provider_charge_id,
                    "raw": json.dumps(payment.raw or {}),
                },
            )
            row = result.mappings().first()
            if row is None:
                existing = await session.execute(
                    SELECT_PAYMENT_SQL, {"charge_id": payment.charge_id}
                )
                found = existing.mappings().first()
                if found is None:
                    raise PaymentError("payment_lost", "conflicting payment row disappeared")
                return {
                    "charge_id": found["charge_id"],
                    "user_id": int(found["user_id"]),
                    "amount": int(found["amount"]),
                    "currency": found["currency"],
                    "status": found["status"],
                    "duplicate": True,
                }
            if parsed.product.subscription and expires_at is not None:
                await session.execute(
                    INSERT_SUBSCRIPTION_SQL,
                    {
                        "charge_id": payment.charge_id,
                        "user_id": payment.user_id,
                        "period_seconds": SUBSCRIPTION_PERIOD_SECONDS,
                        "expires_at": expires_at,
                    },
                )
    await queue.enqueue(
        "payment.fulfill",
        {
            "chargeId": payment.charge_id,
            "userId": payment.user_id,
            "productId": parsed.product.id,
        },
        idempotency_key="payment:" + payment.charge_id,
    )
    return {
        "charge_id": row["charge_id"],
        "user_id": int(row["user_id"]),
        "amount": int(row["amount"]),
        "currency": row["currency"],
        "status": row["status"],
        "duplicate": False,
    }


async def refund_payment(
    session_factory: async_sessionmaker[AsyncSession],
    api: TelegramPayments,
    *,
    user_id: int,
    charge_id: str,
) -> dict[str, Any]:
    async with session_factory() as session:
        async with session.begin():
            guarded = await session.execute(
                GUARD_REFUND_SQL, {"charge_id": charge_id, "user_id": user_id}
            )
            guard_row = guarded.mappings().first()
            if guard_row is None:
                existing = await session.execute(
                    SELECT_PAYMENT_STATUS_SQL,
                    {"charge_id": charge_id, "user_id": user_id},
                )
                row = existing.mappings().first()
                if row is None:
                    raise PaymentError(
                        "payment_not_found", "no payment for charge " + charge_id
                    )
                return {
                    "refunded": False,
                    "duplicate": True,
                    "amount": int(row["amount"]),
                    "status": row["status"],
                }
            amount = int(guard_row["amount"])
    try:
        await api.refund_star_payment(user_id, charge_id)
    except Exception:
        async with session_factory() as session:
            async with session.begin():
                await session.execute(RESTORE_PAYMENT_SQL, {"charge_id": charge_id})
                await session.execute(
                    INSERT_REFUND_SQL,
                    {
                        "charge_id": charge_id,
                        "user_id": user_id,
                        "amount": amount,
                        "status": "failed",
                    },
                )
        raise
    async with session_factory() as session:
        async with session.begin():
            await session.execute(
                INSERT_REFUND_SQL,
                {
                    "charge_id": charge_id,
                    "user_id": user_id,
                    "amount": amount,
                    "status": "completed",
                },
            )
    return {"refunded": True, "duplicate": False, "amount": amount, "status": "refunded"}


async def cancel_subscription(
    session_factory: async_sessionmaker[AsyncSession],
    api: TelegramPayments,
    *,
    user_id: int,
    charge_id: str,
) -> dict[str, Any]:
    async with session_factory() as session:
        async with session.begin():
            result = await session.execute(
                SELECT_SUBSCRIPTION_SQL,
                {"charge_id": charge_id, "user_id": user_id},
            )
            row = result.mappings().first()
            if row is None:
                raise PaymentError(
                    "subscription_not_found", "no subscription for charge " + charge_id
                )
            if row["canceled_at"] is not None:
                return {"canceled": False, "duplicate": True}
    await api.edit_user_star_subscription(user_id, charge_id, True)
    async with session_factory() as session:
        async with session.begin():
            await session.execute(CANCEL_SUBSCRIPTION_SQL, {"charge_id": charge_id})
    return {"canceled": True, "duplicate": False}


def _field(transaction: Any, name: str, default: Any = None) -> Any:
    if isinstance(transaction, Mapping):
        return transaction.get(name, default)
    return getattr(transaction, name, default)


@dataclass(frozen=True)
class ClassifiedTransaction:
    kind: str
    charge_id: str
    amount: int
    user_id: int | None = None


def classify_star_transaction(transaction: Any) -> ClassifiedTransaction:
    transaction_id = str(_field(transaction, "id", ""))
    amount = int(_field(transaction, "amount", 0) or 0)
    if amount == 0:
        return ClassifiedTransaction(kind="skip", charge_id=transaction_id, amount=0)
    if amount > 0:
        source = _field(transaction, "source")
        user_id = _field(source, "id") if source is not None else None
        if user_id is None:
            return ClassifiedTransaction(
                kind="skip", charge_id=transaction_id, amount=amount
            )
        return ClassifiedTransaction(
            kind="payment", charge_id=transaction_id, amount=amount, user_id=int(user_id)
        )
    transaction_type = _field(transaction, "transaction_type")
    payment_charge_id = _field(transaction_type, "payment_charge_id")
    type_name = _field(transaction_type, "type")
    charge_id = str(payment_charge_id or transaction_id)
    kind = "chargeback" if type_name == "chargeback" else "refund"
    return ClassifiedTransaction(kind=kind, charge_id=charge_id, amount=amount)


async def reconcile_payments(
    session_factory: async_sessionmaker[AsyncSession],
    api: TelegramPayments,
    *,
    offset: int = 0,
    limit: int = 100,
    max_pages: int = 100,
) -> dict[str, int]:
    limit = max(1, min(limit, 100))
    counters = {
        "scanned": 0,
        "inserted": 0,
        "refunded": 0,
        "chargebacks": 0,
        "skipped": 0,
    }
    for _ in range(max_pages):
        transactions = await api.get_star_transactions(offset=offset, limit=limit)
        if not transactions:
            break
        for transaction in transactions:
            counters["scanned"] += 1
            classified = classify_star_transaction(transaction)
            if classified.kind == "skip":
                counters["skipped"] += 1
                continue
            if classified.kind == "payment":
                async with session_factory() as session:
                    async with session.begin():
                        await session.execute(
                            UPSERT_USER_SQL,
                            {
                                "user_id": classified.user_id,
                                "username": None,
                                "display_name": "",
                            },
                        )
                        result = await session.execute(
                            RECONCILE_INSERT_PAYMENT_SQL,
                            {
                                "charge_id": classified.charge_id,
                                "user_id": classified.user_id,
                                "amount": classified.amount,
                                "raw": json.dumps(transaction, default=str),
                            },
                        )
                        if result.first() is not None:
                            counters["inserted"] += 1
                        else:
                            counters["skipped"] += 1
                continue
            status = "chargeback" if classified.kind == "chargeback" else "refunded"
            async with session_factory() as session:
                async with session.begin():
                    result = await session.execute(
                        RECONCILE_MARK_REFUND_SQL,
                        {"charge_id": classified.charge_id, "status": status},
                    )
                    if result.first() is None:
                        counters["skipped"] += 1
                    elif classified.kind == "chargeback":
                        counters["chargebacks"] += 1
                    else:
                        counters["refunded"] += 1
        if len(transactions) < limit:
            break
        offset += len(transactions)
    return counters
`;
}
