import assert from "node:assert/strict";
import { test } from "node:test";
import { BOT_SPEC_VERSION, type BotSpec } from "../../src/core/spec/bot-spec.ts";
import { TELEGRAM_TOKEN_RE } from "../../src/core/security/secrets.ts";
import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import { renderGrammyFeature } from "../../src/core/projects/features/grammy.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";
import type { TemplateFile } from "../../src/core/projects/templates/shared.ts";

const spec: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "demo_bot",
  displayName: 'Demo "Bot"',
  stack: "grammy",
  features: [
    "commands",
    "llm",
    "inline",
    "payments",
    "miniapps",
    "moderation",
    "broadcast",
    "widgets",
    "rich",
  ],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: true },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
};

const target = resolveStack("grammy").target;
const files = renderGrammyProject(spec, target);

function find(path: string): TemplateFile {
  const file = files.find((candidate) => candidate.path === path);
  assert.ok(file, `missing ${path}`);
  return file;
}

function hasTokenLiteral(content: string): boolean {
  TELEGRAM_TOKEN_RE.lastIndex = 0;
  return TELEGRAM_TOKEN_RE.test(content);
}

const REQUIRED = [
  ".env.example",
  ".gitignore",
  ".dockerignore",
  "Dockerfile",
  "docker-compose.yml",
  "Caddyfile",
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "drizzle.config.ts",
  "README.md",
  ".github/workflows/ci.yml",
  "src/config.ts",
  "src/logger.ts",
  "src/bot.ts",
  "src/main.ts",
  "src/server.ts",
  "src/features/index.ts",
  "src/features/start.ts",
  "src/features/help.ts",
  "src/features/admin.ts",
  "src/security/allowlist.ts",
  "src/security/dedupe.ts",
  "src/security/rate-limit.ts",
  "src/storage/db.ts",
  "src/storage/schema.ts",
  "src/telegram/api104.ts",
  "src/security/retry.ts",
  "src/features/widgets.ts",
  "src/features/rich.ts",
  "src/features/miniapp.ts",
  "tests/features.test.ts",
  "tests/security.test.ts",
  "tests/webhook-secret.test.ts",
  "tests/api104.test.ts",
  "tests/widgets.test.ts",
  "tests/retry.test.ts",
  "tests/miniapp-session.test.ts",
  "tests/middleware.test.ts",
  "tests/body-cap.test.ts",
];

test("renders every required file", () => {
  const paths = new Set(files.map((file) => file.path));
  for (const path of REQUIRED) {
    assert.ok(paths.has(path), `missing ${path}`);
  }
});

test("is deterministic for the same spec", () => {
  assert.deepEqual(renderGrammyProject(spec, target), files);
});

test("uses safe project-relative POSIX paths", () => {
  for (const file of files) {
    assert.ok(!file.path.startsWith("/"), `absolute path: ${file.path}`);
    assert.ok(!file.path.includes("\\"), `backslash path: ${file.path}`);
    assert.ok(!file.path.split("/").includes(".."), `parent segment: ${file.path}`);
  }
});

test("package.json parses with the required scripts and pins", () => {
  const pkg = JSON.parse(find("package.json").content) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
  };
  for (const script of [
    "dev",
    "build",
    "start",
    "typecheck",
    "test",
    "lint",
    "format:check",
    "db:generate",
    "db:migrate",
  ]) {
    assert.ok(script in pkg.scripts, `missing script ${script}`);
  }
  assert.equal(pkg.dependencies["grammy"], "1.46.0");
});

test("Dockerfile runs as a non-root user", () => {
  const users = find("Dockerfile")
    .content.split("\n")
    .filter((line) => line.startsWith("USER "))
    .map((line) => line.slice(5).trim());
  assert.ok(users.length > 0, "no USER line");
  assert.ok(
    users.every((user) => user !== "root" && user !== "0"),
    `root user: ${users.join(",")}`,
  );
});

test("no rendered file contains a token-shaped literal", () => {
  for (const file of files) {
    assert.ok(!hasTokenLiteral(file.content), `token literal in ${file.path}`);
  }
  assert.match(find(".env.example").content, /^BOT_TOKEN=$/m);
});

