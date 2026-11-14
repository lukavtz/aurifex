import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { addFeature, type FeatureResult } from "../../src/core/projects/add-feature.ts";
import { readManifest, writeManifest, type AurifexManifest } from "../../src/core/projects/manifest.ts";
import { renderAiogramProject } from "../../src/core/projects/templates/aiogram.ts";
import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import { renderLegacyLlmEnqueueTs, renderLlmEnqueueTs } from "../../src/core/projects/templates/jobs.ts";
import { renderCompose } from "../../src/core/projects/templates/shared.ts";
import { sha256Hex, type DomainResult } from "../../src/core/results.ts";
import { createPathPolicy, type PathPolicy } from "../../src/core/security/path-policy.ts";
import { BOT_SPEC_VERSION, type BotFeature, type BotSpec, type BotStack } from "../../src/core/spec/bot-spec.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";

function specification(stack: BotStack, postgres = false, queue = false, redis = true): BotSpec {
  return { schemaVersion: BOT_SPEC_VERSION, name: "demo", displayName: "Demo", stack,
    features: ["commands"], deployment: "docker", storage: { postgres, redis },
    i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
    security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
    runtime: { queue: queue ? "postgres" : "none", telemetry: { otlp: false, prometheus: false, sentry: false } } };
}

async function fixture(t: TestContext, stack: BotStack = "grammy", postgres = false, queue = false, redis = true, prefix = "", features: BotFeature[] = ["commands"], overrides: Partial<BotSpec> = {}) {
  const root = await mkdtemp(join(tmpdir(), "aurifex-feature-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const policy = await createPathPolicy(root);
  const spec = { ...specification(stack, postgres, queue, redis), features, ...overrides };
  const templates = stack === "grammy" ? renderGrammyProject(spec, resolveStack(stack).target) : renderAiogramProject(spec);
  const files: Record<string, string> = {};
  for (const file of templates) {
    await policy.writeFile(prefix === "" ? file.path : `${prefix}/${file.path}`, file.content);
    files[file.path] = sha256Hex(file.content);
  }
  const manifest: AurifexManifest = { manifestVersion: 1, specVersion: BOT_SPEC_VERSION, stack,
    specHash: "a".repeat(64), generatedAt: "2026-01-01T00:00:00.000Z", files };
  await writeManifest(policy, prefix, manifest);
  return { root: prefix === "" ? root : join(root, prefix), policy, spec, manifest };
}

function ok(result: DomainResult<FeatureResult>): FeatureResult {
  if (result.status !== "ok") assert.fail(`${result.error.code}: ${result.error.detail}`);
  return result.value;
}
function error(result: DomainResult<FeatureResult>, code: string) {
  if (result.status !== "error") assert.fail("expected domain error");
  assert.equal(result.error.code, code);
  return result.error;
}
async function snapshot(policy: PathPolicy): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all((await policy.listFiles()).map(async (path) => [path, await policy.readText(path)])));
}
async function own(policy: PathPolicy, path: string, content: string): Promise<void> {
  await policy.writeFile(path, content, { overwrite: true });
  const manifest = await readManifest(policy);
  assert.ok(manifest);
  await writeManifest(policy, "", { ...manifest, files: { ...manifest.files, [path]: sha256Hex(content) } });
}

const TS_INFRA = ["src/runtime/queue.ts", "src/runtime/worker.ts", "src/worker.ts", "src/jobs/index.ts", "src/migrate.ts", "src/security/user-sync.ts", "tests/queue-wiring.test.ts"];
const PY_INFRA = ["app/runtime/queue.py", "app/runtime/worker.py", "app/worker.py", "app/jobs/__init__.py", "app/middlewares/user_sync.py", "tests/test_queue_wiring.py"];

