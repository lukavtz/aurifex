import { logger } from "../logger.js";
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
