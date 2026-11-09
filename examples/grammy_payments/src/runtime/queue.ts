import type { Sql } from "postgres";

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

const ENQUEUE_SQL = `INSERT INTO jobs (kind, payload, idempotency_key, run_at, max_attempts)
VALUES ($1, $2::jsonb, $3, COALESCE($4::timestamptz, now()), COALESCE($5::integer, 5))
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;`;

const SELECT_ID_SQL = `SELECT id FROM jobs WHERE idempotency_key = $1;`;

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
