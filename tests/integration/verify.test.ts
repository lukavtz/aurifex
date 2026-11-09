import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";

import { inspectBot } from "../../src/core/projects/inspect.ts";
import { baseFiles } from "../../src/core/projects/templates/shared.ts";
import type { TemplateFile } from "../../src/core/projects/templates/shared.ts";
import { verifyBot } from "../../src/core/projects/verify.ts";
import type { VerifyResult } from "../../src/core/projects/verify.ts";
import type { DomainResult } from "../../src/core/results.ts";
import { createPathPolicy } from "../../src/core/security/path-policy.ts";
import type { PathPolicy } from "../../src/core/security/path-policy.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";

const PROJECT = "project";

const SPEC: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "demo_bot",
  displayName: "Demo Bot",
  stack: "grammy",
  features: ["commands", "inline", "payments", "miniapps", "moderation", "broadcast", "llm"],
  deployment: "docker",
  storage: { postgres: false, redis: false },
  i18n: { defaultLocale: "en", en: true, ru: false },
  security: {
    webhookSecret: true,
    adminAllowlist: true,
    rateLimit: true,
    idempotency: true,
  },
};

const FILES: readonly TemplateFile[] = [
  {
    path: "src/config.ts",
    content:
      'export const config = {\n  botToken: process.env.BOT_TOKEN ?? "",\n  webhookSecret: process.env.WEBHOOK_SECRET ?? "",\n  webhookUrl: process.env.WEBHOOK_URL ?? "",\n};\n',
  },
  {
    path: "src/logger.ts",
    content: 'export const logger = { redact: ["BOT_TOKEN", "WEBHOOK_SECRET"] };\n',
  },
  {
    path: "src/server.ts",
    content:
      'import { webhookCallback } from "grammy";\n\nexport function createHandler(bot: unknown) {\n  return webhookCallback(bot as never, "http", { secretToken: process.env.WEBHOOK_SECRET ?? "" });\n}\n',
  },
  {
    path: "src/telegram/api104.ts",
    content:
      'export const methods = ["sendWidget", "answerWidgetQuery", "sendRichMessage"] as const;\n',
  },
  {
    path: "src/security/dedupe.ts",
    content:
      "export async function claimUpdate(update_id: number): Promise<boolean> {\n  // retry_after is honoured by the caller.\n  return update_id > 0;\n}\n",
  },
  {
    path: "src/security/allowlist.ts",
    content: "export function isAdmin(userId: number): boolean {\n  return userId === 1;\n}\n",
  },
  {
    path: "scripts/set-webhook.ts",
    content: 'export const options = { allowed_updates: ["message"], max_connections: 40 };\n',
  },
  {
    path: "tests/features.test.ts",
    content: 'import assert from "node:assert/strict";\n\nassert.equal(1, 1);\n',
  },
  { path: "bun.lock", content: "" },
];

const AIOGRAM_SPEC: BotSpec = { ...SPEC, stack: "aiogram" };

const AIOGRAM_FILES: readonly TemplateFile[] = [
  {
    path: "app/config.py",
    content:
      'import os\n\nADMIN_IDS = os.environ.get("ADMIN_IDS", "")\nWEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")\n',
  },
  {
    path: "app/webhook.py",
    content:
      "from aiogram.webhook.aiohttp_server import SimpleRequestHandler\n\nhandler = SimpleRequestHandler(dispatcher=dp, bot=bot, secret_token=settings.webhook_secret)\nallowed_updates = dispatcher.resolve_used_update_types()\n",
  },
  {
    path: "app/services/retry.py",
    content:
      "async def send_with_retry(call, attempts: int = 3) -> object:\n    retry_after = 1\n    return await call(retry_after)\n",
  },
  {
    path: "app/services/api104.py",
    content: 'METHODS = ("SendWidget", "AnswerWidgetQuery", "SendRichMessage")\n',
  },
  {
    path: "app/middlewares/dedupe.py",
    content:
      'class DedupeMiddleware:\n    async def __call__(self, handler, event, data):\n        update_id = getattr(event, "update_id", None)\n        return await handler(event, data)\n',
  },
  {
    path: "app/logger.py",
    content: 'redact_keys = ["BOT_TOKEN", "WEBHOOK_SECRET"]\n',
  },
  {
    path: "tests/test_commands.py",
    content: "def test_ok() -> None:\n    assert True\n",
  },
  { path: "uv.lock", content: "" },
];

async function scaffold(
  policy: PathPolicy,
  spec: BotSpec = SPEC,
  extra: readonly TemplateFile[] = FILES,
): Promise<void> {
  const files = [...baseFiles(spec, resolveStack(spec.stack).target), ...extra];
  for (const file of files) {
    await policy.writeFile(`${PROJECT}/${file.path}`, file.content);
  }
}

