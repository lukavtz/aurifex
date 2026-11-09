import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { QUEUE_SQL, renderQueueTs } from "../../src/core/projects/templates/queue.ts";
import {
  createSandbox,
  createSql,
  INFRA_SKIP,
  startPostgres,
  type Postgres,
  type Sandbox,
} from "./pg.ts";

const ENABLED = process.env.AURIFEX_INFRA === "1";

interface ClaimedJob {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly maxAttempts: number;
}

interface EnqueueOptions {
  readonly idempotencyKey?: string;
  readonly runAt?: Date;
  readonly maxAttempts?: number;
}

interface Queue {
  enqueue(kind: string, payload: unknown, options?: EnqueueOptions): Promise<string>;
  claim(workerId: string): Promise<ClaimedJob | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: unknown): Promise<void>;
  recoverStuck(): Promise<number>;
}

interface QueueModule {
  createQueue(sql: unknown, options?: { visibilityTimeoutSeconds?: number }): Queue;
}

let postgres: Postgres | undefined;
let sandbox: Sandbox | undefined;
let queueModule: QueueModule | undefined;

function database(): Postgres {
  assert.ok(postgres, "postgres must be started");
  return postgres;
}

function queue(): Queue {
  assert.ok(queueModule, "queue module must be loaded");
  return queueModule.createQueue(createSql(database()));
}

async function status(id: string): Promise<Record<string, unknown> | undefined> {
  const rows = await database().unsafe(
    "SELECT status, attempts, last_error, locked_by FROM jobs WHERE id = $1",
    [id],
  );
  return rows[0];
}

before(async () => {
  if (!ENABLED) return;
  postgres = await startPostgres();
  sandbox = await createSandbox({ "queue.ts": renderQueueTs() });
  queueModule = (await sandbox.import("queue.ts")) as unknown as QueueModule;
});

after(async () => {
  await sandbox?.dispose();
  await postgres?.stop();
});

beforeEach(async () => {
  if (!ENABLED) return;
  const db = database();
  await db.exec("DROP TABLE IF EXISTS jobs;");
  await db.exec(QUEUE_SQL);
});

test(
  "enqueue is idempotent per idempotency key",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const first = await q.enqueue("demo", { n: 1 }, { idempotencyKey: "k1" });
    const second = await q.enqueue("demo", { n: 2 }, { idempotencyKey: "k1" });
    assert.equal(first, second);

    const rows = await database().unsafe("SELECT count(*) AS total FROM jobs");
    assert.equal(Number(rows[0]?.total), 1);

    const claim = await q.claim("w1");
    assert.equal(claim?.id, first);
    assert.deepEqual(claim?.payload, { n: 1 });
  },
);

test(
  "two concurrent claims never return the same job",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const first = await q.enqueue("demo", { n: 1 });
    const second = await q.enqueue("demo", { n: 2 });

    const [a, b] = await Promise.all([q.claim("w1"), q.claim("w2")]);
    const ids = [a?.id, b?.id].toSorted();
    assert.deepEqual(ids, [first, second].toSorted());

    const running = await database().unsafe(
      "SELECT count(*) AS total FROM jobs WHERE status = 'running'",
    );
    assert.equal(Number(running[0]?.total), 2);
    assert.equal(await q.claim("w3"), null);
  },
);

test(
  "a job that keeps failing becomes dead after max attempts",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const id = await q.enqueue("demo", { n: 1 }, { maxAttempts: 2 });

    const firstClaim = await q.claim("w1");
    assert.equal(firstClaim?.id, id);
    await q.fail(id, new Error("boom"));
    const retrying = await status(id);
    assert.equal(retrying?.status, "pending");
    assert.equal(Number(retrying?.attempts), 1);

    // Backoff is 10 s after the first attempt; rewind it to claim immediately.
    await database().unsafe("UPDATE jobs SET run_at = now() WHERE id = $1", [id]);
    const secondClaim = await q.claim("w1");
    assert.equal(secondClaim?.id, id);
    await q.fail(id, new Error("boom again"));

    const dead = await status(id);
    assert.equal(dead?.status, "dead");
    assert.equal(Number(dead?.attempts), 2);
    assert.equal(dead?.last_error, "boom again");
    assert.equal(await q.claim("w1"), null);
  },
);

test(
  "recoverStuck returns an abandoned running job to pending",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const id = await q.enqueue("demo", { n: 1 });
    const claimed = await q.claim("crashed-worker");
    assert.equal(claimed?.id, id);
    await database().unsafe(
      "UPDATE jobs SET locked_at = now() - interval '120 seconds' WHERE id = $1",
      [id],
    );

    await q.recoverStuck();
    const recovered = await status(id);
    assert.equal(recovered?.status, "pending");
    assert.equal(recovered?.locked_by, null);

    const reclaimed = await q.claim("fresh-worker");
    assert.equal(reclaimed?.id, id);
  },
);

test(
  "complete leaves no orphaned running row",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    const q = queue();
    const id = await q.enqueue("demo", { n: 1 });
    const claimed = await q.claim("w1");
    assert.equal(claimed?.id, id);
    await q.complete(id);

    const done = await status(id);
    assert.equal(done?.status, "done");
    assert.equal(done?.locked_by, null);

    const running = await database().unsafe(
      "SELECT count(*) AS total FROM jobs WHERE status = 'running'",
    );
    assert.equal(Number(running[0]?.total), 0);
  },
);
