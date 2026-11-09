import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Bot } from "grammy";
import type { Redis } from "ioredis";
import type { Sql } from "postgres";
import type { Config } from "../config.js";
import { logger } from "../logger.js";
import type { Queue } from "../runtime/queue.js";

export interface FeatureDeps {
  readonly bot: Bot;
  readonly sql: Sql;
  readonly queue: Queue;
  readonly config: Config;
  readonly redis?: Redis;
}

export interface FeatureModule {
  register(bot: Bot, deps: FeatureDeps): void | Promise<void>;
}

const FEATURE_FILE_RE = /^[a-z][a-z0-9_-]*\.(?:js|ts)$/;
const SKIPPED: Record<string, true> = { "index.js": true, "index.ts": true };

export async function registerFeatures(deps: FeatureDeps): Promise<void> {
  const directory = dirname(fileURLToPath(import.meta.url));
  const entries = (await readdir(directory)).filter(
    (entry) =>
      FEATURE_FILE_RE.test(entry) && SKIPPED[entry] === undefined && !entry.endsWith(".d.ts"),
  );
  entries.toSorted();
  for (const entry of entries) {
    // Feature modules are a runtime registry, so the specifier is selected at run time.
    const loaded = (await import(
      pathToFileURL(join(directory, entry)).href
    )) as Partial<FeatureModule>;
    if (typeof loaded.register !== "function") {
      logger.warn({ entry }, "feature module has no register export");
      continue;
    }
    // Most features take the full deps object; the LLM module only needs the queue.
    const register = loaded.register as (bot: Bot, argument: unknown) => void | Promise<void>;
    await register(deps.bot, entry === "llm.js" || entry === "llm.ts" ? deps.queue : deps);
  }
}
