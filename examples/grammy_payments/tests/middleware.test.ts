import { expect, test } from "bun:test";
import { createBot } from "../src/bot.js";
import { loadConfig } from "../src/config.js";

const EXPECTED_SECURITY_MIDDLEWARE = 2;

const config = loadConfig({
  BOT_TOKEN: "123456:" + "a".repeat(30),
  WEBHOOK_SECRET: "test_secret_value",
  DATABASE_URL: "postgres://user:pass@localhost:5432/bot",
  REDIS_URL: "redis://localhost:6379/0",
});

test("createBot installs the configured security middleware", () => {
  const bot = createBot(config);
  expect(bot.securityMiddleware.length).toBe(EXPECTED_SECURITY_MIDDLEWARE);
});

test("security middleware is installed before update handling", () => {
  const bot = createBot({ ...config, REDIS_URL: "" });
  expect(bot.securityMiddleware.length).toBe(EXPECTED_SECURITY_MIDDLEWARE);
  expect(typeof bot.middleware()).toBe("function");
});
