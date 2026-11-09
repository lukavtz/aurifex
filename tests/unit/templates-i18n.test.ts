import assert from "node:assert/strict";
import test from "node:test";
import * as ts from "typescript";

import { BOT_SPEC_VERSION, type BotSpec } from "../../src/core/spec/bot-spec.ts";
import { renderI18nFiles } from "../../src/core/projects/templates/i18n.ts";
import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import { renderAiogramProject } from "../../src/core/projects/templates/aiogram.ts";
import { renderEnvExample } from "../../src/core/projects/templates/shared.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";
import type { TemplateFile } from "../../src/core/projects/templates/shared.ts";

const spec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "i18n_bot",
  displayName: "I18n Bot",
  stack: "grammy",
  features: ["commands"],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "ru", en: true, ru: true, zh: true },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
  runtime: { queue: "none", telemetry: { otlp: false, prometheus: false, sentry: false } },
} as BotSpec;

const aiogramSpec = { ...spec, stack: "aiogram" } as BotSpec;

const specWithoutZh = {
  ...spec,
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
} as BotSpec;

function find(files: readonly TemplateFile[], path: string): TemplateFile {
  const file = files.find((candidate) => candidate.path === path);
  assert.ok(file, `missing ${path}`);
  return file;
}

function syntacticErrors(content: string): readonly ts.Diagnostic[] {
  const result = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  return (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
}

test("emits all three locales regardless of enabled flags", () => {
  const files = renderI18nFiles(specWithoutZh);
  for (const locale of ["en", "ru", "zh"]) {
    assert.ok(files.some((file) => file.path === `src/i18n/${locale}.ts`));
    assert.ok(files.some((file) => file.path === `app/i18n/${locale}.json`));
  }
  assert.ok(files.some((file) => file.path === "src/i18n/index.ts"));
  assert.ok(files.some((file) => file.path === "app/services/i18n.py"));
});

test("fallback configuration follows enabled flags and default locale", () => {
  const index = find(renderI18nFiles(spec), "src/i18n/index.ts").content;
  assert.match(index, /export const DEFAULT_LOCALE: Locale = "ru"/);
  assert.match(index, /export const ENABLED_LOCALES: readonly Locale\[\] = \["en","ru","zh"\]/);

  const restricted = find(renderI18nFiles(specWithoutZh), "app/services/i18n.py").content;
  assert.match(restricted, /^DEFAULT_LOCALE = "en"$/m);
  assert.match(restricted, /^ENABLED_LOCALES = \["en"\]$/m);
  assert.match(restricted, /^LOCALES = \["en","ru","zh"\]$/m);
});

test("emitted TypeScript has no syntax errors", () => {
  for (const file of renderI18nFiles(spec)) {
    if (!file.path.endsWith(".ts")) continue;
    assert.deepEqual(
      syntacticErrors(file.content).map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
      [],
      `syntax error in ${file.path}`,
    );
  }
});

test("emitted Python keeps escaped newlines and interpolated values", () => {
  const python = find(renderI18nFiles(spec), "app/services/i18n.py").content;
  assert.doesNotMatch(python, /\$\{/);
  assert.doesNotMatch(python, /I18n Bot/);
  assert.match(python, /"i18n" \/ \(locale \+ "\.json"\)/);

  const aiogramPkg = renderAiogramProject(aiogramSpec);
  const commands = find(aiogramPkg, "app/handlers/commands.py").content;
  assert.match(commands, /await message\.answer\(t\(locale, "help\.title"\) \+ "\\n" \+ t\(locale, "help\.commands"\)\)/);
  assert.match(commands, /from app\.services\.i18n import t/);
});

test("grammy start and help render through the catalog", () => {
  const files = renderGrammyProject(spec, resolveStack("grammy").target);
  const start = find(files, "src/features/start.ts").content;
  const help = find(files, "src/features/help.ts").content;
  assert.match(start, /import { t } from "\.\.\/i18n\/index\.js";/);
  assert.match(start, /t\(ctx\.from\?\.language_code, "start\.welcome", \{ bot: "I18n Bot" \}\)/);
  assert.match(help, /t\(locale, "help\.title"\) \+ "\\n" \+ t\(locale, "help\.commands"\)/);
  for (const file of [start, help]) {
    assert.deepEqual(syntacticErrors(file), []);
  }
});

test("both stacks include the i18n files", () => {
  const grammy = renderGrammyProject(spec, resolveStack("grammy").target).map((file) => file.path);
  const aiogram = renderAiogramProject(aiogramSpec).map((file) => file.path);
  for (const path of [
    "src/i18n/en.ts",
    "src/i18n/ru.ts",
    "src/i18n/zh.ts",
    "src/i18n/index.ts",
    "app/i18n/en.json",
    "app/i18n/ru.json",
    "app/i18n/zh.json",
    "app/services/i18n.py",
  ]) {
    assert.ok(grammy.includes(path), `grammy missing ${path}`);
    assert.ok(aiogram.includes(path), `aiogram missing ${path}`);
  }
  assert.ok(grammy.includes("tests/i18n.test.ts"));
  assert.ok(aiogram.includes("tests/test_i18n.py"));
});

test("env example lists the Stage 1 runtime and secrets keys", () => {
  const env = renderEnvExample(spec);
  for (const key of [
    "BOT_TOKEN_FILE",
    "WEBHOOK_SECRET_FILE",
    "DATABASE_URL_FILE",
    "REDIS_URL_FILE",
    "LLM_API_KEY_FILE",
    "QUEUE_POLL_MS",
    "QUEUE_BATCH",
    "QUEUE_MAX_ATTEMPTS",
    "QUEUE_VISIBILITY_TIMEOUT_SECONDS",
    "WORKER_ID",
    "MINIAPP_SESSION_TTL_SECONDS",
    "MINIAPP_ALLOWED_ORIGINS",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_SERVICE_NAME",
    "SENTRY_DSN",
    "METRICS_ENABLED",
  ]) {
    assert.match(env, new RegExp(`^${key}=`, "m"), `missing ${key}`);
  }
  assert.match(env, /^QUEUE_POLL_MS=500$/m);
  assert.match(env, /^QUEUE_BATCH=10$/m);
  assert.match(env, /^QUEUE_MAX_ATTEMPTS=5$/m);
  assert.match(env, /^METRICS_ENABLED=true$/m);
});