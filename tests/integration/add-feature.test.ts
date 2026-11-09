import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { addFeature, type FeatureResult } from "../../src/core/projects/add-feature.ts";
import type { AurifexManifest } from "../../src/core/projects/manifest.ts";
import { readManifest, writeManifest } from "../../src/core/projects/manifest.ts";
import type { DomainResult } from "../../src/core/results.ts";
import { createPathPolicy, type PathPolicy } from "../../src/core/security/path-policy.ts";
import type { BotFeature, BotStack } from "../../src/core/spec/bot-spec.ts";

const GRAMMY_MANIFEST = `${JSON.stringify(
  { name: "demo_bot", private: true, dependencies: { grammy: "1.46.0" } },
  null,
  2,
)}\n`;

const AIOGRAM_MANIFEST = `[project]
name = "demo-bot"
version = "0.1.0"
dependencies = ["aiogram==3.31.0"]
`;

const ENV_EXAMPLE = "BOT_TOKEN=\nLLM_MODEL=\n";

const CONFIG_TS = "export const base = 1;\n// aurifex:config\n// aurifex:config-end\n";

const CONFIG_PY = "BASE = 1\n# aurifex:config\n# aurifex:config-end\n";

interface Fixture {
  readonly root: string;
  readonly policy: PathPolicy;
}

function demoManifest(stack: BotStack, files: Record<string, string> = {}): AurifexManifest {
  return {
    manifestVersion: 1,
    specVersion: "bot-spec-1.1.0",
    stack,
    specHash: "a".repeat(64),
    generatedAt: "2026-01-01T00:00:00.000Z",
    files,
  };
}

async function fixture(manifest: "grammy" | "aiogram" | "none" | "no-manifest"): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "aurifex-feature-"));
  const policy = await createPathPolicy(root);
  if (manifest === "grammy") {
    await policy.writeFile("package.json", GRAMMY_MANIFEST);
    await policy.writeFile(".env.example", ENV_EXAMPLE);
    await policy.writeFile("src/config.ts", CONFIG_TS);
    await writeManifest(policy, "", demoManifest("grammy"));
  }
  if (manifest === "aiogram") {
    await policy.writeFile("pyproject.toml", AIOGRAM_MANIFEST);
    await policy.writeFile(".env.example", ENV_EXAMPLE);
    await policy.writeFile("app/config.py", CONFIG_PY);
    await writeManifest(policy, "", demoManifest("aiogram"));
  }
  if (manifest === "no-manifest") await policy.writeFile("package.json", GRAMMY_MANIFEST);
  return { root: policy.root, policy };
}

function expectOk(result: DomainResult<FeatureResult>): FeatureResult {
  if (result.status !== "ok") {
    assert.fail(`expected ok, got ${result.error.code}: ${result.error.detail}`);
  }
  return result.value;
}

function expectError(result: DomainResult<FeatureResult>, code: string): void {
  if (result.status !== "error") assert.fail("expected an error result");
  assert.equal(result.error.code, code);
}

function paths(result: FeatureResult): string[] {
  return result.files.map((file) => file.path).toSorted();
}

test("grammy command feature writes module and test", async () => {
  const { root, policy } = await fixture("grammy");
  const result = expectOk(
    await addFeature({ projectRoot: root, feature: "commands", name: "greet" }, { policy }),
  );
  assert.deepEqual(paths(result), ["src/features/greet.ts", "tests/greet.test.ts"]);
  assert.equal(result.root, root);
  assert.equal(result.feature, "commands");
  for (const file of result.files) assert.match(file.sha256, /^[a-f0-9]{64}$/);
});

test("aiogram command feature writes handler and test", async () => {
  const { root, policy } = await fixture("aiogram");
  const result = expectOk(
    await addFeature({ projectRoot: root, feature: "commands", name: "greet" }, { policy }),
  );
  assert.deepEqual(paths(result), ["app/handlers/greet.py", "tests/test_greet.py"]);
});

