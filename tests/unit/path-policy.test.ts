import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, symlink, writeFile as fsWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { afterEach } from "node:test";

import {
  DEFAULT_MAX_BYTES,
  PathPolicyError,
  createPathPolicy,
} from "../../src/core/security/path-policy.ts";
import { sha256Hex } from "../../src/core/results.ts";

const tempDirs = new Set<string>();

afterEach(async () => {
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
});

async function makeTempDir(prefix: string): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.add(created);
  return realpath(created);
}

async function makeRoot(): Promise<string> {
  return makeTempDir("aurifex-policy-");
}

function isPolicyError(code: string) {
  return (error: unknown): boolean => error instanceof PathPolicyError && error.code === code;
}

async function symlinkOrSkip(
  t: import("node:test").TestContext,
  target: string,
  path: string,
): Promise<void> {
  try {
    await symlink(target, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlink requires privileges on this platform");
      return;
    }
    throw error;
  }
}

test("resolves relative and inside-root absolute paths", async () => {
  const root = await makeRoot();
  const policy = await createPathPolicy(root);
  assert.equal(policy.root, root);
  assert.equal(policy.resolve("notes.txt"), join(root, "notes.txt"));
  assert.equal(policy.resolve(join(root, "inside.txt")), join(root, "inside.txt"));
});

test("rejects absolute paths outside the root", async () => {
  const root = await makeRoot();
  const policy = await createPathPolicy(root);
  const outside = join(dirname(root), "outside.txt");
  assert.throws(() => policy.resolve(outside), isPolicyError("unauthorized_path"));
});

test("rejects dot-dot, backslash, NUL and empty paths", async () => {
  const root = await makeRoot();
  const policy = await createPathPolicy(root);
  assert.throws(() => policy.resolve("a/../b"), isPolicyError("invalid_path"));
  assert.throws(() => policy.resolve(".."), isPolicyError("unauthorized_path"));
  assert.throws(() => policy.resolve("a\\b"), isPolicyError("invalid_path"));
  assert.throws(() => policy.resolve("a\0b"), isPolicyError("invalid_path"));
  assert.throws(() => policy.resolve(""), isPolicyError("invalid_path"));
});

test("reads text and enforces the size cap", async () => {
  const root = await makeRoot();
  const policy = await createPathPolicy(root);
  await policy.writeFile("hello.txt", "hello");
  assert.equal(await policy.readText("hello.txt"), "hello");
  await assert.rejects(policy.readText("hello.txt", 4), isPolicyError("file_too_large"));
  await policy.writeFile("big.txt", "a".repeat(DEFAULT_MAX_BYTES + 1));
  await assert.rejects(policy.readText("big.txt"), isPolicyError("file_too_large"));
});

test("rejects symlinked files", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink coverage requires a POSIX host");
    return;
  }
  const root = await makeRoot();
  const outsideDir = await makeTempDir("aurifex-outside-");
  const outsideFile = join(outsideDir, "secret.txt");
  await fsWriteFile(outsideFile, "secret");
  await symlinkOrSkip(t, outsideFile, join(root, "link-file"));
  const policy = await createPathPolicy(root);
  await assert.rejects(policy.readText("link-file"), isPolicyError("unauthorized_path"));
});

test("rejects symlinked parent directories", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink coverage requires a POSIX host");
    return;
  }
  const root = await makeRoot();
  const outsideDir = await makeTempDir("aurifex-outside-");
  await fsWriteFile(join(outsideDir, "secret.txt"), "secret");
  await symlinkOrSkip(t, outsideDir, join(root, "escape"));
  const policy = await createPathPolicy(root);
  await assert.rejects(policy.readText("escape/secret.txt"), isPolicyError("unauthorized_path"));
  await assert.rejects(policy.writeFile("escape/new.txt", "x"), isPolicyError("unauthorized_path"));
});

test("writeFile uses exclusive create and refuses duplicates", async () => {
  const root = await makeRoot();
  const policy = await createPathPolicy(root);
  const ref = await policy.writeFile("notes.txt", "hello");
  assert.deepEqual(ref, { path: "notes.txt", bytes: 5, sha256: sha256Hex("hello") });
  await assert.rejects(policy.writeFile("notes.txt", "again"), isPolicyError("file_exists"));
});

test("writeFile overwrite replaces content and stays inside root", async () => {
  const root = await makeRoot();
  const policy = await createPathPolicy(root);
  await policy.writeFile("notes.txt", "hello");
  const ref = await policy.writeFile("notes.txt", "replaced", { overwrite: true });
  assert.equal(ref.path, "notes.txt");
  assert.equal(ref.bytes, 8);
  assert.equal(await policy.readText("notes.txt"), "replaced");
});

test("ensureDir creates nested directories and refuses symlink components", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink coverage requires a POSIX host");
    return;
  }
  const root = await makeRoot();
  const outsideDir = await makeTempDir("aurifex-outside-");
  await symlinkOrSkip(t, outsideDir, join(root, "link-dir"));
  const policy = await createPathPolicy(root);
  assert.equal(await policy.ensureDir("a/b"), join(root, "a/b"));
  await assert.rejects(policy.ensureDir("link-dir/sub"), isPolicyError("unauthorized_path"));
});

test("listFiles is deterministic and skips ignored directories", async () => {
  const root = await makeRoot();
  const policy = await createPathPolicy(root);
  await policy.writeFile("b.txt", "b");
  await policy.writeFile("a.txt", "a");
  await policy.writeFile("sub/c.txt", "c");
  await policy.writeFile("node_modules/pkg/index.js", "x");
  await policy.writeFile(".git/config", "x");
  await policy.writeFile(".venv/pyvenv.cfg", "x");
  assert.deepEqual(await policy.listFiles(), ["a.txt", "b.txt", "sub/c.txt"]);
});

test("removeFile removes files but refuses directories and missing targets", async () => {
  const root = await makeRoot();
  const policy = await createPathPolicy(root);
  await policy.writeFile("gone.txt", "x");
  await policy.removeFile("gone.txt");
  await assert.rejects(policy.readText("gone.txt"), isPolicyError("not_a_file"));
  await policy.ensureDir("folder");
  await assert.rejects(policy.removeFile("folder"), isPolicyError("not_a_file"));
  await policy.removeFile("missing.txt");
});
