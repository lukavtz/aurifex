// Generated queue and worker sources shared by both stacks. The SQL here is
// emitted verbatim into the generated migrations and runtime modules; every
// runtime query is parameterized, never interpolated.

export const QUEUE_SQL = `CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','dead')),
  idempotency_key text UNIQUE,
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs (status, run_at);
`;

const ENQUEUE_SQL = `INSERT INTO jobs (kind, payload, idempotency_key, run_at, max_attempts)
VALUES ($1, $2::jsonb, $3, COALESCE($4::timestamptz, now()), COALESCE($5::integer, 5))
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;`;

const SELECT_ID_SQL = `SELECT id FROM jobs WHERE idempotency_key = $1;`;

// Each claim locks exactly one row: a batched claim would mark rows running
// that the caller never receives and would strand them until recoverStuck().
const CLAIM_SQL = `WITH next AS (
  SELECT id FROM jobs
  WHERE status = 'pending' AND run_at <= now()
  ORDER BY run_at, id
  FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE jobs j SET status = 'running', locked_at = now(), locked_by = $1,
  attempts = j.attempts + 1
FROM next WHERE j.id = next.id
RETURNING j.id, j.kind, j.payload, j.attempts, j.max_attempts;`;

const COMPLETE_SQL = `UPDATE jobs SET status = 'done', finished_at = now(),
  locked_at = NULL, locked_by = NULL
WHERE id = $1 AND status = 'running';`;

const FAIL_SQL = `UPDATE jobs
SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
  last_error = $2,
  finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
  locked_at = NULL,
  locked_by = NULL,
  run_at = CASE
    WHEN attempts >= max_attempts THEN run_at
    ELSE now() + make_interval(secs => least(300, 5 * power(2, attempts)))
  END
WHERE id = $1 AND status = 'running';`;

const RECOVER_SQL = `UPDATE jobs SET status = 'pending', locked_at = NULL, locked_by = NULL
WHERE status = 'running'
  AND locked_at < now() - make_interval(secs => $1);`;

export function renderQueueTs(): string {
  return `import type { Sql } from "postgres";

export interface ClaimedJob {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

export interface EnqueueOptions {
  idempotencyKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

export interface QueueOptions {
  visibilityTimeoutSeconds?: number;
}

export interface Queue {
  enqueue(kind: string, payload: unknown, options?: EnqueueOptions): Promise<string>;
  claim(workerId: string): Promise<ClaimedJob | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: unknown): Promise<void>;
  recoverStuck(): Promise<number>;
}

interface ClaimedRow {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

interface IdRow {
  id: string;
}

interface CountResult {
  count: number;
}

const ENQUEUE_SQL = \`${ENQUEUE_SQL}\`;

const SELECT_ID_SQL = \`${SELECT_ID_SQL}\`;

const CLAIM_SQL = \`${CLAIM_SQL}\`;

const COMPLETE_SQL = \`${COMPLETE_SQL}\`;

const FAIL_SQL = \`${FAIL_SQL}\`;

const RECOVER_SQL = \`${RECOVER_SQL}\`;

function clipError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return Buffer.from(message, "utf8").subarray(0, 2048).toString("utf8");
}

export function createQueue(sql: Sql, options: QueueOptions = {}): Queue {
  const visibilityTimeoutSeconds = options.visibilityTimeoutSeconds ?? 60;
  return {
    async enqueue(kind, payload, enqueueOptions = {}) {
      const inserted = (await sql.unsafe(ENQUEUE_SQL, [
        kind,
        JSON.stringify(payload),
        enqueueOptions.idempotencyKey ?? null,
        enqueueOptions.runAt ?? null,
        enqueueOptions.maxAttempts ?? 5,
      ])) as unknown as IdRow[];
      const insertedRow = inserted[0];
      if (insertedRow !== undefined) return insertedRow.id;
      const idempotencyKey = enqueueOptions.idempotencyKey;
      if (idempotencyKey === undefined) throw new Error("enqueue failed");
      const existing = (await sql.unsafe(SELECT_ID_SQL, [idempotencyKey])) as unknown as IdRow[];
      const existingRow = existing[0];
      if (existingRow === undefined) throw new Error("enqueue failed");
      return existingRow.id;
    },
    async claim(workerId) {
      const rows = (await sql.unsafe(CLAIM_SQL, [workerId])) as unknown as ClaimedRow[];
      const row = rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        kind: row.kind,
        payload: row.payload,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
      };
    },
    async complete(id) {
      await sql.unsafe(COMPLETE_SQL, [id]);
    },
    async fail(id, error) {
      await sql.unsafe(FAIL_SQL, [id, clipError(error)]);
    },
    async recoverStuck() {
      const result = (await sql.unsafe(RECOVER_SQL, [
        visibilityTimeoutSeconds,
      ])) as unknown as CountResult;
      return result.count;
    },
  };
}
`;
}

