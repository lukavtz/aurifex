import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..", "..", "examples");

test("checked-in examples include manifests and lockfiles", async () => {
  for (const name of ["grammy_commands", "aiogram_commands", "grammy_payments"]) {
    const dir = join(ROOT, name);
    const manifest = JSON.parse(await readFile(join(dir, ".aurifex/manifest.json"), "utf8")) as {
      manifestVersion: number;
    };
    assert.equal(manifest.manifestVersion, 1);
    const lock = name === "aiogram_commands" ? "uv.lock" : "bun.lock";
    assert.ok((await stat(join(dir, lock))).isFile(), `${name}/${lock}`);
  }
});

test("payment example includes a product and queue", async () => {
  const dir = join(ROOT, "grammy_payments");
  const config = await readFile(join(dir, "src/config.ts"), "utf8");
  assert.match(config, /QUEUE_VISIBILITY_TIMEOUT_SECONDS/);
  const payments = await readFile(join(dir, "src/runtime/payments.ts"), "utf8");
  assert.match(payments, /"support"/);
  assert.match(payments, /createInvoiceLink/);
});
