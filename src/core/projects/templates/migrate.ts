// One-shot migration runner. It applies the checked-in SQL instead of calling
// drizzle-kit inside the production image, so the deploy needs no dev deps.
// A migration row plus an advisory lock make repeated runs a no-op.

export const QUEUE_MIGRATION_FILE = "drizzle/0001_runtime_schema.sql";
export const QUEUE_MIGRATION_NAME = "0001_runtime_schema";

export function renderMigrateTs(): string {
  return `import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { logger } from "./logger.js";
import { readSecret } from "./runtime/secrets.js";

const MIGRATION_NAME = "${QUEUE_MIGRATION_NAME}";
const MIGRATION_PATH = join(import.meta.dirname, "..", "drizzle", \`\${MIGRATION_NAME}.sql\`);

async function main(): Promise<void> {
  const databaseUrl = readSecret("DATABASE_URL");
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required to run migrations");
  }
  const statement = readFileSync(MIGRATION_PATH, "utf8");
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      // ponytail: one advisory lock for the single jobs migration; give each
      // migration its own key when there is more than one.
      await tx.unsafe("SELECT pg_advisory_xact_lock(9100000001)");
      await tx.unsafe(\`CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)\`);
      const applied = await tx.unsafe<{ name: string }[]>(
        "SELECT name FROM schema_migrations WHERE name = $1",
        [MIGRATION_NAME],
      );
      if (applied.length > 0) {
        logger.info({ migration: MIGRATION_NAME }, "migration already applied");
        return;
      }
      await tx.unsafe(statement);
      await tx.unsafe("INSERT INTO schema_migrations (name) VALUES ($1)", [MIGRATION_NAME]);
      logger.info({ migration: MIGRATION_NAME }, "migration applied");
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  logger.error(
    { message: error instanceof Error ? error.message : "unknown" },
    "migration failed",
  );
  process.exitCode = 1;
});
`;
}