import { expect, test } from "bun:test";
import type { Context } from "grammy";
import { callbackAckMiddleware } from "../src/guard/callback-ack.js";

function fakeContext(answers: string[]): Context {
  return {
    callbackQuery: { id: "cb-1" },
    answerCallbackQuery: async () => {
      answers.push("answer");
      return true;
    },
  } as unknown as Context;
}

test("answers once when the handler throws before replying", async () => {
  const answers: string[] = [];
  const middleware = callbackAckMiddleware(60_000);
  await expect(
    middleware(fakeContext(answers), async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(answers.length).toBe(1);
});

test("does not answer when the handler succeeds", async () => {
  const answers: string[] = [];
  const middleware = callbackAckMiddleware(60_000);
  await middleware(fakeContext(answers), async () => {});
  expect(answers.length).toBe(0);
});

test("answers a slow handler exactly once", async () => {
  const answers: string[] = [];
  const middleware = callbackAckMiddleware(5);
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 25);
  await middleware(fakeContext(answers), () => promise);
  expect(answers.length).toBe(1);
});

test("passes non-callback updates through untouched", async () => {
  const answers: string[] = [];
  const middleware = callbackAckMiddleware(5);
  await middleware({} as Context, async () => {});
  expect(answers.length).toBe(0);
});
