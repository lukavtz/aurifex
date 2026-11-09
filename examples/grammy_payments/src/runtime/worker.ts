import { hostname } from "node:os";
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
