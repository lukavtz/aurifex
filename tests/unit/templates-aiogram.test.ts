import assert from "node:assert/strict";
import { test } from "node:test";

import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import { renderAiogramProject } from "../../src/core/projects/templates/aiogram.ts";
import { TELEGRAM_TOKEN_RE } from "../../src/core/security/secrets.ts";

const spec: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "support_bot",
  displayName: "Support Bot",
  stack: "aiogram",
  features: ["commands", "llm"],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false },
  security: {
    webhookSecret: true,
    adminAllowlist: true,
    rateLimit: true,
    idempotency: true,
  },
};

const REQUIRED_FILES = [
  ".env.example",
  ".gitignore",
  ".dockerignore",
  "Dockerfile",
  "docker-compose.yml",
  "Caddyfile",
  "pyproject.toml",
  "README.md",
  ".github/workflows/ci.yml",
  "alembic.ini",
  "migrations/env.py",
  "migrations/versions/0001_init.py",
  "app/__init__.py",
  "app/config.py",
  "app/logger.py",
  "app/bot.py",
  "app/main.py",
  "app/webhook.py",
  "app/handlers/__init__.py",
  "app/handlers/commands.py",
  "app/handlers/admin.py",
  "app/middlewares/__init__.py",
  "app/middlewares/allowlist.py",
  "app/middlewares/dedupe.py",
  "app/middlewares/rate_limit.py",
  "app/services/__init__.py",
  "app/services/api104.py",
  "app/services/retry.py",
  "app/db/__init__.py",
  "app/db/session.py",
  "app/db/models.py",
  "tests/test_commands.py",
  "tests/test_security.py",
  "tests/test_webhook_secret.py",
  "tests/test_api104.py",
  "tests/test_retry.py",
];

const modernSpec: BotSpec = {
  ...spec,
  features: ["commands", "widgets", "rich"] as unknown as BotSpec["features"],
};

function contentOf(path: string): string {
  const file = renderAiogramProject(spec).find((entry) => entry.path === path);
  assert.ok(file, `missing file ${path}`);
  return file.content;
}

test("render is deterministic", () => {
  const first = renderAiogramProject(spec);
  const second = renderAiogramProject(spec);
  assert.deepEqual(first, second);
});

test("renders every required file exactly once", () => {
  const paths = renderAiogramProject(spec).map((file) => file.path);
  assert.equal(new Set(paths).size, paths.length);
  for (const path of REQUIRED_FILES) {
    assert.ok(paths.includes(path), `missing ${path}`);
  }
});

test("pyproject pins the aiogram stack and Python range", () => {
  const pyproject = contentOf("pyproject.toml");
  assert.match(pyproject, /^\[project\]$/m);
  assert.match(pyproject, /requires-python = ">=3.11,<3.15"/);
  assert.match(pyproject, /"aiogram==3\.31\.0"/);
  assert.match(pyproject, /"pydantic-settings==2\.16\.2"/);
  assert.match(pyproject, /"asyncpg==0\.32\.0"/);
  assert.match(pyproject, /"sqlalchemy==2\.1\.8"/);
  assert.match(pyproject, /"redis==8\.1\.0"/);
  assert.match(pyproject, /"alembic==1\.20\.1"/);
  assert.match(pyproject, /"structlog==26\.1\.0"/);
  assert.match(pyproject, /"httpx==0\.28\.1"/);
  assert.match(pyproject, /"pytest==9\.2\.0"/);
  assert.match(pyproject, /"pytest-asyncio==1\.4\.1\.post1"/);
  assert.match(pyproject, /pythonpath = \["\."\]/);
});

test("no rendered file contains a token literal", () => {
  for (const file of renderAiogramProject(spec)) {
    TELEGRAM_TOKEN_RE.lastIndex = 0;
    assert.equal(TELEGRAM_TOKEN_RE.test(file.content), false, `token literal in ${file.path}`);
  }
});

test("Dockerfile runs as a non-root user", () => {
  const dockerfile = contentOf("Dockerfile");
  const user = /^USER\s+(\S+)$/m.exec(dockerfile);
  assert.ok(user, "Dockerfile has no USER line");
  assert.notEqual(user[1], "root");
});

