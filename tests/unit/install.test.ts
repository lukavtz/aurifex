import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline/promises";
import { test as nodeTest } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ask,
  defaultInstallSource,
  needsBuild,
  parseHostAnswer,
  parseScopeAnswer,
} from "../../src/cli.ts";

const test = process.platform === "win32" ? nodeTest.skip : nodeTest;
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(REPO, "src", "cli.ts");
const NODE_BIN = join(process.execPath, "..");

function run(args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const { promise, resolve, reject } = Promise.withResolvers<{
    code: number;
    stdout: string;
    stderr: string;
  }>();
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("error", reject);
  child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  return promise;
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "aurifex-install-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = join(root, "pkg");
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  await mkdir(join(pkg, "dist", "adapters", "mcp"), { recursive: true });
  await mkdir(bin);
  await writeFile(join(pkg, "package.json"), '{"name":"aurifex","version":"0.2.0"}\n');
  await writeFile(join(pkg, "dist", "cli.js"), "");
  await writeFile(join(pkg, "dist", "adapters", "mcp", "server.js"), "");
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: root, AURIFEX_TEST_LOG: log };
  return { root, pkg, bin, log, env };
}

async function host(bin: string, name: string, fail = false) {
  await writeFile(
    join(bin, name),
    `#!/bin/sh\nprintf '%s\\n' '${name}:'"$*" >> "$AURIFEX_TEST_LOG"\n${fail ? "exit 1\n" : ""}`,
    { mode: 0o755 },
  );
}

test("default source validates package identity without requiring git", async (t) => {
  const { pkg, root } = await fixture(t);
  assert.equal(defaultInstallSource(pkg, existsSync), pkg);
  assert.throws(() => defaultInstallSource(root, existsSync), /expected an Aurifex checkout/);
  await writeFile(join(pkg, "package.json"), '{"name":"other"}');
  assert.throws(() => defaultInstallSource(pkg, existsSync), /expected an Aurifex checkout/);
});

test("both CLI and MCP artifacts are required", async (t) => {
  const { pkg } = await fixture(t);
  assert.equal(needsBuild(pkg, existsSync), false);
  await rm(join(pkg, "dist", "cli.js"));
  assert.equal(needsBuild(pkg, existsSync), true);
  await writeFile(join(pkg, "dist", "cli.js"), "");
  await rm(join(pkg, "dist", "adapters", "mcp", "server.js"));
  assert.equal(needsBuild(pkg, existsSync), true);
});

test("nonlocal install sources fail with exact usage error", async (t) => {
  const { env } = await fixture(t);
  for (const source of [
    "aurifex",
    "aurifex@0.2.0",
    "github:lukavtz/aurifex",
    "https://example.org/repo",
    ".invalid",
  ]) {
    const result = await run(["install", "--source", source, "--dry-run"], env);
    assert.equal(result.code, 2, result.stderr);
    assert.ok(
      result.stderr.includes(
        `unsupported install source: ${source}: pass an absolute path or a ./relative path to an Aurifex checkout`,
      ),
    );
  }
});

test("invalid checkout reports exact source error", async (t) => {
  const { root, env } = await fixture(t);
  const result = await run(["install", "--source", root, "--dry-run"], env);
  assert.equal(result.code, 2);
  assert.ok(
    result.stderr.includes(
      `invalid install source: ${root}: expected an Aurifex checkout with package.json "name": "aurifex"`,
    ),
  );
});

test("dry run uses local checkout and never calls hosts", async (t) => {
  const { pkg, bin, log, env } = await fixture(t);
  for (const name of ["omp", "dsh", "claude"]) await host(bin, name);
  const result = await run(["install", "--source", pkg, "--dry-run", "--json"], env);
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as {
    value: { source: string; hosts: Array<{ host: string; status: string; command: string }> };
  };
  assert.equal(payload.value.source, pkg);
  assert.equal(payload.value.hosts.length, 3);
  assert.ok(payload.value.hosts.every((entry) => entry.status === "planned"));
  assert.ok(
    payload.value.hosts
      .find((entry) => entry.host === "claude")
      ?.command.includes(`marketplace add ${pkg}`),
  );
  assert.equal(existsSync(log), false);
});

