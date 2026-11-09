import assert from "node:assert/strict";
import { test } from "node:test";

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

test("feature loader passes deps and the queue to the llm module", () => {
  const loader = find(renderGrammyProject(spec, target), "src/features/index.ts").content;
  assert.ok(loader.includes("export interface FeatureDeps"));
  assert.ok(loader.includes("registerFeatures(deps: FeatureDeps)"));
  assert.ok(loader.includes('entry === "llm.js" || entry === "llm.ts" ? deps.queue : deps'));
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
