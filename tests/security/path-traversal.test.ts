import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createCoreOperations } from "../../src/core/operations.ts";
import { createPathPolicy, PathPolicyError } from "../../src/core/security/path-policy.ts";
import type { PathPolicy } from "../../src/core/security/path-policy.ts";

const ESCAPE_CODES: Readonly<Record<string, true>> = {
  unauthorized_path: true,
  invalid_path: true,
};

async function rejectionCode(run: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof PathPolicyError) return error.code;
    throw error;
  }
  assert.fail("expected the path policy to reject the input");
}

async function setup(
  label: string,
): Promise<{ root: string; outside: string; policy: PathPolicy }> {
  const root = await mkdtemp(join(tmpdir(), `aurifex-traversal-${label}-`));
  const outside = await mkdtemp(join(tmpdir(), `aurifex-outside-${label}-`));
  return { root, outside, policy: await createPathPolicy(root) };
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

test("rejects traversal corpus for resolve, read, and write", async () => {
  const { root, outside, policy } = await setup("corpus");
  try {
    const absoluteOutside = join(outside, "absolute.txt");
    const invalid = ["../escape.txt", "a/../../escape.txt", "..", "a/../b", "a\0b", ""];
    if (process.platform !== "win32") invalid.push("a\\b");
    for (const candidate of invalid) {
      const code = await rejectionCode(() => policy.resolve(candidate));
      assert.equal(ESCAPE_CODES[code], true, `${candidate}: ${code}`);
      const readCode = await rejectionCode(() => policy.readText(candidate));
      assert.equal(ESCAPE_CODES[readCode], true, `${candidate}: read ${readCode}`);
      const writeCode = await rejectionCode(() => policy.writeFile(candidate, "x"));
      assert.equal(ESCAPE_CODES[writeCode], true, `${candidate}: write ${writeCode}`);
    }

    for (const action of [
      () => policy.resolve(absoluteOutside),
      () => policy.readText(absoluteOutside),
      () => policy.writeFile(absoluteOutside, "x"),
    ]) {
      assert.equal(await rejectionCode(action), "unauthorized_path");
    }

    assert.equal(
      await rejectionCode(() => policy.resolve(join(root, "..", "sibling.txt"))),
      "unauthorized_path",
    );
    await assert.rejects(readFile(join(root, "escape.txt")));
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("rejects symlink file and symlink directory escapes", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink coverage requires a POSIX host");
    return;
  }
  const { root, outside, policy } = await setup("symlink");
  try {
    const outsideFile = join(outside, "secret.txt");
    await writeFile(outsideFile, "secret\n");
    if (!(await symlinkOrSkip(t, outsideFile, join(root, "link-file.txt")))) return;
    assert.equal(await rejectionCode(() => policy.readText("link-file.txt")), "unauthorized_path");
    assert.equal(
      await rejectionCode(() => policy.writeFile("link-file.txt", "clobber")),
      "unauthorized_path",
    );
    assert.equal(await readFile(outsideFile, "utf8"), "secret\n");

    if (!(await symlinkOrSkip(t, outside, join(root, "link-dir")))) return;
    assert.equal(await rejectionCode(() => policy.ensureDir("link-dir/sub")), "unauthorized_path");
    assert.equal(
      await rejectionCode(() => policy.readText("link-dir/secret.txt")),
      "unauthorized_path",
    );
    assert.equal(
      await rejectionCode(() => policy.writeFile("link-dir/new.txt", "x")),
      "unauthorized_path",
    );
    assert.deepEqual((await readdir(outside)).toSorted(), ["secret.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("removeFile refuses a symlinked parent directory", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink coverage requires a POSIX host");
    return;
  }
  const { root, outside, policy } = await setup("remove-link");
  try {
    const secret = join(outside, "keep.txt");
    await writeFile(secret, "keep\n");
    if (!(await symlinkOrSkip(t, outside, join(root, "linked")))) return;
    assert.equal(
      await rejectionCode(() => policy.removeFile("linked/keep.txt")),
      "unauthorized_path",
    );
    assert.equal(await readFile(secret, "utf8"), "keep\n");
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("treats percent-encoded dot segments as literal in-root names", async () => {
  const { root, outside, policy } = await setup("encoded");
  try {
    assert.equal(policy.resolve("%2e%2e"), join(policy.root, "%2e%2e"));
    const ref = await policy.writeFile("%2e%2e/inside.txt", "inside");
    assert.equal(ref.path, "%2e%2e/inside.txt");
    assert.equal(await policy.readText("%2e%2e/inside.txt"), "inside");
    assert.equal(await readFile(join(root, "%2e%2e", "inside.txt"), "utf8"), "inside");
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("operations reject project roots outside the policy root", async (t) => {
  const { root, outside } = await setup("operations");
  try {
    const operations = await createCoreOperations({ root });
    await mkdir(join(outside, "keep"));
    const before = (await readdir(outside)).toSorted();

    for (const projectRoot of ["../outside-bot", join(outside, "project"), "a/../../up"]) {
      for (const result of [
        await operations.inspectBot({ projectRoot }),
        await operations.verifyBot({ projectRoot }),
      ]) {
        assert.ok(result.status === "error", `${projectRoot}: ${JSON.stringify(result)}`);
        assert.equal(result.error.code, "unauthorized_path", projectRoot);
      }
    }

    if (!(await symlinkOrSkip(t, outside, join(root, "linked-project")))) return;
    for (const result of [
      await operations.inspectBot({ projectRoot: "linked-project" }),
      await operations.verifyBot({ projectRoot: "linked-project" }),
    ]) {
      assert.ok(result.status === "error");
      assert.equal(result.error.code, "unauthorized_path");
    }

    assert.deepEqual((await readdir(outside)).toSorted(), before);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
