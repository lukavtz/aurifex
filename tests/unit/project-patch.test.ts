import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";

import { createPathPolicy, type PathPolicy } from "../../src/core/security/path-policy.ts";
import {
  CONFIG_TS_MARKERS,
  applyPatch,
  type ProjectPatch,
} from "../../src/core/projects/project-patch.ts";

const tempDirs = new Set<string>();

afterEach(async () => {
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
});

async function makeProject(files: Record<string, string> = {}): Promise<PathPolicy> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurifex-patch-")));
  tempDirs.add(root);
  const policy = await createPathPolicy(root);
  for (const [path, content] of Object.entries(files)) {
    await policy.writeFile(path, content);
  }
  return policy;
}

function patch(overrides: Partial<ProjectPatch>): ProjectPatch {
  return { files: [], env: [], ...overrides };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal(errorCode(error), code);
    return true;
  });
}

test("appends missing env keys once and preserves existing values", async () => {
  const policy = await makeProject({ ".env.example": "BOT_TOKEN=\n" });
  const value = patch({
    env: [
      { key: "LLM_MODEL", value: "gpt-5" },
      { key: "BOT_TOKEN", value: "do-not-overwrite" },
    ],
  });

  await applyPatch(policy, "", value, { files: {} });
  await applyPatch(policy, "", value, { files: {} });

  const text = await policy.readText(".env.example");
  assert.equal(text, "BOT_TOKEN=\nLLM_MODEL=gpt-5\n");
});

test("inserts config exports before the end marker, idempotently", async () => {
  const policy = await makeProject({
    "src/config.ts": `export const base = 1;\n${CONFIG_TS_MARKERS.start}\n${CONFIG_TS_MARKERS.end}\nexport const after = 2;\n`,
  });
  const value = patch({
    configTs: [
      {
        key: "BROADCAST_RATE",
        expression: "Number(process.env.BROADCAST_RATE ?? 30)",
      },
    ],
  });

  await applyPatch(policy, "", value, { files: {} });
  await applyPatch(policy, "", value, { files: {} });

  const text = await policy.readText("src/config.ts");
  assert.equal(
    text,
    `export const base = 1;\n${CONFIG_TS_MARKERS.start}\nexport const BROADCAST_RATE = Number(process.env.BROADCAST_RATE ?? 30);\n${CONFIG_TS_MARKERS.end}\nexport const after = 2;\n`,
  );
});

test("rejects config edits when the markers are missing", async () => {
  const policy = await makeProject({ "src/config.ts": "export const base = 1;\n" });

  await rejectsWithCode(
    applyPatch(
      policy,
      "",
      patch({ configTs: [{ key: "NOPE", expression: "true" }] }),
      { files: {} },
    ),
    "project_unreadable",
  );

  assert.equal(await policy.readText("src/config.ts"), "export const base = 1;\n");
});

test("patches package dependencies deterministically", async () => {
  const policy = await makeProject({
    "package.json": `${JSON.stringify(
      { name: "bot", dependencies: { zod: "4.6.7", grammy: "1.46.0" } },
      null,
      2,
    )}\n`,
  });

  await applyPatch(
    policy,
    "",
    patch({ packageDependencies: { ioredis: "6.0.0", zod: "4.7.0" } }),
    { files: {} },
  );

  const parsed: unknown = JSON.parse(await policy.readText("package.json"));
  assert.ok(typeof parsed === "object" && parsed !== null && "dependencies" in parsed);
  const { dependencies } = parsed;
  assert.ok(typeof dependencies === "object" && dependencies !== null);
  assert.deepEqual(dependencies, {
    grammy: "1.46.0",
    ioredis: "6.0.0",
    zod: "4.7.0",
  });
  assert.deepEqual(Object.keys(dependencies), ["grammy", "ioredis", "zod"]);
});

test("rolls back earlier writes when a later file conflicts", async () => {
  const policy = await makeProject({ "src/jobs/b.ts": "export const b = 1;\n" });

  await rejectsWithCode(
    applyPatch(
      policy,
      "",
      patch({
        files: [
          { path: "src/jobs/a.ts", content: "export const a = 1;\n" },
          { path: "src/jobs/b.ts", content: "export const b = 2;\n" },
        ],
      }),
      { files: {} },
    ),
    "project_unreadable",
  );

  await assert.rejects(policy.readText("src/jobs/a.ts"));
  assert.equal(await policy.readText("src/jobs/b.ts"), "export const b = 1;\n");
});

test("rejects paths escaping the project prefix", async () => {
  const policy = await makeProject();

  await rejectsWithCode(
    applyPatch(
      policy,
      "bot",
      patch({ files: [{ path: "../evil.ts", content: "boom\n" }] }),
      { files: {} },
    ),
    "invalid_request",
  );
  await rejectsWithCode(
    applyPatch(policy, "../outside", patch({ env: [{ key: "A", value: "1" }] }), { files: {} }),
    "invalid_request",
  );

  await assert.rejects(policy.readText("evil.ts"));
});

test("appends pyproject dependencies, schema SQL, and compose services", async () => {
  const policy = await makeProject({
    "pyproject.toml": `[project]\nname = "bot"\ndependencies = [\n  "aiogram==3.31.0",\n]\n`,
    "docker-compose.yml": "services:\n  bot:\n    build: .\n  # aurifex:services\n",
  });

  await applyPatch(
    policy,
    "",
    patch({
      pyprojectDependencies: ["httpx==0.28.1", "aiogram==3.31.0"],
      schemaSql: "CREATE TABLE jobs (id uuid PRIMARY KEY);\n",
      compose: { worker: true, migrate: true },
    }),
    { files: {} },
  );

  const pyproject = await policy.readText("pyproject.toml");
  assert.match(pyproject, /"httpx==0\.28\.1",/u);
  assert.equal(pyproject.match(/"aiogram==3\.31\.0"/gu)?.length, 1);
  assert.equal(
    await policy.readText("drizzle/0001_schema.sql"),
    "CREATE TABLE jobs (id uuid PRIMARY KEY);\n",
  );

  const compose = await policy.readText("docker-compose.yml");
  assert.match(compose, /^ {2}migrate:$/mu);
  assert.match(compose, /^ {2}worker:$/mu);
  assert.match(compose, /command: \["node", "dist\/worker\.js"\]/u);
  assert.match(compose, /^ {2}# aurifex:services$/mu);
});

test("writes template and migration files under the prefix", async () => {
  const policy = await makeProject({ "bots/x/.env.example": "A=\n" });

  const refs = await applyPatch(
    policy,
    "bots/x",
    patch({
      files: [{ path: "src/jobs/llm.ts", content: "export const kind = 'llm';\n" }],
      migrationFiles: [{ path: "drizzle/0001_jobs.sql", content: "select 1;\n" }],
      env: [{ key: "LLM_MODEL", value: "gpt-5" }],
    }),
    { files: {} },
  );

  assert.equal(refs.length, 3);
  assert.equal(
    await readFile(join(policy.root, "bots/x/src/jobs/llm.ts"), "utf8"),
    "export const kind = 'llm';\n",
  );
  assert.equal(await policy.readText("bots/x/drizzle/0001_jobs.sql"), "select 1;\n");
  assert.equal(await policy.readText("bots/x/.env.example"), "A=\nLLM_MODEL=gpt-5\n");
});