const GRAMMY_FEATURES: ReadonlyArray<readonly [BotFeature, string, readonly string[]]> = [
  ["llm", "llm", ["src/features/llm.ts", "src/jobs/llm.ts", "tests/llm.test.ts"]],
  ["inline", "inline", ["src/features/inline.ts", "tests/inline.test.ts"]],
  [
    "payments",
    "payments",
    [
      "src/features/payments.ts",
      "src/jobs/payments-reconcile.ts",
      "src/jobs/payments.ts",
      "src/runtime/payments.ts",
      "tests/payments.test.ts",
    ],
  ],
  ["moderation", "moderation", ["src/features/moderation.ts", "tests/moderation.test.ts"]],
  [
    "broadcast",
    "broadcast",
    ["src/features/broadcast.ts", "src/jobs/broadcast.ts", "tests/broadcast.test.ts"],
  ],
  ["widgets", "widget", ["src/features/widget.ts", "tests/widget.test.ts"]],
  ["rich", "rich", ["src/features/rich.ts", "tests/rich.test.ts"]],
];

for (const [feature, name, expected] of GRAMMY_FEATURES) {
  test(`grammy ${feature} feature writes expected files`, async () => {
    const { root, policy } = await fixture("grammy");
    const result = expectOk(await addFeature({ projectRoot: root, feature, name }, { policy }));
    assert.deepEqual(paths(result), [...expected].toSorted());
  });
}

const AIOGRAM_FEATURES: ReadonlyArray<readonly [BotFeature, string, readonly string[]]> = [
  ["llm", "llm", ["app/handlers/llm.py", "app/jobs/llm.py"]],
  ["inline", "inline", ["app/handlers/inline.py", "tests/test_inline.py"]],
  [
    "payments",
    "payments",
    [
      "app/handlers/payments.py",
      "app/jobs/payment_fulfill.py",
      "app/jobs/payment_reconcile.py",
      "app/runtime/payments.py",
      "tests/test_payments.py",
    ],
  ],
  ["moderation", "moderation", ["app/middlewares/moderation.py", "tests/test_moderation.py"]],
  ["broadcast", "broadcast", ["app/handlers/broadcast.py", "app/jobs/broadcast.py"]],
  ["widgets", "widget", ["app/handlers/widget.py", "tests/test_widget.py"]],
  ["rich", "rich", ["app/handlers/rich.py", "tests/test_rich.py"]],
];

for (const [feature, name, expected] of AIOGRAM_FEATURES) {
  test(`aiogram ${feature} feature writes expected files`, async () => {
    const { root, policy } = await fixture("aiogram");
    const result = expectOk(await addFeature({ projectRoot: root, feature, name }, { policy }));
    assert.deepEqual(paths(result), [...expected].toSorted());
  });
}

test("grammy miniapps feature writes frontend and backend", async () => {
  const { root, policy } = await fixture("grammy");
  const result = expectOk(
    await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp" }, { policy }),
  );
  const written = paths(result);
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

test("aiogram miniapps feature writes frontend and service", async () => {
  const { root, policy } = await fixture("aiogram");
  const result = expectOk(
    await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp" }, { policy }),
  );
  const written = paths(result);
  assert.ok(written.includes("miniapp/index.html"));
  assert.ok(written.includes("app/services/miniapp.py"));
  assert.ok(written.includes("tests/test_miniapp.py"));
  const service = await policy.readText("app/services/miniapp.py");
  assert.match(service, /\/api\/miniapp\/session/);
  assert.match(service, /from app\.runtime\.miniapp_session import/);
  assert.match(service, /assert_mutation_authorized/);
  assert.match(service, /MINIAPP_SESSION_TTL_SECONDS|session_ttl_seconds/);
});

test("miniapps requires the exact name miniapp", async () => {
  const { root, policy } = await fixture("grammy");
  expectError(
    await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp_extra" }, { policy }),
    "invalid_request",
  );
});

test("duplicate feature add is refused without overwrite", async () => {
  const { root, policy } = await fixture("grammy");
  expectOk(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }));
  expectError(
    await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }),
    "feature_exists",
  );
});

test("overwrite replaces files and keeps unrelated files", async () => {
  const { root, policy } = await fixture("grammy");
  await policy.writeFile("src/features/notes.ts", "export const notes = 1;\n");
  expectOk(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }));
  expectOk(
    await addFeature(
      { projectRoot: root, feature: "llm", name: "llm", overwrite: true },
      { policy },
    ),
  );
  assert.equal(await policy.readText("src/features/notes.ts"), "export const notes = 1;\n");
});

