import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { DomainResult } from "../../src/core/results.ts";
import { sha256Hex } from "../../src/core/results.ts";
import type { AurifexManifest } from "../../src/core/projects/manifest.ts";
import { MANIFEST_PATH, serializeManifest } from "../../src/core/projects/manifest.ts";
import { scaffoldBot } from "../../src/core/projects/scaffold.ts";
import type { ScaffoldResult } from "../../src/core/projects/scaffold.ts";
import { renderAiogramProject } from "../../src/core/projects/templates/aiogram.ts";
import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import type { PathPolicy } from "../../src/core/security/path-policy.ts";
import { createPathPolicy } from "../../src/core/security/path-policy.ts";
import { TELEGRAM_TOKEN_RE } from "../../src/core/security/secrets.ts";
import type { BotSpec, BotStack } from "../../src/core/spec/bot-spec.ts";
import { botSpecHash, validateBotSpec } from "../../src/core/spec/bot-spec.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";

const BASE_SPEC: Record<string, unknown> = {
  schemaVersion: "bot-spec-1.0.0",
  name: "sample_bot",
  displayName: "Sample Bot",
  stack: "grammy",
  features: ["commands", "llm", "inline", "payments", "miniapps", "moderation", "broadcast"],
  payments: {
    products: [
      {
        id: "support",
        title: "Support",
        description: "Support the bot",
        stars: 1,
        subscription: false,
      },
    ],
  },
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
};

function specFor(
  stack: BotStack,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...structuredClone(BASE_SPEC), stack, ...overrides };
}

async function makeRoot(label: string): Promise<{ root: string; policy: PathPolicy }> {
  const root = await mkdtemp(join(tmpdir(), `aurifex-scaffold-${label}-`));
  return { root, policy: await createPathPolicy(root) };
}

function expectOk(result: DomainResult<ScaffoldResult>): ScaffoldResult {
  assert.ok(result.status === "ok", JSON.stringify(result));
  return result.value;
}

async function stagingEntries(root: string): Promise<string[]> {
  return (await readdir(root)).filter((name) => name.includes(".aurifex-staging-"));
}

function expectedManifest(spec: BotSpec, generatedAt: string): AurifexManifest {
  const rendered = expectedRendered(spec);
  return {
    manifestVersion: 1,
    specVersion: spec.schemaVersion,
    stack: spec.stack,
    specHash: botSpecHash(spec),
    generatedAt,
    files: Object.fromEntries(rendered.map((file) => [file.path, file.sha256])),
  };
}