for (const stack of ["grammy", "aiogram"] as const) {
  for (const feature of ["llm", "broadcast", "payments"] as const) {
    for (const custom of [false, true]) {
      test(`${stack} S1 adds ${feature} ${custom ? "custom" : "canonical"} with complete infrastructure`, async (t) => {
        const { root, policy, spec, manifest: before } = await fixture(t, stack, false, false, false);
        const storagePaths = stack === "grammy" ? ["src/storage/db.ts", "src/storage/schema.ts"] : ["app/db/__init__.py", "app/db/session.py", "app/db/models.py"];
        const immutable = await Promise.all(storagePaths.map((path) => policy.readText(path)));
        const name = custom ? `custom_${feature}` : feature;
        const result = ok(await addFeature({ projectRoot: root, feature, name }, { policy }));
        const paths = result.files.map((ref) => ref.path);
        for (const path of stack === "grammy" ? TS_INFRA : PY_INFRA) assert.ok(paths.includes(path), path);
        assert.ok(paths.includes(stack === "grammy" ? `src/features/${name}.ts` : `app/handlers/${name}.py`));
        const payload = stack === "grammy"
          ? feature === "llm" ? ["src/jobs/llm.ts", `tests/${name}.test.ts`]
            : feature === "broadcast" ? ["src/jobs/broadcast.ts", `tests/${name}.test.ts`]
              : ["src/runtime/payments.ts", `tests/${name}.test.ts`, "src/jobs/payments.ts"]
          : feature === "llm" ? ["app/jobs/llm.py"]
            : feature === "broadcast" ? ["app/jobs/broadcast.py"]
              : ["app/runtime/payments.py", `tests/test_${name}.py`, "app/jobs/payment_fulfill.py", "app/jobs/payment_reconcile.py"];
        for (const path of payload) assert.ok(paths.includes(path), path);
        assert.ok(paths.includes(stack === "grammy" ? "drizzle/0001_runtime_schema.sql" : "migrations/versions/0001_runtime_schema.py"));
        assert.deepEqual(await Promise.all(storagePaths.map((path) => policy.readText(path))), immutable);
        for (const path of storagePaths) assert.ok(!paths.includes(path));
        const promotedRedis = feature === "broadcast";
        const compose = await policy.readText("docker-compose.yml");
        assert.equal(compose, renderCompose({ ...spec, features: ["commands", feature], storage: { postgres: true, redis: promotedRedis }, runtime: { ...spec.runtime, queue: "postgres" } }));
        assert.equal(/^  redis:$/m.test(compose), promotedRedis);
        assert.equal(/REDIS_URL/.test(compose), promotedRedis);
        assert.ok(!(await policy.listFiles()).some((path) => /0002|^secrets\//.test(path)));
        const config = await policy.readText(stack === "grammy" ? "src/config.ts" : "app/config.py");
        const required = config.slice(config.indexOf("REQUIRED_SECRETS"), config.indexOf(stack === "grammy" ? "];" : ")\n", config.indexOf("REQUIRED_SECRETS")));
        assert.match(required, /DATABASE_URL/);
        for (const path of stack === "grammy" ? ["docker-compose.yml", "src/main.ts", "src/config.ts", "package.json", "src/features/index.ts"] : ["docker-compose.yml", "app/bot.py", "app/config.py"]) {
          assert.ok(paths.includes(path), path);
        }
        const manifest = await readManifest(policy);
        assert.ok(manifest);
        assert.equal(manifest.specHash, before.specHash);
        assert.equal(manifest.specVersion, before.specVersion);
        assert.equal(manifest.generatedAt, before.generatedAt);
        for (const ref of result.files) {
          assert.equal(ref.sha256, sha256Hex(await policy.readText(ref.path)));
          assert.equal(manifest.files[ref.path], ref.sha256);
        }
        if (feature === "payments") assert.match(await policy.readText(stack === "grammy" ? "src/runtime/payments.ts" : "app/runtime/payments.py"), stack === "grammy" ? /PRODUCTS[^=]*= \[\]/ : /no products configured|PRODUCTS[^=]*= \[\]/);
      });
    }
  }
  test(`${stack} S2 preserves existing storage, migration, and config`, async (t) => {
    const { root, policy } = await fixture(t, stack, true);
    const migration = stack === "grammy" ? "drizzle/0001_runtime_schema.sql" : "migrations/versions/0001_runtime_schema.py";
    const configPath = stack === "grammy" ? "src/config.ts" : "app/config.py";
    const beforeMigration = await policy.readText(migration);
    const beforeConfig = await policy.readText(configPath);
    const result = ok(await addFeature({ projectRoot: root, feature: "llm", name: "custom_llm" }, { policy }));
    assert.equal(await policy.readText(migration), beforeMigration);
    assert.equal(await policy.readText(configPath), beforeConfig);
    const paths = result.files.map((file) => file.path);
    const infrastructure = (stack === "grammy" ? TS_INFRA : PY_INFRA).filter((path) => !path.includes("user-sync") && !path.includes("user_sync"));
    for (const path of infrastructure) assert.ok(paths.includes(path), path);
    assert.ok(!paths.includes(migration));
    const compose = await policy.readText("docker-compose.yml");
    assert.equal(compose.match(/condition: service_completed_successfully/g)?.length, 2);
    assert.equal(compose.match(/postgres:\n        condition: service_healthy/g)?.length, 3);
  });
  test(`${stack} S3 adds second queued feature without infrastructure writes`, async (t) => {
    const { root, policy } = await fixture(t, stack);
    ok(await addFeature({ projectRoot: root, feature: "llm", name: "custom_llm" }, { policy }));
    const result = ok(await addFeature({ projectRoot: root, feature: "broadcast", name: "custom_broadcast" }, { policy }));
    for (const path of stack === "grammy" ? TS_INFRA : PY_INFRA) assert.ok(!result.files.some((file) => file.path === path), path);
    assert.ok(!result.files.some((file) => file.path === "docker-compose.yml"));
    assert.match(await policy.readText("docker-compose.yml"), /^  llm_api_key:$/m);
    const before = await snapshot(policy);
    error(await addFeature({ projectRoot: root, feature: "broadcast", name: "custom_broadcast" }, { policy }), "feature_exists");
    assert.deepEqual(await snapshot(policy), before);
  });
  for (const kind of ["missing", "modified", "unowned"] as const) {
    test(`${stack} immutable database ${kind} fails before writes`, async (t) => {
      const { root, policy } = await fixture(t, stack);
      const path = stack === "grammy" ? "src/storage/db.ts" : "app/db/session.py";
      if (kind === "missing") await policy.removeFile(path);
      if (kind === "modified") await policy.writeFile(path, "modified\n", { overwrite: true });
      if (kind === "unowned") {
        const manifest = await readManifest(policy); assert.ok(manifest); delete manifest.files[path]; await writeManifest(policy, "", manifest);
      }
      const before = await snapshot(policy);
      const result = error(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }), kind === "missing" ? "project_unreadable" : "feature_exists");
      assert.ok(JSON.stringify(result.details).includes(path));
      assert.deepEqual(await snapshot(policy), before);
    });
  }
  for (const point of ["applyPatch", "manifest"] as const) {
    test(`${stack} transaction rolls back every byte after ${point} failure`, async (t) => {
      const { root, policy } = await fixture(t, stack);
      const before = await snapshot(policy);
      const write = policy.writeFile.bind(policy);
      let injected = false;
      policy.writeFile = async (path, content, options) => {
        if (!injected && path === (point === "manifest" ? ".aurifex/manifest.json" : (stack === "grammy" ? "src/runtime/queue.ts" : "app/runtime/queue.py"))) {
          injected = true;
          throw new Error(`injected ${point} failure`);
        }
        return write(path, content, options);
      };
      const result = await addFeature({ projectRoot: root, feature: "llm", name: "custom_llm" }, { policy });
      assert.equal(result.status, "error");
      assert.equal(injected, true);
      assert.deepEqual(await snapshot(policy), before);
    });
  }
}

