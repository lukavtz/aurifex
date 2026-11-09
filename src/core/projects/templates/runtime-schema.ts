// Combined runtime schema shared by both stacks.
//
// `PAYMENTS_SQL` and `QUEUE_SQL` are the single sources of truth for their
// tables; this module adds the broadcast tables and renders the matching
// Drizzle schema, SQLAlchemy models, and migration files. Every render is a
// pure string function: no timestamps, random values, or environment reads.

import type { BotSpec } from "../../spec/bot-spec.ts";
import { BROADCAST_SQL } from "./jobs.ts";
import { PAYMENTS_SQL } from "./payments.ts";
import { QUEUE_SQL } from "./queue.ts";

export { BROADCAST_SQL };


/** Drizzle schema mirroring `PAYMENTS_SQL`, `QUEUE_SQL`, and `BROADCAST_SQL`. */
export function renderSchemaTs(_spec: BotSpec): string {
  return `import {
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
    check("payments_status_check", sql\`\${table.status} in ('paid','refunded','chargeback')\`),
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
    check("refunds_status_check", sql\`\${table.status} in ('requested','completed','failed')\`),
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
    check("jobs_status_check", sql\`\${table.status} in ('pending','running','done','dead')\`),
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
    check(
      "broadcasts_status_check",
      sql\`\${table.status} in ('pending','running','done','failed')\`,
    ),
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
    check("broadcast_deliveries_status_check", sql\`\${table.status} in ('sent','failed')\`),
  ],
);
`;
}

/** SQLAlchemy 2.x models mirroring the same tables column for column. */
export function renderSchemaPy(_spec: BotSpec): string {
  return `from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    PrimaryKeyConstraint,
    Text,
    Uuid,
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str | None] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=""
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('paid','refunded','chargeback')",
            name="payments_status_check",
        ),
    )

    charge_id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    currency: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="paid"
    )
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
    raw: Mapped[dict[str, object]] = mapped_column(postgresql.JSONB, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class Refund(Base):
    __tablename__ = "refunds"
    __table_args__ = (
        CheckConstraint(
            "status IN ('requested','completed','failed')",
            name="refunds_status_check",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    charge_id: Mapped[str] = mapped_column(
        Text, ForeignKey("payments.charge_id"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
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


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','done','dead')",
            name="jobs_status_check",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(postgresql.JSONB, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="pending"
    )
    idempotency_key: Mapped[str | None] = mapped_column(Text, unique=True)
    run_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    max_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="5"
    )
    locked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(Text)
    last_error: Mapped[str | None] = mapped_column(Text)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class Broadcast(Base):
    __tablename__ = "broadcasts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','done','failed')",
            name="broadcasts_status_check",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="pending"
    )
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False)
    last_user_id: Mapped[int | None] = mapped_column(BigInteger)
    sent: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    failed: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class BroadcastDelivery(Base):
    __tablename__ = "broadcast_deliveries"
    __table_args__ = (
        PrimaryKeyConstraint("broadcast_id", "chat_id"),
        CheckConstraint(
            "status IN ('pending','sent','failed')",
            name="broadcast_deliveries_status_check",
        ),
    )

    broadcast_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("broadcasts.id", ondelete="CASCADE"), nullable=False
    )
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
`;
}

/** Full schema SQL for the Drizzle migration. */
export function renderDrizzleMigration(): string {
  return `${PAYMENTS_SQL}${QUEUE_SQL}${BROADCAST_SQL}`;
}

/** Full Alembic migration creating the same tables and indexes. */
export function renderAlembicMigration(): string {
  return `"""runtime schema

Revision ID: 0001_runtime_schema
Revises:
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_runtime_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("username", sa.Text(), nullable=True),
        sa.Column(
            "display_name", sa.Text(), nullable=False, server_default=""
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_table(
        "payments",
        sa.Column("charge_id", sa.Text(), primary_key=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column(
            "status", sa.Text(), nullable=False, server_default="paid"
        ),
        sa.Column(
            "is_recurring",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.Column(
            "is_first_recurring",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.Column(
            "subscription_expiration_date",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column("provider_charge_id", sa.Text(), nullable=True),
        sa.Column("raw", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('paid','refunded','chargeback')",
            name="payments_status_check",
        ),
    )
    op.create_table(
        "refunds",
        sa.Column(
            "id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "charge_id",
            sa.Text(),
            sa.ForeignKey("payments.charge_id"),
            nullable=False,
        ),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('requested','completed','failed')",
            name="refunds_status_check",
        ),
    )
    op.create_table(
        "subscriptions",
        sa.Column(
            "charge_id",
            sa.Text(),
            sa.ForeignKey("payments.charge_id"),
            primary_key=True,
        ),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("period_seconds", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "jobs",
        sa.Column(
            "id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "status", sa.Text(), nullable=False, server_default="pending"
        ),
        sa.Column("idempotency_key", sa.Text(), nullable=True, unique=True),
        sa.Column(
            "run_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "attempts", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "max_attempts", sa.Integer(), nullable=False, server_default="5"
        ),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.Text(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('pending','running','done','dead')",
            name="jobs_status_check",
        ),
    )
    op.create_table(
        "broadcasts",
        sa.Column(
            "id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "status", sa.Text(), nullable=False, server_default="pending"
        ),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "last_user_id",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "sent", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "failed", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending','running','done','failed')",
            name="broadcasts_status_check",
        ),
    )
    op.create_table(
        "broadcast_deliveries",
        sa.Column(
            "broadcast_id",
            sa.Uuid(),
            sa.ForeignKey("broadcasts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("broadcast_id", "chat_id"),
        sa.CheckConstraint(
            "status IN ('pending','sent','failed')",
            name="broadcast_deliveries_status_check",
        ),
    )
    op.create_index("jobs_ready_idx", "jobs", ["status", "run_at"])
    op.create_index("broadcasts_status_idx", "broadcasts", ["status", "created_at"])
    op.create_index("broadcast_deliveries_chat_idx", "broadcast_deliveries", ["chat_id"])


def downgrade() -> None:
    op.drop_index("broadcast_deliveries_chat_idx", table_name="broadcast_deliveries")
    op.drop_index("broadcasts_status_idx", table_name="broadcasts")
    op.drop_index("jobs_ready_idx", table_name="jobs")
    op.drop_table("broadcast_deliveries")
    op.drop_table("broadcasts")
    op.drop_table("jobs")
    op.drop_table("subscriptions")
    op.drop_table("refunds")
    op.drop_table("payments")
    op.drop_table("users")
`;
}