function expectedRendered(spec: BotSpec): Array<{ path: string; sha256: string }> {
  const files =
    spec.stack === "grammy"
      ? renderGrammyProject(spec, resolveStack("grammy").target)
      : renderAiogramProject(spec);
  return files
    .map((file) => ({ path: file.path, sha256: sha256Hex(file.content) }))
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function expectedFiles(
  spec: BotSpec,
  generatedAt = new Date(0).toISOString(),
): Array<{ path: string; sha256: string }> {
  const rendered = expectedRendered(spec);
  const manifest = expectedManifest(spec, generatedAt);
  return [
    ...rendered,
    { path: MANIFEST_PATH, sha256: sha256Hex(serializeManifest(manifest)) },
  ].toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const GRAMMY_STEPS = [
  "cp .env.example .env",
  "set BOT_TOKEN and WEBHOOK_SECRET in .env",
  "bun install",
  "bun run typecheck && bun test",
  "bun run db:generate && bun run db:migrate",
];

const AIOGRAM_STEPS = [
  "cp .env.example .env",
  "set BOT_TOKEN and WEBHOOK_SECRET in .env",
  "uv sync && uv run pytest",
  "uv run alembic upgrade head",
];

test("scaffolds a self-consistent grammY project", async () => {
  const { root, policy } = await makeRoot("grammy");
  try {
    const requestSpec = specFor("grammy");
    const result = await scaffoldBot(
      { destination: "sample-bot", spec: requestSpec },
      { policy, now: () => new Date(0) },
    );
    const value = expectOk(result);
    const spec = validateBotSpec(requestSpec);

    assert.equal(value.root, "sample-bot");
    assert.equal(value.stack, "grammy");
    assert.equal(value.specHash, botSpecHash(spec));
    assert.deepEqual(value.nextSteps, GRAMMY_STEPS);
    assert.equal(value.files.length, (await expectedFiles(spec)).length);

    const expected = await expectedFiles(spec);
    assert.deepEqual(
      value.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
      expected.map((file) => ({ path: `sample-bot/${file.path}`, sha256: file.sha256 })),
    );
    const expectedManifestValue = expectedManifest(spec, new Date(0).toISOString());
    const paths = value.files.map((file) => file.path);
    assert.deepEqual(paths, paths.toSorted());

    for (const file of value.files) {
      const bytes = await readFile(join(root, file.path));
      assert.equal(bytes.length, file.bytes, file.path);
      assert.equal(sha256Hex(bytes), file.sha256, file.path);
    }

    for (const required of [
      ".env.example",
      ".gitignore",
      ".dockerignore",
      "Dockerfile",
      "docker-compose.yml",
      "Caddyfile",
      "package.json",
      "README.md",
      ".github/workflows/ci.yml",
      "src/config.ts",
      "src/server.ts",
      "tests/security.test.ts",
    ]) {
      assert.ok(paths.includes(`sample-bot/${required}`), required);
    }

    const env = await readFile(join(root, "sample-bot/.env.example"), "utf8");
    assert.match(env, /^BOT_TOKEN=$/m);
    assert.match(env, /^WEBHOOK_SECRET=$/m);
    TELEGRAM_TOKEN_RE.lastIndex = 0;
    assert.equal(TELEGRAM_TOKEN_RE.test(env), false);

    const manifestText = await readFile(join(root, "sample-bot", MANIFEST_PATH), "utf8");
    const manifest = JSON.parse(manifestText) as AurifexManifest;
    assert.deepEqual(manifest, expectedManifestValue);
    assert.deepEqual(value.manifest, expectedManifestValue);
    assert.equal(manifest.specHash, botSpecHash(spec));
    assert.equal(manifest.specVersion, spec.schemaVersion);
    assert.equal(manifest.generatedAt, new Date(0).toISOString());
    assert.equal(Object.hasOwn(manifest.files, MANIFEST_PATH), false);
    assert.deepEqual(
      Object.keys(manifest.files),
      (await expectedFiles(spec)).map((file) => file.path).filter((path) => path !== MANIFEST_PATH),
    );
    for (const [path, hash] of Object.entries(manifest.files)) {
      assert.equal(sha256Hex(await readFile(join(root, "sample-bot", path))), hash, path);
    }
    TELEGRAM_TOKEN_RE.lastIndex = 0;
    assert.equal(TELEGRAM_TOKEN_RE.test(manifestText), false);
    assert.deepEqual(await stagingEntries(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scaffolds an aiogram project", async () => {
  const { root, policy } = await makeRoot("aiogram");
  try {
    const requestSpec = specFor("aiogram");
    const result = await scaffoldBot(
      { destination: "py-bot", spec: requestSpec },
      { policy, now: () => new Date(0) },
    );
    const value = expectOk(result);
    const spec = validateBotSpec(requestSpec);

    assert.equal(value.stack, "aiogram");
    assert.deepEqual(value.nextSteps, AIOGRAM_STEPS);
    const expected = await expectedFiles(spec);
    assert.deepEqual(
      value.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
      expected.map((file) => ({ path: `py-bot/${file.path}`, sha256: file.sha256 })),
    );
    assert.ok(value.files.some((file) => file.path === "py-bot/pyproject.toml"));
    assert.ok(value.files.some((file) => file.path === "py-bot/app/webhook.py"));

    const env = await readFile(join(root, "py-bot/.env.example"), "utf8");
    assert.match(env, /^BOT_TOKEN=$/m);
    TELEGRAM_TOKEN_RE.lastIndex = 0;
    assert.equal(TELEGRAM_TOKEN_RE.test(env), false);
    assert.deepEqual(await stagingEntries(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses a non-empty destination without overwrite", async () => {
  const { root, policy } = await makeRoot("occupied");
  try {
    await mkdir(join(root, "occupied"));
    await writeFile(join(root, "occupied", "keep.txt"), "keep\n");
    const result = await scaffoldBot(
      { destination: "occupied", spec: specFor("grammy") },
      { policy, now: () => new Date(0) },
    );
    assert.ok(result.status === "error");
    assert.equal(result.error.code, "destination_exists");
    assert.equal(await readFile(join(root, "occupied", "keep.txt"), "utf8"), "keep\n");
    assert.deepEqual(await readdir(join(root, "occupied")), ["keep.txt"]);
    assert.deepEqual(await stagingEntries(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overwrite refreshes rendered files and preserves unrelated files", async () => {
  const { root, policy } = await makeRoot("overwrite");
  try {
    const requestSpec = specFor("grammy");
    assert.ok(
      (
        await scaffoldBot(
          { destination: "bot", spec: requestSpec },
          { policy, now: () => new Date(0) },
        )
      ).status === "ok",
    );
    await writeFile(join(root, "bot", "notes.txt"), "user notes\n");
    await writeFile(join(root, "bot", "README.md"), "stale\n");

    const value = expectOk(
      await scaffoldBot(
        { destination: "bot", spec: requestSpec, overwrite: true },
        { policy, now: () => new Date(0) },
      ),
    );
    assert.ok(value.files.length > 0);
    assert.equal(await readFile(join(root, "bot", "notes.txt"), "utf8"), "user notes\n");
    const readme = await readFile(join(root, "bot", "README.md"), "utf8");
    assert.notEqual(readme, "stale\n");
    assert.match(readme, /Sample Bot Telegram bot/);
    assert.deepEqual(await stagingEntries(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects destinations that escape the policy root", async () => {
  const { root, policy } = await makeRoot("escape");
  try {
    const relative = await scaffoldBot(
      { destination: "../escape-relative", spec: specFor("grammy") },
      { policy, now: () => new Date(0) },
    );
    assert.ok(relative.status === "error");
    assert.equal(relative.error.code, "unauthorized_path");

    const absolute = await scaffoldBot(
      { destination: join(tmpdir(), "aurifex-escape-absolute"), spec: specFor("grammy") },
      { policy, now: () => new Date(0) },
    );
    assert.ok(absolute.status === "error");
    assert.equal(absolute.error.code, "unauthorized_path");
    assert.deepEqual(await stagingEntries(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overwrite refuses a symlinked subdirectory and writes nothing outside", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink coverage requires a POSIX host");
    return;
  }
  const { root, policy } = await makeRoot("symlink-commit");
  const outside = await mkdtemp(join(tmpdir(), "aurifex-outside-commit-"));
  try {
    await mkdir(join(root, "bot"));
    await symlink(outside, join(root, "bot", "src"));
    const result = await scaffoldBot(
      { destination: "bot", spec: specFor("grammy"), overwrite: true },
      { policy, now: () => new Date(0) },
    );
    assert.ok(result.status === "error");
    assert.equal(result.error.code, "unauthorized_path");
    assert.deepEqual(await readdir(outside), []);
    assert.deepEqual(await stagingEntries(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("reports invalid specs without writing files and strips control characters", async () => {
  const { root, policy } = await makeRoot("invalid");
  try {
    const missingCommands = specFor("grammy", { features: ["llm"] });
    const first = await scaffoldBot(
      { destination: "bad-bot", spec: missingCommands },
      { policy, now: () => new Date(0) },
    );
    assert.ok(first.status === "error");
    assert.equal(first.error.code, "invalid_request");
    assert.equal((first.error.details as { path?: unknown } | undefined)?.path, "spec.features");

    const control = specFor("grammy", { displayName: "bad\u0000name" });
    const second = await scaffoldBot(
      { destination: "bad-bot", spec: control },
      { policy, now: () => new Date(0) },
    );
    assert.ok(second.status === "error");
    assert.equal(second.error.code, "invalid_request");
    const details = second.error.details as { message?: unknown } | undefined;
    const message = details?.message;
    if (typeof message !== "string") assert.fail("expected redacted message");
    assert.equal(message.includes("\u0000"), false);

    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rolls back overwritten originals when a later target cannot be written", async () => {
  const { root, policy } = await makeRoot("rollback");
  try {
    const destination = join(root, "rollback-bot");
    await mkdir(destination);
    await writeFile(join(destination, ".env.example"), "ORIGINAL-ENV\n");
    // Sorted commit order puts tsconfig.json last; a directory there fails the commit.
    await mkdir(join(destination, "tsconfig.json"));

    const result = await scaffoldBot(
      { destination: "rollback-bot", spec: specFor("grammy"), overwrite: true },
      { policy, now: () => new Date(0) },
    );
    assert.ok(result.status === "error");
    assert.equal(result.error.code, "internal_error");

    assert.equal(await readFile(join(destination, ".env.example"), "utf8"), "ORIGINAL-ENV\n");
    assert.equal((await stat(join(destination, "tsconfig.json"))).isDirectory(), true);
    await assert.rejects(readFile(join(destination, "src/config.ts")));
    await assert.rejects(readFile(join(destination, "Dockerfile")));
    // The manifest commits last, so a failure before it leaves no manifest behind.
    await assert.rejects(readFile(join(destination, MANIFEST_PATH)));
    assert.deepEqual(await stagingEntries(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