for (const kind of ["modified", "unknown", "postgres_without_schema"] as const) {
  test(`S4 compose ${kind} rejects with zero writes`, async (t) => {
    const { root, policy, spec } = await fixture(t);
    const content = kind === "postgres_without_schema" ? renderCompose({ ...spec, storage: { ...spec.storage, postgres: true } }) : `${await policy.readText("docker-compose.yml")}  unknown: true\n`;
    if (kind === "modified") await policy.writeFile("docker-compose.yml", content, { overwrite: true });
    else await own(policy, "docker-compose.yml", content);
    const before = await snapshot(policy);
    error(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }), "feature_exists");
    assert.deepEqual(await snapshot(policy), before);
  });
}

for (const postgres of [false, true]) {
  test(`payments reconcile bootstrap is guarded ${postgres ? "S2" : "S3"}`, async (t) => {
    const { root, policy } = await fixture(t, "grammy", postgres);
    if (!postgres) ok(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }));
    ok(await addFeature({ projectRoot: root, feature: "payments", name: "payments" }, { policy }));
    assert.equal((await policy.readText("src/main.ts")).match(/reconcile:bootstrap/g)?.length, 1);
    ok(await addFeature({ projectRoot: root, feature: "payments", name: "payments", overwrite: true }, { policy }));
    assert.equal((await policy.readText("src/main.ts")).match(/reconcile:bootstrap/g)?.length, 1);
  });
}

