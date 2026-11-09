import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Context } from "@deepseek-ai/cordis";
import { ToolsService, type ToolRunContext } from "@deepseek-ai/dsh-tools";

import * as plugin from "../../src/adapters/dsh/index.ts";
import type { DomainResult } from "../../src/core/results.ts";

const EXPECTED_TOOLS = [
  "telegram_bot_target_resolve",
  "telegram_bot_scaffold",
  "telegram_bot_inspect",
  "telegram_bot_verify",
  "telegram_bot_add_feature",
  "telegram_bot_deploy_plan",
  "telegram_bot_test_harness",
  "telegram_bot_upgrade",
  "telegram_bot_upgrade_plan",
] as const;

function execution(): ToolRunContext {
  const controller = new AbortController();
  return { signal: controller.signal } as unknown as ToolRunContext;
}

async function mount(root: string) {
  const ctx = new Context();
  const sections: Array<{
    name: string;
    order: number;
    text: string;
    interpolate?: boolean;
  }> = [];
  const prompt = {
    section: (section: (typeof sections)[number]) => {
      sections.push(section);
      return () => {};
    },
    tools: () => () => {},
  };
  ctx.provide("systemPrompt", prompt as never);
  const tools = new ToolsService(ctx);
  const fiber = await ctx.plugin(plugin, { root });
  return { ctx, fiber, tools, sections };
}

test("module exports no default and the expected plugin surface", () => {
  assert.equal("default" in plugin, false);
  assert.equal(plugin.name, "aurifex");
  assert.deepEqual([...plugin.inject], ["tools", "systemPrompt"]);
  assert.equal(typeof plugin.apply, "function");
  assert.equal(typeof plugin.Config, "function");
});

test("apply registers eight tools, guidance, and disposes cleanly", async () => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-dsh-"));
  const { fiber, tools, sections } = await mount(root);
  try {
    assert.deepEqual(
      tools
        .definitions()
        .map((definition) => definition.name)
        .toSorted(),
      [...EXPECTED_TOOLS].toSorted(),
    );
    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.name, "aurifex");
    assert.equal(sections[0]?.order, 120);
    assert.equal(sections[0]?.interpolate, false);
    assert.equal(sections[0]?.text.split(". ").length, 4);
  } finally {
    await fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }

  assert.deepEqual(tools.definitions(), []);
});

test("telegram_bot_target_resolve executes through the operation facade", async () => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-dsh-"));
  const { fiber, tools } = await mount(root);
  try {
    const definition = tools
      .definitions()
      .find((candidate) => candidate.name === "telegram_bot_target_resolve");
    assert.ok(definition);
    const result = (await definition.execute({ stack: "grammy" }, execution())) as DomainResult<{
      target: { frameworkVersion: string };
    }>;
    assert.equal(result.status, "ok");
    assert.equal(result.status === "ok" && result.value.target.frameworkVersion, "1.46.0");
  } finally {
    await fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
