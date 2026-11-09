import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const INSTALL_SH = join(REPO, "install.sh");
const INSTALL_PS1 = join(REPO, "install.ps1");
const POSIX = process.platform !== "win32";

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
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

async function hasCommand(command: string): Promise<boolean> {
  try {
    return (await run(command, ["-version"], { cwd: REPO })).code === 0;
  } catch {
    return false;
  }
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aurifex-scripts-"));
}

// install.sh runs the compiled CLI; a fresh checkout has no dist/, so build it
// once (offline, from installed dev dependencies) instead of downloading inside the test.
async function ensureDist(): Promise<void> {
  try {
    await stat(join(REPO, "dist", "cli.js"));
    return;
  } catch {
    const result = await run(
      process.execPath,
      [join(REPO, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"],
      { cwd: REPO },
    );
    assert.equal(result.code, 0, `pre-build failed: ${result.stderr}`);
  }
}

async function fakeNode(bin: string, version: string): Promise<void> {
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "node"), `#!/bin/sh\nprintf '%s' '${version}'\n`, { mode: 0o755 });
  await writeFile(join(bin, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}

test(
  "install.sh is a POSIX sh script with the required install flow",
  { skip: POSIX ? false : "requires a POSIX shell" },
  async () => {
    const script = await readFile(INSTALL_SH, "utf8");

    assert.match(script, /^#!\/bin\/sh\n/);
    assert.match(script, /^set -eu$/m);
    for (const variable of [
      "AURIFEX_REF",
      "AURIFEX_HOME",
      "AURIFEX_SOURCE_DIR",
      "AURIFEX_DRY_RUN",
    ]) {
      assert.ok(script.includes(variable), `missing ${variable}`);
    }
    assert.ok(script.includes('HOME_DIR="${AURIFEX_HOME:-$HOME/.aurifex}"'));
    assert.ok(script.includes('PERSIST_DIR="$HOME_DIR/src"'));
    assert.ok(script.includes(".aurifex-ref"));
    assert.ok(script.includes('"$SOURCE_DIR/dist/cli.js"'));
    assert.ok(script.includes('install --source "$SOURCE_DIR"'));
    assert.ok(script.includes('mv "$TMP_DIR/src" "$PERSIST_DIR"'));
    assert.ok(script.includes('REPO="lukavtz/aurifex"'));
    assert.ok(script.includes("https://codeload.github.com/$REPO/tar.gz/$REF"));
    assert.match(script, /curl -fsSL/);
    assert.match(script, /tar -xzf/);
    assert.match(script, /--strip-components=1/);
    assert.match(script, /mktemp -d/);
    assert.match(script, /npm install/);
    assert.match(script, /node dist\/cli\.js/);
    assert.ok(script.includes("install --source"));
    assert.ok(script.includes("--dry-run"));
    assert.match(script, /trap cleanup EXIT/);
    assert.match(script, /rm -rf "\$TMP_DIR"/);
    assert.match(script, /NODE_MAJOR" -lt 24/);
    assert.match(script, /NODE_MINOR" -lt 9/);
    for (const missing of ["Node.js was not found", "npm was not found"]) {
      assert.ok(script.includes(missing), `missing error: ${missing}`);
    }
    assert.ok(script.includes("curl was not found"));
    assert.ok(script.includes("tar was not found"));
    assert.equal(/\bsudo\b/.test(script), false, "install.sh must not use sudo");
    assert.equal(/npm install -g/.test(script), false, "install.sh must not install globally");

    const mode = (await stat(INSTALL_SH)).mode;
    assert.notEqual(mode & 0o111, 0, "install.sh must be executable");
  },
);

test(
  "install.sh passes a POSIX shell syntax check",
  { skip: POSIX ? false : "requires a POSIX shell" },
  async () => {
    const result = await run("/bin/sh", ["-n", INSTALL_SH], { cwd: REPO });
    assert.equal(result.code, 0, result.stderr);
  },
);

test(
  "install.sh reports a missing Node.js clearly",
  { skip: POSIX ? false : "requires a POSIX shell" },
  async (t) => {
    const root = await tempRoot();
    t.after(() => rm(root, { recursive: true, force: true }));
    const emptyBin = join(root, "bin");
    await mkdir(emptyBin);

    const result = await run("/bin/sh", [INSTALL_SH], {
      cwd: root,
      env: { PATH: emptyBin },
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Node\.js was not found/);
  },
);

test(
  "install.sh rejects Node.js older than 24.9",
  { skip: POSIX ? false : "requires a POSIX shell" },
  async (t) => {
    const root = await tempRoot();
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, "bin");
    await fakeNode(bin, "24.8.0");

    const result = await run("/bin/sh", [INSTALL_SH], {
      cwd: root,
      env: { PATH: `${bin}:/usr/bin:/bin`, AURIFEX_SOURCE_DIR: REPO },
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Node\.js >= 24\.9 is required \(found 24\.8\.0\)/);
  },
);

test(
  "install.sh dry-run uses an existing checkout without downloading",
  { skip: POSIX ? false : "requires a POSIX shell" },
  async (t) => {
    await ensureDist();
    const root = await tempRoot();
    t.after(() => rm(root, { recursive: true, force: true }));
    const scratch = join(root, "tmp");
    await mkdir(scratch);

    const env = { AURIFEX_SOURCE_DIR: REPO, AURIFEX_DRY_RUN: "1", TMPDIR: scratch };
    const first = await run("/bin/sh", [INSTALL_SH], { cwd: root, env });
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Would install: OMP, DSH, Claude Code/);
    assert.match(first.stdout, /OMP: planned/);
    assert.match(first.stdout, /DSH: planned/);
    assert.match(first.stdout, /Claude Code: planned/);
    assert.equal(first.stdout.includes("Downloading"), false, "must not download a checkout");
    assert.deepEqual(await readdir(scratch), [], "temporary download directory must be cleaned up");

    const second = await run("/bin/sh", [INSTALL_SH], { cwd: root, env });
    assert.equal(second.code, 0, second.stderr);
    assert.equal(
      second.stdout.replace(/Done in \d+ ms/g, "Done in <ms>"),
      first.stdout.replace(/Done in \d+ ms/g, "Done in <ms>"),
      "dry run must be idempotent",
    );
  },
);

test(
  "install.sh reuses the persistent install root across runs",
  { skip: POSIX ? false : "requires a POSIX shell" },
  async (t) => {
    await ensureDist();
    const root = await tempRoot();
    t.after(() => rm(root, { recursive: true, force: true }));
    const home = join(root, "home");
    const persist = join(home, "src");
    await mkdir(persist, { recursive: true });
    await cp(join(REPO, "package.json"), join(persist, "package.json"));
    await cp(join(REPO, "dist"), join(persist, "dist"), { recursive: true });
    await writeFile(join(persist, ".aurifex-ref"), "v0.2.0\n");
    const scratch = join(root, "tmp");
    await mkdir(scratch);

    const env = {
      AURIFEX_HOME: home,
      AURIFEX_REF: "v0.2.0",
      AURIFEX_DRY_RUN: "1",
      TMPDIR: scratch,
    };
    const first = await run("/bin/sh", [INSTALL_SH], { cwd: root, env });
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Using existing Aurifex checkout/);
    assert.match(first.stdout, /Would install: OMP, DSH, Claude Code/);
    assert.ok(first.stdout.includes(persist), "host commands must reference the persistent root");
    assert.equal(first.stdout.includes("Downloading"), false, "must reuse the existing checkout");

    const second = await run("/bin/sh", [INSTALL_SH], { cwd: root, env });
    assert.equal(second.code, 0, second.stderr);
    assert.match(second.stdout, /Using existing Aurifex checkout/);
    assert.ok(second.stdout.includes(persist));

    // The install root persists after both exits; no temporary download path is reused or deleted.
    await stat(join(persist, "package.json"));
    await stat(join(persist, "dist", "cli.js"));
    assert.deepEqual((await readdir(home)).toSorted(), ["src"]);
    assert.deepEqual(await readdir(scratch), []);
    assert.equal(/\.download\./.test(first.stdout + second.stdout), false);
  },
);

test("install.ps1 implements the required Windows install flow", async () => {
  const script = await readFile(INSTALL_PS1, "utf8");

  assert.match(script, /^#Requires -Version 5\.1$/m);
  for (const variable of ["AURIFEX_REF", "AURIFEX_HOME", "AURIFEX_SOURCE_DIR", "AURIFEX_DRY_RUN"]) {
    assert.ok(script.includes(variable), `missing ${variable}`);
  }
  assert.ok(script.includes('$env:LOCALAPPDATA "Aurifex"'));
  assert.ok(script.includes('Join-Path $HomeDir "src"'));
  assert.ok(script.includes(".aurifex-ref"));
  assert.ok(script.includes("https://codeload.github.com/$Repo/zip/$Ref"));
  assert.match(script, /Invoke-WebRequest/);
  assert.match(script, /-UseBasicParsing/);
  assert.match(script, /Expand-Archive/);
  assert.match(script, /& npm install/);
  assert.match(script, /node "dist\/cli\.js"/);
  assert.ok(script.includes('@("install", "--source", $SourceDir)'));
  assert.ok(script.includes('"--dry-run"'));
  assert.match(script, /try \{/);
  assert.match(script, /finally \{/);
  assert.match(script, /Remove-Item -Path \$ScratchDir -Recurse -Force/);
  assert.ok(script.includes("the install root must persist"));
  assert.match(script, /\$NodeMajor -lt 24/);
  assert.match(script, /\$NodeMinor -lt 9/);
  assert.ok(script.includes("Node.js was not found"));
  assert.ok(script.includes("npm was not found"));
  assert.equal(/sudo/i.test(script), false, "install.ps1 must not use sudo");
  assert.equal(/npm install -g/.test(script), false, "install.ps1 must not install globally");
});

const pwsh = process.platform === "win32" ? "powershell" : "pwsh";
const pwshAvailable = process.platform === "win32" ? true : await hasCommand(pwsh);

test(
  "install.ps1 dry-run uses an existing checkout",
  {
    skip: pwshAvailable
      ? false
      : "PowerShell is not installed; install pwsh or run on Windows to execute install.ps1",
  },
  async (t) => {
    await ensureDist();
    const root = await tempRoot();
    t.after(() => rm(root, { recursive: true, force: true }));

    const result = await run(
      pwsh,
      process.platform === "win32"
        ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", INSTALL_PS1]
        : ["-NoProfile", "-File", INSTALL_PS1],
      {
        cwd: root,
        env: { AURIFEX_SOURCE_DIR: REPO, AURIFEX_DRY_RUN: "1" },
      },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Would install: OMP, DSH, Claude Code/);
    assert.equal(result.stdout.includes("Downloading"), false, "must not download a checkout");
  },
);