test("webhook wiring enforces the secret header and body cap", () => {
  const webhook = contentOf("app/webhook.py");
  assert.match(webhook, /SimpleRequestHandler\(/);
  assert.match(webhook, /secret_token=settings\.webhook_secret/);
  assert.match(webhook, /client_max_size=MAX_BODY_BYTES/);
  assert.match(webhook, /MAX_BODY_BYTES = 1_048_576/);
  assert.match(webhook, /"\/healthz"/);
  assert.match(webhook, /def register_miniapp_routes/);
  assert.match(webhook, /register_miniapp_routes\(app, settings\)/);
});

test("config validates without import-time instantiation", () => {
  const config = contentOf("app/config.py");
  assert.match(config, /class Settings\(BaseSettings\)/);
  assert.match(config, /@lru_cache\(maxsize=1\)/);
  assert.doesNotMatch(config, /^SETTINGS = Settings\(/m);
  assert.match(config, /def _validate_bot_token/);
  assert.match(config, /def _validate_webhook_secret/);
  assert.match(config, /def _validate_webhook_url/);
  assert.match(config, /ge=1, le=65535/);
});

test("middlewares implement dedupe, rate limit, and allowlist", () => {
  const dedupe = contentOf("app/middlewares/dedupe.py");
  assert.match(dedupe, /nx=True, ex=DEDUPE_TTL_SECONDS/);
  assert.match(dedupe, /DEDUPE_TTL_SECONDS = 86_400/);
  const rateLimit = contentOf("app/middlewares/rate_limit.py");
  assert.match(rateLimit, /PRIVATE_LIMIT = 1/);
  assert.match(rateLimit, /GROUP_LIMIT = 20/);
  const allowlist = contentOf("app/middlewares/allowlist.py");
  assert.match(allowlist, /def is_admin/);
});

test("logger redacts secrets", () => {
  const logger = contentOf("app/logger.py");
  assert.match(logger, /from collections\.abc import MutableMapping/);
  assert.match(logger, /event_dict: MutableMapping\[str, Any\]\n\) -> MutableMapping\[str, Any\]/);
  assert.match(logger, /redact_processor/);
  assert.match(logger, /"bot_token"/);
  assert.match(logger, /"webhook_secret"/);
  assert.match(logger, /"llm_api_key"/);
  assert.match(logger, /"authorization"/);
});

test("handlers auto-load sibling modules", () => {
  const handlers = contentOf("app/handlers/__init__.py");
  assert.match(handlers, /pkgutil\.iter_modules/);
  assert.match(handlers, /register\(dp, bot\)/);
});

test("Bot API 10.4 raw adapter defines typed methods and bounds", () => {
  const api = contentOf("app/services/api104.py");
  for (const name of [
    "SendWidget",
    "SendSharedWidget",
    "AnswerWidgetQuery",
    "EditMessageWidgetData",
    "EditSharedWidgetData",
    "SendRichMessage",
    "SendRichMessageDraft",
  ]) {
    assert.match(api, new RegExp(`class ${name}\\(TelegramMethod\\[`));
  }
  assert.match(api, /__api_method__ = "sendWidget"/);
  assert.match(api, /__api_method__ = "answerWidgetQuery"/);
  assert.match(api, /__api_method__ = "sendRichMessageDraft"/);
  assert.match(api, /min_length=1, max_length=32768/);
  assert.match(api, /max_length=1024/);
  assert.match(api, /ge=5, le=3600/);
  assert.match(api, /draft_id must be non-zero/);
});

test("retry service exposes retry_after handling", () => {
  const retry = contentOf("app/services/retry.py");
  assert.match(retry, /def get_retry_after/);
  assert.match(retry, /def is_retry_after_error/);
  assert.match(retry, /async def sleep_retry_after/);
  assert.match(retry, /retry_after/);
  const bot = contentOf("app/bot.py");
  assert.match(bot, /dispatcher\.errors\.register\(handle_error\)/);
  assert.match(bot, /sleep_retry_after/);
});

test("widget and rich handlers are feature-gated", () => {
  const basePaths = renderAiogramProject(spec).map((file) => file.path);
  assert.equal(basePaths.includes("app/handlers/widgets.py"), false);
  assert.equal(basePaths.includes("app/handlers/rich.py"), false);
  assert.equal(basePaths.includes("tests/test_widgets.py"), false);

  const modernPaths = renderAiogramProject(modernSpec).map((file) => file.path);
  assert.ok(modernPaths.includes("app/handlers/widgets.py"));
  assert.ok(modernPaths.includes("app/handlers/rich.py"));
  assert.ok(modernPaths.includes("tests/test_widgets.py"));
});

test("widget handler answers queries and enables allowed updates", () => {
  const widgets = renderAiogramProject(modernSpec).find(
    (file) => file.path === "app/handlers/widgets.py",
  );
  assert.ok(widgets);
  assert.match(widgets.content, /answer_widget_query/);
  assert.match(widgets.content, /widget_query/);
  assert.match(widgets.content, /shared_widget_query/);
  assert.match(widgets.content, /allowed_updates_extra/);
});

test("README documents the 10.4 raw adapter", () => {
  const readme = contentOf("README.md");
  assert.match(readme, /## Bot API 10\.4 typed raw adapter/);
  assert.match(readme, /sendRichMessageDraft/);
});
