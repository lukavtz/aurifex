import type { BotSpec } from "../../spec/bot-spec.ts";

// Every environment name that may be supplied through `<NAME>_FILE`. The
// generated loaders resolve these before schema validation.
export const FILE_BACKED_SECRETS = [
  "BOT_TOKEN",
  "WEBHOOK_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "LLM_API_KEY",
] as const;

export function requiredSecretNames(spec: BotSpec): string[] {
  const names = ["BOT_TOKEN", "WEBHOOK_SECRET"];
  if (spec.runtime.queue === "postgres") {
    names.push("DATABASE_URL");
  }
  if (
    spec.security.idempotency ||
    spec.security.rateLimit ||
    spec.features.includes("miniapps")
  ) {
    names.push("REDIS_URL");
  }
  return names;
}

export function renderConfigTs(spec: BotSpec): string {
  const required = requiredSecretNames(spec);
  return `import { z } from "zod";
import { readSecret, requireSecrets } from "./runtime/secrets.js";

const tokenSchema = z
  .string()
  .regex(/^\\d{6,}:[A-Za-z0-9_-]{30,}$/, "BOT_TOKEN must be a Telegram bot token");
const secretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,256}$/, "WEBHOOK_SECRET must be 1-256 characters of A-Z, a-z, 0-9, _ or -");

const envSchema = z.object({
  BOT_TOKEN: tokenSchema,
  WEBHOOK_SECRET: secretSchema,
  WEBHOOK_URL: z
    .string()
    .default("")
    .refine(
      (value) => value === "" || /^https:\\/\\/[^\\s]+$/.test(value),
      "WEBHOOK_URL must be an https URL or empty",
    ),
  BOT_MODE: z.enum(["webhook", "polling"]).default("polling"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  ADMIN_IDS: z
    .string()
    .default("")
    .transform((value) =>
      value === ""
        ? []
        : value
            .split(",")
            .map((part) => Number(part.trim()))
            .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  DATABASE_URL: z.string().default(""),
  REDIS_URL: z.string().default(""),
  LLM_BASE_URL: z.string().default(""),
  LLM_MODEL: z.string().default(""),
  LLM_API_KEY: z.string().default(""),
  QUEUE_POLL_MS: z.coerce.number().int().min(1).default(500),
  QUEUE_BATCH: z.coerce.number().int().min(1).max(100).default(10),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  QUEUE_VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(60),
  WORKER_ID: z.string().default(""),
  MINIAPP_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2592000).default(86400),
  MINIAPP_ALLOWED_ORIGINS: z.string().default(""),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(""),
  OTEL_SERVICE_NAME: z.string().default(""),
  SENTRY_DSN: z.string().default(""),
  METRICS_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value === "true" || value === "1"),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof envSchema>;

const FILE_BACKED_SECRETS = [
  "BOT_TOKEN",
  "WEBHOOK_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "LLM_API_KEY",
] as const;

const REQUIRED_SECRETS: readonly string[] = [
${required.map((name) => `  "${name}",`).join("\n")}
];

// aurifex:config
// aurifex:config-end

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  requireSecrets(REQUIRED_SECRETS, env);
  const resolved: NodeJS.ProcessEnv = { ...env };
  for (const name of FILE_BACKED_SECRETS) {
    const value = readSecret(name, env);
    if (value !== undefined) {
      resolved[name] = value;
    }
  }
  return envSchema.parse(resolved);
}

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached === undefined) {
    cached = loadConfig();
  }
  return cached;
}
`;
}

export function renderConfigPy(spec: BotSpec): string {
  const required = requiredSecretNames(spec);
  return `from __future__ import annotations

import os
import re
from collections.abc import Mapping
from functools import lru_cache
from typing import Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.runtime.secrets import read_secret, require_secrets

TOKEN_PATTERN = re.compile(r"^\\d{6,}:[A-Za-z0-9_-]{30,}$")
SECRET_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,256}$")
HTTPS_URL_PATTERN = re.compile(r"^https://\\S+$")

FILE_BACKED_SECRETS = (
    "BOT_TOKEN",
    "WEBHOOK_SECRET",
    "DATABASE_URL",
    "REDIS_URL",
    "LLM_API_KEY",
)

REQUIRED_SECRETS = (
${required.map((name) => `    "${name}",`).join("\n")}
)

# aurifex:config
# aurifex:config-end


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    bot_token: str
    webhook_secret: str = ""
    webhook_url: str = ""
    bot_mode: Literal["webhook", "polling"] = "polling"
    port: int = Field(default=8080, ge=1, le=65535)
    admin_ids: str = ""
    database_url: str = ""
    redis_url: str = ""
    llm_base_url: str = ""
    llm_model: str = ""
    llm_api_key: str = ""
    queue_poll_ms: int = Field(default=500, ge=1)
    queue_batch: int = Field(default=10, ge=1, le=100)
    queue_max_attempts: int = Field(default=5, ge=1)
    queue_visibility_timeout_seconds: int = Field(default=60, ge=1)
    worker_id: str = ""
    miniapp_session_ttl_seconds: int = Field(default=86400, ge=300, le=2592000)
    miniapp_allowed_origins: str = ""
    otel_exporter_otlp_endpoint: str = ""
    otel_service_name: str = ""
    sentry_dsn: str = ""
    metrics_enabled: bool = True
    log_level: str = "info"

    @field_validator("bot_token")
    @classmethod
    def _validate_bot_token(cls, value: str) -> str:
        if not TOKEN_PATTERN.match(value):
            raise ValueError("BOT_TOKEN must look like <bot id>:<token>")
        return value

    @field_validator("webhook_secret")
    @classmethod
    def _validate_webhook_secret(cls, value: str) -> str:
        if value and not SECRET_PATTERN.match(value):
            raise ValueError(
                "WEBHOOK_SECRET must be 1-256 characters of A-Z, a-z, 0-9, _ or -"
            )
        return value

    @field_validator("webhook_url")
    @classmethod
    def _validate_webhook_url(cls, value: str) -> str:
        if value and not HTTPS_URL_PATTERN.match(value):
            raise ValueError("WEBHOOK_URL must be an https:// URL or empty")
        return value

    @property
    def admin_id_set(self) -> frozenset[int]:
        return frozenset(
            int(part) for part in self.admin_ids.split(",") if part.strip().isdigit()
        )


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env
    require_secrets(list(REQUIRED_SECRETS), source)
    resolved: dict[str, Any] = {}
    for key, value in source.items():
        field = key.lower()
        if field in Settings.model_fields:
            resolved[field] = value
    for name in FILE_BACKED_SECRETS:
        value = read_secret(name, source)
        if value is not None:
            resolved[name.lower()] = value
    return Settings(**resolved)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()
`;
}