for (const kind of ["canonical", "modified", "duplicate"] as const) {
  test(`legacy custom LLM ${kind} migrates atomically or rejects`, async (t) => {
    const { root, policy } = await fixture(t, "grammy", true, true);
    await own(policy, "src/features/custom_llm.ts", renderLegacyLlmEnqueueTs());
    if (kind === "modified") await policy.writeFile("src/features/custom_llm.ts", `${renderLegacyLlmEnqueueTs()}// edited\n`, { overwrite: true });
    if (kind === "duplicate") await own(policy, "src/features/second_llm.ts", renderLegacyLlmEnqueueTs());
    const before = await snapshot(policy);
    const result = await addFeature({ projectRoot: root, feature: "broadcast", name: "broadcast" }, { policy });
    if (kind === "canonical") {
      const value = ok(result);
      assert.equal(await policy.readText("src/features/custom_llm.ts"), renderLlmEnqueueTs());
      assert.ok(value.files.some((file) => file.path === "src/features/custom_llm.ts"));
    } else { error(result, "feature_exists"); assert.deepEqual(await snapshot(policy), before); }
  });
}

test("nested project returns prefixed file refs and manifest-local hashes", async (t) => {
  const { root, policy } = await fixture(t, "grammy", false, false, true, "bots/demo");
  const value = ok(await addFeature({ projectRoot: root, feature: "llm", name: "custom_llm" }, { policy }));
  const manifest = await readManifest(policy, "bots/demo"); assert.ok(manifest);
  for (const file of value.files) { assert.ok(file.path.startsWith("bots/demo/")); assert.equal(manifest.files[file.path.slice(10)], file.sha256); }
});

test("missing manifest gives recoverable non-circular guidance", async (t) => {
  const { root, policy } = await fixture(t);
  await policy.removeFile(".aurifex/manifest.json");
  const result = error(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }), "project_unreadable");
  assert.equal(result.detail, "no .aurifex/manifest.json found; restore the original .aurifex/manifest.json from version control, or scaffold a new project in a different directory");
  assert.deepEqual(result.details, { path: ".aurifex/manifest.json" });
});

test("command add preserves unrelated files, validates names and rejects repeat", async (t) => {
  const { root, policy } = await fixture(t);
  const value = ok(await addFeature({ projectRoot: root, feature: "commands", name: "greet" }, { policy }));
  assert.deepEqual(value.files.map((file) => file.path).toSorted(), ["src/features/greet.ts", "tests/greet.test.ts"]);
  error(await addFeature({ projectRoot: root, feature: "commands", name: "greet" }, { policy }), "feature_exists");
  for (const name of ["Admin", "9bad", "index", "a", "with-dash"]) error(await addFeature({ projectRoot: root, feature: "commands", name }, { policy }), "invalid_request");
});

