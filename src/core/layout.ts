import type { BotStack } from "./spec/bot-spec.ts";

/**
 * Canonical project layout for both supported stacks. Every path the verifier
 * looks for is declared here exactly once; `skills/telegram-bot-recipes/
 * references/project-layout.md` mirrors this table and is kept in sync by
 * `tests/unit/layout.test.ts`.
 */
export interface StackLayout {
  readonly queue: string;
  readonly worker: string;
  readonly payments: string;
  readonly miniapp: string;
  readonly api104: string;
  readonly migration: string;
  readonly userSync: string;
  readonly tests: string;
  readonly lockfile: string;
}

export const LAYOUT: Readonly<Record<BotStack, StackLayout>> = {
  grammy: {
    queue: "src/runtime/queue.ts",
    worker: "src/worker.ts",
    payments: "src/runtime/payments.ts",
    miniapp: "src/runtime/miniapp-session.ts",
    api104: "src/telegram/api104.ts",
    migration: "drizzle/0001_runtime_schema.sql",
    userSync: "src/security/user-sync.ts",
    tests: "tests/",
    lockfile: "bun.lock",
  },
  aiogram: {
    queue: "app/runtime/queue.py",
    worker: "app/worker.py",
    payments: "app/runtime/payments.py",
    miniapp: "app/runtime/miniapp_session.py",
    api104: "app/services/api104.py",
    migration: "migrations/versions/0001_runtime_schema.py",
    userSync: "app/middlewares/user_sync.py",
    tests: "tests/",
    lockfile: "uv.lock",
  },
};

/** Every path in the layout contract, deduplicated and sorted. */
export function layoutPaths(): readonly string[] {
  const paths = new Set<string>();
  for (const layout of Object.values(LAYOUT)) {
    for (const path of Object.values(layout)) paths.add(path);
  }
  return [...paths].toSorted();
}
