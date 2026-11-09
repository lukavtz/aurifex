import assert from "node:assert/strict";
import test from "node:test";

import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import {
  renderJobsIndexPy,
  renderJobsIndexTs,
  renderWorkerEntryPy,
  renderWorkerEntryTs,
} from "../../src/core/projects/templates/worker-entry.ts";

const QUEUED: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "ledger_bot",
  displayName: "Ledger Bot",
  stack: "grammy",
  features: ["commands", "llm"],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
  runtime: {
    queue: "postgres",
    telemetry: { otlp: true, prometheus: true, sentry: true },
  },
};

test("worker entry renders deterministically", () => {
  assert.equal(renderWorkerEntryTs(QUEUED), renderWorkerEntryTs(QUEUED));
  assert.equal(renderJobsIndexTs(), renderJobsIndexTs());
  assert.equal(renderWorkerEntryPy(QUEUED), renderWorkerEntryPy(QUEUED));
  assert.equal(renderJobsIndexPy(), renderJobsIndexPy());
});

test("typescript worker entry wires config, telemetry, db, queue, and handlers", () => {
  const source = renderWorkerEntryTs(QUEUED);
  for (const specifier of [
    'import { createBot } from "./bot.js";',
    'import { getConfig } from "./config.js";',
    'import { loadJobHandlers } from "./jobs/index.js";',
    'import { logger } from "./logger.js";',
    'import { createQueue } from "./runtime/queue.js";',
    'import { initTelemetry, shutdownTelemetry } from "./runtime/telemetry.js";',
    'import { runWorker } from "./runtime/worker.js";',
    'import { closeDb, getDb } from "./storage/db.js";',
  ]) {
    assert.ok(source.includes(specifier), `missing ${specifier}`);
  }
  assert.ok(source.includes('config.OTEL_SERVICE_NAME || "ledger_bot"'));
  assert.ok(source.includes("const config = getConfig();"));
  assert.ok(source.includes("if (database === null) {"));
  assert.ok(source.includes('throw new Error("DATABASE_URL is required for the worker");'));
  assert.ok(
    source.includes("loadJobHandlers({ bot, sql: database.client, queue, config, redis })"),
  );
  assert.ok(source.includes("visibilityTimeoutSeconds: config.QUEUE_VISIBILITY_TIMEOUT_SECONDS"));
});

