import { expect, test } from "bun:test";
import { retryAfterMs, sendWithRetry } from "../src/security/retry.js";

test("reads retry_after seconds and converts to milliseconds", () => {
  expect(retryAfterMs({ parameters: { retry_after: 3 } })).toBe(3000);
  expect(retryAfterMs({ parameters: { retry_after: 0.5 } })).toBe(500);
});

test("ignores errors without a retry_after hint", () => {
  expect(retryAfterMs(new Error("plain"))).toBeUndefined();
  expect(retryAfterMs({ parameters: {} })).toBeUndefined();
});

test("sendWithRetry retries exactly once after a 429", async () => {
  let attempts = 0;
  const result = await sendWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw { parameters: { retry_after: 0.001 } };
    return "ok";
  });
  expect(result).toBe("ok");
  expect(attempts).toBe(2);
});
