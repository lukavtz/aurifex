import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
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
    assert.ok(script.includes('"$SOURCE_DIR/dist/cli.js"'));
    assert.ok(script.includes("dist/adapters/mcp/server.js"));
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
    assert.ok(script.includes("$BIN_DIR/aurifex"));
    assert.ok(script.includes("Installed CLI:"));
    assert.match(script, /AURIFEX INSTALLER/);
    assert.match(script, /OMP · DSH · Claude Code/);
    assert.ok(script.includes("[ -t 1 ]"), "color must be gated on a TTY");
    assert.ok(script.includes("NO_COLOR"));
    assert.ok(script.includes('"$DRY_RUN" != "1"'), "dry runs must stay uncolored");
    assert.ok(script.includes("Detected hosts:"));
    assert.ok(script.includes('say "Scope: ${AURIFEX_SCOPE:-user}"'));
    assert.equal(/(^|\n)\s*read\s/.test(script), false, "install.sh must never prompt");
    assert.ok(script.includes('[ "$REF" != "main" ]'), "only pinned refs reuse the checkout");
    assert.ok(script.includes("npm_config_update_notifier=false"));
    assert.ok(script.includes("--no-audit"));
    assert.ok(script.includes("--no-progress"));
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
    assert.match(first.stdout, /AURIFEX INSTALLER/);
    assert.match(first.stdout, /^Detected hosts: .+$/m);
    assert.match(first.stdout, /^Scope: user$/m);
    assert.equal(first.stdout.includes("\u001b["), false, "dry run must not emit ANSI color");
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
  "install.sh creates an aurifex launcher",
  { skip: POSIX ? false : "requires a POSIX shell" },
  async (t) => {
    await ensureDist();
    const root = await tempRoot();
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, "bin");
    const pkg = join(root, "пакет $dollar `tick` \\slash \"quote\" 'single' & ! ^ %");
    const launcherDir = join(root, "launcher");
    const log = join(root, "calls.log");
    await mkdir(bin);
    await mkdir(pkg);
    await cp(join(REPO, "package.json"), join(pkg, "package.json"));
    await symlink(join(REPO, "dist"), join(pkg, "dist"), "dir");
    for (const host of ["omp", "dsh", "claude"]) {
      await writeFile(join(bin, host), `#!/bin/sh\necho "${host}:$*" >> "$AURIFEX_TEST_LOG"\n`, {
        mode: 0o755,
      });
    }
    const nodeDir = join(process.execPath, "..");
    const result = await run("/bin/sh", [INSTALL_SH], {
      cwd: root,
      env: {
        PATH: `${bin}:${nodeDir}:/usr/bin:/bin`,
        AURIFEX_SOURCE_DIR: pkg,
        AURIFEX_BIN_DIR: launcherDir,
        AURIFEX_TEST_LOG: log,
        AURIFEX_YES: "1",
      },
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^Detected hosts: OMP, DSH, Claude Code$/m);
    assert.match(result.stdout, /^Scope: user$/m);
    const launcher = join(launcherDir, "aurifex");
    assert.ok((await stat(launcher)).isFile());
    const version = await run(launcher, ["--version"], { cwd: root });
    assert.equal(version.code, 0, version.stderr);
    assert.match(version.stdout, /Aurifex 0\.2\.0/);
  },
);

