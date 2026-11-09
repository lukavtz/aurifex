import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Bot } from "grammy";
import type { Sql } from "postgres";
import type { Config } from "../config.js";
import type { ClaimedJob, Queue } from "../runtime/queue.js";
import type { JobHandler } from "../runtime/worker.js";
import type { Redis } from "ioredis";

export interface JobContext {
  bot: Bot;
  sql: Sql;
  queue: Queue;
  config: Config;
  redis: Redis | null;
}

export interface JobModule {
  kind: string;
  handle(job: ClaimedJob, ctx: JobContext): Promise<void>;
}

function isJobModule(value: unknown): value is JobModule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; handle?: unknown };
  return (
    typeof candidate.kind === "string" &&
    candidate.kind.length > 0 &&
    typeof candidate.handle === "function"
  );
}

// Only compiled siblings are loaded: index.ts is this loader, declarations and
// tests must never become jobs. Sorting keeps the duplicate-kind error stable.
// Dynamic import is required here: job modules are a runtime registry, so their
// specifiers cannot be static.
function isJobFile(entry: string): boolean {
  return (
    entry.endsWith(".js") &&
    entry !== "index.js" &&
    !entry.endsWith(".d.js") &&
    !entry.includes(".test.") &&
    !entry.includes(".spec.")
  );
}

export async function loadJobHandlers(ctx: JobContext): Promise<Record<string, JobHandler>> {
  const directory = import.meta.dirname;
  const entries = (await readdir(directory)).filter(isJobFile).toSorted();
  const handlers: Record<string, JobHandler> = {};
  for (const entry of entries) {
    const module: unknown = await import(pathToFileURL(join(directory, entry)).href);
    if (!isJobModule(module)) {
      throw new Error(
        "invalid job module " + entry + ": expected a string kind and a handle function",
      );
    }
    if (handlers[module.kind] !== undefined) {
      throw new Error("duplicate job kind: " + module.kind);
    }
    handlers[module.kind] = (job) => module.handle(job, ctx);
  }
  return handlers;
}
