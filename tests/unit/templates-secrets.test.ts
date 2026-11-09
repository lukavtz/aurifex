import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  renderSecretsPy,
  renderSecretsTs,
} from "../../src/core/projects/templates/runtime-secrets.ts";

interface SecretsModule {
  readSecret(name: string, env?: NodeJS.ProcessEnv): string | undefined;
  requiredSecret(name: string, env?: NodeJS.ProcessEnv): string;
  requireSecrets(names: readonly string[], env?: NodeJS.ProcessEnv): void;
}

async function loadTsModule(): Promise<SecretsModule> {
  const dir = await mkdtemp(join(tmpdir(), "aurifex-secrets-"));
  const file = join(dir, "secrets.ts");
  await writeFile(file, renderSecretsTs(), "utf8");
  // Static import cannot work: the module path is a fresh temp dir per test run.
  return (await import(pathToFileURL(file).href)) as SecretsModule;
}

function writeSecretFile(dir: string, name: string, content: string, mode = 0o600): string {
  const file = join(dir, name);
  writeFileSync(file, content, "utf8");
  if (process.platform !== "win32") {
    chmodSync(file, mode);
  }
  return file;
}

test("renders a TS module that imports node:fs and exposes the secret helpers", () => {
  const source = renderSecretsTs();
  assert.match(
    source,
    /import \{ closeSync, constants, fstatSync, openSync, readSync \} from "node:fs";/,
  );
  assert.match(source, /export function readSecret\(name: string, env: Env = process\.env\)/);
  assert.match(source, /export function requiredSecret\(name: string, env: Env = process\.env\)/);
  assert.match(source, /\$\{name\}_FILE/);
  assert.match(source, /missing required configuration: \$\{name\}/);
});

test("_FILE wins over the plain variable and trims exactly one trailing newline", async () => {
  const secrets = await loadTsModule();
  const dir = await mkdtemp(join(tmpdir(), "aurifex-secret-file-"));
  const file = writeSecretFile(dir, "bot_token", "from-file\n");

  assert.equal(
    secrets.readSecret("BOT_TOKEN", { BOT_TOKEN: "from-env", BOT_TOKEN_FILE: file }),
    "from-file",
  );

  const twoNewlines = writeSecretFile(dir, "two", "value\n\n");
  assert.equal(secrets.readSecret("TWO", { TWO_FILE: twoNewlines }), "value\n");

  const crlf = writeSecretFile(dir, "crlf", "value\r\n");
  assert.equal(secrets.readSecret("CRLF", { CRLF_FILE: crlf }), "value");

  assert.equal(secrets.readSecret("BOT_TOKEN", { BOT_TOKEN: "from-env" }), "from-env");
  assert.equal(secrets.readSecret("BOT_TOKEN", {}), undefined);
  assert.equal(secrets.readSecret("BOT_TOKEN", { BOT_TOKEN: "" }), undefined);
});

test("empty secret file is an error and errors never include the value", async () => {
  const secrets = await loadTsModule();
  const dir = await mkdtemp(join(tmpdir(), "aurifex-secret-empty-"));
  const empty = writeSecretFile(dir, "empty", "");

  assert.throws(
    () => secrets.readSecret("BOT_TOKEN", { BOT_TOKEN_FILE: empty }),
    /secret file for BOT_TOKEN is empty/,
  );

  assert.throws(
    () =>
      secrets.readSecret("BOT_TOKEN", {
        BOT_TOKEN: "do-not-leak",
        BOT_TOKEN_FILE: join(dir, "missing"),
      }),
    (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, /cannot read secret file for BOT_TOKEN/);
      assert.ok(!message.includes("do-not-leak"));
      return true;
    },
  );
});