export function renderWorkerTs(): string {
  return `import { hostname } from "node:os";
import type { ClaimedJob, Queue } from "./queue.js";
import { logger } from "../logger.js";

export type JobHandler = (job: ClaimedJob, signal: AbortSignal) => Promise<void>;

const CONCURRENCY = 5;

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  const finish = (): void => {
    clearTimeout(timer);
    signal.removeEventListener("abort", finish);
    resolve();
  };
  const timer = setTimeout(finish, ms);
  signal.addEventListener("abort", finish, { once: true });
  return promise;
}

export async function runWorker(
  queue: Queue,
  handlers: Readonly<Record<string, JobHandler>>,
  signal: AbortSignal,
): Promise<void> {
  const workerId = process.env.WORKER_ID ?? hostname();
  const pollMs = envInt("QUEUE_POLL_MS", 500);

  async function runJob(job: ClaimedJob): Promise<void> {
    const started = Date.now();
    try {
      const handler = handlers[job.kind];
      if (handler === undefined) throw new Error("no handler for job kind: " + job.kind);
      await handler(job, signal);
      await queue.complete(job.id);
    } catch (error) {
      try {
        await queue.fail(job.id, error);
      } catch (failError) {
        logger.error({ jobId: job.id, err: failError }, "failed to record job failure");
      }
      logger.error(
        { jobId: job.id, kind: job.kind, attempt: job.attempts, err: error },
        "job failed",
      );
    } finally {
      logger.info(
        { jobId: job.id, kind: job.kind, attempt: job.attempts, durationMs: Date.now() - started },
        "job finished",
      );
    }
  }

  async function loop(): Promise<void> {
    while (!signal.aborted) {
      let job: ClaimedJob | null = null;
      try {
        job = await queue.claim(workerId);
      } catch (error) {
        logger.error({ err: error }, "queue claim failed");
        await sleep(pollMs, signal);
        continue;
      }
      if (job === null) {
        await sleep(pollMs, signal);
        continue;
      }
      await runJob(job);
    }
  }

  await queue.recoverStuck();
  await Promise.all(Array.from({ length: CONCURRENCY }, loop));
}
`;
}

