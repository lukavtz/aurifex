import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { createCoreOperations } from "../../src/core/operations.ts";
import { serializeDomainResult } from "../../src/core/results.ts";
import type { VerifyResult } from "../../src/core/projects/verify.ts";
import { copyReference, listFiles } from "../fixtures/reference-project.ts";

const CUSTOM_COMPARE =
  /\b(?:x-telegram-bot-api-secret-token|X-Telegram-Bot-Api-Secret-Token|secret[_-]?token)\b[^\n]{0,160}(?:===|==|!==|!=)/i;

function statusOf(result: VerifyResult, id: string): string | undefined {
  return result.checks.find((check) => check.id === id)?.status;
}

async function assertNoCustomCompare(root: string): Promise<void> {
  for (const path of await listFiles(root)) {
    if (/(^|\/)tests?\//.test(path) || /(^|\/)test_[^/]+\.py$/.test(path)) continue;
    assert.doesNotMatch(await readFile(join(root, path), "utf8"), CUSTOM_COMPARE, path);
  }
}

test("reference grammY webhook validates the secret through the framework", async () => {
  const reference = await copyReference("grammy");
  try {
    const operations = await createCoreOperations({ root: reference.root });
    const inspection = await operations.inspectBot({ projectRoot: "." });
    assert.ok(inspection.status === "ok");
    assert.equal(inspection.value.stack, "grammy");

    const server = await readFile(join(reference.root, "src/server.ts"), "utf8");
    assert.match(server, /webhookCallback\(bot, "http"/);
    assert.match(server, /secretToken/);
    assert.doesNotMatch(server, /x-telegram-bot-api-secret-token/i);
    const main = await readFile(join(reference.root, "src/main.ts"), "utf8");
    assert.match(main, /secret_token:\s*config\.WEBHOOK_SECRET/);
    await assertNoCustomCompare(reference.root);

    const result = await operations.verifyBot({ projectRoot: "." });
    assert.ok(result.status === "ok", JSON.stringify(result));
    assert.equal(result.value.ok, true, JSON.stringify(result.value.checks));
    assert.equal(statusOf(result.value, "webhook.secret"), "pass");
    assert.equal(statusOf(result.value, "webhook.constant_time"), "pass");
    const check = result.value.checks.find((entry) => entry.id === "webhook.constant_time");
    assert.match(check?.evidence?.path ?? "", /server\.ts$/);
  } finally {
    await reference.cleanup();
  }
});

test("reference aiogram webhook validates the secret through SimpleRequestHandler", async () => {
  const reference = await copyReference("aiogram");
  try {
    const operations = await createCoreOperations({ root: reference.root });
    const inspection = await operations.inspectBot({ projectRoot: "." });
    assert.ok(inspection.status === "ok");
    assert.equal(inspection.value.stack, "aiogram");

    const webhook = await readFile(join(reference.root, "app/webhook.py"), "utf8");
    assert.match(webhook, /SimpleRequestHandler\(/);
    assert.match(webhook, /secret_token=settings\.webhook_secret/);
    await assertNoCustomCompare(reference.root);

    const result = await operations.verifyBot({ projectRoot: "." });
    assert.ok(result.status === "ok", JSON.stringify(result));
    assert.equal(result.value.ok, true, JSON.stringify(result.value.checks));
    assert.equal(statusOf(result.value, "webhook.secret"), "pass");
    assert.equal(statusOf(result.value, "webhook.constant_time"), "pass");
  } finally {
    await reference.cleanup();
  }
});

test("custom secret header comparisons fail webhook.constant_time", async () => {
  const secret = ["top", "secret", "value", "9182"].join("-");
  const cases = [
    {
      label: "typescript",
      path: "src/server.ts",
      content: [
        'import type { IncomingMessage } from "node:http";',
        `const WEBHOOK_SECRET = "${secret}";`,
        "export function authorized(req: IncomingMessage): boolean {",
        '  return req.headers["x-telegram-bot-api-secret-token"] === WEBHOOK_SECRET;',
        "}",
        "",
      ].join("\n"),
    },
    {
      label: "python",
      path: "app/webhook.py",
      content: [
        "from aiohttp import web",
        "",
        "def authorized(request: web.Request) -> bool:",
        '    return request.headers.get("X-Telegram-Bot-Api-Secret-Token") == "constant-secret-value"',
        "",
      ].join("\n"),
    },
  ];

  for (const item of cases) {
    const root = await mkdtemp(join(tmpdir(), `aurifex-constant-${item.label}-`));
    try {
      const operations = await createCoreOperations({ root });
      await mkdir(dirname(join(root, item.path)), { recursive: true });
      await writeFile(join(root, item.path), item.content);
      assert.match(item.content, CUSTOM_COMPARE, `${item.label} fixture must contain a compare`);

      const result = await operations.verifyBot({ projectRoot: "." });
      assert.ok(result.status === "ok", JSON.stringify(result));
      assert.equal(result.value.ok, false);
      assert.equal(statusOf(result.value, "webhook.constant_time"), "fail");
      const check = result.value.checks.find((entry) => entry.id === "webhook.constant_time");
      assert.match(check?.detail ?? "", /constant-time/);

      const serialized = serializeDomainResult(result);
      assert.equal(serialized.includes(secret), false);
      assert.equal(serialized.includes("constant-secret-value"), false);
      assert.equal(serialized.includes('x-telegram-bot-api-secret-token" ==='), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