test("requiredSecret and requireSecrets list only variable names", async () => {
  const secrets = await loadTsModule();

  assert.equal(secrets.requiredSecret("BOT_TOKEN", { BOT_TOKEN: "abc" }), "abc");
  assert.throws(
    () => secrets.requiredSecret("BOT_TOKEN", {}),
    /^Error: missing required configuration: BOT_TOKEN$/,
  );
  assert.throws(
    () => secrets.requireSecrets(["DATABASE_URL", "REDIS_URL"], { DATABASE_URL: "postgres://x" }),
    /^Error: missing required configuration: REDIS_URL$/,
  );
});

test("rejects a symlinked secret file on POSIX", async () => {
  if (process.platform === "win32") return;
  const secrets = await loadTsModule();
  const dir = await mkdtemp(join(tmpdir(), "aurifex-secret-link-"));
  const real = writeSecretFile(dir, "real", "value\n");
  const link = join(dir, "link");
  symlinkSync(real, link);
  assert.throws(
    () => secrets.readSecret("LINK", { LINK_FILE: link }),
    /cannot read secret file for LINK/,
  );
});

test("rejects an oversized secret file", async () => {
  const secrets = await loadTsModule();
  const dir = await mkdtemp(join(tmpdir(), "aurifex-secret-big-"));
  const big = writeSecretFile(dir, "big", "x".repeat(65_537));
  assert.throws(() => secrets.readSecret("BIG", { BIG_FILE: big }), /too large/);
});

test("warns once about group-readable files unless NODE_ENV=test", async () => {
  if (process.platform === "win32") {
    return;
  }
  const secrets = await loadTsModule();
  const dir = await mkdtemp(join(tmpdir(), "aurifex-secret-mode-"));
  const loose = writeSecretFile(dir, "loose", "value\n", 0o644);

  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  try {
    assert.equal(secrets.readSecret("LOOSE", { LOOSE_FILE: loose }), "value");
    assert.equal(secrets.readSecret("LOOSE", { LOOSE_FILE: loose }), "value");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /secret file for LOOSE is readable by group or others \(mode 644\)/);

    assert.equal(secrets.readSecret("LOOSE", { LOOSE_FILE: loose, NODE_ENV: "test" }), "value");
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = original;
  }
});

test("renders the Python module with fd-based regular-file checks", () => {
  const source = renderSecretsPy();
  assert.match(source, /^from __future__ import annotations/m);
  assert.match(source, /^import stat$/m);
  assert.match(source, /^import os$/m);
  assert.match(source, /\{name\}_FILE/);
  assert.match(source, /getattr\(os, "O_NOFOLLOW", 0\)/);
  assert.match(source, /getattr\(os, "O_NONBLOCK", 0\)/);
  assert.match(source, /stat\.S_ISREG\(info\.st_mode\)/);
  assert.match(source, /"PYTEST_CURRENT_TEST" in env/);
  assert.match(source, /missing required configuration: \{name\}/);
  assert.match(source, /def read_secret\(name: str, env: Mapping\[str, str\] \| None = None\)/);
  assert.match(source, /def required_secret\(/);
});

test("Python module behaviour matches the TS contract", (t) => {
  const python = spawnSync("python3", ["--version"], { encoding: "utf8" });
  if (python.status !== 0) {
    t.skip("python3 unavailable");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "aurifex-secret-py-"));
  const module = join(dir, "secrets.py");
  writeFileSync(module, renderSecretsPy(), "utf8");
  const file = writeSecretFile(dir, "token", "file-value\n");
  const script = `import sys
sys.path.insert(0, ${JSON.stringify(dir)})
from secrets import read_secret, required_secret
assert read_secret("TOKEN", {"TOKEN": "env-value", "TOKEN_FILE": ${JSON.stringify(file)}}) == "file-value"
assert read_secret("TOKEN", {"TOKEN": "env-value"}) == "env-value"
assert read_secret("TOKEN", {}) is None
try:
    required_secret("TOKEN", {})
except RuntimeError as error:
    assert str(error) == "missing required configuration: TOKEN"
else:
    raise AssertionError("required_secret did not raise")
print("ok")
`;
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ok");
});
