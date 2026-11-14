import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { BOT_SPEC_VERSION, type BotSpec } from "../../src/core/spec/bot-spec.ts";
import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import {
  renderBroadcastCommandTs,
  renderBroadcastJobTs,
  renderLlmEnqueueTs,
  renderLlmJobTs,
  renderUserSyncTs,
} from "../../src/core/projects/templates/jobs.ts";
import {
  renderDrizzleMigration,
  renderSchemaTs,
} from "../../src/core/projects/templates/runtime-schema.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";
import type { TemplateFile } from "../../src/core/projects/templates/shared.ts";

const target = resolveStack("grammy").target;

const spec: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "jobs_bot",
  displayName: "Jobs Bot",
  stack: "grammy",
  features: ["commands", "llm", "broadcast"],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
  runtime: {
    queue: "postgres",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

function find(files: readonly TemplateFile[], path: string): TemplateFile {
  const file = files.find((candidate) => candidate.path === path);
  assert.ok(file, `missing ${path}`);
  return file;
}

/** Emitted feature stub: records the registration order and the deps it received. */
function featureStub(name: string): string {
  return `export function register(bot, deps) {\n  globalThis.aurifexLoaderCalls.push({ name: ${JSON.stringify(name)}, bot, queue: deps.queue });\n}\n`;
}

test("llm webhook enqueues instead of calling the model", () => {
  const files = renderGrammyProject(spec, target);
  assert.equal(find(files, "src/features/llm.ts").content, renderLlmEnqueueTs());
  const feature = find(files, "src/features/llm.ts").content;
  assert.ok(feature.includes("Working on it."));
  assert.ok(!feature.includes("fetch("));
  assert.ok(!feature.includes("chat/completions"));

  assert.equal(find(files, "src/jobs/llm.ts").content, renderLlmJobTs(spec));
  assert.ok(find(files, "src/jobs/llm.ts").content.includes("/chat/completions"));
  assert.ok(find(files, "tests/llm.test.ts").content.includes("WORKING_TEXT"));
});

test("broadcast command enqueues and the job pages users", () => {
  const files = renderGrammyProject(spec, target);
  assert.equal(find(files, "src/features/broadcast.ts").content, renderBroadcastCommandTs());
  assert.equal(find(files, "src/jobs/broadcast.ts").content, renderBroadcastJobTs());

  const command = find(files, "src/features/broadcast.ts").content;
  assert.ok(command.includes('idempotencyKey: "broadcast:" + broadcastId'));
  const job = find(files, "src/jobs/broadcast.ts").content;
  assert.ok(job.includes("FROM users"));
  assert.ok(!job.includes("ADMIN_IDS"));
  assert.ok(find(files, "tests/broadcast.test.ts").content.includes("ADMIN_IDS"));
});

test("main creates the queue and installs user sync before features", () => {
  const files = renderGrammyProject(spec, target);
  const main = find(files, "src/main.ts").content;
  assert.ok(main.includes("getDb(config.DATABASE_URL)"));
  assert.ok(main.includes("createQueue(database.client"));
  assert.ok(main.includes("DATABASE_URL is required when runtime.queue is postgres"));
  const sync = main.indexOf("userSyncMiddleware(database.client)");
  assert.ok(sync >= 0);
  assert.ok(sync < main.indexOf("await registerFeatures"));

  assert.equal(find(files, "src/security/user-sync.ts").content, renderUserSyncTs());
});

test("feature loader sorts entries and passes deps to every module", async () => {
  const loader = find(renderGrammyProject(spec, target), "src/features/index.ts").content;
  assert.ok(loader.includes("export interface FeatureDeps"));
  assert.ok(loader.includes("registerFeatures(deps: FeatureDeps)"));
  assert.ok(loader.includes("for (const entry of entries.toSorted())"));
  assert.ok(loader.includes("await loaded.register(deps.bot, deps)"));
  assert.ok(!loader.includes("entry ==="));

  const root = await mkdtemp(join(tmpdir(), "aurifex-loader-"));
  try {
    await writeFile(join(root, "package.json"), '{ "type": "module" }\n');
    await mkdir(join(root, "src", "features"), { recursive: true });
    await writeFile(
      join(root, "src", "logger.js"),
      "export const logger = { info() {}, warn() {}, error() {} };\n",
    );
    // Created out of alphabetical order on purpose: registration order is the sorted one.
    for (const name of ["zebra", "llm", "alpha"]) {
      await writeFile(join(root, "src", "features", `${name}.ts`), featureStub(name));
    }
    await writeFile(join(root, "src", "features", "index.ts"), loader);

    const calls: { readonly name: string; readonly bot: unknown; readonly queue: unknown }[] = [];
    const globals = globalThis as unknown as { aurifexLoaderCalls: typeof calls };
    globals.aurifexLoaderCalls = calls;
    try {
      // Dynamic import is required: the loader is a runtime feature registry and the
      // emitted module only exists in this temporary project directory.
      const loaded = (await import(
        pathToFileURL(join(root, "src", "features", "index.ts")).href
      )) as {
        registerFeatures(deps: unknown): Promise<void>;
      };
      const bot = { kind: "bot" };
      const queue = { kind: "queue" };
      await loaded.registerFeatures({ bot, sql: null, queue, config: {} });
      assert.deepEqual(
        calls.map((call) => call.name),
        ["alpha", "llm", "zebra"],
      );
      // llm gets the queue through deps; there is no filename-specific second argument.
      for (const call of calls) {
        assert.equal(call.bot, bot);
        assert.equal(call.queue, queue);
      }
    } finally {
      delete (globalThis as Record<string, unknown>).aurifexLoaderCalls;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migration is the consolidated runtime schema", () => {
  const files = renderGrammyProject(spec, target);
  assert.equal(find(files, "drizzle/0001_runtime_schema.sql").content, renderDrizzleMigration());
  assert.ok(!files.some((file) => file.path === "drizzle/0001_jobs.sql"));
  assert.equal(find(files, "src/storage/schema.ts").content, renderSchemaTs(spec));
});

test("commands-only bots carry no queue, jobs, or user sync", () => {
  const minimal: BotSpec = {
    ...spec,
    features: ["commands"],
    storage: { postgres: false, redis: false },
    security: { ...spec.security, rateLimit: false, idempotency: false },
    runtime: { ...spec.runtime, queue: "none" },
  };
  const files = renderGrammyProject(minimal, target);
  const paths = new Set(files.map((file) => file.path));
  for (const path of [
    "src/runtime/queue.ts",
    "src/worker.ts",
    "src/jobs/index.ts",
    "src/jobs/llm.ts",
    "src/jobs/broadcast.ts",
    "src/security/user-sync.ts",
    "drizzle/0001_runtime_schema.sql",
  ]) {
    assert.ok(!paths.has(path), `unexpected ${path}`);
  }

  const main = find(files, "src/main.ts").content;
  assert.ok(!main.includes("createQueue"));
  assert.ok(!main.includes("userSyncMiddleware"));
  assert.ok(main.includes("sql: null"));
  assert.ok(main.includes("queue: null"));

  const loader = find(files, "src/features/index.ts").content;
  assert.ok(loader.includes("readonly sql: null"));
  assert.ok(loader.includes("readonly queue: null"));
});