test(
  "POSIX launcher preserves shell metacharacters in install root",
  { skip: POSIX ? false : "requires a POSIX shell" },
  async (t) => {
    await ensureDist();
    const root = await tempRoot();
    t.after(() => rm(root, { recursive: true, force: true }));
    const pkg = join(root, "пакет $dollar `tick` \\slash 'single' & ! ^ %");
    const bin = join(root, "bin"); const launcherDir = join(root, "launcher");
    await mkdir(pkg, { recursive: true }); await mkdir(bin);
    await cp(join(REPO, "package.json"), join(pkg, "package.json"));
    await cp(join(REPO, "dist"), join(pkg, "dist"), { recursive: true });
    await writeFile(join(pkg, "package.json"), '{"name":"aurifex","version":"0.2.0","type":"commonjs"}');
    await writeFile(join(pkg, "dist", "cli.js"), `if (process.argv[2] === "install") process.exit(0); process.stdout.write(JSON.stringify(process.argv.slice(2)) + "\\n"); process.exitCode = 17;`);
    await writeFile(join(bin, "omp"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const install = await run("/bin/sh", [INSTALL_SH], {
      cwd: root,
      env: { PATH: `${join(process.execPath, "..")}:${bin}:/usr/bin:/bin:/opt/homebrew/bin`, AURIFEX_SOURCE_DIR: pkg, AURIFEX_BIN_DIR: launcherDir, AURIFEX_HOSTS: "omp", AURIFEX_YES: "1" },
    });
    assert.equal(install.code, 0, install.stderr);
    const result = await run(join(launcherDir, "aurifex"), ["arg with spaces", "$literal", "`literal`", "\\", "quote's"], { cwd: root });
    assert.equal(result.code, 17);
    assert.deepEqual(JSON.parse(result.stdout), ["arg with spaces", "$literal", "`literal`", "\\", "quote's"]);
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
  assert.ok(script.includes("aurifex.cmd"));
  assert.ok(script.includes("Installed CLI:"));
  assert.match(script, /AURIFEX INSTALLER/);
  assert.match(script, /OMP \. DSH \. Claude Code/);
  assert.ok(script.includes("[Console]::IsOutputRedirected"), "color must be gated on a console");
  assert.ok(script.includes("npm_config_update_notifier"));
  assert.ok(script.includes("npm_config_audit"));
  assert.ok(script.includes("Detected hosts:"));
  assert.ok(script.includes('Write-Host "Scope: $ScopeText"'));
  assert.equal(script.includes("Read-Host"), false, "install.ps1 must never prompt");
  assert.ok(script.includes('$Ref -ne "main"'), "only pinned refs reuse the checkout");
  assert.equal(script.includes("\u001b"), false, "install.ps1 must use console colors, not ANSI");
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
  assert.ok(script.includes("--include=dev --ignore-scripts --no-audit --no-fund --no-progress"));
  assert.ok(script.includes("& npm run build"));
  assert.ok(script.includes("dist/adapters/mcp/server.js"));
  assert.ok(script.includes("DisableDelayedExpansion"));
  assert.ok(script.includes("chcp 65001"));
  assert.ok(script.includes('set "AURIFEX_RC=%ERRORLEVEL%"'));
  assert.ok(script.includes("exit /b %AURIFEX_RC%"));
  assert.ok(script.includes("[Text.UTF8Encoding]::new($false)"));
  assert.ok(script.includes(".Replace('%', '%%')"));
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
    assert.match(result.stdout, /AURIFEX INSTALLER/);
    assert.match(result.stdout, /^Detected hosts: .+$/m);
    assert.match(result.stdout, /^Scope: user$/m);
    assert.equal(result.stdout.includes("\u001b["), false, "dry run must not emit ANSI color");
    assert.match(result.stdout, /Would install: OMP, DSH, Claude Code/);
    assert.equal(result.stdout.includes("Downloading"), false, "must not download a checkout");
  },
);

// Drives the real terminal prompt (a pty, not pipes) so Enter, Ctrl-C and EOF
// exercise the same code path a user's terminal does.
const PTY_DRIVER = String.raw`
import json, os, pty, select, sys, time
mode, cmd = sys.argv[1], sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
out, answers, status, start = b"", 0, None, time.time()
while time.time() - start < 30:
    ready, _, _ = select.select([fd], [], [], 0.1)
    if fd in ready:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            chunk = b""
        out += chunk
    if answers == 0 and b"Hosts [" in out:
        answers = 1
        os.write(fd, b"\x03" if mode == "int" else b"\x04" if mode == "eof" else b"\n")
    elif answers == 1 and mode == "defaults" and b"Scope [" in out:
        answers = 2
        os.write(fd, b"\n")
    done, state = os.waitpid(pid, os.WNOHANG)
    if done:
        status = os.waitstatus_to_exitcode(state)
        break
if status is None:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
print(json.dumps({"code": status, "out": out.decode("utf-8", "replace")}))
`;

test(
  "interactive installer answers prompts and cancels in a real tty",
  { skip: POSIX ? false : "requires a POSIX pty" },
  async (t) => {
    const root = await tempRoot();
    t.after(() => rm(root, { recursive: true, force: true }));
    let python = false;
    try {
      python = (await run("python3", ["--version"], { cwd: root })).code === 0;
    } catch {
      python = false;
    }
    if (!python) {
      t.skip("python3 is required to allocate a pty");
      return;
    }
    const pkg = join(root, "pkg");
    const bin = join(root, "bin");
    const log = join(root, "calls.log");
    await mkdir(join(pkg, "dist", "adapters", "mcp"), { recursive: true });
    await mkdir(bin);
    await writeFile(join(pkg, "package.json"), '{"name":"aurifex","version":"0.2.0"}\n');
    await writeFile(join(pkg, "dist", "cli.js"), "");
    await writeFile(join(pkg, "dist", "adapters", "mcp", "server.js"), "");
    for (const name of ["omp", "dsh", "claude"]) {
      await writeFile(
        join(bin, name),
        `#!/bin/sh\nprintf '%s\\n' '${name}:'"$*" >> "$AURIFEX_TEST_LOG"\n`,
        { mode: 0o755 },
      );
    }
    const drive = async (mode: string) => {
      const result = await run("python3", ["-c", PTY_DRIVER, mode, process.execPath, "--experimental-strip-types", join(REPO, "src", "cli.ts"), "install", "--source", pkg], {
        cwd: root,
        env: { HOME: join(root, "home"), PATH: `${bin}:${join(process.execPath, "..")}:/usr/bin:/bin:/opt/homebrew/bin`, AURIFEX_TEST_LOG: log },
      });
      assert.equal(result.code, 0, result.stderr);
      return JSON.parse(result.stdout.trim().split("\n").at(-1)!) as { code: number; out: string };
    };

    const defaults = await drive("defaults");
    assert.equal(defaults.code, 0, defaults.out);
    assert.match(defaults.out, /Installed: OMP, DSH, Claude Code/);
    assert.match(defaults.out, /Scope \[user\/project\] \(user\)/);
    const calls = await readFile(log, "utf8");
    for (const host of ["omp", "dsh", "claude"]) assert.ok(calls.includes(`${host}:`), `missing ${host}`);

    for (const mode of ["int", "eof"]) {
      await rm(log, { force: true });
      const cancelled = await drive(mode);
      assert.equal(cancelled.code, 2, cancelled.out);
      assert.match(cancelled.out, /install cancelled/);
      assert.equal(existsSync(log), false, "a cancelled prompt must not run hosts");
    }
  },
);
