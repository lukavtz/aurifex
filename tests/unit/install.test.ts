import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultInstallSource, needsBuild } from "../../src/cli.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(REPO, "src", "cli.ts");
const SAFE_PATH = "/usr/bin:/bin";

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(args: readonly string[], env: Readonly<Record<string, string>>): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const child = spawn(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.on("error", reject);
  child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  return promise;
}

async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "aurifex-install-")));
}

async function fakeBin(dir: string, name: string, body: string): Promise<void> {
  await writeFile(join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function envFor(binDir: string, log: string): Record<string, string> {
  return { PATH: `${binDir}:${SAFE_PATH}`, AURIFEX_TEST_LOG: log };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface InstallPayload {
  status: string;
  value: {
    hosts: Array<{ host: string; status: string; command: string }>;
    packageRoot: string;
    source: string;
  };
}

test("install --dry-run prints exact commands without executing", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  await mkdir(bin);

  const result = await run(["install", "--host", "all", "--dry-run", "--json"], envFor(bin, log));
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as InstallPayload;
  assert.equal(payload.status, "ok");
  assert.equal(payload.value.hosts.length, 3);
  assert.equal(payload.value.source, await realpath(REPO));
  assert.ok(payload.value.hosts.every((host) => host.status === "planned"));

  const commands = Object.fromEntries(payload.value.hosts.map((host) => [host.host, host.command]));
  assert.equal(commands.omp, `omp plugin install ${await realpath(REPO)} --scope user`);
  assert.equal(commands.dsh, `dsh plugin --profile aurifex add ${await realpath(REPO)}`);
  assert.equal(
    commands.claude,
    `claude plugin marketplace add ${await realpath(REPO)} && claude plugin install aurifex@aurifex -s user`,
  );
  assert.equal(await exists(log), false, "dry run must not execute host commands");
});

test("install --host all runs each host and reports stable JSON", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  const pkg = join(root, "pkg");
  await mkdir(bin);
  await mkdir(join(pkg, "dist", "adapters", "mcp"), { recursive: true });
  await writeFile(join(pkg, "dist", "adapters", "mcp", "server.js"), "");
  for (const host of ["omp", "dsh", "claude"]) {
    await fakeBin(bin, host, `echo "${host}:$*" >> "$AURIFEX_TEST_LOG"`);
  }

  const result = await run(
    [
      "install",
      "--host",
      "all",
      "--scope",
      "project",
      "--profile",
      "test",
      "--source",
      pkg,
      "--yes",
      "--json",
    ],
    envFor(bin, log),
  );
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as InstallPayload;
  assert.equal(payload.status, "ok");
  assert.deepEqual(Object.keys(payload.value).toSorted(), ["hosts", "packageRoot", "source"]);
  assert.equal(payload.value.packageRoot, await realpath(REPO));
  assert.equal(payload.value.source, pkg);
  assert.ok(payload.value.hosts.every((host) => host.status === "installed"));
  for (const host of payload.value.hosts) {
    assert.deepEqual(Object.keys(host).toSorted(), ["command", "host", "status"]);
  }

  const calls = await readFile(log, "utf8");
  const lines = calls.trim().split("\n");
  assert.ok(lines.includes(`omp:plugin install ${pkg} --scope project`));
  assert.ok(lines.includes(`dsh:plugin --profile test add ${pkg}`));
  assert.ok(lines.includes(`claude:plugin marketplace add ${pkg}`));
  assert.ok(lines.includes("claude:plugin install aurifex@aurifex -s project"));
});

test("install skips a missing host with a warning", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  await mkdir(bin);

  const result = await run(
    ["install", "--host", "omp", "--source", "aurifex", "--json"],
    envFor(bin, log),
  );
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as InstallPayload;
  assert.equal(payload.status, "ok");
  assert.equal(payload.value.hosts[0]?.status, "skipped");
  assert.match(result.stderr, /omp not found on PATH/);
});

