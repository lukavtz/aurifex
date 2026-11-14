import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { QUEUE_SQL, renderQueuePy, renderQueueTs } from "../../src/core/projects/templates/queue.ts";
import {
  createSql,
  INFRA_SKIP,
  run,
  startPostgres,
  startRedis,
  type Postgres,
  type Redis,
  type Sandbox,
  createSandbox,
} from "./pg.ts";

const ENABLED = process.env.AURIFEX_INFRA === "1";

interface Claimed {
  readonly id: string;
  readonly payload: unknown;
  readonly attempts: number;
}

interface Queue {
  enqueue(kind: string, payload: unknown, options?: { idempotencyKey?: string; maxAttempts?: number }): Promise<string>;
  claim(workerId: string): Promise<Claimed | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: unknown): Promise<void>;
  recoverStuck(): Promise<number>;
}

interface QueueModule {
  createQueue(sql: unknown, options?: { visibilityTimeoutSeconds?: number }): Queue;
}

let postgres: Postgres | undefined;
let redis: Redis | undefined;
let sandbox: Sandbox | undefined;
let queueModule: QueueModule | undefined;

function db(): Postgres {
  assert.ok(postgres, "postgres must be started");
  return postgres;
}

function queue(): Queue {
  assert.ok(queueModule, "queue module must be loaded");
  return queueModule.createQueue(createSql(db()));
}

async function status(id: string): Promise<Record<string, unknown> | undefined> {
  return (await db().unsafe("SELECT status, attempts, last_error, locked_by FROM jobs WHERE id = $1", [id]))[0];
}

before(async () => {
  if (!ENABLED) return;
  postgres = await startPostgres();
  redis = await startRedis();
  sandbox = await createSandbox({ "queue.ts": renderQueueTs() });
  queueModule = (await sandbox.import("queue.ts")) as unknown as QueueModule;
});

after(async () => {
  await sandbox?.dispose();
  await postgres?.stop();
  await redis?.stop();
});

beforeEach(async () => {
  if (!ENABLED) return;
  await db().exec("DROP TABLE IF EXISTS jobs;");
  await db().exec(QUEUE_SQL);
});

test(
  "transition: idempotent enqueue returns one row and one id",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const first = await q.enqueue("demo", { n: 1 }, { idempotencyKey: "same" });
    const second = await q.enqueue("demo", { n: 2 }, { idempotencyKey: "same" });
    assert.equal(first, second);
    const rows = await db().unsafe("SELECT count(*) AS total FROM jobs");
    assert.equal(Number(rows[0]?.total), 1);
  },
);

test(
  "transition: concurrent claims are unique",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const ids = [await q.enqueue("demo", { n: 1 }), await q.enqueue("demo", { n: 2 })];
    const claims = await Promise.all([q.claim("w1"), q.claim("w2")]);
    assert.deepEqual(claims.map((claim) => claim?.id).toSorted(), ids.toSorted());
    assert.equal(await q.claim("w3"), null);
  },
);

test(
  "transition: complete leaves no running row",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const id = await q.enqueue("demo", { n: 1 });
    assert.equal((await q.claim("w1"))?.id, id);
    await q.complete(id);
    const row = await status(id);
    assert.notEqual(row?.status, "running");
    const running = await db().unsafe("SELECT count(*) AS total FROM jobs WHERE status = 'running'");
    assert.equal(Number(running[0]?.total), 0);
  },
);

test(
  "transition: first failure schedules backoff",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const id = await q.enqueue("demo", { n: 1 }, { maxAttempts: 2 });
    assert.equal((await q.claim("w1"))?.id, id);
    await q.fail(id, new Error("first"));
    const row = await status(id);
    assert.equal(row?.status, "pending");
    assert.equal(Number(row?.attempts), 1);
  },
);

test(
  "transition: max failures move to dead",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const id = await q.enqueue("demo", { n: 1 }, { maxAttempts: 1 });
    assert.equal((await q.claim("w1"))?.id, id);
    await q.fail(id, new Error("dead"));
    const row = await status(id);
    assert.equal(row?.status, "dead");
    assert.equal(row?.last_error, "dead");
    assert.equal(await q.claim("w2"), null);
  },
);

test(
  "transition: stale running job is recovered and reclaimable",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const id = await q.enqueue("demo", { n: 1 });
    assert.equal((await q.claim("crashed"))?.id, id);
    await db().unsafe("UPDATE jobs SET locked_at = now() - interval '120 seconds' WHERE id = $1", [id]);
    await q.recoverStuck();
    const row = await status(id);
    assert.equal(row?.status, "pending");
    assert.equal(row?.locked_by, null);
    assert.equal((await q.claim("fresh"))?.id, id);
  },
);

test(
  "postgres transaction rollback leaves no partial row",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    await db().exec(
      "BEGIN; INSERT INTO jobs (kind, payload) VALUES ('rollback', '{}'::jsonb); ROLLBACK;",
    );
    const rows = await db().unsafe("SELECT count(*) AS total FROM jobs WHERE kind = 'rollback'");
    assert.equal(Number(rows[0]?.total), 0);
  },
);