// Baseline coverage restored from HEAD and adapted to promotion semantics: queued
// features now also create runtime infrastructure, so file sets here cover the
// non-queued features and the feature-owned payloads.

test("aiogram command feature writes handler and test", async (t) => {
  const { root, policy } = await fixture(t, "aiogram");
  const value = ok(await addFeature({ projectRoot: root, feature: "commands", name: "greet" }, { policy }));
  assert.deepEqual(value.files.map((file) => file.path).toSorted(), ["app/handlers/greet.py", "tests/test_greet.py"]);
});

const GRAMMY_FEATURE_FILES: ReadonlyArray<readonly [BotFeature, string, readonly string[]]> = [
  ["inline", "inline", ["src/features/inline.ts", "tests/inline.test.ts"]],
  ["moderation", "moderation", [".env.example", "src/features/moderation.ts", "tests/moderation.test.ts"]],
  ["widgets", "widget", ["src/features/widget.ts", "tests/widget.test.ts"]],
  ["rich", "rich", ["src/features/rich.ts", "tests/rich.test.ts"]],
];

for (const [feature, name, expected] of GRAMMY_FEATURE_FILES) {
  test(`grammy ${feature} feature writes expected files`, async (t) => {
    const { root, policy } = await fixture(t, "grammy");
    const value = ok(await addFeature({ projectRoot: root, feature, name }, { policy }));
    assert.deepEqual(value.files.map((file) => file.path).toSorted(), [...expected].toSorted());
  });
}

const AIOGRAM_FEATURE_FILES: ReadonlyArray<readonly [BotFeature, string, readonly string[]]> = [
  ["inline", "inline", ["app/handlers/inline.py", "tests/test_inline.py"]],
  ["moderation", "moderation", [".env.example", "app/middlewares/moderation.py", "app/handlers/moderation.py", "tests/test_moderation.py"]],
  ["widgets", "widget", ["app/handlers/widget.py", "tests/test_widget.py"]],
  ["rich", "rich", ["app/handlers/rich.py", "tests/test_rich.py"]],
];

for (const [feature, name, expected] of AIOGRAM_FEATURE_FILES) {
  test(`aiogram ${feature} feature writes expected files`, async (t) => {
    const { root, policy } = await fixture(t, "aiogram");
    const value = ok(await addFeature({ projectRoot: root, feature, name }, { policy }));
    assert.deepEqual(value.files.map((file) => file.path).toSorted(), [...expected].toSorted());
  });
}

test("grammy miniapps feature writes frontend and backend", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  const value = ok(await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp" }, { policy }));
  const written = value.files.map((file) => file.path);
  assert.ok(written.includes("miniapp/index.html"));
  assert.ok(written.includes("miniapp/package.json"));
  assert.ok(written.includes("src/features/miniapp.ts"));
  assert.ok(written.includes("tests/miniapp.test.ts"));
  const backend = await policy.readText("src/features/miniapp.ts");
  assert.match(backend, /\/api\/miniapp\/session/);
  assert.match(backend, /from "\.\.\/runtime\/miniapp-session\.js"/);
  assert.match(backend, /MINIAPP_SESSION_TTL_SECONDS/);
  assert.match(await policy.readText("src/runtime/miniapp-session.ts"), /86_400|86400/);
});