test("install redacts tokens from failed host output", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  await mkdir(bin);
  const token = ["123456789", "A".repeat(35)].join(":");
  await fakeBin(
    bin,
    "claude",
    `echo "claude:$*" >> "$AURIFEX_TEST_LOG"\nprintf 'fatal Authorization: Bearer ${token}\\n' >&2\nexit 1`,
  );

  const result = await run(
    ["install", "--host", "claude", "--source", "aurifex"],
    envFor(bin, log),
  );
  assert.equal(result.code, 1);
  const combined = result.stdout + result.stderr;
  assert.equal(combined.includes(token), false, "token leaked to output");
  assert.match(combined, /<redacted>/);
  assert.match(result.stdout, /Claude Code: failed/);
});

test("defaultInstallSource prefers a checkout over a package name", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(defaultInstallSource(root, existsSync), "aurifex");
  await mkdir(join(root, ".git"));
  assert.equal(defaultInstallSource(root, existsSync), root);
  assert.equal(
    defaultInstallSource(root, () => false),
    "aurifex",
  );
});

test("install --source package uses registry references", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  await mkdir(bin);

  const result = await run(
    ["install", "--host", "all", "--source", "aurifex", "--dry-run", "--json"],
    envFor(bin, log),
  );
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as InstallPayload;
  assert.equal(payload.value.source, "aurifex");
  const commands = Object.fromEntries(payload.value.hosts.map((host) => [host.host, host.command]));
  assert.equal(commands.omp, "omp plugin install aurifex --scope user");
  assert.equal(commands.dsh, "dsh plugin --profile aurifex add aurifex");
  assert.equal(
    commands.claude,
    "claude plugin marketplace add lukavtz/aurifex && claude plugin install aurifex@aurifex -s user",
  );
});

test("needsBuild only for local checkouts without the MCP bundle", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(
    needsBuild(root, () => false),
    true,
  );
  const dist = join(root, "dist", "adapters", "mcp");
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, "server.js"), "");
  assert.equal(needsBuild(root, existsSync), false);
  assert.equal(
    needsBuild(root, () => false),
    true,
  );
  assert.equal(
    needsBuild("aurifex", () => false),
    false,
  );
});

test("install builds a local checkout when the MCP bundle is missing", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  const pkg = join(root, "pkg");
  await mkdir(bin);
  await mkdir(pkg);
  await fakeBin(
    bin,
    "pnpm",
    'mkdir -p "$AURIFEX_TEST_PKG/dist/adapters/mcp"\n: > "$AURIFEX_TEST_PKG/dist/adapters/mcp/server.js"\necho "pnpm:$*" >> "$AURIFEX_TEST_LOG"',
  );
  await fakeBin(bin, "omp", `echo "omp:$*" >> "$AURIFEX_TEST_LOG"`);

  const result = await run(["install", "--host", "omp", "--source", pkg], {
    ...envFor(bin, log),
    AURIFEX_TEST_PKG: pkg,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Build: ok · pnpm build/);
  assert.match(result.stdout, /OMP: installed/);
  assert.equal(await exists(join(pkg, "dist", "adapters", "mcp", "server.js")), true);
  const calls = await readFile(log, "utf8");
  assert.match(calls, /pnpm:build/);
  assert.match(calls, /omp:plugin install/);
});

test("install fails clearly when a local build does not produce the MCP bundle", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  const pkg = join(root, "pkg");
  await mkdir(bin);
  await mkdir(pkg);
  await fakeBin(bin, "pnpm", `echo "pnpm:$*" >> "$AURIFEX_TEST_LOG"`);

  const result = await run(
    ["install", "--host", "omp", "--source", pkg, "--json"],
    envFor(bin, log),
  );
  assert.equal(result.code, 1);
  const payload = JSON.parse(result.stdout) as {
    status: string;
    error: { code: string; detail: string };
  };
  assert.equal(payload.status, "error");
  assert.equal(payload.error.code, "build_failed");
  assert.match(payload.error.detail, /still missing after pnpm build/);
});
