import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { installedClaudeRoot } from "../../scripts/smoke-hosts.ts";

test("Claude root comes only from installed JSON v2 record", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-claude-record-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, "config");
  const installed = join(root, "actual-cache-copy");
  await mkdir(join(config, "plugins"), { recursive: true });
  await mkdir(installed);
  const record = join(config, "plugins", "installed_plugins.json");
  await writeFile(
    record,
    JSON.stringify({ version: 2, plugins: { "aurifex@aurifex": [{ installPath: installed }] } }),
  );
  assert.equal(await installedClaudeRoot(config), await realpath(installed));
  for (const data of [
    { version: 1, plugins: { "aurifex@aurifex": [{ installPath: installed }] } },
    { version: 2, plugins: { "aurifex@aurifex": [] } },
    { version: 2, plugins: { "aurifex@aurifex": [{ installPath: "relative/path" }] } },
    { version: 2, plugins: {} },
  ]) {
    await writeFile(record, JSON.stringify(data));
    await assert.rejects(installedClaudeRoot(config), /cannot determine installed plugin root/);
  }
});
