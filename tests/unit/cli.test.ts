import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(REPO, "src", "cli.ts");

const SPEC = {
  schemaVersion: "bot-spec-1.0.0",
  name: "demo_bot",
  displayName: "Demo Bot",
  stack: "grammy",
  features: ["commands"],
  deployment: "docker",
  storage: { postgres: false, redis: false },
  i18n: { defaultLocale: "en", en: true, ru: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
};

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

async function writeSpec(root: string, spec: unknown = SPEC): Promise<string> {
  const path = join(root, "spec.json");
  await writeFile(path, JSON.stringify(spec));
  return path;
}

function parseJson<T = Record<string, unknown>>(output: string): T {
  return JSON.parse(output) as T;
}

test("target --json resolves the grammY framework version", async () => {
  const result = await run(["target", "--stack", "grammy", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const payload = parseJson<{
    status: string;
    value: { stack: string; target: { frameworkVersion: string } };
  }>(result.stdout);
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
  await writeSpec(root);

  const cases: readonly (readonly string[])[] = [
    [],
    ["bogus"],
    ["target", "--stack", "grammy", "--bogus"],
    ["target"],
    ["target", "--stack", "telegraf"],
    ["new", "--spec", join(root, "spec.json")],
    ["new", "demo", "--spec", join(root, "spec.json"), "extra"],
    ["new", "../escape", "--spec", join(root, "spec.json"), "--root", root],
    ["add", "--root", root, "--feature", "nope", "--name", "demo"],
    ["deploy", "--root", root, "--domain", "bot.example.com", "--mode", "carrier-pigeon"],
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

test("invalid spec exits 1 with a domain error", async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const spec = await writeSpec(root, { schemaVersion: "bot-spec-1.0.0" });

  const result = await run(["new", "demo", "--spec", spec, "--root", root, "--json"]);
  assert.equal(result.code, 1, result.stderr);
  const payload = parseJson<{ status: string; error: { code: string } }>(result.stdout);
  assert.equal(payload.status, "error");
  assert.equal(payload.error.code, "invalid_request");
});

test("new then verify round trip", { timeout: 120_000 }, async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const spec = await writeSpec(root);

  const created = await run(["new", "demo", "--spec", spec, "--root", root, "--json"]);
  assert.equal(created.code, 0, created.stderr);
  const createdPayload = parseJson<{
    status: string;
    value: { root: string; files: Array<{ path: string }> };
  }>(created.stdout);
  assert.equal(createdPayload.status, "ok");
  assert.equal(createdPayload.value.root, "demo");
  assert.ok(createdPayload.value.files.length > 0);
  assert.ok(createdPayload.value.files.some((file) => file.path === "src/server.ts"));
  assert.ok(createdPayload.value.files.every((file) => !file.path.startsWith("demo/")));
  await access(join(root, "demo", "src", "server.ts"));

  const verified = await run(["verify", "demo", "--root", root, "--json"]);
  assert.equal(verified.code, 0, verified.stderr);
  const verifiedPayload = parseJson<{
    status: string;
    value: { checks: Array<{ id: string; status: string }> };
  }>(verified.stdout);
  assert.equal(verifiedPayload.status, "ok");
  assert.ok(verifiedPayload.value.checks.length > 0);
  assert.equal(
    verifiedPayload.value.checks.find((check) => check.id === "webhook.secret")?.status,
    "pass",
  );
});

test("new reads the spec from stdin with --spec -", { timeout: 120_000 }, async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await run(
    ["new", "demo", "--spec", "-", "--root", root, "--json"],
    JSON.stringify(SPEC),
  );
  assert.equal(result.code, 0, result.stderr);
  const payload = parseJson<{ status: string; value: { files: unknown[] } }>(result.stdout);
  assert.equal(payload.status, "ok");
  assert.ok(payload.value.files.length > 0);
});

test("add rebases feature paths to the project root", { timeout: 120_000 }, async (t) => {
  const root = await tempRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const spec = await writeSpec(root);

  const created = await run(["new", "demo", "--spec", spec, "--root", root, "--json"]);
  assert.equal(created.code, 0, created.stderr);

  const added = await run([
    "add",
    "demo",
    "--feature",
    "commands",
    "--name",
    "echo",
    "--root",
    root,
    "--json",
  ]);
  assert.equal(added.code, 0, added.stderr);
  const payload = parseJson<{
    status: string;
    value: { root: string; files: Array<{ path: string }> };
  }>(added.stdout);
  assert.equal(payload.status, "ok");
  assert.equal(payload.value.root, "demo");
  assert.ok(payload.value.files.some((file) => file.path === "src/features/echo.ts"));
  assert.ok(payload.value.files.every((file) => !file.path.startsWith("demo/")));
  await access(join(root, "demo", "src", "features", "echo.ts"));
});