test("aiogram miniapps feature writes frontend and service", async (t) => {
  const { root, policy } = await fixture(t, "aiogram");
  const value = ok(await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp" }, { policy }));
  const written = value.files.map((file) => file.path);
  assert.ok(written.includes("miniapp/index.html"));
  assert.ok(written.includes("app/services/miniapp.py"));
  assert.ok(written.includes("tests/test_miniapp.py"));
  const service = await policy.readText("app/services/miniapp.py");
  assert.match(service, /\/api\/miniapp\/session/);
  assert.match(service, /from app\.runtime\.miniapp_session import/);
  assert.match(service, /assert_mutation_authorized/);
  assert.match(service, /MINIAPP_SESSION_TTL_SECONDS|session_ttl_seconds/);
});

test("miniapps requires the exact name miniapp", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  error(await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp_extra" }, { policy }), "invalid_request");
});

test("duplicate non-queued feature add is refused without overwrite", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  ok(await addFeature({ projectRoot: root, feature: "inline", name: "inline" }, { policy }));
  error(await addFeature({ projectRoot: root, feature: "inline", name: "inline" }, { policy }), "feature_exists");
});

test("overwrite replaces files and keeps unrelated files", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  await policy.writeFile("src/features/notes.ts", "export const notes = 1;\n");
  ok(await addFeature({ projectRoot: root, feature: "inline", name: "inline" }, { policy }));
  ok(await addFeature({ projectRoot: root, feature: "inline", name: "inline", overwrite: true }, { policy }));
  assert.equal(await policy.readText("src/features/notes.ts"), "export const notes = 1;\n");
});

test("miniapp frontend is refused on the second add", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  ok(await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp" }, { policy }));
  error(await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp" }, { policy }), "feature_exists");
});

test("invalid feature names are rejected", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  for (const name of ["Admin", "9bad", "admin", "index", "a", "with-dash"]) {
    error(await addFeature({ projectRoot: root, feature: "commands", name }, { policy }), "invalid_request");
  }
});

test("unknown feature is rejected", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  error(await addFeature({ projectRoot: root, feature: "nope" as BotFeature, name: "greet" }, { policy }), "invalid_request");
});

test("project root escape is unauthorized", async (t) => {
  const { policy } = await fixture(t, "grammy");
  const outside = await mkdtemp(join(tmpdir(), "aurifex-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  error(await addFeature({ projectRoot: outside, feature: "llm", name: "llm" }, { policy }), "unauthorized_path");
});

test("generated files contain no token literal", async (t) => {
  const { policy } = await fixture(t, "grammy");
  const value = ok(await addFeature({ projectRoot: policy.root, feature: "llm", name: "llm" }, { policy }));
  for (const file of value.files) {
    assert.doesNotMatch(await policy.readText(file.path), /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/);
  }
});

test("grammy widgets and rich use the Bot API 10.4 adapter", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  ok(await addFeature({ projectRoot: root, feature: "widgets", name: "widget" }, { policy }));
  ok(await addFeature({ projectRoot: root, feature: "rich", name: "rich" }, { policy }));
  const widgets = await policy.readText("src/features/widget.ts");
  assert.match(widgets, /from "\.\.\/telegram\/api104\.js"/);
  assert.match(widgets, /answerWidgetQuery/);
  assert.match(widgets, /shared_widget_query/);
  assert.match(widgets, /await next\(\)/);
  const rich = await policy.readText("src/features/rich.ts");
  assert.match(rich, /sendRichMessageDraft/);
  assert.match(rich, /rich_message: richMessage\(/);
  assert.match(rich, /sendRichMessage\(/);
});

test("aiogram widgets and rich use the Bot API 10.4 adapter", async (t) => {
  const { root, policy } = await fixture(t, "aiogram");
  ok(await addFeature({ projectRoot: root, feature: "widgets", name: "widget" }, { policy }));
  ok(await addFeature({ projectRoot: root, feature: "rich", name: "rich" }, { policy }));
  const widgets = await policy.readText("app/handlers/widget.py");
  assert.match(widgets, /from app\.services\.api104 import answer_widget_query/);
  assert.match(widgets, /ANSWER_TIMEOUT_SECONDS = 15/);
  const rich = await policy.readText("app/handlers/rich.py");
  assert.match(rich, /send_rich_message_draft/);
  assert.match(rich, /send_rich_message\(/);
});

test("aiogram broadcast uses the shared retry helper", async (t) => {
  const { root, policy } = await fixture(t, "aiogram");
  ok(await addFeature({ projectRoot: root, feature: "broadcast", name: "broadcast" }, { policy }));
  const broadcast = await policy.readText("app/jobs/broadcast.py");
  assert.match(broadcast, /retry_after/);
  assert.match(broadcast, /broadcast:rate:/);
});

test("feature add appends missing env keys once and preserves existing values", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  ok(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }));
  const first = await policy.readText(".env.example");
  ok(await addFeature({ projectRoot: root, feature: "llm", name: "llm", overwrite: true }, { policy }));
  const second = await policy.readText(".env.example");
  assert.equal(second, first);
  assert.match(second, /^BOT_TOKEN=$/m);
  assert.equal(second.match(/^LLM_MODEL=/gm)?.length, 1);
  assert.match(second, /^LLM_BASE_URL=https:\/\/api\.openai\.com\/v1$/m);
  assert.match(second, /^LLM_API_KEY=$/m);
});

test("payments and miniapps add their env keys without duplicating config", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  ok(await addFeature({ projectRoot: root, feature: "payments", name: "payments" }, { policy }));
  const afterPayments = await policy.readText("src/config.ts");
  ok(await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp" }, { policy }));
  const env = await policy.readText(".env.example");
  assert.match(env, /^PAYSUPPORT_TEXT=Contact support for payment issues\.$/m);
  assert.match(env, /^MINIAPP_SESSION_TTL_SECONDS=86400$/m);
  assert.match(env, /^MINIAPP_ALLOWED_ORIGINS=$/m);
  assert.equal(await policy.readText("src/config.ts"), afterPayments);
});

test("broadcast inserts its config entry between the grammy markers", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  ok(await addFeature({ projectRoot: root, feature: "broadcast", name: "broadcast" }, { policy }));
  const config = await policy.readText("src/config.ts");
  assert.match(config, /\/\/ aurifex:config\nexport const BROADCAST_RATE = Number\(process\.env\.BROADCAST_RATE \?\? 30\);\n\/\/ aurifex:config-end/);
  assert.match(await policy.readText(".env.example"), /^BROADCAST_RATE=30$/m);
});

