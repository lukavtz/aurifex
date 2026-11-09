import { randomUUID } from "node:crypto";
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
export const PRODUCTS: readonly PaymentProduct[] = [
  {
    id: "support",
    title: "Support",
    description: "Support the bot",
    stars: 1,
    subscription: false,
  },
];

const PRODUCT_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const NONCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAYLOAD_RE =
  /^product:([a-z][a-z0-9_]{1,31}):user:(\d{1,20}):nonce:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

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
  editUserStarSubscription(userId: number, chargeId: string, canceled: boolean): Promise<unknown>;
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
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface InvoiceResult {
  readonly payload: string;
  readonly invoiceLink?: string;
}

export interface ParsedPayload {
  readonly product: PaymentProduct;
  readonly userId: number;
  readonly nonce: string;
}

export function invoicePayload(productId: string, userId: number, nonce: string): string {
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
  enqueue(kind: string, payload: unknown, options?: { idempotencyKey?: string }): Promise<string>;
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
  return lines.join("\n");
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

const RESTORE_PAYMENT_SQL = sqlLines("UPDATE payments SET status = 'paid' WHERE charge_id = $1;");

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
      throw new PaymentError("payment_not_found", "no payment for charge " + input.chargeId);
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
    await sql.unsafe(INSERT_REFUND_SQL, [input.chargeId, input.userId, amount, "failed"]);
    throw error;
  }
  await sql.unsafe(INSERT_REFUND_SQL, [input.chargeId, input.userId, amount, "completed"]);
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