export function renderQueuePy(): string {
  return `from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

logger = logging.getLogger(__name__)

ENQUEUE_SQL = text(
    """
    INSERT INTO jobs (kind, payload, idempotency_key, run_at, max_attempts)
    VALUES (:kind, CAST(:payload AS jsonb), :idempotency_key,
            COALESCE(CAST(:run_at AS timestamptz), now()),
            COALESCE(CAST(:max_attempts AS integer), 5))
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
    """
)

SELECT_ID_SQL = text("SELECT id FROM jobs WHERE idempotency_key = :idempotency_key")

CLAIM_SQL = text(
    """
    WITH next AS (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_at <= now()
      ORDER BY run_at, id
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE jobs j SET status = 'running', locked_at = now(), locked_by = :worker_id,
      attempts = j.attempts + 1
    FROM next WHERE j.id = next.id
    RETURNING j.id, j.kind, j.payload, j.attempts, j.max_attempts
    """
)

COMPLETE_SQL = text(
    """
    UPDATE jobs SET status = 'done', finished_at = now(),
      locked_at = NULL, locked_by = NULL
    WHERE id = :job_id AND status = 'running'
    """
)

FAIL_SQL = text(
    """
    UPDATE jobs
    SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
      last_error = :last_error,
      finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
      locked_at = NULL,
      locked_by = NULL,
      run_at = CASE
        WHEN attempts >= max_attempts THEN run_at
        ELSE now() + make_interval(secs => least(300, 5 * power(2, attempts)))
      END
    WHERE id = :job_id AND status = 'running'
    """
)

RECOVER_SQL = text(
    """
    UPDATE jobs SET status = 'pending', locked_at = NULL, locked_by = NULL
    WHERE status = 'running'
      AND locked_at < now() - make_interval(secs => :visibility_timeout)
    """
)


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    kind: str
    payload: Any
    attempts: int
    max_attempts: int


def clip_error(error: object) -> str:
    return str(error).encode("utf-8")[:2048].decode("utf-8", errors="ignore")


class Queue:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        visibility_timeout_seconds: int = 60,
    ) -> None:
        self._session_factory = session_factory
        self._visibility_timeout_seconds = visibility_timeout_seconds

    async def enqueue(
        self,
        kind: str,
        payload: Any,
        *,
        idempotency_key: str | None = None,
        run_at: datetime | None = None,
        max_attempts: int = 5,
    ) -> str:
        async with self._session_factory() as session:
            async with session.begin():
                result = await session.execute(
                    ENQUEUE_SQL,
                    {
                        "kind": kind,
                        "payload": json.dumps(payload),
                        "idempotency_key": idempotency_key,
                        "run_at": run_at,
                        "max_attempts": max_attempts,
                    },
                )
                row = result.first()
                if row is not None:
                    return str(row[0])
                if idempotency_key is None:
                    raise RuntimeError("enqueue failed")
                existing = await session.execute(
                    SELECT_ID_SQL, {"idempotency_key": idempotency_key}
                )
                existing_row = existing.first()
                if existing_row is None:
                    raise RuntimeError("enqueue failed")
                return str(existing_row[0])

    async def claim(self, worker_id: str) -> ClaimedJob | None:
        async with self._session_factory() as session:
            async with session.begin():
                result = await session.execute(CLAIM_SQL, {"worker_id": worker_id})
                row = result.mappings().first()
                if row is None:
                    return None
                payload = row["payload"]
                if isinstance(payload, str):
                    payload = json.loads(payload)
                return ClaimedJob(
                    id=str(row["id"]),
                    kind=str(row["kind"]),
                    payload=payload,
                    attempts=int(row["attempts"]),
                    max_attempts=int(row["max_attempts"]),
                )

    async def complete(self, job_id: str) -> None:
        async with self._session_factory() as session:
            async with session.begin():
                await session.execute(COMPLETE_SQL, {"job_id": job_id})

    async def fail(self, job_id: str, error: object) -> None:
        async with self._session_factory() as session:
            async with session.begin():
                await session.execute(
                    FAIL_SQL, {"job_id": job_id, "last_error": clip_error(error)}
                )

    async def recover_stuck(self) -> int:
        async with self._session_factory() as session:
            async with session.begin():
                result = await session.execute(
                    RECOVER_SQL,
                    {"visibility_timeout": self._visibility_timeout_seconds},
                )
                return getattr(result, "rowcount", 0) or 0
`;
}

export function renderWorkerPy(): string {
  return `from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import Awaitable, Callable, Mapping

from app.runtime.queue import ClaimedJob, Queue

logger = logging.getLogger(__name__)

CONCURRENCY = 5
POLL_SECONDS = 0.5

JobHandler = Callable[[ClaimedJob, asyncio.Event], Awaitable[None]]


async def _sleep(stop: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except TimeoutError:
        pass


async def run_worker(
    queue: Queue,
    handlers: Mapping[str, JobHandler],
    stop: asyncio.Event,
    *,
    concurrency: int = CONCURRENCY,
    poll_seconds: float = POLL_SECONDS,
) -> None:
    worker_id = os.environ.get("WORKER_ID") or str(os.getpid())
    await queue.recover_stuck()
    semaphore = asyncio.Semaphore(concurrency)
    tasks: set[asyncio.Task[None]] = set()

    async def run_job(job: ClaimedJob) -> None:
        started = time.monotonic()
        try:
            handler = handlers.get(job.kind)
            if handler is None:
                raise RuntimeError("no handler for job kind: " + job.kind)
            await handler(job, stop)
            await queue.complete(job.id)
        except Exception as error:  # noqa: BLE001
            try:
                await queue.fail(job.id, error)
            except Exception:  # noqa: BLE001
                logger.exception("failed to record job failure", extra={"job_id": job.id})
            logger.exception(
                "job failed", extra={"job_id": job.id, "kind": job.kind}
            )
        finally:
            logger.info(
                "job finished",
                extra={
                    "job_id": job.id,
                    "kind": job.kind,
                    "attempt": job.attempts,
                    "duration_ms": int((time.monotonic() - started) * 1000),
                },
            )
            semaphore.release()

    try:
        while not stop.is_set():
            await semaphore.acquire()
            if stop.is_set():
                semaphore.release()
                break
            try:
                job = await queue.claim(worker_id)
            except Exception:  # noqa: BLE001
                semaphore.release()
                logger.exception("queue claim failed")
                await _sleep(stop, poll_seconds)
                continue
            if job is None:
                semaphore.release()
                await _sleep(stop, poll_seconds)
                continue
            task = asyncio.create_task(run_job(job))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
    finally:
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
`;
}