test("miniapp frontend is refused on the second add", async () => {
  const { root, policy } = await fixture("grammy");
  expectOk(
    await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp" }, { policy }),
  );
  expectError(
    await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp" }, { policy }),
    "feature_exists",
  );
});

test("invalid feature names are rejected", async () => {
  const { root, policy } = await fixture("grammy");
  for (const name of ["Admin", "9bad", "admin", "index", "a", "with-dash"]) {
    expectError(
      await addFeature({ projectRoot: root, feature: "commands", name }, { policy }),
      "invalid_request",
    );
  }
});

test("unknown feature is rejected", async () => {
  const { root, policy } = await fixture("grammy");
  expectError(
    await addFeature(
      { projectRoot: root, feature: "nope" as BotFeature, name: "greet" },
      { policy },
    ),
    "invalid_request",
  );
});

test("project without a manifest is unreadable", async () => {
  const { root, policy } = await fixture("no-manifest");
  const result = await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy });
  if (result.status !== "error") assert.fail("expected an error result");
  assert.equal(result.error.code, "project_unreadable");
  assert.equal(result.error.detail, "run aurifex upgrade --apply first");
});

test("project root escape is unauthorized", async () => {
  const { policy } = await fixture("grammy");
  const outside = await mkdtemp(join(tmpdir(), "aurifex-outside-"));
  expectError(
    await addFeature({ projectRoot: outside, feature: "llm", name: "llm" }, { policy }),
    "unauthorized_path",
  );
});

test("generated files contain no token literal", async () => {
  const { root, policy } = await fixture("grammy");
  const result = expectOk(
    await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }),
  );
  for (const file of result.files) {
    const content = await readFile(join(root, file.path), "utf8");
    assert.doesNotMatch(content, /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/);
  }
});

test("nested project roots are detected and prefixed", async () => {
  const { policy } = await fixture("none");
  await policy.writeFile("bots/demo/package.json", GRAMMY_MANIFEST);
  await writeManifest(policy, "bots/demo", demoManifest("grammy"));
  const result = expectOk(
    await addFeature({ projectRoot: "bots/demo", feature: "llm", name: "llm" }, { policy }),
  );
  assert.deepEqual(paths(result), [
    "bots/demo/src/features/llm.ts",
    "bots/demo/src/jobs/llm.ts",
    "bots/demo/tests/llm.test.ts",
  ]);
});

