import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("worker entry runs jobs without starting long polling", () => {
  const source = read("src/worker.ts");
  expect(source).not.toContain("bot.start");
  expect(source).toContain("SIGINT");
  expect(source).toContain("SIGTERM");
  expect(source).toContain("./runtime/queue.js");
});
