import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { renderAiogramProject } from "../../src/core/projects/templates/aiogram.ts";
import { renderGrammyProject } from "../../src/core/projects/templates/grammy.ts";
import {
  renderConfigPy,
  renderConfigTs,
  requiredSecretNames,
} from "../../src/core/projects/templates/runtime-config.ts";
import { renderSecretsTs } from "../../src/core/projects/templates/runtime-secrets.ts";
import { renderCompose, renderGitignore } from "../../src/core/projects/templates/shared.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import { resolveStack } from "../../src/core/targets/catalog.ts";

const BASE: BotSpec = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "config_bot",
  displayName: "Config Bot",
  stack: "grammy",
  features: ["commands"],
  deployment: "docker",
  storage: { postgres: false, redis: false },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: false, idempotency: false },
  runtime: {
    queue: "none",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

const QUEUED: BotSpec = {
  ...BASE,
  features: ["commands", "llm"],
  storage: { postgres: true, redis: true },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
  runtime: {
    queue: "postgres",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

interface LoadedConfig {
  loadConfig(env?: NodeJS.ProcessEnv): Record<string, unknown>;
}

async function loadGeneratedConfig(source: string): Promise<LoadedConfig> {
  // Place the fixture inside the repository so `zod` resolves from the root
  // node_modules; Node's type stripping then loads the generated TS directly.
  const dir = await mkdtemp(join(process.cwd(), ".tmp-config-"));
  try {
    await mkdir(join(dir, "runtime"));
    await writeFile(
      join(dir, "runtime", "secrets.ts"),
      renderSecretsTs(),
      "utf8",
    );
    await writeFile(
      join(dir, "config.ts"),
      source.replace('from "./runtime/secrets.js"', 'from "./runtime/secrets.ts"'),
      "utf8",
    );
    return (await import(pathToFileURL(join(dir, "config.ts")).href)) as LoadedConfig;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("required names follow queue, redis security flags, and miniapps", () => {
  assert.deepEqual(requiredSecretNames(BASE), ["BOT_TOKEN", "WEBHOOK_SECRET"]);
  assert.deepEqual(requiredSecretNames(QUEUED), [
    "BOT_TOKEN",
    "WEBHOOK_SECRET",
    "DATABASE_URL",
    "REDIS_URL",
  ]);
  assert.deepEqual(
    requiredSecretNames({
      ...BASE,
      security: { webhookSecret: true, adminAllowlist: true, rateLimit: false, idempotency: true },
    }),
    ["BOT_TOKEN", "WEBHOOK_SECRET", "REDIS_URL"],
  );
  assert.deepEqual(
    requiredSecretNames({ ...BASE, features: ["commands", "miniapps"] }),
    ["BOT_TOKEN", "WEBHOOK_SECRET", "REDIS_URL"],
  );

  const plain = /const REQUIRED_SECRETS: readonly string\[\] = \[([\s\S]*?)\];/.exec(
    renderConfigTs(BASE),
  );
  assert.ok(plain, "missing REQUIRED_SECRETS");
  assert.doesNotMatch(plain[1]!, /DATABASE_URL|REDIS_URL/);
});

test("generated TS config lists required secrets and resolves files per name", () => {
  const source = renderConfigTs(QUEUED);
  assert.match(source, /import \{ readSecret, requireSecrets \} from "\.\/runtime\/secrets\.js";/);
  const requiredBlock = /const REQUIRED_SECRETS: readonly string\[\] = \[([\s\S]*?)\];/.exec(source);
  assert.ok(requiredBlock, "missing REQUIRED_SECRETS");
  for (const name of ["BOT_TOKEN", "WEBHOOK_SECRET", "DATABASE_URL", "REDIS_URL"]) {
    assert.match(requiredBlock[1]!, new RegExp(`"${name}"`));
  }
  assert.match(source, /for \(const name of FILE_BACKED_SECRETS\)/);
  assert.match(source, /"LLM_API_KEY",/);
  assert.doesNotMatch(source, /process\.env\.BOT_TOKEN/);
  for (const field of [
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
    assert.match(source, new RegExp(`${field}:`));
  }
});

test("generated TS config gives _FILE precedence and lists one missing error", async () => {
  const { loadConfig } = await loadGeneratedConfig(renderConfigTs(QUEUED));
  const dir = await mkdtemp(join(tmpdir(), "aurifex-config-"));
  try {
    const token = "123456:" + "a".repeat(30);
    const files: Record<string, string> = {
      BOT_TOKEN: token,
      WEBHOOK_SECRET: "from_webhook_file",
      DATABASE_URL: "postgres://file:file@postgres:5432/bot",
      REDIS_URL: "redis://redis:6379/0",
      LLM_API_KEY: "sk-from-file",
    };
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      BOT_TOKEN: "123456:" + "b".repeat(30),
      WEBHOOK_SECRET: "from_webhook_env",
      DATABASE_URL: "postgres://env:env@postgres:5432/bot",
      REDIS_URL: "redis://env:6379/0",
      LLM_API_KEY: "sk-from-env",
    };
    for (const [name, value] of Object.entries(files)) {
      const path = join(dir, name.toLowerCase());
      await writeFile(path, `${value}\n`, "utf8");
      env[`${name}_FILE`] = path;
    }

    const config = loadConfig(env);
    assert.equal(config.BOT_TOKEN, token);
    assert.equal(config.WEBHOOK_SECRET, "from_webhook_file");
    assert.equal(config.DATABASE_URL, files.DATABASE_URL);
    assert.equal(config.LLM_API_KEY, "sk-from-file");
    assert.equal(config.QUEUE_POLL_MS, 500);
    assert.equal(config.METRICS_ENABLED, true);
    assert.ok(!JSON.stringify(config).includes(dir));

    assert.throws(
      () => loadConfig({ BOT_TOKEN: token, WEBHOOK_SECRET: "webhook_secret_value" }),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.equal(message, "missing required configuration: DATABASE_URL, REDIS_URL");
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generated Python config imports the secret helpers and validates the same fields", () => {
  const source = renderConfigPy(QUEUED);
  assert.match(source, /from app\.runtime\.secrets import read_secret, require_secrets/);
  assert.match(source, /Settings\(\*\*resolved\)/);
  const requiredBlock = /REQUIRED_SECRETS = \(([\s\S]*?)\n\)/.exec(source);
  assert.ok(requiredBlock, "missing REQUIRED_SECRETS");
  for (const name of ["BOT_TOKEN", "WEBHOOK_SECRET", "DATABASE_URL", "REDIS_URL"]) {
    assert.match(requiredBlock[1]!, new RegExp(`"${name}"`));
  }
  assert.match(source, /miniapp_session_ttl_seconds: int = Field\(default=86400, ge=300, le=2592000\)/);
  assert.match(source, /metrics_enabled: bool = True/);
  assert.match(source, /@field_validator\("bot_token"\)/);
  assert.match(source, /def admin_id_set/);
});

test("rendered projects ship configs, secret loaders, and secret tests", () => {
  const grammy = renderGrammyProject(QUEUED, resolveStack("grammy").target);
  const grammyPaths = new Set(grammy.map((file) => file.path));
  for (const path of ["src/config.ts", "src/runtime/secrets.ts", "tests/secrets.test.ts"]) {
    assert.ok(grammyPaths.has(path), `missing ${path}`);
  }
  const aiogram = renderAiogramProject({ ...QUEUED, stack: "aiogram" });
  const aiogramPaths = new Set(aiogram.map((file) => file.path));
  for (const path of ["app/config.py", "app/runtime/secrets.py", "tests/test_secrets.py"]) {
    assert.ok(aiogramPaths.has(path), `missing ${path}`);
  }
});

test("compose declares file-backed secrets and mounts them", () => {
  const compose = renderCompose(QUEUED);
  assert.match(compose, /^secrets:$/m);
  for (const name of ["bot_token", "webhook_secret", "database_url", "redis_url", "llm_api_key"]) {
    assert.match(compose, new RegExp(`^  ${name}:\\n    file: \\./secrets/${name}$`, "m"));
  }
  for (const name of ["BOT_TOKEN", "WEBHOOK_SECRET", "DATABASE_URL", "REDIS_URL", "LLM_API_KEY"]) {
    assert.match(compose, new RegExp(`      ${name}_FILE: /run/secrets/${name.toLowerCase()}`));
  }
  assert.match(compose, /^  worker:$/m);
});

test("compose omits the worker when the queue is disabled", () => {
  const compose = renderCompose(BASE);
  assert.doesNotMatch(compose, /^  worker:$/m);
  assert.match(compose, /^  bot_token:$/m);
  assert.match(compose, /^  webhook_secret:$/m);
  assert.doesNotMatch(compose, /^  database_url:$/m);
  assert.doesNotMatch(compose, /^  redis_url:$/m);
  assert.doesNotMatch(compose, /^  llm_api_key:$/m);
});

test("gitignore ignores local secret files", () => {
  assert.match(renderGitignore(BASE), /^secrets\/$/m);
});