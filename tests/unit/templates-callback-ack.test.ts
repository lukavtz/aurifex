import assert from "node:assert/strict";
import { test } from "node:test";
import { BOT_SPEC_VERSION, type BotSpec } from "../../src/core/spec/bot-spec.ts";
import { renderAiogramProject } from "../../src/core/projects/templates/aiogram.ts";
import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import type { TemplateFile } from "../../src/core/projects/templates/shared.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";

function spec(stack: "grammy" | "aiogram"): BotSpec {
  return {
    schemaVersion: BOT_SPEC_VERSION,
    name: "ack_bot",
    displayName: "Ack Bot",
    stack,
    features: ["commands"],
    deployment: "docker",
    storage: { postgres: false, redis: false },
    i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
    security: { webhookSecret: true, adminAllowlist: false, rateLimit: false, idempotency: false },
    runtime: {
      queue: "none",
      telemetry: { otlp: false, prometheus: false, sentry: false },
    },
  };
}

function find(files: readonly TemplateFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path);
  assert.ok(file, `missing ${path}`);
  return file.content;
}

const grammyFiles = renderGrammyProject(spec("grammy"), resolveStack("grammy").target);
const aiogramFiles = renderAiogramProject(spec("aiogram"));

test("grammy renders a per-invocation callback ack middleware", () => {
  const source = find(grammyFiles, "src/security/callback-ack.ts");
  assert.match(source, /const ACK_TIMEOUT_MS = 2_000;/);
  assert.match(source, /export function callbackAckMiddleware/);
  assert.match(source, /if \(!ctx\.callbackQuery\) \{/);
  assert.match(source, /let answered = false;/);
  assert.match(source, /if \(answered\) return;/);
  assert.match(source, /await ctx\.answerCallbackQuery\(\);/);
  assert.match(source, /clearTimeout\(timer\);/);
  assert.match(source, /await answerOnce\(\);\n      throw error;/);

  const moduleScope = source.slice(0, source.indexOf("export function callbackAckMiddleware"));
  assert.doesNotMatch(moduleScope, /\b(?:let|const|var)\s+answered\b|\bsetTimeout\(/);
});

test("grammy registers the ack middleware before features", () => {
  const bot = find(grammyFiles, "src/bot.ts");
  const ackIndex = bot.indexOf("bot.use(callbackAckMiddleware());");
  const securityIndex = bot.indexOf("for (const middleware of security)");
  assert.ok(ackIndex > -1, "callback ack middleware is not registered");
  assert.ok(securityIndex > ackIndex, "callback ack middleware must precede security middleware");

  const main = find(grammyFiles, "src/main.ts");
  assert.ok(main.indexOf("createBot()") < main.indexOf("registerFeatures({"));
});

test("grammy ships generated ack tests", () => {
  const source = find(grammyFiles, "tests/callback-ack.test.ts");
  assert.match(source, /answers once when the handler throws before replying/);
  assert.match(source, /does not answer when the handler succeeds/);
  assert.match(source, /answers a slow handler exactly once/);
  assert.match(source, /expect\(answers\.length\)\.toBe\(1\);/);
  assert.match(source, /expect\(answers\.length\)\.toBe\(0\);/);
});

test("aiogram renders a per-invocation callback ack middleware", () => {
  const source = find(aiogramFiles, "app/middlewares/callback_ack.py");
  assert.match(source, /class CallbackAckMiddleware\(BaseMiddleware\):/);
  assert.match(source, /ACK_TIMEOUT_SECONDS = 2\.0/);
  assert.match(source, /if not isinstance\(event, CallbackQuery\):/);
  assert.match(source, /nonlocal answered/);
  assert.match(source, /if answered:/);
  assert.match(source, /await event\.answer\(\)/);
  assert.match(source, /task = asyncio\.create_task\(answer_late\(\)\)/);
  assert.match(source, /task\.cancel\(\)/);
  assert.match(source, /contextlib\.suppress\(asyncio\.CancelledError\)/);
  assert.match(source, /await answer_once\(\)\n            raise/);

  const moduleScope = source.slice(0, source.indexOf("class CallbackAckMiddleware"));
  assert.doesNotMatch(moduleScope, /answered|task/);
});

test("aiogram registers the ack middleware before handlers", () => {
  const bot = find(aiogramFiles, "app/bot.py");
  const ackIndex = bot.indexOf("dispatcher.callback_query.middleware(CallbackAckMiddleware())");
  const handlerIndex = bot.indexOf("register_handlers(dispatcher, bot)");
  assert.ok(ackIndex > -1, "callback ack middleware is not registered");
  assert.ok(handlerIndex > ackIndex, "callback ack middleware must precede handler registration");
});

test("aiogram ships generated ack tests", () => {
  const source = find(aiogramFiles, "tests/test_callback_ack.py");
  assert.match(source, /test_fast_failure_answers_once_and_reraises/);
  assert.match(source, /test_success_does_not_answer/);
  assert.match(source, /test_slow_handler_is_answered_once/);
  assert.match(source, /assert_awaited_once\(\)/);
  assert.match(source, /assert_not_awaited\(\)/);
});
