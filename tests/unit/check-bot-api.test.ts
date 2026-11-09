import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

const SCRIPT = fileURLToPath(new URL("../../scripts/check-bot-api.mjs", import.meta.url));
const CONTRACT = fileURLToPath(
  new URL("../../src/core/targets/bot-api-contract.json", import.meta.url),
);
const pinned = JSON.parse(readFileSync(CONTRACT, "utf8"));

const dir = mkdtempSync(join(tmpdir(), "aurifex-check-bot-api-"));
after(() => rmSync(dir, { recursive: true, force: true }));

interface Fixture {
  readonly changelog: string;
  readonly api: string;
  readonly contract: string;
}

function writeFixture(
  name: string,
  options: {
    version?: string;
    methods?: readonly string[];
    types?: readonly string[];
    omitMethod?: string;
  } = {},
): Fixture {
  const version = options.version ?? pinned.botApiVersion;
  const methods = (options.methods ?? pinned.methods).filter(
    (method: string) => method !== options.omitMethod,
  );
  const types = options.types ?? pinned.types;
  const changelog = [
    "# Bot API changelog",
    "",
    "### 2026",
    "",
    "#### November 9, 2026",
    "",
    `**Bot API ${version}**`,
    "",
    ...methods.map(
      (method: string) => `- Added [${method}](/bots/api/methods/${method.toLowerCase()}.md).`,
    ),
    ...types.map(
      (type: string) => `- Added the class [${type}](/bots/api/types/${type.toLowerCase()}.md).`,
    ),
    "",
    "#### August 24, 2026",
    "",
    "**Bot API 10.3**",
    "",
  ].join("\n");
  const api = [
    "# Telegram Bot API",
    "",
    "- [getMe](/bots/api/methods/getme.md): get basic information about the bot.",
    "- [sendMessage](/bots/api/methods/sendmessage.md): send text messages.",
    "",
  ].join("\n");
  const contract = join(dir, `${name}.contract.json`);
  const changelogPath = join(dir, `${name}.changelog.md`);
  const apiPath = join(dir, `${name}.api.md`);
  writeFileSync(changelogPath, changelog, "utf8");
  writeFileSync(apiPath, api, "utf8");
  writeFileSync(contract, `${JSON.stringify(pinned, null, 2)}\n`, "utf8");
  return { changelog: changelogPath, api: apiPath, contract };
}

function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("check-bot-api --check", () => {
  it("passes when the pinned contract matches the changelog block", () => {
    const fixture = writeFixture("match");
    const result = run([
      "--check",
      "--changelog-file",
      fixture.changelog,
      "--api-file",
      fixture.api,
      "--contract-file",
      fixture.contract,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /bot-api ok: 10\.4 \(26 methods, 38 types/);
  });

  it("fails when the live version is newer", () => {
    const fixture = writeFixture("newer", { version: "10.5" });
    const result = run([
      "--check",
      "--changelog-file",
      fixture.changelog,
      "--api-file",
      fixture.api,
      "--contract-file",
      fixture.contract,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /live Bot API 10\.5 is newer than pinned 10\.4/);
  });

  it("fails on a changed method set with the missing name", () => {
    const fixture = writeFixture("dropped-method", { omitMethod: "sendWidget" });
    const result = run([
      "--check",
      "--changelog-file",
      fixture.changelog,
      "--api-file",
      fixture.api,
      "--contract-file",
      fixture.contract,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /method removed from 10\.4: sendWidget/);
  });

  it("fails on an added type", () => {
    const fixture = writeFixture("added-type", {
      types: [...pinned.types, "NftAuction"],
    });
    const result = run([
      "--check",
      "--changelog-file",
      fixture.changelog,
      "--api-file",
      fixture.api,
      "--contract-file",
      fixture.contract,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /type added to 10\.4: NftAuction/);
  });

  it("reports JSON for automation", () => {
    const fixture = writeFixture("json");
    const result = run([
      "--check",
      "--json",
      "--changelog-file",
      fixture.changelog,
      "--api-file",
      fixture.api,
      "--contract-file",
      fixture.contract,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.version, "10.4");
    assert.deepEqual(parsed.diffs, []);
  });

  it("never passes when the network is unavailable", () => {
    const result = run([
      "--check",
      "--base-url",
      "http://127.0.0.1:9",
      "--contract-file",
      CONTRACT,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /network_unavailable/);
  });
});

describe("check-bot-api --update", () => {
  it("writes the version, release date, and sorted sets", () => {
    const fixture = writeFixture("update");
    const target = join(dir, "updated.contract.json");
    const result = run([
      "--update",
      "--changelog-file",
      fixture.changelog,
      "--api-file",
      fixture.api,
      "--contract-file",
      target,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const written = JSON.parse(readFileSync(target, "utf8"));
    assert.equal(written.botApiVersion, "10.4");
    assert.equal(written.date, "2026-11-09");
    assert.deepEqual(written.methods, [...pinned.methods].toSorted());
    assert.deepEqual(written.types, [...pinned.types].toSorted());
  });

  it("prints the live version", () => {
    const fixture = writeFixture("version");
    const result = run([
      "--version",
      "--changelog-file",
      fixture.changelog,
      "--api-file",
      fixture.api,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "10.4");
  });
});