test("selected hosts receive scope and profile and installer exits", async (t) => {
  const { pkg, bin, log, env } = await fixture(t);
  for (const name of ["omp", "dsh", "claude"]) await host(bin, name);
  const result = await run(
    [
      "install",
      "--source",
      pkg,
      "--host",
      "all",
      "--scope",
      "project",
      "--profile",
      "test",
      "--yes",
      "--json",
    ],
    env,
  );
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout) as { value: { hosts: Array<{ status: string }> } };
  assert.ok(payload.value.hosts.every((entry) => entry.status === "installed"));
  const calls = await readFile(log, "utf8");
  assert.ok(calls.includes(`omp:plugin install ${pkg} --scope project`));
  assert.ok(calls.includes(`dsh:plugin --profile test add ${pkg}`));
  assert.ok(calls.includes(`claude:plugin marketplace add ${pkg}`));
  assert.ok(calls.includes("claude:plugin install aurifex@aurifex -s project"));
});

test("missing host warns and failed host output redacts secrets", async (t) => {
  const { pkg, bin, env } = await fixture(t);
  const missing = await run(["install", "--source", pkg, "--host", "omp", "--yes", "--json"], env);
  assert.equal(missing.code, 0);
  assert.match(missing.stderr, /omp not found on PATH/);
  const token = ["123456789", "A".repeat(35)].join(":");
  await writeFile(
    join(bin, "claude"),
    `#!/bin/sh\nprintf '%s\\n' 'Authorization: Bearer ${token}' >&2\nexit 1\n`,
    { mode: 0o755 },
  );
  const failed = await run(["install", "--source", pkg, "--host", "claude", "--yes"], env);
  assert.equal(failed.code, 1);
  assert.equal((failed.stdout + failed.stderr).includes(token), false);
  assert.match(failed.stdout + failed.stderr, /<redacted>/);
});

test("production environment builds missing CLI using real npm with dev dependencies", async (t) => {
  const { pkg, bin, env } = await fixture(t);
  await rm(join(pkg, "dist", "cli.js"));
  const dev = join(pkg, "local-dev");
  await mkdir(dev);
  await writeFile(
    join(dev, "package.json"),
    '{"name":"aurifex-build-proof","version":"1.0.0","main":"index.cjs"}',
  );
  await writeFile(
    join(dev, "index.cjs"),
    'require("node:fs").writeFileSync("dist/cli.js", "// built\\n");',
  );
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "aurifex",
      version: "0.2.0",
      scripts: { build: "node -e \"require('aurifex-build-proof')\"" },
      devDependencies: { "aurifex-build-proof": "file:./local-dev" },
    }),
  );
  await host(bin, "omp");
  const result = await run(["install", "--source", pkg, "--host", "omp", "--yes"], {
    ...env,
    PATH: `${bin}:${NODE_BIN}:/usr/bin:/bin`,
    NODE_ENV: "production",
    npm_config_offline: "true",
    npm_config_package_lock: "false",
  });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Build: ok · npm install --include=dev && npm run build/);
  assert.equal(await readFile(join(pkg, "dist", "cli.js"), "utf8"), "// built\n");
  assert.equal(existsSync(join(pkg, "dist", "adapters", "mcp", "server.js")), true);
  assert.equal(existsSync(join(pkg, "package-lock.json")), false);
});

test("EOF and SIGINT cancel prompt with install cancelled", async () => {
  for (const event of ["close", "SIGINT"] as const) {
    const input = new PassThrough();
    const output = new PassThrough();
    const rl = createInterface({ input, output });
    const pending = ask(rl, "Hosts: ");
    rl.emit(event);
    await assert.rejects(pending, { message: "install cancelled" });
    rl.close();
    input.destroy();
    output.destroy();
  }
});

test("host and scope prompts accept defaults and reject invalid selections", () => {
  const hosts = ["omp", "dsh", "claude"] as const;
  assert.deepEqual(parseHostAnswer("", hosts), hosts);
  assert.deepEqual(parseHostAnswer("3,1", hosts), ["omp", "claude"]);
  assert.deepEqual(parseHostAnswer("dsh", hosts), ["dsh"]);
  assert.throws(() => parseHostAnswer("1,99", hosts), /unknown host: 99/);
  assert.equal(parseScopeAnswer("", "project"), "project");
  assert.throws(() => parseScopeAnswer("system", "user"), /unknown scope/);
});
