import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import { PAYMENTS_SQL } from "../../src/core/projects/templates/payments.ts";
import { QUEUE_SQL } from "../../src/core/projects/templates/queue.ts";
import {
  BROADCAST_SQL,
  renderAlembicMigration,
  renderDrizzleMigration,
  renderSchemaPy,
  renderSchemaTs,
} from "../../src/core/projects/templates/runtime-schema.ts";

const SPEC: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "schema_bot",
  displayName: "Schema Bot",
  stack: "grammy",
  features: ["commands", "payments", "broadcast"],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: {
    webhookSecret: true,
    adminAllowlist: true,
    rateLimit: true,
    idempotency: true,
  },
  runtime: {
    queue: "postgres",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

const TABLES = [
  "users",
  "payments",
  "refunds",
  "subscriptions",
  "jobs",
  "broadcasts",
  "broadcast_deliveries",
] as const;

describe("runtime schema SQL", () => {
  it("reuses the payments and queue schema verbatim and adds broadcasts", () => {
    assert.equal(renderDrizzleMigration(), `${PAYMENTS_SQL}${QUEUE_SQL}${BROADCAST_SQL}`);
    assert.equal(
      renderDrizzleMigration(),
      renderDrizzleMigration(),
      "render must be deterministic",
    );
  });

  it("creates every table and index", () => {
    const sql = renderDrizzleMigration();
    for (const table of TABLES) {
      assert.ok(sql.includes(`CREATE TABLE ${table} (`), `missing table: ${table}`);
    }
    assert.ok(sql.includes("CREATE INDEX jobs_ready_idx ON jobs (status, run_at);"));
  });

  it("enforces the approved keys and checks", () => {
    const sql = renderDrizzleMigration();
    assert.ok(sql.includes("charge_id text PRIMARY KEY"));
    assert.ok(sql.includes("REFERENCES users(id)"));
    assert.ok(sql.includes("REFERENCES payments(charge_id)"));
    assert.ok(sql.includes("REFERENCES broadcasts(id)"));
    assert.ok(sql.includes("idempotency_key text UNIQUE"));
    assert.ok(sql.includes("PRIMARY KEY (broadcast_id, chat_id)"));
    assert.match(sql, /CHECK \(status IN \('paid','refunded','chargeback'\)\)/);
    assert.match(sql, /CHECK \(status IN \('requested','completed','failed'\)\)/);
    assert.match(sql, /CHECK \(status IN \('pending','running','done','dead'\)\)/);
    assert.equal(sql.includes("CREATE EXTENSION"), false, "schema must not install extensions");
  });
});

describe("renderSchemaTs", () => {
  const source = renderSchemaTs(SPEC);

  it("renders deterministically", () => {
    assert.equal(source, renderSchemaTs(SPEC));
  });

  it("declares every table", () => {
    for (const table of TABLES) {
      const exported = table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      assert.ok(
        source.includes(`pgTable("${table}"`) || source.includes(`pgTable(\n  "${table}"`),
        `missing pgTable: ${table} (${exported})`,
      );
    }
  });

  it("uses the required drizzle column types and defaults", () => {
    assert.ok(source.includes('bigint("id", { mode: "number" })'));
    assert.ok(source.includes('jsonb("payload").notNull()'));
    assert.ok(source.includes('boolean("is_recurring").notNull().default(false)'));
    assert.ok(source.includes('integer("amount").notNull()'));
    assert.ok(source.includes('text("charge_id").primaryKey()'));
    assert.ok(
      source.includes('timestamp("created_at", { withTimezone: true }).notNull().defaultNow()'),
    );
    assert.ok(source.includes('text("status").notNull().default("paid")'));
    assert.ok(source.includes('text("idempotency_key").unique()'));
    assert.ok(source.includes('uuid("id").primaryKey().defaultRandom()'));
  });

  it("wires foreign keys, the composite primary key, and the jobs index", () => {
    assert.ok(source.includes(".references(() => users.id)"));
    assert.ok(source.includes(".references(() => payments.chargeId)"));
    assert.ok(source.includes('.references(() => broadcasts.id, { onDelete: "cascade" })'));
    assert.ok(source.includes("primaryKey({ columns: [table.broadcastId, table.chatId] })"));
    assert.ok(source.includes('index("jobs_ready_idx").on(table.status, table.runAt)'));
  });

  it("keeps status checks in the schema module", () => {
    for (const name of [
      "payments_status_check",
      "refunds_status_check",
      "jobs_status_check",
      "broadcasts_status_check",
      "broadcast_deliveries_status_check",
    ]) {
      assert.ok(source.includes(`"${name}"`), `missing check: ${name}`);
    }
  });
});

describe("renderSchemaPy", () => {
  const source = renderSchemaPy(SPEC);

  it("renders deterministically", () => {
    assert.equal(source, renderSchemaPy(SPEC));
  });

  it("declares a SQLAlchemy model per table", () => {
    for (const table of TABLES) {
      assert.ok(source.includes(`__tablename__ = "${table}"`), `missing ${table}`);
    }
    for (const column of [
      "id",
      "username",
      "display_name",
      "created_at",
      "updated_at",
      "charge_id",
      "user_id",
      "payload",
      "currency",
      "amount",
      "status",
      "is_recurring",
      "is_first_recurring",
      "subscription_expiration_date",
      "provider_charge_id",
      "raw",
      "period_seconds",
      "expires_at",
      "canceled_at",
      "kind",
      "idempotency_key",
      "run_at",
      "attempts",
      "max_attempts",
      "locked_at",
      "locked_by",
      "last_error",
      "finished_at",
      "text",
      "created_by",
      "last_user_id",
      "sent",
      "failed",
      "broadcast_id",
      "chat_id",
      "error",
      "sent_at",
    ]) {
      assert.ok(source.includes(`${column}: Mapped[`), `missing column: ${column}`);
    }
  });

  it("uses SQLAlchemy 2.x mapped types", () => {
    for (const fragment of [
      "Mapped[int] = mapped_column(BigInteger",
      "Mapped[str | None] = mapped_column(Text",
      "Mapped[dict[str, object]] = mapped_column(postgresql.JSONB",
      "DateTime(timezone=True)",
      "Uuid(as_uuid=False)",
      "Mapped[bool] = mapped_column(",
      "mapped_column(Integer",
      'ForeignKey("users.id")',
      'ForeignKey("payments.charge_id")',
      'ForeignKey("broadcasts.id", ondelete="CASCADE")',
      'PrimaryKeyConstraint("broadcast_id", "chat_id")',
      'text("gen_random_uuid()")',
    ]) {
      assert.ok(source.includes(fragment), `missing: ${fragment}`);
    }
  });
});

describe("renderAlembicMigration", () => {
  const source = renderAlembicMigration();

  it("renders deterministically", () => {
    assert.equal(source, renderAlembicMigration());
  });

  it("creates every table with op.create_table", () => {
    assert.equal(source.match(/op\.create_table\(/g)?.length, TABLES.length);
    for (const table of TABLES) {
      assert.ok(source.includes(`op.create_table(\n        "${table}"`), `missing ${table}`);
    }
    assert.ok(source.includes('op.create_index("jobs_ready_idx", "jobs", ["status", "run_at"])'));
  });

  it("uses gen_random_uuid() only through sa.text", () => {
    assert.equal(source.match(/sa\.text\("gen_random_uuid\(\)"\)/g)?.length, 3);
    assert.ok(!source.includes("server_default=gen_random_uuid"));
  });

  it("mirrors keys, foreign keys, and checks", () => {
    for (const fragment of [
      'sa.ForeignKey("users.id")',
      'sa.ForeignKey("payments.charge_id")',
      'sa.ForeignKey("broadcasts.id", ondelete="CASCADE")',
      'sa.PrimaryKeyConstraint("broadcast_id", "chat_id")',
      "unique=True",
      "payments_status_check",
      "refunds_status_check",
      "jobs_status_check",
      "broadcasts_status_check",
      "broadcast_deliveries_status_check",
      'sa.ForeignKey("broadcasts.id", ondelete="CASCADE")',
      'sa.Column("raw", postgresql.JSONB(), nullable=False)',
      "sa.Uuid()",
    ]) {
      assert.ok(source.includes(fragment), `missing: ${fragment}`);
    }
  });

  it("drops everything in reverse order and needs no extension", () => {
    const downgrade = source.slice(source.indexOf("def downgrade"));
    assert.ok(downgrade.includes('op.drop_table("broadcast_deliveries")'));
    assert.ok(downgrade.includes('op.drop_table("users")'));
    assert.equal(source.includes("CREATE EXTENSION"), false);
  });
});

describe("schema contract roundtrip", () => {
  it("names every table in all four renderings", () => {
    const renderings = [
      renderDrizzleMigration(),
      renderSchemaTs(SPEC),
      renderSchemaPy(SPEC),
      renderAlembicMigration(),
    ];
    for (const table of TABLES) {
      for (const rendering of renderings) {
        assert.ok(rendering.includes(table), `rendering missing ${table}`);
      }
    }
  });
});