async function setup(
  t: TestContext,
  spec: BotSpec = SPEC,
  extra: readonly TemplateFile[] = FILES,
): Promise<PathPolicy> {
  const root = await mkdtemp(join(tmpdir(), "aurifex-verify-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const policy = await createPathPolicy(root);
  await scaffold(policy, spec, extra);
  return policy;
}

function valueOf(result: DomainResult<VerifyResult>): VerifyResult {
  assert.equal(result.status, "ok");
  if (result.status !== "ok") throw new Error("expected domain success");
  return result.value;
}

function statusOf(result: VerifyResult, id: string): string | undefined {
  return result.checks.find((check) => check.id === id)?.status;
}

async function symlinkOrSkip(
  t: import("node:test").TestContext,
  target: string,
  path: string,
  type: "dir" | "file" = "file",
): Promise<void> {
  try {
    await symlink(target, path, type);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlink requires privileges on this platform");
      return;
    }
    throw error;
  }
}

test("clean scaffold verifies with zero failures", async (t) => {
  const policy = await setup(t);
  const result = valueOf(await verifyBot(PROJECT, policy));
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, { pass: 16, warn: 0, fail: 0 });
  assert.equal(statusOf(result, "token.literal"), "pass");
  assert.equal(statusOf(result, "env.ignored"), "pass");
  assert.equal(statusOf(result, "webhook.secret"), "pass");
  assert.equal(statusOf(result, "webhook.constant_time"), "pass");
  assert.equal(statusOf(result, "container.non_root"), "pass");
  assert.equal(statusOf(result, "botapi.104"), "pass");
});

test("clean aiogram scaffold verifies with zero failures", async (t) => {
  const policy = await setup(t, AIOGRAM_SPEC, AIOGRAM_FILES);
  const result = valueOf(await verifyBot(PROJECT, policy));
  assert.equal(result.ok, true);
  assert.equal(result.summary.fail, 0);
  assert.equal(statusOf(result, "webhook.secret"), "pass");
  assert.equal(statusOf(result, "webhook.https"), "pass");
  assert.equal(statusOf(result, "retry.retry_after"), "pass");
  assert.equal(statusOf(result, "botapi.104"), "pass");
});

test("planted token literal fails token.literal without echoing it", async (t) => {
  const policy = await setup(t);
  const fakeToken = ["123456789", "A".repeat(35)].join(":");
  await policy.writeFile(`${PROJECT}/src/leak.ts`, `export const leaked = "${fakeToken}";\n`);
  const result = valueOf(await verifyBot(PROJECT, policy));
  assert.equal(result.ok, false);
  assert.equal(statusOf(result, "token.literal"), "fail");
  assert.equal(JSON.stringify(result).includes(fakeToken), false);
});

test("missing webhook secret marker fails webhook.secret", async (t) => {
  const policy = await setup(t);
  await policy.writeFile(
    `${PROJECT}/src/server.ts`,
    'import { webhookCallback } from "grammy";\n\nexport const handler = webhookCallback(bot, "http");\n',
    { overwrite: true },
  );
  const result = valueOf(await verifyBot(PROJECT, policy));
  assert.equal(result.ok, false);
  assert.equal(statusOf(result, "webhook.secret"), "fail");
});

test("missing .gitignore fails env.ignored", async (t) => {
  const policy = await setup(t);
  await policy.removeFile(`${PROJECT}/.gitignore`);
  const result = valueOf(await verifyBot(PROJECT, policy));
  assert.equal(result.ok, false);
  assert.equal(statusOf(result, "env.ignored"), "fail");
});

test("missing raw adapter and declaration fails botapi.104", async (t) => {
  const policy = await setup(t);
  await policy.removeFile(`${PROJECT}/src/telegram/api104.ts`);
  await policy.writeFile(`${PROJECT}/README.md`, "# demo bot\n", { overwrite: true });
  const result = valueOf(await verifyBot(PROJECT, policy));
  assert.equal(result.ok, false);
  assert.equal(statusOf(result, "botapi.104"), "fail");
});

test("inspect reports grammY, webhook mode, and Bot API 10.4 gap", async (t) => {
  const policy = await setup(t);
  const result = await inspectBot(PROJECT, policy);
  assert.equal(result.status, "ok");
  if (result.status !== "ok") throw new Error("expected domain success");
  assert.equal(result.value.stack, "grammy");
  assert.equal(result.value.frameworkVersion, "1.46.0");
  assert.equal(result.value.mode, "webhook");
  assert.equal(result.value.botApi, "10.4");
  assert.equal(result.value.rawGap, "10.3");
  assert.equal(
    result.value.findings.every((finding) => finding.status === "pass"),
    true,
  );
});

test("symlinked project root fails unauthorized_path", async (t) => {
  if (process.platform === "win32") {
    t.skip("symlink coverage requires a POSIX host");
    return;
  }
  const base = await mkdtemp(join(tmpdir(), "aurifex-verify-link-"));
  t.after(async () => {
    await rm(base, { recursive: true, force: true });
  });
  const root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await symlinkOrSkip(t, outside, join(root, "escape"), "dir");
  const policy = await createPathPolicy(root);
  const result = await verifyBot("escape", policy);
  assert.equal(result.status, "error");
  if (result.status !== "error") throw new Error("expected domain failure");
  assert.equal(result.error.code, "unauthorized_path");
});
