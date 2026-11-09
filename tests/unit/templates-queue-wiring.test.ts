import assert from "node:assert/strict";
import { test } from "node:test";

import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import { QUEUE_SQL } from "../../src/core/projects/templates/queue.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";

const target = resolveStack("grammy").target;

const QUEUED: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "queued_bot",
  displayName: "Queued Bot",
  stack: "grammy",
  features: ["commands", "llm"],
  deployment: "docker",
  storage: { postgres: true, redis: false },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: false, idempotency: false },
  runtime: {
    queue: "postgres",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

const COMMANDS_ONLY: BotSpec = {
  ...QUEUED,
  features: ["commands"],
  storage: { postgres: false, redis: false },
  runtime: {
    queue: "none",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

const QUEUE_FILES = [
  "src/runtime/queue.ts",
  "src/runtime/worker.ts",
  "src/worker.ts",
  "src/jobs/index.ts",
  "src/migrate.ts",
  "drizzle/0001_runtime_schema.sql",
  "tests/queue-wiring.test.ts",
];

function files(spec: BotSpec): Map<string, string> {
  return new Map(renderGrammyProject(spec, target).map((file) => [file.path, file.content]));
}

function serviceBlock(compose: string, service: string): string {
  const start = compose.indexOf(`\n  ${service}:\n`);
  assert.notEqual(start, -1, `compose must define ${service}`);
  const rest = compose.slice(start + 1);
  const end = rest.slice(1).search(/\n {2}[a-z#]/u);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

test("queue files exist only when the queue is postgres", () => {
  const queued = files(QUEUED);
  for (const path of QUEUE_FILES) {
    assert.ok(queued.has(path), `expected ${path}`);
  }
  const commandsOnly = files(COMMANDS_ONLY);
  for (const path of QUEUE_FILES) {
    assert.ok(!commandsOnly.has(path), `unexpected ${path}`);
  }
});

test("the jobs migration carries the queue schema", () => {
  const queued = files(QUEUED);
  const migration = queued.get("drizzle/0001_runtime_schema.sql");
  assert.ok(migration?.includes(QUEUE_SQL));
  assert.match(migration ?? "", /CREATE TABLE jobs \(/u);
  assert.match(migration ?? "", /idempotency_key text UNIQUE/u);
});

test("the migrate entrypoint reads the SQL file and exits nonzero", () => {
  const migrate = files(QUEUED).get("src/migrate.ts") ?? "";
  assert.match(migrate, /readFileSync\(MIGRATION_PATH/u);
  assert.match(migrate, /drizzle/u);
  assert.match(migrate, /tx\.unsafe\(statement\)/u);
  assert.match(migrate, /process\.exitCode = 1/u);
  assert.match(migrate, /schema_migrations/u);
  assert.match(migrate, /pg_advisory_xact_lock/u);
});

test("worker entry runs jobs, handles signals, and never starts polling", () => {
  const worker = files(QUEUED).get("src/worker.ts") ?? "";
  assert.ok(!worker.includes("bot.start"));
  assert.match(worker, /SIGINT/u);
  assert.match(worker, /SIGTERM/u);
  assert.match(worker, /\.\/runtime\/queue\.js/u);
  assert.match(worker, /runWorker\(/u);
  const generatedTest = files(QUEUED).get("tests/queue-wiring.test.ts") ?? "";
  assert.match(generatedTest, /not\.toContain\("bot\.start"\)/u);
});

test("compose adds a one-shot migrate service gating bot and worker", () => {
  const compose = files(QUEUED).get("docker-compose.yml") ?? "";
  const migrate = serviceBlock(compose, "migrate");
  assert.match(migrate, /command: \["node", "dist\/migrate\.js"\]/u);
  assert.match(migrate, /restart: "no"/u);
  assert.match(migrate, /postgres:\n {8}condition: service_healthy/u);
  assert.match(
    serviceBlock(compose, "bot"),
    /migrate:\n {8}condition: service_completed_successfully/u,
  );
  const worker = serviceBlock(compose, "worker");
  assert.match(worker, /migrate:\n {8}condition: service_completed_successfully/u);
  assert.match(worker, /stop_grace_period: 35s/u);
});

test("commands-only compose has no worker or migrate service", () => {
  const compose = files(COMMANDS_ONLY).get("docker-compose.yml") ?? "";
  assert.doesNotMatch(compose, /^ {2}migrate:$/mu);
  assert.doesNotMatch(compose, /^ {2}worker:$/mu);
  assert.doesNotMatch(compose, /service_completed_successfully/u);
});

test("compose declares no fixed passwords and no published bot port", () => {
  const compose = files(QUEUED).get("docker-compose.yml") ?? "";
  assert.doesNotMatch(compose, /POSTGRES_PASSWORD:\s*bot/u);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/u);
  assert.doesNotMatch(compose, /"8080:8080"/u);
});

test("package scripts and image carry the migration and worker entrypoint", () => {
  const queued = files(QUEUED);
  const pkg = JSON.parse(queued.get("package.json") ?? "{}") as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };
  assert.equal(pkg.scripts["db:migrate"], "node dist/migrate.js");
  assert.equal(pkg.scripts["start:worker"], "node dist/worker.js");
  assert.equal(pkg.scripts["db:generate"], "drizzle-kit generate");
  assert.ok(Object.keys(pkg.dependencies).some((name) => name.startsWith("@opentelemetry/")));
  assert.match(queued.get("Dockerfile") ?? "", /^COPY drizzle \.\/drizzle$/mu);

  const commandsOnly = files(COMMANDS_ONLY);
  const plainPkg = JSON.parse(commandsOnly.get("package.json") ?? "{}") as {
    scripts: Record<string, string>;
  };
  assert.equal(plainPkg.scripts["db:migrate"], "drizzle-kit migrate");
  assert.equal(plainPkg.scripts["start:worker"], undefined);
  assert.doesNotMatch(commandsOnly.get("Dockerfile") ?? "", /COPY drizzle/u);
});
