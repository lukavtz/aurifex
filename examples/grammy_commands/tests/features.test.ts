import { expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  BOT_TOKEN: "123456:" + "a".repeat(30),
  WEBHOOK_SECRET: "test_secret_value",
  DATABASE_URL: "postgres://user:pass@localhost:5432/bot",
  REDIS_URL: "redis://localhost:6379/0",
};

test("rejects a malformed bot token", () => {
  expect(() => loadConfig({ ...baseEnv, BOT_TOKEN: "not-a-token" })).toThrow();
});

test("accepts a polling configuration without a webhook url", () => {
  const config = loadConfig({ ...baseEnv, BOT_MODE: "polling" });
  expect(config.BOT_MODE).toBe("polling");
  expect(config.PORT).toBe(8080);
});

test("rejects a non-https webhook url", () => {
  expect(() => loadConfig({ ...baseEnv, WEBHOOK_URL: "http://bot.example.com" })).toThrow();
});

test("parses admin ids and drops invalid entries", () => {
  expect(loadConfig({ ...baseEnv, ADMIN_IDS: "1, 2,oops,0" }).ADMIN_IDS).toEqual([1, 2]);
});
