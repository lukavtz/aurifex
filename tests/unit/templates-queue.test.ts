import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  QUEUE_SQL,
  renderQueuePy,
  renderQueueTs,
  renderWorkerPy,
  renderWorkerTs,
} from "../../src/core/projects/templates/queue.ts";

const CLAIM_CTE = `WITH next AS (
  SELECT id FROM jobs
  WHERE status = 'pending' AND run_at <= now()
  ORDER BY run_at, id
  FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE jobs j SET status = 'running', locked_at = now(), locked_by = $1,
  attempts = j.attempts + 1
FROM next WHERE j.id = next.id
RETURNING j.id, j.kind, j.payload, j.attempts, j.max_attempts;`;

describe("QUEUE_SQL", () => {
  it("creates the jobs table with every required column", () => {
    for (const column of [
      "id uuid PRIMARY KEY DEFAULT gen_random_uuid()",
      "kind text NOT NULL",
      "payload jsonb NOT NULL",
      "status text NOT NULL DEFAULT 'pending'",
      "idempotency_key text UNIQUE",
      "run_at timestamptz NOT NULL DEFAULT now()",
      "attempts integer NOT NULL DEFAULT 0",
      "max_attempts integer NOT NULL DEFAULT 5",
      "locked_at timestamptz",
      "locked_by text",
      "last_error text",
      "finished_at timestamptz",
      "created_at timestamptz NOT NULL DEFAULT now()",
    ]) {
      assert.ok(QUEUE_SQL.includes(column), `missing column: ${column}`);
    }
  });

  it("constrains status to the four queue states", () => {
    assert.match(QUEUE_SQL, /CHECK \(status IN \('pending','running','done','dead'\)\)/);
  });

  it("indexes ready jobs by status and run_at", () => {
    assert.ok(QUEUE_SQL.includes("CREATE INDEX jobs_ready_idx ON jobs (status, run_at);"));
  });
});