test("typescript worker entry creates exactly one queue", () => {
  const source = renderWorkerEntryTs(QUEUED);
  assert.equal(source.match(/createQueue\(/g)?.length, 1);
});

test("typescript worker entry never starts polling or a webhook", () => {
  const source = renderWorkerEntryTs(QUEUED);
  assert.ok(!source.includes("bot.start"));
  assert.ok(!source.includes("setWebhook"));
  assert.ok(!source.includes("webhookCallback"));
  assert.ok(!source.includes("createServer"));
});

test("typescript worker entry shuts down on SIGINT and SIGTERM within 30s", () => {
  const source = renderWorkerEntryTs(QUEUED);
  assert.ok(source.includes("const SHUTDOWN_TIMEOUT_MS = 30_000;"));
  assert.ok(source.includes('process.once("SIGINT"'));
  assert.ok(source.includes('process.once("SIGTERM"'));
  assert.ok(source.includes("controller.abort()"));
  assert.ok(source.includes("Promise.race([runWorker(queue, handlers, controller.signal), deadline])"));
  assert.ok(source.includes("await bot.stop();"));
  assert.ok(source.includes("await closeDb();"));
  assert.ok(source.includes("await shutdownTelemetry();"));
});

test("typescript job loader skips index, declarations, and tests", () => {
  const source = renderJobsIndexTs();
  assert.ok(source.includes('entry.endsWith(".js")'));
  assert.ok(source.includes('entry !== "index.js"'));
  assert.ok(source.includes('entry.endsWith(".d.js")'));
  assert.ok(source.includes('entry.includes(".test.")'));
  assert.ok(source.includes('entry.includes(".spec.")'));
  assert.ok(source.includes('.filter(isJobFile).sort()'));
});

test("typescript job loader imports siblings by file URL and validates shape", () => {
  const source = renderJobsIndexTs();
  assert.ok(source.includes("await import(pathToFileURL(join(directory, entry)).href)"));
  assert.ok(source.includes("typeof candidate.kind === \"string\""));
  assert.ok(source.includes("typeof candidate.handle === \"function\""));
  assert.ok(source.includes("export async function loadJobHandlers("));
  assert.ok(source.includes("): Promise<Record<string, JobHandler>>"));
  assert.ok(source.includes("handlers[module.kind] = (job) => module.handle(job, ctx);"));
});

test("typescript job loader exposes the shared context contract", () => {
  const source = renderJobsIndexTs();
  assert.ok(source.includes("export interface JobContext {"));
  assert.ok(source.includes("export interface JobModule {"));
  for (const field of ["bot: Bot;", "sql: Sql;", "queue: Queue;", "config: Config;"]) {
    assert.ok(source.includes(field), `missing ${field}`);
  }
});

test("typescript job loader throws on a duplicate kind", () => {
  const source = renderJobsIndexTs();
  assert.match(source, /if \(handlers\[module\.kind\] !== undefined\) \{/);
  assert.ok(source.includes('throw new Error("duplicate job kind: " + module.kind);'));
});

test("python worker entry uses settings, bot, session factory, queue, and loader", () => {
  const source = renderWorkerEntryPy(QUEUED);
  assert.ok(source.includes("from app.bot import create_bot"));
  assert.ok(source.includes("from app.config import get_settings"));
  assert.ok(source.includes("from app.db.session import create_session_factory"));
  assert.ok(source.includes("from app.jobs import JobContext, load_job_handlers"));
  assert.ok(source.includes("from app.runtime.queue import Queue"));
  assert.ok(source.includes("from app.runtime.worker import run_worker"));
  assert.ok(source.includes("settings = get_settings()"));
  assert.ok(source.includes("bot = create_bot(settings)"));
  assert.ok(source.includes("session_factory = create_session_factory(settings.database_url)"));
  assert.ok(source.includes("handlers = load_job_handlers(ctx)"));
  assert.equal(source.match(/= Queue\(/g)?.length, 1);
});

test("python worker entry handles signals with an asyncio.Event", () => {
  const source = renderWorkerEntryPy(QUEUED);
  assert.ok(source.includes("stop = asyncio.Event()"));
  assert.ok(source.includes("loop.add_signal_handler(signum, stop.set)"));
  assert.ok(source.includes("signal.signal(signum"));
  assert.ok(source.includes('for name in ("SIGINT", "SIGTERM")'));
  assert.ok(source.includes("SHUTDOWN_TIMEOUT_SECONDS = 30"));
  assert.ok(source.includes("await asyncio.wait_for(worker_task, timeout=SHUTDOWN_TIMEOUT_SECONDS)"));
});

test("python worker entry closes the bot session and engine", () => {
  const source = renderWorkerEntryPy(QUEUED);
  assert.ok(source.includes("await bot.session.close()"));
  assert.ok(source.includes("await engine.dispose()"));
  assert.ok(source.includes("shutdown_telemetry()"));
  assert.ok(source.includes('settings.otel_service_name or "ledger_bot"'));
  assert.ok(!source.includes("start_polling"));
  assert.ok(!source.includes("run_webhook"));
});

test("python job loader imports every module in the package", () => {
  const source = renderJobsIndexPy();
  assert.ok(source.includes("pkgutil.iter_modules(package.__path__)"));
  assert.ok(source.includes('importlib.import_module(f"{__name__}.{module_name}")'));
  assert.ok(source.includes("sorted("));
  assert.ok(source.includes("if not info.name.startswith(\"_\")"));
});

test("python job loader requires KIND and handle and rejects duplicates", () => {
  const source = renderJobsIndexPy();
  assert.ok(source.includes('kind = getattr(module, "KIND", None)'));
  assert.ok(source.includes('handle = getattr(module, "handle", None)'));
  assert.ok(source.includes("must define a non-empty KIND"));
  assert.ok(source.includes("must define handle(job, ctx)"));
  assert.ok(source.includes("if kind in handlers:"));
  assert.ok(source.includes('raise RuntimeError(f"duplicate job kind: {kind}")'));
});

test("python job loader exposes the shared context dataclass", () => {
  const source = renderJobsIndexPy();
  assert.ok(source.includes("@dataclass(frozen=True)"));
  assert.ok(source.includes("class JobContext:"));
  for (const field of ["bot: Bot", "session_factory:", "queue: Queue", "settings: Settings"]) {
    assert.ok(source.includes(field), `missing ${field}`);
  }
  assert.ok(source.includes("def load_job_handlers(ctx: JobContext) -> dict[str, JobHandler]:"));
});