test("broadcast inserts its config entry between the aiogram markers", async (t) => {
  const { root, policy } = await fixture(t, "aiogram");
  ok(await addFeature({ projectRoot: root, feature: "broadcast", name: "broadcast" }, { policy }));
  const config = await policy.readText("app/config.py");
  assert.match(config, /# aurifex:config\nBROADCAST_RATE = int\(os\.getenv\("BROADCAST_RATE", "30"\)\)\n# aurifex:config-end/);
});

test("config without aurifex markers is refused instead of rewritten", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  await own(policy, "src/config.ts", "export const base = 1;\n");
  const before = await snapshot(policy);
  error(await addFeature({ projectRoot: root, feature: "broadcast", name: "broadcast" }, { policy }), "feature_exists");
  assert.deepEqual(await snapshot(policy), before);
});

test("manifest records written file hashes and preserves other entries", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  const manifest = await readManifest(policy);
  assert.ok(manifest);
  await writeManifest(policy, "", { ...manifest, files: { ...manifest.files, "src/index.ts": "b".repeat(64) } });
  const value = ok(await addFeature({ projectRoot: root, feature: "inline", name: "inline" }, { policy }));
  const next = await readManifest(policy);
  assert.ok(next);
  assert.equal(next.files["src/index.ts"], "b".repeat(64));
  for (const file of value.files) assert.equal(next.files[file.path], file.sha256);
});

test("later patch conflict rolls feature files back", async (t) => {
  const { root, policy } = await fixture(t, "grammy");
  await policy.removeFile(".env.example");
  await mkdir(join(root, ".env.example"));
  error(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }), "project_unreadable");
  await assert.rejects(policy.readText("src/features/llm.ts"));
  await assert.rejects(policy.readText("src/jobs/llm.ts"));
  await assert.rejects(policy.readText("src/runtime/queue.ts"));
});