export function renderSecretsTestTs(spec: BotSpec): string {
  const required = requiredSecretNames(spec);
  return `import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { readSecret, requireSecrets } from "../src/runtime/secrets.js";

const TOKEN = "123456:" + "a".repeat(30);
const REQUIRED = ${JSON.stringify(required)};

function secretFile(dir: string, name: string, value: string): string {
  const path = join(dir, name);
  writeFileSync(path, value + "\\n", "utf8");
  if (process.platform !== "win32") {
    chmodSync(path, 0o600);
  }
  return path;
}

test("_FILE wins over the plain variable", () => {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  const tokenFile = secretFile(dir, "bot_token", TOKEN);
  const override = TOKEN.slice(0, -1) + "b";
  expect(
    readSecret("BOT_TOKEN", { BOT_TOKEN: override, BOT_TOKEN_FILE: tokenFile }),
  ).toBe(TOKEN);
});

test("loadConfig resolves files before validation and keeps no file paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "secrets-config-"));
  const env: NodeJS.ProcessEnv = {
    BOT_TOKEN_FILE: secretFile(dir, "bot_token", TOKEN),
    WEBHOOK_SECRET_FILE: secretFile(dir, "webhook_secret", "webhook_secret_value"),
    DATABASE_URL_FILE: secretFile(dir, "database_url", "postgres://user:pass@postgres:5432/bot"),
    REDIS_URL_FILE: secretFile(dir, "redis_url", "redis://redis:6379/0"),
    LLM_API_KEY_FILE: secretFile(dir, "llm_api_key", "sk-test"),
  };
  const config = loadConfig(env);
  expect(config.BOT_TOKEN).toBe(TOKEN);
  expect(config.LLM_API_KEY).toBe("sk-test");
  expect(JSON.stringify(config)).not.toContain(dir);
});

test("missing configuration lists names only", () => {
  try {
    loadConfig({});
    throw new Error("expected loadConfig to fail");
  } catch (error) {
    expect((error as Error).message).toBe(
      "missing required configuration: " + REQUIRED.join(", "),
    );
  }
});

test("requireSecrets reports every missing name once", () => {
  expect(() => requireSecrets(["DATABASE_URL", "REDIS_URL"], {})).toThrow(
    "missing required configuration: DATABASE_URL, REDIS_URL",
  );
});
`;
}

export function renderSecretsTestPy(spec: BotSpec): string {
  const required = requiredSecretNames(spec);
  return `from __future__ import annotations

import json

import pytest

from app.config import load_settings
from app.runtime.secrets import read_secret, require_secrets

VALID_TOKEN = "123456:" + "A" * 30
REQUIRED = ${JSON.stringify(required)}


def secret_file(tmp_path, name: str, value: str):
    path = tmp_path / name
    path.write_text(value + "\\n", encoding="utf-8")
    path.chmod(0o600)
    return path


def file_env(tmp_path):
    return {
        "BOT_TOKEN_FILE": str(secret_file(tmp_path, "bot_token", VALID_TOKEN)),
        "WEBHOOK_SECRET_FILE": str(secret_file(tmp_path, "webhook_secret", "webhook_secret_value")),
        "DATABASE_URL_FILE": str(
            secret_file(tmp_path, "database_url", "postgres://user:pass@postgres:5432/bot")
        ),
        "REDIS_URL_FILE": str(secret_file(tmp_path, "redis_url", "redis://redis:6379/0")),
        "LLM_API_KEY_FILE": str(secret_file(tmp_path, "llm_api_key", "sk-test")),
    }


def test_file_wins_over_plain_value(tmp_path) -> None:
    token_file = secret_file(tmp_path, "token", VALID_TOKEN)
    env = {"BOT_TOKEN": "wrong", "BOT_TOKEN_FILE": str(token_file)}
    assert read_secret("BOT_TOKEN", env) == VALID_TOKEN


def test_settings_resolve_files_before_validation(tmp_path) -> None:
    env = file_env(tmp_path)
    settings = load_settings(env)
    assert settings.bot_token == VALID_TOKEN
    assert settings.llm_api_key == "sk-test"
    serialized = json.dumps(settings.model_dump(mode="json"))
    assert str(tmp_path) not in serialized


def test_missing_configuration_lists_names_only() -> None:
    with pytest.raises(RuntimeError) as excinfo:
        load_settings({})
    assert str(excinfo.value) == "missing required configuration: " + ", ".join(REQUIRED)


def test_require_secrets_reports_every_missing_name() -> None:
    with pytest.raises(RuntimeError) as excinfo:
        require_secrets(["DATABASE_URL", "REDIS_URL"], {})
    message = str(excinfo.value)
    assert message == "missing required configuration: DATABASE_URL, REDIS_URL"
    assert "://" not in message
`;
}