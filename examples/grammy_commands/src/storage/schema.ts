import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  username: text("username"),
  displayName: text("display_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable(
  "payments",
  {
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
    subscriptionExpirationDate: timestamp("subscription_expiration_date", {
      withTimezone: true,
    }),
    providerChargeId: text("provider_charge_id"),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("payments_status_check", sql`${table.status} in ('paid','refunded','chargeback')`),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chargeId: text("charge_id")
      .notNull()
      .references(() => payments.chargeId),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    amount: integer("amount").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("refunds_status_check", sql`${table.status} in ('requested','completed','failed')`),
  ],
);

export const subscriptions = pgTable("subscriptions", {
  chargeId: text("charge_id")
    .primaryKey()
    .references(() => payments.chargeId),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  periodSeconds: integer("period_seconds").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").unique(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("jobs_status_check", sql`${table.status} in ('pending','running','done','dead')`),
    index("jobs_ready_idx").on(table.status, table.runAt),
  ],
);

export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    text: text("text").notNull(),
    status: text("status").notNull().default("pending"),
    createdBy: bigint("created_by", { mode: "number" }).notNull(),
    lastUserId: bigint("last_user_id", { mode: "number" }),
    sent: integer("sent").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    check("broadcasts_status_check", sql`${table.status} in ('pending','running','done','failed')`),
  ],
);

export const broadcastDeliveries = pgTable(
  "broadcast_deliveries",
  {
    broadcastId: uuid("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    status: text("status").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.broadcastId, table.chatId] }),
    check("broadcast_deliveries_status_check", sql`${table.status} in ('sent','failed')`),
  ],
);
