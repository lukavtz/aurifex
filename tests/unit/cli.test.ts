import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(REPO, "src", "cli.ts");

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(args: readonly string[], input?: string): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const child = spawn(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    cwd: REPO,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.on("error", reject);
  child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  child.stdin.end(input ?? "");
  return promise;
}

async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "aurifex-cli-")));
}

test("--help lists exactly the four canonical commands", async () => {
  const result = await run(["--help"]);
  assert.equal(result.code, 0, result.stderr);
  const commands = [...result.stdout.matchAll(/aurifex ([a-z-]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(commands)].toSorted(), ["inspect", "install", "target", "verify"]);
  for (const removed of ["scaffold", "upgrade", "harness", "deploy"]) {
    assert.equal(result.stdout.includes(`aurifex ${removed}`), false, removed);
  }
});

test("install documents local sources and rejects package or git sources", async () => {
  const help = await run(["--help"]);
  assert.match(help.stdout, /--source <path>/);
  for (const source of ["aurifex", "git+https://example.com/aurifex.git"]) {
    const result = await run(["install", "--source", source, "--yes"]);
    assert.equal(result.code, 2);
    assert.ok(
      result.stderr.includes(
        `unsupported install source: ${source}: pass an absolute path or a ./relative path to an Aurifex checkout`,
      ),
      result.stderr,
    );
  }
});

test("target --json resolves the grammY framework version", async () => {
  const result = await run(["target", "--stack", "grammy", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    status: string;
    value: { stack: string; target: { frameworkVersion: string } };
  };
  assert.equal(payload.status, "ok");
  assert.equal(payload.value.stack, "grammy");
  assert.equal(payload.value.target.frameworkVersion, "1.46.0");
});

test("target without --json prints a one-line summary", async () => {
  const result = await run(["target", "--stack", "aiogram"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /aiogram 3\.31\.0/);
});

test("usage errors exit 2", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const cases: readonly (readonly string[])[] = [
    [],
    ["bogus"],
    ["target", "--stack", "grammy", "--bogus"],
    ["target"],
    ["target", "--stack", "telegraf"],
    ["verify"],
    ["verify", "one", "two"],
    ["inspect"],
    ["install", "--host", "bogus"],
    ["install", "--scope", "global"],
    ["install", "extra"],
  ];
  for (const args of cases) {
    const result = await run(args);
    assert.equal(result.code, 2, `${args.join(" ")} -> ${result.code}: ${result.stderr}`);
    assert.match(result.stderr, /Usage:/);
  }
});

test("verify reports the reference project as ok", { timeout: 120_000 }, async () => {
  const result = await run(["verify", "examples/grammy_commands", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    status: string;
    value: { ok: boolean; summary: { fail: number } };
  };
  assert.equal(payload.status, "ok");
  assert.equal(payload.value.ok, true);
  assert.equal(payload.value.summary.fail, 0);
});

test("verify of a missing project exits 1 with a domain error", async () => {
  const result = await run(["verify", "does-not-exist", "--json"]);
  assert.equal(result.code, 1, result.stderr);
  const payload = JSON.parse(result.stdout) as { status: string; error: { code: string } };
  assert.equal(payload.status, "error");
});

test("entry guard follows a symlinked bin", { skip: process.platform === "win32" }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurifex-bin-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const link = join(root, "aurifex");
  await symlink(CLI, link);
  const { promise, resolve } = Promise.withResolvers<{ code: number; stdout: string }>();
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", link, "target", "--stack", "grammy", "--json"],
    {
      cwd: REPO,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.on("close", (code) => resolve({ code: code ?? -1, stdout }));
  const result = await promise;
  assert.equal(result.code, 0);
  assert.match(result.stdout, /"frameworkVersion":"1.46.0"/);
});
