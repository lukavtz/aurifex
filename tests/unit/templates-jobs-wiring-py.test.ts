import assert from "node:assert/strict";
import { test } from "node:test";

import { renderAiogramProject } from "../../src/core/projects/templates/aiogram.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import type { BotSpec } from "../../src/core/spec/bot-spec.ts";

const spec: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "support_bot",
  displayName: "Support Bot",
  stack: "aiogram",
  features: ["commands", "llm", "broadcast"],
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

const files = renderAiogramProject(spec);
const paths = files.map((file) => file.path);

function contentOf(path: string): string {
  const file = files.find((entry) => entry.path === path);
  assert.ok(file, `missing ${path}`);
  return file.content;
}

test("llm feature enqueues from the handler and runs the call in a job", () => {
  const handler = contentOf("app/handlers/llm.py");
  assert.match(handler, /Command\("llm"\)/);
  assert.match(handler, /await queue\.enqueue\(/);
  assert.match(handler, /idempotency_key="llm:" \+ str\(update_id\)/);
  assert.match(handler, /WORKING_TEXT = "Working on it\."/);
  assert.doesNotMatch(handler, /httpx|chat\/completions|from app\.services\.llm/);

  const job = contentOf("app/jobs/llm.py");
  assert.match(job, /KIND = "llm\.request"/);
  assert.match(job, /async def handle\(job: ClaimedJob, ctx: JobContext\)/);
  assert.match(job, /httpx\.AsyncClient\(timeout=8\.0\)/);
  assert.match(job, /config\.base_url \+ "\/chat\/completions"/);
});

test("broadcast feature commands enqueue and the job pages the users table", () => {
  const handler = contentOf("app/handlers/broadcast.py");
  assert.match(handler, /Command\("broadcast"\)/);
  assert.match(handler, /idempotency_key="broadcast:" \+ broadcast_id/);
  assert.doesNotMatch(handler, /send_message/);

  const job = contentOf("app/jobs/broadcast.py");
  assert.match(job, /KIND = "broadcast\.send"/);
  assert.match(job, /SELECT id FROM users WHERE id > :last_user_id::bigint ORDER BY id LIMIT 100/);
  assert.match(job, /broadcast_deliveries/);
  assert.doesNotMatch(job, /ADMIN_IDS|admin_id_set|admin_ids/);
});

test("postgres projects install user sync before dedupe, rate limit, and allowlist", () => {
  assert.ok(paths.includes("app/middlewares/user_sync.py"));
  const bot = contentOf("app/bot.py");
  assert.match(bot, /UserSyncMiddleware\(session_factory\)/);
  assert.match(bot, /from app\.middlewares\.user_sync import UserSyncMiddleware/);
  const userSync = bot.indexOf("UserSyncMiddleware(session_factory)");
  assert.ok(userSync < bot.indexOf("DedupeMiddleware(redis)"));
  assert.ok(userSync < bot.indexOf("RateLimitMiddleware(redis)"));
  assert.ok(userSync < bot.indexOf("AllowlistMiddleware(settings.admin_id_set)"));
});

test("create_dispatcher seeds the queue and workflow dependencies", () => {
  const bot = contentOf("app/bot.py");
  assert.match(bot, /from app\.runtime\.queue import Queue/);
  assert.match(bot, /dispatcher\.workflow_data\["session_factory"\]/);
  assert.match(bot, /dispatcher\.workflow_data\["settings"\] = settings/);
  assert.match(bot, /dispatcher\.workflow_data\["queue"\] = Queue\(/);
});

test("one runtime schema migration replaces the split init and jobs migrations", () => {
  assert.ok(paths.includes("migrations/versions/0001_runtime_schema.py"));
  assert.equal(paths.includes("migrations/versions/0001_init.py"), false);
  assert.equal(paths.includes("migrations/versions/0002_jobs.py"), false);
  assert.equal(paths.includes("migrations/versions/0003_broadcast.py"), false);

  const migration = contentOf("migrations/versions/0001_runtime_schema.py");
  assert.match(migration, /revision = "0001_runtime_schema"/);
  for (const table of ["users", "payments", "refunds", "subscriptions", "jobs", "broadcasts", "broadcast_deliveries"]) {
    assert.match(migration, new RegExp(`op\\.create_table\\(\\n        "${table}"`));
  }
  assert.match(migration, /def downgrade\(\) -> None:/);
  for (const table of ["broadcast_deliveries", "broadcasts", "jobs"]) {
    assert.match(migration, new RegExp(`op\\.drop_table\\("${table}"\\)`));
  }
});