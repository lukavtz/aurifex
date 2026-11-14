import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";

import { createPathPolicy, PathPolicyError } from "../../src/core/security/path-policy.ts";
import type { PathPolicy } from "../../src/core/security/path-policy.ts";
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

function isPolicyError(code: string) {
  return (error: unknown): boolean => error instanceof PathPolicyError && error.code === code;
}

async function symlinkOrSkip(
  t: import("node:test").TestContext,
  target: string,
  path: string,
): Promise<boolean> {
  try {
    await symlink(target, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlink requires privileges on this platform");
      return false;
    }
    throw error;
  }
}

async function setup(
  label: string,
): Promise<{ root: string; outside: string; policy: PathPolicy }> {
  const root = await makeTempDir(`aurifex-write-${label}-`);
  const outside = await makeTempDir(`aurifex-outside-${label}-`);
  return { root, outside, policy: await createPathPolicy(root) };
}

for (const overwrite of [false, true]) {
  test(`refuses a symlink planted at the destination (overwrite: ${overwrite})`, async (t) => {
    if (process.platform === "win32") {
      t.skip("symlink coverage requires a POSIX host");
      return;
    }
    const { root, outside, policy } = await setup(`dest-${overwrite}`);
    const secret = join(outside, "secret.txt");
    await fsWriteFile(secret, "outside");
    if (!(await symlinkOrSkip(t, secret, join(root, "notes.txt")))) return;

    await assert.rejects(
      policy.writeFile("notes.txt", "attacker", { overwrite }),
      isPolicyError("unauthorized_path"),
    );
    assert.equal(await readFile(secret, "utf8"), "outside");
    assert.deepEqual(await policy.listFiles(), []);
  });
}

test("refuses a symlink planted at the predictable temp path", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink coverage requires a POSIX host");
    return;
  }
  const { root, outside, policy } = await setup("temp-link");
  await policy.writeFile("notes.txt", "before");
  const secret = join(outside, "secret.txt");
  await fsWriteFile(secret, "outside");

  const tempPath = join(root, `.notes.txt.tmp-${process.pid}-1700000000000`);
  if (!(await symlinkOrSkip(t, secret, tempPath))) return;

  const realNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    await assert.rejects(
      policy.writeFile("notes.txt", "after", { overwrite: true }),
      isPolicyError("unauthorized_path"),
    );
  } finally {
    Date.now = realNow;
  }
  assert.equal(await readFile(secret, "utf8"), "outside");
  assert.equal(await policy.readText("notes.txt"), "before");
});

test("reported digest and size describe the bytes written", async () => {
  const { policy } = await setup("digest");
  const content = "héllo · 世界 · 🚀".repeat(40);
  const created = await policy.writeFile("unicode.txt", content);
  assert.equal(created.bytes, Buffer.byteLength(content, "utf8"));
  assert.equal(created.sha256, sha256Hex(Buffer.from(content, "utf8")));
  assert.equal(await readFile(join(policy.root, "unicode.txt"), "utf8"), content);

  const replaced = await policy.writeFile("unicode.txt", "replaced", { overwrite: true });
  assert.equal(replaced.bytes, 8);
  assert.equal(replaced.sha256, sha256Hex("replaced"));
  assert.equal(await policy.readText("unicode.txt"), "replaced");
});

test("leaves no temp file behind when a commit is refused", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink coverage requires a POSIX host");
    return;
  }
  const { root, outside, policy } = await setup("no-temp");
  await policy.writeFile("notes.txt", "before");
  const secret = join(outside, "secret.txt");
  await fsWriteFile(secret, "outside");
  const tempPath = join(root, `.notes.txt.tmp-${process.pid}-1700000000001`);
  if (!(await symlinkOrSkip(t, secret, tempPath))) return;

  const realNow = Date.now;
  Date.now = () => 1_700_000_000_001;
  try {
    await assert.rejects(
      policy.writeFile("notes.txt", "after", { overwrite: true }),
      isPolicyError("unauthorized_path"),
    );
  } finally {
    Date.now = realNow;
  }
  assert.equal(await readFile(secret, "utf8"), "outside");
});
