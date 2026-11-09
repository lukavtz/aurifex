import assert from "node:assert/strict";
import { test } from "node:test";

import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import { renderAiogramProject } from "../../src/core/projects/templates/aiogram.ts";
import type { TemplateFile } from "../../src/core/projects/templates/shared.ts";
import { renderQueuePy, renderWorkerPy } from "../../src/core/projects/templates/queue.ts";
import {
  renderJobsIndexPy,
  renderWorkerEntryPy,
} from "../../src/core/projects/templates/worker-entry.ts";

const queuedSpec: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "support_bot",
  displayName: "Support Bot",
  stack: "aiogram",
  features: ["commands", "llm"],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: {
    webhookSecret: true,
    adminAllowlist: true,
    rateLimit: true,
    idempotency: true,
  },
  runtime: {
    queue: "postgres",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

const commandsSpec: BotSpec = {
  ...queuedSpec,
  features: ["commands"],
  storage: { postgres: false, redis: false },
  security: {
    webhookSecret: true,
    adminAllowlist: false,
    rateLimit: false,
    idempotency: false,
  },
  runtime: {
    queue: "none",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

const QUEUE_PATHS = [
  "app/runtime/queue.py",
  "app/runtime/worker.py",
  "app/worker.py",
  "app/jobs/__init__.py",
  "migrations/versions/0001_runtime_schema.py",
] as const;

function projectOf(spec: BotSpec): Map<string, string> {
  const files = renderAiogramProject(spec);
  const paths = files.map((file) => file.path);
  assert.equal(new Set(paths).size, paths.length, "duplicate template path");
  return new Map(files.map((file) => [file.path, file.content]));
}

function contentOf(spec: BotSpec, path: string): string {
  const content = projectOf(spec).get(path);
  assert.ok(content !== undefined, `missing file ${path}`);
  return content;
}

test("queue files render for a postgres-backed project", () => {
  const files = projectOf(queuedSpec);
  assert.equal(files.get("app/runtime/queue.py"), renderQueuePy());
  assert.equal(files.get("app/runtime/worker.py"), renderWorkerPy());
  assert.equal(files.get("app/worker.py"), renderWorkerEntryPy(queuedSpec));
  assert.equal(files.get("app/jobs/__init__.py"), renderJobsIndexPy());
  assert.equal(files.get("app/runtime/__init__.py"), '"""Runtime package."""\n');
});

test("commands-only project carries no queue surface", () => {
  const files = projectOf(commandsSpec);
  for (const path of QUEUE_PATHS) {
    assert.equal(files.has(path), false, `unexpected file ${path}`);
  }
  assert.equal(files.get("app/runtime/__init__.py"), '"""Runtime package."""\n');
});

test("rendering is deterministic and token-free", () => {
  const first: readonly TemplateFile[] = renderAiogramProject(queuedSpec);
  const second: readonly TemplateFile[] = renderAiogramProject(queuedSpec);
  assert.deepEqual(first, second);
});

test("single runtime migration creates the queue table and ready index", () => {
  const migration = contentOf(queuedSpec, "migrations/versions/0001_runtime_schema.py");
  assert.ok(migration.includes('revision = "0001_runtime_schema"'));
  assert.ok(migration.includes("down_revision = None"));
  assert.ok(migration.includes('op.create_table(\n        "jobs",'));
  for (const column of [
    '"id"',
    '"kind"',
    '"payload"',
    '"status"',
    '"idempotency_key"',
    '"run_at"',
    '"attempts"',
    '"max_attempts"',
    '"locked_at"',
    '"locked_by"',
    '"last_error"',
    '"finished_at"',
    '"created_at"',
  ]) {
    assert.ok(migration.includes(column), `missing jobs column ${column}`);
  }
  assert.ok(migration.includes("gen_random_uuid()"));
  assert.ok(migration.includes("postgresql.JSONB()"));
  assert.ok(migration.includes("status IN ('pending','running','done','dead')"));
  assert.ok(migration.includes('op.create_index("jobs_ready_idx", "jobs", ["status", "run_at"])'));
  assert.ok(migration.includes('op.drop_index("jobs_ready_idx", table_name="jobs")'));
  assert.ok(migration.includes('op.drop_table("jobs")'));
});

test("queue runtime claims with FOR UPDATE SKIP LOCKED and no polling", () => {
  const queue = contentOf(queuedSpec, "app/runtime/queue.py");
  assert.ok(queue.includes("FOR UPDATE SKIP LOCKED LIMIT 1"));
  assert.ok(queue.includes("ON CONFLICT (idempotency_key) DO NOTHING"));
  const worker = contentOf(queuedSpec, "app/runtime/worker.py");
  assert.ok(!worker.includes("start_polling"));
});

test("worker entrypoint imports the queue runtime and never polls or serves webhooks", () => {
  const entry = contentOf(queuedSpec, "app/worker.py");
  assert.ok(entry.includes("from app.jobs import JobContext, load_job_handlers"));
  assert.ok(entry.includes("from app.runtime.queue import Queue"));
  assert.ok(entry.includes("from app.runtime.worker import run_worker"));
  assert.ok(!entry.includes("start_polling"));
  assert.ok(!entry.includes("Dispatcher"));
  assert.ok(!entry.includes("app.webhook"));
});

test("generated queue wiring test is shipped with the project", () => {
  const testFile = contentOf(queuedSpec, "tests/test_queue_wiring.py");
  assert.ok(testFile.includes('(APP / "worker.py")'));
  assert.ok(testFile.includes("start_polling"));
  assert.ok(testFile.includes("from app.runtime.queue import Queue"));
});
