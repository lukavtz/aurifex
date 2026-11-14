import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { LAYOUT, layoutPaths } from "../../src/core/layout.ts";
import { REPO } from "../fixtures/reference-project.ts";

const RECIPES = join(REPO, "skills/telegram-bot-recipes/references/project-layout.md");

function backtickedPaths(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(/`([A-Za-z0-9_./-]+)`/g)) {
    const candidate = match[1]!;
    const looksLikePath = candidate.includes("/") || /\.(lock|sql|py|ts)$/.test(candidate);
    if (looksLikePath && !candidate.startsWith(".")) found.add(candidate);
  }
  return [...found].toSorted();
}

test("the layout contract declares both stacks with every path", () => {
  assert.deepEqual(Object.keys(LAYOUT).toSorted(), ["aiogram", "grammy"]);
  assert.equal(layoutPaths().length, 35);
  assert.deepEqual(layoutPaths(), [...new Set(layoutPaths())]);
  assert.deepEqual(Object.keys(LAYOUT.grammy).toSorted(), Object.keys(LAYOUT.aiogram).toSorted());
  for (const layout of Object.values(LAYOUT)) {
    for (const value of Object.values(layout)) assert.ok(value.length > 0);
  }
});

test("the recipes reference documents exactly the layout paths", async () => {
  const markdown = await readFile(RECIPES, "utf8");
  assert.deepEqual(backtickedPaths(markdown), layoutPaths());
});