test("config validates token and webhook secrets with regexes", () => {
  const content = find("src/config.ts").content;
  assert.ok(content.includes("\\d{6,}:[A-Za-z0-9_-]{30,}"));
  assert.ok(content.includes("[A-Za-z0-9_-]{1,256}"));
  assert.ok(content.includes("https:\\/\\/"));
  assert.ok(content.includes('BOT_MODE: z.enum(["webhook", "polling"])'));
  assert.ok(content.includes("ADMIN_IDS"));
  assert.ok(content.includes("export function loadConfig"));
  assert.ok(content.includes("export function getConfig"));
});

test("server enforces the webhook secret and body cap", () => {
  const content = find("src/server.ts").content;
  assert.ok(content.includes('webhookCallback(bot, "http"'));
  assert.ok(content.includes("secretToken"));
  assert.ok(content.includes("1_048_576"));
  assert.ok(content.includes("/healthz"));
  assert.ok(content.includes("413"));
});

test("main uses explicit allowed_updates and graceful shutdown", () => {
  const content = find("src/main.ts").content;
  assert.ok(content.includes("allowed_updates"));
  assert.ok(content.includes("SIGINT"));
  assert.ok(content.includes("SIGTERM"));
  assert.ok(find("src/bot.ts").content.includes("bot.catch"));
  assert.ok(find("src/logger.ts").content.includes("req.headers.authorization"));
});

test("generated imports use .js suffixes", () => {
  assert.ok(find("src/main.ts").content.includes('"./config.js"'));
  assert.ok(find("src/main.ts").content.includes('"./features/index.js"'));
  assert.ok(find("src/security/rate-limit.ts").content.includes('"./dedupe.js"'));
});

test("start command embeds the display name safely", () => {
  const content = find("src/features/start.ts").content;
  assert.ok(content.includes(JSON.stringify(spec.displayName)));
  assert.ok(!content.includes("parse_mode"));
});

test("feature loader is deterministic and skips index", () => {
  const content = find("src/features/index.ts").content;
  assert.ok(content.includes("entries.sort()"));
  assert.ok(content.includes('"index.js"'));
  assert.ok(content.includes("registerFeatures"));
});

test("package and tsconfig include Bun test types", () => {
  const pkg = JSON.parse(find("package.json").content) as {
    devDependencies: Record<string, string>;
  };
  assert.equal(pkg.devDependencies["@types/bun"], "1.4.4");
  const tsconfig = JSON.parse(find("tsconfig.json").content) as {
    compilerOptions: { types: string[] };
  };
  assert.deepEqual(tsconfig.compilerOptions.types, ["node", "bun"]);
});

test("redis client uses the named ioredis export", () => {
  const content = find("src/security/dedupe.ts").content;
  assert.ok(content.includes('import { Redis } from "ioredis";'));
  assert.ok(!content.includes('import Redis from "ioredis";'));
});

test("retry_after handling is wired into bot.catch", () => {
  assert.ok(find("src/security/retry.ts").content.includes("retry_after"));
  assert.ok(find("src/bot.ts").content.includes("retryAfterMs"));
  assert.ok(find("tests/retry.test.ts").content.includes("retry_after"));
});

test("Bot API 10.4 adapter uses one narrow raw cast", () => {
  const content = find("src/telegram/api104.ts").content;
  assert.ok(content.includes("bot.api.raw as unknown as RawApi104"));
  for (const method of [
    "sendWidget",
    "sendSharedWidget",
    "answerWidgetQuery",
    "editMessageWidgetData",
    "editSharedWidgetData",
    "sendRichMessage",
    "sendRichMessageDraft",
    "sendMessageEphemeral",
  ]) {
    assert.ok(content.includes(method), `missing ${method}`);
  }
});

test("widgets feature answers queries within the documented contract", () => {
  const content = find("src/features/widgets.ts").content;
  assert.ok(content.includes("widget_query"));
  assert.ok(content.includes("shared_widget_query"));
  assert.ok(content.includes("answerWidgetQuery"));
  assert.ok(content.includes("15 seconds"));
  assert.ok(!content.includes("BOT_TOKEN"));
  const rich = find("src/features/rich.ts").content;
  assert.ok(rich.includes("sendRichMessage"));
  assert.ok(rich.includes("sendRichMessageDraft"));
});

