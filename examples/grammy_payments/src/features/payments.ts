import type { Bot } from "grammy";
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
        .join("\n"),
    );
  });
}