describe("renderQueueTs", () => {
  const source = renderQueueTs();

  it("renders deterministically", () => {
    assert.equal(source, renderQueueTs());
  });

  it("imports the postgres Sql type", () => {
    assert.ok(source.includes('import type { Sql } from "postgres";'));
    assert.ok(source.includes("export function createQueue(sql: Sql, options: QueueOptions = {}): Queue"));
  });

  it("implements the full Queue interface", () => {
    assert.ok(source.includes("enqueue(kind: string, payload: unknown, options?: EnqueueOptions): Promise<string>;"));
    assert.ok(source.includes("claim(workerId: string): Promise<ClaimedJob | null>;"));
    assert.ok(source.includes("complete(id: string): Promise<void>;"));
    assert.ok(source.includes("fail(id: string, error: unknown): Promise<void>;"));
    assert.ok(source.includes("recoverStuck(): Promise<number>;"));
  });

  it("claims with the approved FOR UPDATE SKIP LOCKED CTE", () => {
    assert.ok(source.includes(CLAIM_CTE), "claim CTE must match the plan exactly");
  });

  it("claims exactly one row so concurrent claims orphan no running jobs", () => {
    assert.ok(source.includes("FOR UPDATE SKIP LOCKED LIMIT 1"));
    assert.ok(source.includes("sql.unsafe(CLAIM_SQL, [workerId])"));
    assert.ok(!source.includes("LIMIT $2"), "claim must not take a batch parameter");
    assert.ok(!source.includes("batch"), "generated queue must not expose a batch option");
    assert.ok(!source.includes("QUEUE_BATCH"));
  });

  it("enqueues idempotently and falls back to the existing row id", () => {
    assert.ok(
      source.includes(`VALUES ($1, $2::jsonb, $3, COALESCE($4::timestamptz, now()), COALESCE($5::integer, 5))`),
    );
    assert.ok(source.includes("ON CONFLICT (idempotency_key) DO NOTHING"));
    assert.ok(source.includes("RETURNING id;"));
    assert.ok(source.includes("SELECT id FROM jobs WHERE idempotency_key = $1;"));
  });

  it("moves to dead at max attempts and backs off otherwise", () => {
    assert.ok(
      source.includes("status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END"),
    );
    assert.ok(source.includes("least(300, 5 * power(2, attempts))"));
    assert.ok(source.includes("finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END"));
  });

  it("clips stored errors to 2 KiB", () => {
    assert.ok(source.includes("subarray(0, 2048)"));
  });

  it("recovers stale running jobs using the visibility timeout", () => {
    assert.ok(source.includes("make_interval(secs => $1)"));
    assert.ok(source.includes("visibilityTimeoutSeconds = options.visibilityTimeoutSeconds ?? 60"));
  });

  it("never interpolates values into SQL", () => {
    assert.ok(!source.includes("${"), "generated queue code must not contain template interpolation");
    const calls = source.match(/sql\.unsafe\(/g) ?? [];
    const parameterized = source.match(/sql\.unsafe\([A-Za-z_][A-Za-z0-9_]*,/g) ?? [];
    assert.ok(calls.length >= 6, `expected at least 6 sql.unsafe calls, got ${calls.length}`);
    assert.equal(parameterized.length, calls.length, "every sql.unsafe call must use a SQL constant");
  });
});

describe("renderWorkerTs", () => {
  const source = renderWorkerTs();

  it("renders deterministically", () => {
    assert.equal(source, renderWorkerTs());
  });

  it("exposes runWorker over a typed handler map and AbortSignal", () => {
    assert.ok(source.includes("export type JobHandler = (job: ClaimedJob, signal: AbortSignal) => Promise<void>;"));
    assert.ok(source.includes("handlers: Readonly<Record<string, JobHandler>>"));
    assert.ok(source.includes("signal: AbortSignal,"));
  });

  it("recovers before polling and runs five concurrent loops", () => {
    assert.ok(source.includes("const CONCURRENCY = 5;"));
    const recovered = source.indexOf("await queue.recoverStuck();");
    const started = source.indexOf("await Promise.all(Array.from({ length: CONCURRENCY }, loop));");
    assert.ok(recovered > -1 && started > recovered, "recoverStuck must run before the loops");
  });

  it("completes and fails claimed jobs", () => {
    assert.ok(source.includes("await queue.complete(job.id);"));
    assert.ok(source.includes("await queue.fail(job.id, error);"));
  });

  it("polls on idle and wakes on abort", () => {
    assert.ok(source.includes('envInt("QUEUE_POLL_MS", 500)'));
    assert.ok(!source.includes("QUEUE_BATCH"), "worker must not read a batch size");
    assert.ok(source.includes("await sleep(pollMs, signal);"));
    assert.ok(source.includes("while (!signal.aborted)"));
    assert.ok(source.includes('signal.addEventListener("abort", finish, { once: true });'));
  });

  it("never interpolates strings into the log or SQL text", () => {
    assert.ok(!source.includes("${"));
  });
});

describe("renderQueuePy", () => {
  const source = renderQueuePy();

  it("renders deterministically", () => {
    assert.equal(source, renderQueuePy());
  });

  it("uses SQLAlchemy text() for every statement", () => {
    const constants = source.match(/= text\(/g) ?? [];
    assert.equal(constants.length, 6);
    assert.ok(source.includes("from sqlalchemy import text"));
  });

  it("claims with the same CTE contract", () => {
    assert.ok(source.includes("FOR UPDATE SKIP LOCKED LIMIT 1"));
    assert.ok(!source.includes(":batch"), "claim must not take a batch parameter");
    assert.ok(!source.includes("self._batch"));
    assert.ok(source.includes("locked_by = :worker_id"));
    assert.ok(source.includes("attempts = j.attempts + 1"));
  });

  it("enqueues idempotently and fails into dead with backoff", () => {
    assert.ok(source.includes("ON CONFLICT (idempotency_key) DO NOTHING"));
    assert.ok(source.includes("least(300, 5 * power(2, attempts))"));
    assert.ok(source.includes("THEN 'dead' ELSE 'pending'"));
    assert.ok(source.includes("make_interval(secs => :visibility_timeout)"));
  });

  it("exposes every queue method on the Queue class", () => {
    for (const method of ["enqueue", "claim", "complete", "fail", "recover_stuck"]) {
      assert.ok(source.includes(`async def ${method}(`), `missing Queue.${method}`);
    }
  });

  it("clips errors to 2 KiB", () => {
    assert.ok(source.includes('encode("utf-8")[:2048]'));
  });

  it("never interpolates values into SQL", () => {
    assert.ok(!source.includes('text(f"'));
    assert.ok(!source.includes("text(f'"));
  });
});

describe("renderWorkerPy", () => {
  const source = renderWorkerPy();

  it("renders deterministically", () => {
    assert.equal(source, renderWorkerPy());
  });

  it("recovers on start and bounds concurrency with a semaphore", () => {
    assert.ok(source.includes("await queue.recover_stuck()"));
    assert.ok(source.includes("asyncio.Semaphore(concurrency)"));
    assert.ok(source.includes("async def run_worker("));
  });

  it("completes and fails claimed jobs without leaking tasks", () => {
    assert.ok(source.includes("await queue.complete(job.id)"));
    assert.ok(source.includes("await queue.fail(job.id, error)"));
    assert.ok(source.includes("asyncio.create_task(run_job(job))"));
    assert.ok(source.includes("return_exceptions=True"));
  });

  it("wakes from the poll loop on shutdown", () => {
    assert.ok(source.includes("stop: asyncio.Event"));
    assert.ok(source.includes("while not stop.is_set():"));
    assert.ok(source.includes("asyncio.wait_for(stop.wait(), timeout=seconds)"));
  });
});