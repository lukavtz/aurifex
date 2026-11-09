import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(REPO, "src", "cli.ts");
const WINDOWS = process.platform === "win32";

function run(args: readonly string[], env: Record<string, string>) {
  const { promise, resolve, reject } = Promise.withResolvers<{
    code: number;
    stdout: string;
    stderr: string;
  }>();
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

test(
  "Windows installer executes .cmd host shims through cmd.exe",
  { skip: WINDOWS ? false : "Windows-only coverage" },
  async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "aurifex-win-install-")));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, "bin");
    const pkg = join(root, "pkg");
    const log = join(root, "calls.log");
    await mkdir(bin);
    await mkdir(join(pkg, "dist", "adapters", "mcp"), { recursive: true });
    await writeFile(join(pkg, "package.json"), '{"name":"aurifex","version":"0.1.0"}\n');
    await writeFile(join(pkg, "dist", "adapters", "mcp", "server.js"), "\n");
    await writeFile(join(bin, "omp.cmd"), '@echo off\r\necho omp:%* >> "%AURIFEX_TEST_LOG%"\r\n');
    const result = await run(["install", "--host", "omp", "--source", pkg, "--json"], {
      PATH: `${bin};${process.env.Path ?? process.env.PATH ?? ""}`,
      AURIFEX_TEST_LOG: log,
    });
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      value: { hosts: Array<{ status: string }> };
    };
    assert.equal(payload.status, "ok");
    assert.equal(payload.value.hosts[0]?.status, "installed");
    const calls = await readFile(log, "utf8");
    assert.match(calls, /omp:"plugin" "install"/);
  },
);