test(
  "redis dedupe NX is atomic and TTL-bounded",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const client = redis;
    assert.ok(client, "redis must be started");
    const first = await run("docker", ["exec", client.name, "redis-cli", "SET", "update:1", "1", "NX", "EX", "10"]);
    const second = await run("docker", ["exec", client.name, "redis-cli", "SET", "update:1", "1", "NX", "EX", "10"]);
    assert.equal(first.stdout.trim(), "OK");
    assert.equal(second.stdout.trim(), "");
    const ttl = await run("docker", ["exec", client.name, "redis-cli", "TTL", "update:1"]);
    assert.ok(Number(ttl.stdout.trim()) > 0);
  },
);
// The aiogram stack ships the same state machine in Python over SQLAlchemy
// sessions. The generated module only imports sqlalchemy, so one `uv run`
// provisioned environment can execute it against the same container.
const PY_QUEUE_PROBE = `import asyncio
import json
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.runtime.queue import Queue


async def status(factory, job_id):
    async with factory() as session:
        async with session.begin():
            row = (
                await session.execute(
                    text("SELECT status, attempts, last_error, locked_by FROM jobs WHERE id = :id"),
                    {"id": job_id},
                )
            ).mappings().first()
            return dict(row) if row is not None else None


async def reset(factory):
    async with factory() as session:
        async with session.begin():
            await session.execute(text("DELETE FROM jobs"))


async def main():
    engine = create_async_engine(os.environ["DATABASE_URL"])
    factory = async_sessionmaker(engine, expire_on_commit=False)
    queue = Queue(factory)
    result = {}
    try:
        result["idempotent"] = (
            await queue.enqueue("demo", {"n": 1}, idempotency_key="same")
        ) == (await queue.enqueue("demo", {"n": 2}, idempotency_key="same"))

        claimed = await queue.claim("py-worker")
        result["claimed"] = claimed is not None and claimed.kind == "demo"
        assert claimed is not None
        await queue.complete(claimed.id)
        result["completed"] = (await status(factory, claimed.id))["status"] == "done"
        assert await queue.claim("py-worker") is None

        await reset(factory)
        dead = await queue.enqueue("dead", {}, max_attempts=1)
        first = await queue.claim("py-worker")
        assert first is not None and first.id == dead
        await queue.fail(dead, RuntimeError("boom"))
        row = await status(factory, dead)
        result["dead"] = row["status"] == "dead" and row["last_error"] == "boom"
        result["dead_unclaimed"] = await queue.claim("py-worker") is None

        await reset(factory)
        retry = await queue.enqueue("retry", {}, max_attempts=3)
        failed = await queue.claim("py-worker")
        assert failed is not None and failed.id == retry
        await queue.fail(retry, RuntimeError("first"))
        row = await status(factory, retry)
        result["backoff"] = row["status"] == "pending" and row["attempts"] == 1

        await reset(factory)
        stuck = await queue.enqueue("stuck", {})
        crashed = await queue.claim("crashed")
        assert crashed is not None and crashed.id == stuck
        async with factory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE jobs SET locked_at = now() - interval '120 seconds' WHERE id = :id"),
                    {"id": stuck},
                )
        result["recovered"] = await Queue(factory, visibility_timeout_seconds=60).recover_stuck() == 1
        row = await status(factory, stuck)
        result["recovered_state"] = row["status"] == "pending" and row["locked_by"] is None
        result["reclaimed"] = (await queue.claim("fresh")).id == stuck

        await reset(factory)
        aborted = False
        try:
            async with factory() as session:
                async with session.begin():
                    await session.execute(
                        text("INSERT INTO jobs (kind, payload) VALUES ('rollback', '{}'::jsonb)")
                    )
                    raise RuntimeError("abort")
        except RuntimeError:
            aborted = True
        async with factory() as session:
            async with session.begin():
                total = (
                    await session.execute(
                        text("SELECT count(*) FROM jobs WHERE kind = 'rollback'")
                    )
                ).scalar_one()
        result["rollback"] = aborted and int(total) == 0
    finally:
        await engine.dispose()
    print(json.dumps(result))


asyncio.run(main())
`;

test(
  "aiogram queue transitions run against real postgres with rollback",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 240_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "aurifex-py-queue-"));
    try {
      // ponytail: pinned to the generated project's versions; bump with shared.ts.
      for (const [path, content] of [
        ["app/__init__.py", ""],
        ["app/runtime/__init__.py", ""],
        ["app/runtime/queue.py", renderQueuePy()],
        ["probe.py", PY_QUEUE_PROBE],
      ] as const) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), content);
      }
      const database = `postgresql+asyncpg://postgres:aurifex_test@127.0.0.1:${db().port}/postgres`;
      const executed = await run(
        "uv",
        [
          "run",
          "--no-project",
          "--quiet",
          "--with",
          "sqlalchemy[asyncio]==2.1.8",
          "--with",
          "asyncpg==0.32.0",
          "python",
          "probe.py",
        ],
        { cwd: dir, env: { DATABASE_URL: database }, timeoutMs: 180_000 },
      );
      assert.equal(executed.code, 0, executed.stdout + executed.stderr);
      const report = JSON.parse(executed.stdout.trim().split("\n").at(-1) ?? "{}") as Record<string, boolean>;
      assert.deepEqual(report, {
        idempotent: true,
        claimed: true,
        completed: true,
        dead: true,
        dead_unclaimed: true,
        backoff: true,
        recovered: true,
        recovered_state: true,
        reclaimed: true,
        rollback: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
