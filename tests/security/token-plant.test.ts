import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { createCoreOperations } from "../../src/core/operations.ts";
import { serializeDomainResult } from "../../src/core/results.ts";
import { findTelegramTokens, redactSecrets } from "../../src/core/security/secrets.ts";
import { copyReference } from "../fixtures/reference-project.ts";

// Built at runtime so this test file never carries a token-shaped literal.
function plantedToken(): string {
  return ["1234567890", "Ab3".repeat(12)].join(":");
}

test("planted token fails token.literal without echoing the full token", async () => {
  const reference = await copyReference("grammy");
  const root = reference.root;
  try {
    const operations = await createCoreOperations({ root });
    const configPath = join(root, "src", "config.ts");
    const original = await readFile(configPath, "utf8");
    const token = plantedToken();
    await writeFile(configPath, `${original}\nconst leaked = "${token}";\n`);

    const result = await operations.verifyBot({ projectRoot: "." });
    assert.ok(result.status === "ok", JSON.stringify(result));
    assert.equal(result.value.ok, false);

    const tokenCheck = result.value.checks.find((check) => check.id === "token.literal");
    assert.ok(tokenCheck !== undefined);
    assert.equal(tokenCheck.status, "fail");
    assert.match(tokenCheck.detail, /token literal/);

    const serialized = serializeDomainResult(result);
    assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes("Ab3Ab3Ab3"), false);
    assert.match(serialized, /1234567890:Ab3A/);
    assert.equal((result.value.summary.fail ?? 0) > 0, true);
  } finally {
    await reference.cleanup();
  }
});

test("an oversized file cannot hide a token", async () => {
  const reference = await copyReference("grammy");
  const root = reference.root;
  try {
    const operations = await createCoreOperations({ root });
    await writeFile(join(root, "bundle.txt"), "x".repeat(1_048_576) + "\n" + plantedToken() + "\n");
    const result = await operations.verifyBot({ projectRoot: "." });
    assert.ok(result.status === "ok");
    assert.equal(result.value.ok, false);
    const tokenCheck = result.value.checks.find((check) => check.id === "token.literal");
    assert.equal(tokenCheck?.status, "fail");
    assert.match(tokenCheck?.detail ?? "", /oversized/);
  } finally {
    await reference.cleanup();
  }
});

test("findTelegramTokens and redactSecrets never return the full token", () => {
  const token = plantedToken();
  const hits = findTelegramTokens(`const token = "${token}";\n`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.redacted.includes(token), false);
  assert.equal(hits[0]?.redacted.startsWith("1234567890:Ab3A"), true);

  const redacted = redactSecrets(`BOT_TOKEN=${token}\nAuthorization: Bearer abc.def.ghi\n`);
  assert.equal(redacted.includes(token), false);
  assert.match(redacted, /1234567890:<redacted>/);
  assert.match(redacted, /Bearer <redacted>/);
});
