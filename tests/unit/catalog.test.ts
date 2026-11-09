import assert from "node:assert/strict";
import test from "node:test";

import {
  BOT_API_RELEASED,
  BOT_API_VERSION,
  featureLabel,
  listStacks,
  resolveStack,
} from "../../src/core/targets/catalog.ts";
import { BOT_FEATURES } from "../../src/core/spec/bot-spec.ts";

test("resolves exact grammY framework version", () => {
  const resolution = resolveStack("grammy");
  assert.equal(resolution.stack, "grammy");
  assert.equal(resolution.target.framework, "grammy");
  assert.equal(resolution.target.frameworkVersion, "1.46.0");
  assert.equal(resolution.target.testedBotApi, "10.3");
  assert.equal(resolution.schemaVersion, "aurifex-target-1.0.0");
});

test("resolves exact aiogram framework version", () => {
  const resolution = resolveStack("aiogram");
  assert.equal(resolution.stack, "aiogram");
  assert.equal(resolution.target.framework, "aiogram");
  assert.equal(resolution.target.frameworkVersion, "3.31.0");
  assert.equal(resolution.target.testedBotApi, "10.3");
});

test("reports Bot API 10.4 and the tested 10.3 gap", () => {
  assert.equal(BOT_API_VERSION, "10.4");
  assert.equal(BOT_API_RELEASED, "2026-11-09");
  for (const stack of listStacks()) {
    const resolution = resolveStack(stack);
    assert.equal(resolution.botApi.version, "10.4");
    assert.equal(resolution.target.supportedBotApi, "10.4");
    assert.ok(
      resolution.warnings.some(
        (warning) =>
          warning.includes("10.3") &&
          warning.includes("10.4") &&
          warning.includes("typed raw adapter"),
      ),
    );
  }
});

test("warns about the 24 hour update retention and update_id", () => {
  for (const stack of listStacks()) {
    assert.ok(
      resolveStack(stack).warnings.some(
        (warning) => warning.includes("24 hours") && warning.includes("update_id"),
      ),
    );
  }
});

test("warns that exactly one consumer may run", () => {
  for (const stack of listStacks()) {
    assert.ok(
      resolveStack(stack).warnings.some(
        (warning) =>
          warning.includes("mutually exclusive") && warning.includes("exactly one consumer"),
      ),
    );
  }
});

test("listStacks returns both stacks", () => {
  assert.deepEqual(listStacks(), ["grammy", "aiogram"]);
});

test("featureLabel returns a distinct nonempty label per feature", () => {
  const labels = BOT_FEATURES.map((feature) => featureLabel(feature));
  assert.equal(new Set(labels).size, BOT_FEATURES.length);
  for (const label of labels) assert.ok(label.length > 0);
  assert.equal(featureLabel("llm"), "LLM chat");
});
