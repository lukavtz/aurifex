import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import { sha256Hex, type DomainResult } from "../../src/core/results.ts";
import { createPathPolicy, type PathPolicy } from "../../src/core/security/path-policy.ts";
import {
  MANIFEST_PATH,
  serializeManifest,
  type AurifexManifest,
} from "../../src/core/projects/manifest.ts";
import { upgradeProject, type UpgradeApplyResult } from "../../src/core/projects/upgrade.ts";

interface Fixture {
  readonly policy: PathPolicy;
  readonly manifest: AurifexManifest;
}

function valueOf<T>(result: DomainResult<T>): T {
  if (result.status === "error") assert.fail(result.error.detail);
  return result.value;
}

async function fixture(t: { after(fn: () => Promise<void>): void }, specVersion: string): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurifex-upgrade-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const policy = await createPathPolicy(root);
  const files: Record<string, string> = {
    "package.json": '{"dependencies":{"grammy":"1.46.0"}}\n',
    "src/bot.ts": "export const bot = 1;\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await policy.writeFile(`bot/${path}`, content);
  }
  const manifest: AurifexManifest = {
    manifestVersion: 1,
    specVersion,
    stack: "grammy",
    specHash: "a".repeat(64),
    generatedAt: "2026-01-01T00:00:00.000Z",
    files: Object.fromEntries(
      Object.entries(files).map(([path, content]) => [path, sha256Hex(content)]),
    ),
  };
  await policy.writeFile(`bot/${MANIFEST_PATH}`, serializeManifest(manifest));
  return { policy, manifest };
}

test("upgradeProject refuses a project without a manifest", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurifex-upgrade-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const policy = await createPathPolicy(root);
  await policy.writeFile("bot/package.json", '{"dependencies":{"grammy":"1.46.0"}}\n');

  const result = await upgradeProject("bot", policy, { apply: true });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.error.code, "project_unreadable");
    assert.equal(result.error.detail, "run aurifex upgrade --apply first");
  }
});

test("upgradeProject refuses a hash mismatch and writes nothing", async (t) => {
  const { policy, manifest } = await fixture(t, "bot-spec-1.0.0");
  await policy.writeFile("bot/src/bot.ts", "export const bot = 2;\n", { overwrite: true });
  const before = await policy.readText(`bot/${MANIFEST_PATH}`);

  const result = await upgradeProject("bot", policy, { apply: true });
  assert.equal(result.status, "error");
  if (result.status === "error") {
    assert.equal(result.error.code, "project_unreadable");
    const details = result.error.details;
    assert.ok(typeof details === "object" && details !== null && "paths" in details);
    assert.deepEqual(details.paths, ["bot/src/bot.ts"]);
  }
  assert.equal(await policy.readText(`bot/${MANIFEST_PATH}`), before);
  assert.equal(JSON.parse(before).specVersion, manifest.specVersion);
});

test("upgradeProject dry-run reports actions and writes nothing", async (t) => {
  const { policy } = await fixture(t, "bot-spec-1.0.0");
  const before = await policy.readText(`bot/${MANIFEST_PATH}`);

  const result = valueOf(await upgradeProject("bot", policy));
  assert.ok(result.actions.length > 0);
  assert.deepEqual(result.changed, []);
  assert.equal(await policy.readText(`bot/${MANIFEST_PATH}`), before);
});

test("upgradeProject --apply writes only the migrated manifest", async (t) => {
  const { policy, manifest } = await fixture(t, "bot-spec-1.0.0");
  const botBefore = await policy.readText("bot/src/bot.ts");
  const packageBefore = await policy.readText("bot/package.json");

  const result = valueOf(
    await upgradeProject("bot", policy, {
      apply: true,
      now: () => new Date("2026-02-02T00:00:00.000Z"),
    }),
  );
  assert.deepEqual(result.changed, ["bot/.aurifex/manifest.json"]);
  assert.equal(result.specVersion, BOT_SPEC_VERSION);

  const migrated = JSON.parse(await policy.readText(`bot/${MANIFEST_PATH}`)) as AurifexManifest;
  assert.equal(migrated.specVersion, BOT_SPEC_VERSION);
  assert.equal(migrated.generatedAt, "2026-02-02T00:00:00.000Z");
  assert.equal(migrated.specHash, manifest.specHash);
  assert.deepEqual(migrated.files, manifest.files);
  assert.equal(await policy.readText("bot/src/bot.ts"), botBefore);
  assert.equal(await policy.readText("bot/package.json"), packageBefore);
});

test("upgradeProject is a no-op for a current manifest", async (t) => {
  const { policy } = await fixture(t, BOT_SPEC_VERSION);
  const before = await policy.readText(`bot/${MANIFEST_PATH}`);

  const result = valueOf(await upgradeProject("bot", policy, { apply: true }));
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.changed, []);
  assert.equal(await policy.readText(`bot/${MANIFEST_PATH}`), before);
});

test("upgradeProject rejects an unreadable manifest", async (t) => {
  const { policy } = await fixture(t, "bot-spec-1.0.0");
  await policy.writeFile(`bot/${MANIFEST_PATH}`, "{not json\n", { overwrite: true });

  const result = await upgradeProject("bot", policy);
  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.error.code, "project_unreadable");
});

test("upgradeProject reports manual migration actions with the project root", async (t) => {
  const { policy } = await fixture(t, "bot-spec-1.0.0");
  const result = valueOf(await upgradeProject("bot", policy));
  assert.ok(result.actions.some((action) => action.includes("aurifex add bot")));
  assert.ok(result.actions.some((action) => action.includes(BOT_SPEC_VERSION)));
});