test("README documents the typed Bot API 10.4 adapter", () => {
  const content = find("README.md").content;
  assert.ok(content.includes("Bot API 10.4 (typed raw adapter)"));
  assert.ok(content.includes("src/telegram/api104.ts"));
});

test("widgets and rich files are conditional on spec features", () => {
  const minimal: BotSpec = {
    ...spec,
    features: ["commands"],
    storage: { postgres: false, redis: false },
  };
  const paths = new Set(renderGrammyProject(minimal, target).map((file) => file.path));
  assert.ok(!paths.has("src/features/widgets.ts"));
  assert.ok(!paths.has("tests/widgets.test.ts"));
  assert.ok(!paths.has("src/features/rich.ts"));
  assert.ok(!paths.has("src/features/miniapp.ts"));
  assert.ok(paths.has("src/telegram/api104.ts"));
});

test("miniapps route is always mounted through a runtime feature load", () => {
  const server = find("src/server.ts").content;
  assert.ok(server.includes("async function loadMiniAppRoute"));
  assert.ok(server.includes('const name = "miniapp"'));
  assert.ok(server.includes('await import("./features/" + name + ".js")'));
  assert.ok(server.includes("ERR_MODULE_NOT_FOUND"));
  assert.ok(server.includes("miniAppRoute.method"));
  assert.ok(server.includes("miniAppRoute.path"));
  assert.ok(!server.includes("import { route as miniAppRoute }"));
  assert.ok(server.includes("401"));
  assert.ok(find("tests/miniapp-session.test.ts").content.includes("401"));

  const minimal: BotSpec = { ...spec, features: ["commands"] };
  const minimalFiles = renderGrammyProject(minimal, target);
  const minimalServer = minimalFiles.find((file) => file.path === "src/server.ts");
  assert.ok(minimalServer !== undefined);
  assert.ok(minimalServer.content.includes("loadMiniAppRoute"));
  assert.ok(!minimalFiles.some((file) => file.path === "src/features/miniapp.ts"));
});

test("adding miniapps after scaffolding supplies the routable module", () => {
  const minimal: BotSpec = { ...spec, features: ["commands"] };
  const featurePaths = new Set(
    renderGrammyFeature("miniapps", "miniapp", minimal).map((file) => file.path),
  );
  assert.ok(featurePaths.has("src/features/miniapp.ts"));
  const module = renderGrammyFeature("miniapps", "miniapp", minimal).find(
    (file) => file.path === "src/features/miniapp.ts",
  );
  assert.ok(module !== undefined);
  assert.ok(module.content.includes('export const SESSION_PATH = "/api/miniapp/session"'));
  assert.ok(module.content.includes("export const route"));
});

test("bot wires dedupe and rate-limit middleware from the spec", () => {
  const content = find("src/bot.ts").content;
  assert.ok(content.includes("dedupeMiddleware(config.REDIS_URL)"));
  assert.ok(content.includes("rateLimitMiddleware(config.REDIS_URL)"));
  assert.ok(content.includes("bot.use(middleware)"));
  assert.ok(content.includes("securityMiddleware"));
  assert.ok(find("tests/middleware.test.ts").content.includes("EXPECTED_SECURITY_MIDDLEWARE = 2"));

  const minimal: BotSpec = {
    ...spec,
    features: ["commands"],
    security: { ...spec.security, idempotency: false, rateLimit: false },
  };
  const botFile = renderGrammyProject(minimal, target).find((file) => file.path === "src/bot.ts");
  assert.ok(botFile !== undefined);
  assert.ok(!botFile.content.includes("dedupeMiddleware"));
  assert.ok(!botFile.content.includes("rateLimitMiddleware"));
});

test("body cap destroys the connection instead of responding", () => {
  const content = find("src/server.ts").content;
  assert.ok(content.includes("req.destroy()"));
  assert.ok(content.includes("must not keep buffering"));
  assert.ok(find("tests/body-cap.test.ts").content.includes("600_000"));
});
