import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import * as prettier from "prettier";

import { EXAMPLES, checkExamples, readExamples, renderExample } from "../../scripts/generate-examples.ts";
import { MANIFEST_PATH, serializeManifest, type AurifexManifest } from "../../src/core/projects/manifest.ts";
import { createPathPolicy } from "../../src/core/security/path-policy.ts";
import { sha256Hex } from "../../src/core/results.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const run = promisify(execFile);
const supported = new Set([".ts", ".js", ".json", ".md", ".yml", ".yaml"]);

async function trackedFiles(root: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (["node_modules", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "dist"].includes(entry.name)) continue;
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await trackedFiles(root, path));
    else if (entry.isFile()) result.push(path);
  }
  return result.toSorted();
}

test("examples:check is deterministic and never writes tracked examples", { timeout: 120_000 }, async () => {
  const before = await readExamples();
  assert.deepEqual(await checkExamples(), []);
  assert.deepEqual(await checkExamples(), []);
  assert.deepEqual(await readExamples(), before);
});

test("checked-in example manifests cover final formatted bytes and exact tracked files", async () => {
  for (const { name, spec } of EXAMPLES) {
    const root = join(ROOT, "examples", name);
    const manifest = JSON.parse(await readFile(join(root, MANIFEST_PATH), "utf8")) as AurifexManifest;
    const lock = spec.stack === "grammy" ? "bun.lock" : "uv.lock";
    assert.equal(manifest.manifestVersion, 1);
    assert.equal(manifest.specVersion, "bot-spec-1.1.0");
    assert.ok(!(MANIFEST_PATH in manifest.files));
    assert.ok(!(lock in manifest.files));
    assert.deepEqual(Object.keys(manifest.files), Object.keys(manifest.files).toSorted());
    assert.deepEqual(await trackedFiles(root), [...Object.keys(manifest.files), MANIFEST_PATH, lock].toSorted());
    for (const [path, hash] of Object.entries(manifest.files)) {
      const content = await readFile(join(root, path), "utf8");
      assert.equal(sha256Hex(content), hash, `${name}/${path}`);
      if (supported.has(extname(path))) {
        const options = await prettier.resolveConfig(join(ROOT, path));
        assert.ok(await prettier.check(content, { ...options, filepath: path }), `${name}/${path} formatting`);
      }
    }
    const docker = await readFile(join(root, "Dockerfile"), "utf8");
    assert.match(docker, spec.stack === "grammy" ? /COPY package\.json bun\.lock\*/ : /COPY pyproject\.toml uv\.lock\*/);
    assert.match(docker, spec.stack === "grammy" ? /bun install --frozen-lockfile/ : /uv sync --frozen/);
    const ignored = (await readFile(join(root, ".dockerignore"), "utf8")).split("\n");
    for (const entry of ["node_modules", ".env", ".env.*", "tests", "dist"]) assert.ok(ignored.includes(entry), `${name}: ${entry}`);
    assert.ok(Object.keys(manifest.files).some((path) => /callback[_-]ack/.test(path)), `${name}: callback ack`);
    assert.ok(Object.keys(manifest.files).every((path) => !path.startsWith(spec.stack === "grammy" ? "app/" : "src/")));
  }
});

test("double render formats before hashing and produces identical manifests", { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-render-proof-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const policy = await createPathPolicy(root);
  for (const { name } of EXAMPLES) {
    const a = await renderExample(name, `${name}-a`, policy);
    const b = await renderExample(name, `${name}-b`, policy);
    assert.deepEqual(a.files, b.files);
    assert.equal(serializeManifest(a.manifest), serializeManifest(b.manifest));
    for (const file of a.files) {
      if (file.path !== MANIFEST_PATH) assert.equal(a.manifest.files[file.path], sha256Hex(file.content));
    }
  }
});

test("parity ignores lock bytes but detects generated drift without rewriting it", { timeout: 120_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-parity-proof-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const policy = await createPathPolicy(root);
  for (const { name, spec } of EXAMPLES) {
    await renderExample(name, `examples/${name}`, policy);
    await writeFile(join(root, "examples", name, spec.stack === "grammy" ? "bun.lock" : "uv.lock"), "different lock bytes\n");
  }
  assert.deepEqual(await checkExamples(root), []);
  const path = "examples/grammy_commands/src/config.ts";
  await writeFile(join(root, path), "// deliberate generated drift\n");
  const before = await readExamples(root);
  const drift = await checkExamples(root);
  assert.ok(drift.some((item) => item.example === "grammy_commands" && item.path === "src/config.ts" && item.reason === "changed"));
  assert.deepEqual(await readExamples(root), before);
});

test("generator imports have no regeneration side effects", async () => {
  const before = await readExamples();
  const result = await run(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", "await import('./scripts/generate-examples.ts')"], { cwd: ROOT });
  assert.equal(result.stdout, "");
  assert.deepEqual(await readExamples(), before);
});

test("payment example includes the configured product and queue", async () => {
  const dir = join(ROOT, "examples", "grammy_payments");
  assert.match(await readFile(join(dir, "src/config.ts"), "utf8"), /QUEUE_VISIBILITY_TIMEOUT_SECONDS/);
  const payments = await readFile(join(dir, "src/runtime/payments.ts"), "utf8");
  assert.match(payments, /"support"/);
  assert.match(payments, /createInvoiceLink/);
});
