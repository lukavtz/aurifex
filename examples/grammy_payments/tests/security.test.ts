import { expect, test } from "bun:test";
import { isAdmin, parseAdminIds } from "../src/security/allowlist.js";
import { claimUpdate } from "../src/security/dedupe.js";
import { allowChat } from "../src/security/rate-limit.js";

test("parseAdminIds keeps only positive safe integers", () => {
  expect(parseAdminIds("10, 20,bad,-3")).toEqual([10, 20]);
  expect(parseAdminIds("")).toEqual([]);
  expect(parseAdminIds(undefined)).toEqual([]);
});

test("isAdmin matches numeric ids only", () => {
  expect(isAdmin(10, "10,20")).toBe(true);
  expect(isAdmin(30, "10,20")).toBe(false);
  expect(isAdmin(undefined, "10,20")).toBe(false);
});

test("dedupe without redis claims the update", async () => {
  expect(await claimUpdate(1, "")).toBe(true);
});

test("rate limit without redis allows the message", async () => {
  expect(await allowChat(1, false, "")).toBe(true);
});
