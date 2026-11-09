import { logger } from "../logger.js";
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
