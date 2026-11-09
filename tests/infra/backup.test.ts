import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { QUEUE_SQL } from "../../src/core/projects/templates/queue.ts";
import { PAYMENTS_SQL } from "../../src/core/projects/templates/payments.ts";
import { INFRA_SKIP, POSTGRES_IMAGE, run, startPostgres, type Postgres } from "./pg.ts";

const ENABLED = process.env.AURIFEX_INFRA === "1";
const SCRIPTS = fileURLToPath(new URL("../../scripts", import.meta.url));
const TARGET_DB = "aurifex_restore";

let postgres: Postgres | undefined;
let backupDir: string | undefined;

function database(): Postgres {
  assert.ok(postgres, "postgres must be started");
  return postgres;
}

/** Runs a shell script inside a postgres:18-alpine client container. The
 *  container talks to the server over the host gateway; the server image is
 *  used only because it carries pg_dump/pg_restore 18. */
async function scriptContainer(
  script: string,
  env: Record<string, string>,
  args: readonly string[] = [],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  assert.ok(backupDir, "backup directory must exist");
  return run("docker", [
    "run",
    "--rm",
    "--add-host",
    "host.docker.internal:host-gateway",
    "-v",
    `${SCRIPTS}:/scripts:ro`,
    "-v",
    `${backupDir}:/backups`,
    "-e",
    "HOME=/tmp",
    ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    "--entrypoint",
    "sh",
    POSTGRES_IMAGE,
    `/scripts/${script}`,
    ...args,
  ]);
}

function connectionUrl(port: number, dbName: string): string {
  return `postgres://postgres:aurifex_test@host.docker.internal:${port}/${dbName}`;
}

async function tableCount(dbName: string, table: string): Promise<number> {
  const db = database();
  const result = await run("docker", [
    "exec",
    "-i",
    db.name,
    "psql",
    "-X",
    "-q",
    "-tA",
    "-U",
    "postgres",
    "-d",
    dbName,
    "-c",
    `SELECT count(*) FROM ${table}`,
  ]);
  assert.equal(result.code, 0, result.stderr);
  return Number(result.stdout.trim());
}

before(async () => {
  if (!ENABLED) return;
  postgres = await startPostgres();
  backupDir = await mkdtemp(join(tmpdir(), "aurifex-backup-"));
  // The dump runs in a container as the host uid; make the mounted directory
  // writable regardless of the daemon's uid mapping.
  await chmod(backupDir, 0o777);
});

after(async () => {
  await postgres?.stop();
  if (backupDir !== undefined) await rm(backupDir, { recursive: true, force: true });
});

test(
  "backup and restore round-trip every core table",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 180_000 },
  async () => {
    const db = database();
    await db.exec(PAYMENTS_SQL);
    await db.exec(QUEUE_SQL);
    await db.exec(`
      INSERT INTO users (id, username, display_name) VALUES
        (1, 'first', 'First'), (2, 'second', 'Second');
      INSERT INTO payments (charge_id, user_id, payload, currency, amount, raw) VALUES
        ('charge_1', 1, 'product:premium:user:1:nonce:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'XTR', 100, '{}'),
        ('charge_2', 2, 'product:premium:user:2:nonce:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'XTR', 100, '{}');
      INSERT INTO jobs (kind, payload) VALUES
        ('demo', '{"n":1}'), ('demo', '{"n":2}'), ('demo', '{"n":3}');
    `);

    const expected = {
      users: await tableCount("postgres", "users"),
      payments: await tableCount("postgres", "payments"),
      jobs: await tableCount("postgres", "jobs"),
    };
    assert.deepEqual(expected, { users: 2, payments: 2, jobs: 3 });

    const backup = await scriptContainer("backup-postgres.sh", {
      DATABASE_URL: connectionUrl(db.port, "postgres"),
      BACKUP_DIR: "/backups",
    });
    assert.equal(backup.code, 0, backup.stderr);
    const dumpPath = backup.stdout.trim().split("\n").at(-1) ?? "";
    assert.ok(dumpPath.startsWith("/backups/aurifex-"), `unexpected dump path: ${dumpPath}`);

    const created = await run("docker", [
      "exec",
      "-i",
      db.name,
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-c",
      `CREATE DATABASE ${TARGET_DB}`,
    ]);
    assert.equal(created.code, 0, created.stderr);

    const restore = await scriptContainer(
      "restore-postgres.sh",
      { DATABASE_URL: connectionUrl(db.port, TARGET_DB) },
      [dumpPath, "--confirm"],
    );
    assert.equal(restore.code, 0, restore.stderr);
    const counts: unknown = JSON.parse(restore.stdout.trim());
    assert.deepEqual(counts, expected);

    // The restored charge ids survive the round trip unchanged.
    const chargeIds = await run("docker", [
      "exec",
      "-i",
      db.name,
      "psql",
      "-X",
      "-q",
      "-tA",
      "-U",
      "postgres",
      "-d",
      TARGET_DB,
      "-c",
      "SELECT string_agg(charge_id, ',' ORDER BY charge_id) FROM payments",
    ]);
    assert.equal(chargeIds.code, 0, chargeIds.stderr);
    assert.equal(chargeIds.stdout.trim(), "charge_1,charge_2");
  },
);
