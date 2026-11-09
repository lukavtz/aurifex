import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { createCoreOperations, type CoreOperations } from "../../src/core/operations.ts";
import { serializeDomainResult, type DomainResult } from "../../src/core/results.ts";
import type { VerifyResult } from "../../src/core/projects/verify.ts";
import type { BotStack } from "../../src/core/spec/bot-spec.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";

const SPEC: Record<string, unknown> = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "webhook_bot",
  displayName: "Webhook Bot",
  stack: "grammy",
  features: ["commands", "llm", "inline", "payments", "miniapps", "moderation", "broadcast"],
  payments: {
    products: [
      {
        id: "support",
        title: "Support",
        description: "Support the bot",
        stars: 1,
        subscription: false,
      },
    ],
  },
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
  runtime: {
    queue: "postgres",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

const CUSTOM_COMPARE =
  /\b(?:x-telegram-bot-api-secret-token|X-Telegram-Bot-Api-Secret-Token|secret[_-]?token)\b[^\n]{0,160}(?:===|==|!==|!=)/i;

function statusOf(result: VerifyResult, id: string): string | undefined {
  return result.checks.find((check) => check.id === id)?.status;
}

async function scaffold(
  operations: CoreOperations,
  stack: BotStack,
  destination: string,
): Promise<Readonly<{ root: string; paths: readonly string[] }>> {
  const created = await operations.scaffoldBot({
    destination,
    spec: { ...structuredClone(SPEC), stack },
  });
  assert.ok(created.status === "ok", JSON.stringify(created));
  return {
    root: destination,
    paths: created.value.files.map((file) => file.path),
  };
}

test("generated grammY webhook validates the secret through the framework", async () => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-webhook-grammy-"));
  try {
    const operations = await createCoreOperations({ root });
    const project = await scaffold(operations, "grammy", "bot");
    const inspection = await operations.inspectBot({ projectRoot: project.root });
    assert.ok(inspection.status === "ok");
    assert.equal(inspection.value.stack, "grammy");

    const server = await readFile(join(root, "bot/src/server.ts"), "utf8");
    assert.match(server, /webhookCallback\(bot, "http"/);
    assert.match(server, /secretToken/);
    assert.doesNotMatch(server, /x-telegram-bot-api-secret-token/i);
    const main = await readFile(join(root, "bot/src/main.ts"), "utf8");
    assert.match(main, /secret_token:\s*config\.WEBHOOK_SECRET/);

    for (const path of project.paths) {
      if (/(^|\/)tests?\//.test(path) || /(^|\/)test_[^/]+\.py$/.test(path)) continue;
      const content = await readFile(join(root, path), "utf8");
      assert.doesNotMatch(content, CUSTOM_COMPARE, path);
    }

    const result: DomainResult<VerifyResult> = await operations.verifyBot({
      projectRoot: project.root,
    });
    assert.ok(result.status === "ok", JSON.stringify(result));
    assert.equal(result.value.ok, true, JSON.stringify(result.value.checks));
    assert.equal(statusOf(result.value, "webhook.secret"), "pass");
    assert.equal(statusOf(result.value, "webhook.constant_time"), "pass");
    const check = result.value.checks.find((entry) => entry.id === "webhook.constant_time");
    assert.equal(check?.evidence?.path, "bot/src/server.ts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated aiogram webhook validates the secret through SimpleRequestHandler", async () => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-webhook-aiogram-"));
  try {
    const operations = await createCoreOperations({ root });
    const project = await scaffold(operations, "aiogram", "pybot");
    const inspection = await operations.inspectBot({ projectRoot: project.root });
    assert.ok(inspection.status === "ok");
    assert.equal(inspection.value.stack, "aiogram");

    const webhook = await readFile(join(root, "pybot/app/webhook.py"), "utf8");
    assert.match(webhook, /SimpleRequestHandler\(/);
    assert.match(webhook, /secret_token=settings\.webhook_secret/);

    for (const path of project.paths) {
      if (/(^|\/)tests?\//.test(path) || /(^|\/)test_[^/]+\.py$/.test(path)) continue;
      const content = await readFile(join(root, path), "utf8");
      assert.doesNotMatch(content, CUSTOM_COMPARE, path);
    }

    const result = await operations.verifyBot({ projectRoot: project.root });
    assert.ok(result.status === "ok", JSON.stringify(result));
    assert.equal(result.value.ok, true, JSON.stringify(result.value.checks));
    assert.equal(statusOf(result.value, "webhook.secret"), "pass");
    assert.equal(statusOf(result.value, "webhook.constant_time"), "pass");
  } finally {
    await rm(root, { recursive: true, force: true });
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
