import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { readSecret, requireSecrets } from "../src/runtime/secrets.js";

const TOKEN = "123456:" + "a".repeat(30);
const REQUIRED = ["BOT_TOKEN", "WEBHOOK_SECRET", "DATABASE_URL", "REDIS_URL"];

function secretFile(dir: string, name: string, value: string): string {
  const path = join(dir, name);
  writeFileSync(path, value + "\n", "utf8");
  if (process.platform !== "win32") {
    chmodSync(path, 0o600);
  }
  return path;
}

test("_FILE wins over the plain variable", () => {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  const tokenFile = secretFile(dir, "bot_token", TOKEN);
  const override = TOKEN.slice(0, -1) + "b";
  expect(readSecret("BOT_TOKEN", { BOT_TOKEN: override, BOT_TOKEN_FILE: tokenFile })).toBe(TOKEN);
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
    expect((error as Error).message).toBe("missing required configuration: " + REQUIRED.join(", "));
  }
});

test("requireSecrets reports every missing name once", () => {
  expect(() => requireSecrets(["DATABASE_URL", "REDIS_URL"], {})).toThrow(
    "missing required configuration: DATABASE_URL, REDIS_URL",
  );
});