test("S2 promotion keeps a pre-existing payments feature registered", async (t) => {
  const { root, policy } = await fixture(t, "grammy", true, false, true, "", ["commands", "payments"]);
  const value = ok(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }));
  assert.ok(value.files.some((file) => file.path === "src/runtime/queue.ts"));
  assert.match(await policy.readText("src/features/payments.ts"), /register\(bot: Bot/);
  assert.match(await policy.readText("src/main.ts"), /reconcile:bootstrap/);
});

for (const stack of ["grammy", "aiogram"] as const) {
  test(`${stack} half-promoted postgres state is refused before writes`, async (t) => {
    const { root, policy } = await fixture(t, stack, true);
    await policy.removeFile(stack === "grammy" ? "src/security/user-sync.ts" : "app/middlewares/user_sync.py");
    const before = await snapshot(policy);
    error(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }), "feature_exists");
    assert.deepEqual(await snapshot(policy), before);
  });
  test(`${stack} queue module without a worker entrypoint is refused`, async (t) => {
    const { root, policy } = await fixture(t, stack);
    const queuePath = stack === "grammy" ? "src/runtime/queue.ts" : "app/runtime/queue.py";
    await own(policy, queuePath, "export {};\n");
    const before = await snapshot(policy);
    error(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }), "feature_exists");
    assert.deepEqual(await snapshot(policy), before);
  });
}

for (const stack of ["grammy", "aiogram"] as const) {
  test(`${stack} S1 promotion keeps redis enabled and writes no secret files`, async (t) => {
    const { root, policy, spec } = await fixture(t, stack);
    const value = ok(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }));
    assert.equal(await policy.readText("docker-compose.yml"), renderCompose({
      ...spec,
      features: ["commands", "llm"],
      storage: { postgres: true, redis: true },
      runtime: { ...spec.runtime, queue: "postgres" },
    }));
    assert.ok((await policy.listFiles()).every((path) => !path.startsWith("secrets/")));
    assert.ok(value.files.every((file) => !file.path.startsWith("secrets/")));
  });
}

for (const postgres of [false, true]) {
  test(`grammy S${postgres ? 2 : 1} keeps a custom display name byte-identically`, async (t) => {
    const { root, policy } = await fixture(t, "grammy", postgres, false, true, "", ["commands"], { displayName: "Docker grammy Bot" });
    ok(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }));
    const main = await policy.readText("src/main.ts");
    assert.match(main, /"Docker grammy Bot"/);
    assert.doesNotMatch(main, /"Docker Grammy Bot"/);
  });
}

test("widgets add accepts a custom display name", async (t) => {
  const { root, policy } = await fixture(t, "grammy", false, false, true, "", ["commands"], { displayName: "Docker grammy Bot" });
  ok(await addFeature({ projectRoot: root, feature: "widgets", name: "widget" }, { policy }));
  assert.match(await policy.readText("src/features/widget.ts"), /answerWidgetQuery/);
});

for (const stack of ["grammy", "aiogram"] as const) {
  test(`${stack} broadcast promotion provisions the Redis service its job requires`, async (t) => {
    const { root, policy } = await fixture(t, stack, false, false, false);
    ok(await addFeature({ projectRoot: root, feature: "broadcast", name: "broadcast" }, { policy }));
    const compose = await policy.readText("docker-compose.yml");
    assert.match(compose, /^  redis:$/m);
    assert.match(compose, /REDIS_URL: redis:\/\//);
  });
}

for (const stack of ["grammy", "aiogram"] as const) {
  test(`${stack} llm promotion does not invent Redis when the project has none`, async (t) => {
    const { root, policy } = await fixture(t, stack, false, false, false);
    ok(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }));
    const compose = await policy.readText("docker-compose.yml");
    assert.doesNotMatch(compose, /^  redis:$/m);
    assert.doesNotMatch(compose, /REDIS_URL/);
  });
}