test("grammy widgets and rich use the Bot API 10.4 adapter", async () => {
  const { root, policy } = await fixture("grammy");
  expectOk(await addFeature({ projectRoot: root, feature: "widgets", name: "widget" }, { policy }));
  expectOk(await addFeature({ projectRoot: root, feature: "rich", name: "rich" }, { policy }));
  const widgets = await policy.readText("src/features/widget.ts");
  assert.match(widgets, /from "\.\.\/telegram\/api104\.js"/);
  assert.match(widgets, /answerWidgetQuery/);
  assert.match(widgets, /15_000/);
  const rich = await policy.readText("src/features/rich.ts");
  assert.match(rich, /sendRichMessageDraft/);
  assert.match(rich, /rich_message: richMessage\(/);
  assert.match(rich, /sendRichMessage\(/);
});

test("aiogram widgets and rich use the Bot API 10.4 adapter", async () => {
  const { root, policy } = await fixture("aiogram");
  expectOk(await addFeature({ projectRoot: root, feature: "widgets", name: "widget" }, { policy }));
  expectOk(await addFeature({ projectRoot: root, feature: "rich", name: "rich" }, { policy }));
  const widgets = await policy.readText("app/handlers/widget.py");
  assert.match(widgets, /from app\.services\.api104 import answer_widget_query/);
  assert.match(widgets, /ANSWER_TIMEOUT_SECONDS = 15/);
  const rich = await policy.readText("app/handlers/rich.py");
  assert.match(rich, /send_rich_message_draft/);
  assert.match(rich, /send_rich_message\(/);
});

test("aiogram broadcast uses the shared retry helper", async () => {
  const { root, policy } = await fixture("aiogram");
  expectOk(
    await addFeature({ projectRoot: root, feature: "broadcast", name: "broadcast" }, { policy }),
  );
  const broadcast = await policy.readText("app/jobs/broadcast.py");
  assert.match(broadcast, /retry_after/);
  assert.match(broadcast, /broadcast:rate:/);
});

test("feature add appends missing env keys once and preserves existing values", async () => {
  const { root, policy } = await fixture("grammy");
  expectOk(await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }));
  const first = await policy.readText(".env.example");
  expectOk(
    await addFeature(
      { projectRoot: root, feature: "llm", name: "llm", overwrite: true },
      { policy },
    ),
  );
  const second = await policy.readText(".env.example");
  assert.equal(second, first);
  assert.match(second, /^BOT_TOKEN=$/m);
  assert.equal(second.match(/^LLM_MODEL=/gm)?.length, 1);
  assert.match(second, /^LLM_BASE_URL=https:\/\/api\.openai\.com\/v1$/m);
  assert.match(second, /^LLM_API_KEY=$/m);
});

test("payments and miniapps add their env keys without duplicating config", async () => {
  const { root, policy } = await fixture("grammy");
  expectOk(
    await addFeature({ projectRoot: root, feature: "payments", name: "payments" }, { policy }),
  );
  expectOk(
    await addFeature({ projectRoot: root, feature: "miniapps", name: "miniapp" }, { policy }),
  );
  const env = await policy.readText(".env.example");
  assert.match(env, /^PAYSUPPORT_TEXT=Contact support for payment issues\.$/m);
  assert.match(env, /^MINIAPP_SESSION_TTL_SECONDS=86400$/m);
  assert.match(env, /^MINIAPP_ALLOWED_ORIGINS=$/m);
  const config = await policy.readText("src/config.ts");
  assert.equal(config, CONFIG_TS);
});

test("broadcast inserts its config entry between the grammy markers", async () => {
  const { root, policy } = await fixture("grammy");
  expectOk(
    await addFeature({ projectRoot: root, feature: "broadcast", name: "broadcast" }, { policy }),
  );
  const config = await policy.readText("src/config.ts");
  assert.match(
    config,
    /\/\/ aurifex:config\nexport const BROADCAST_RATE = Number\(process\.env\.BROADCAST_RATE \?\? 30\);\n\/\/ aurifex:config-end/,
  );
  assert.match(await policy.readText(".env.example"), /^BROADCAST_RATE=30$/m);
});

test("broadcast inserts its config entry between the aiogram markers", async () => {
  const { root, policy } = await fixture("aiogram");
  expectOk(
    await addFeature({ projectRoot: root, feature: "broadcast", name: "broadcast" }, { policy }),
  );
  const config = await policy.readText("app/config.py");
  assert.match(
    config,
    /# aurifex:config\nBROADCAST_RATE = int\(os\.getenv\("BROADCAST_RATE", "30"\)\)\n# aurifex:config-end/,
  );
});

test("config insertion is skipped when the project has no aurifex markers", async () => {
  const { root, policy } = await fixture("grammy");
  await policy.writeFile("src/config.ts", "export const base = 1;\n", { overwrite: true });
  expectOk(
    await addFeature({ projectRoot: root, feature: "broadcast", name: "broadcast" }, { policy }),
  );
  assert.equal(await policy.readText("src/config.ts"), "export const base = 1;\n");
});

test("manifest records written file hashes and preserves other entries", async () => {
  const { root, policy } = await fixture("grammy");
  const existing = demoManifest("grammy", { "src/index.ts": "b".repeat(64) });
  await writeManifest(policy, "", existing);
  const result = expectOk(
    await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }),
  );
  const manifest = await readManifest(policy, "");
  assert.ok(manifest !== null);
  assert.equal(manifest.specHash, existing.specHash);
  assert.equal(manifest.generatedAt, existing.generatedAt);
  assert.equal(manifest.files["src/index.ts"], "b".repeat(64));
  for (const file of result.files) {
    assert.equal(manifest.files[file.path], file.sha256);
  }
  assert.match(manifest.files[".env.example"] ?? "", /^[a-f0-9]{64}$/);
});

test("later patch conflict rolls feature files back", async () => {
  const { root, policy } = await fixture("grammy");
  await policy.removeFile(".env.example");
  await mkdir(join(root, ".env.example"));
  expectError(
    await addFeature({ projectRoot: root, feature: "llm", name: "llm" }, { policy }),
    "project_unreadable",
  );
  await assert.rejects(policy.readText("src/features/llm.ts"));
  await assert.rejects(policy.readText("src/jobs/llm.ts"));
});
