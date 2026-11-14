import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  API104_METHODS,
  API104_PARAMS,
  API104_TYPES,
} from "../../src/core/targets/api104-contract.ts";
import { LAYOUT } from "../../src/core/layout.ts";
import { copyReference, listFiles, REPO } from "../fixtures/reference-project.ts";

test("the contract lists every 10.4 method and type exactly once", () => {
  assert.equal(new Set(API104_METHODS).size, API104_METHODS.length);
  assert.equal(new Set(API104_TYPES).size, API104_TYPES.length);
  for (const method of ["sendWidget", "answerWidgetQuery", "sendRichMessage", "getUniqueGift"]) {
    assert.ok(API104_METHODS.includes(method as never), `missing method ${method}`);
  }
  for (const type of ["Widget", "RichTextTonAddress", "ChatShareThemeBackdrops"]) {
    assert.ok(API104_TYPES.includes(type as never), `missing type ${type}`);
  }
});

test("API104_PARAMS pins the payload fields the changelog adds", () => {
  assert.deepEqual(API104_PARAMS.getUniqueGift, ["name"]);
  assert.deepEqual(API104_PARAMS.getChatShareThemeBackdrops, []);
  assert.deepEqual(API104_PARAMS.deleteBusinessAccountGift, [
    "business_connection_id",
    "owned_gift_id",
  ]);
  for (const method of Object.keys(API104_PARAMS)) {
    assert.ok(API104_METHODS.includes(method as never), `${method} is not a 10.4 method`);
  }
});

test("the contract carries no renderers and no generator imports", async () => {
  const source = await readFile(join(REPO, "src/core/targets/api104-contract.ts"), "utf8");
  assert.equal(source.includes("renderApi104TypesTs"), false);
  assert.equal(source.includes("renderApi104TypesPy"), false);
  assert.equal(source.includes("projects/templates"), false);
});

test("both reference adapters implement the contract", async () => {
  for (const stack of ["grammy", "aiogram"] as const) {
    const reference = await copyReference(stack);
    try {
      const adapter = await readFile(join(reference.root, LAYOUT[stack].api104), "utf8");
      for (const method of ["sendWidget", "answerWidgetQuery", "sendRichMessage"]) {
        const symbol =
          stack === "aiogram" ? `${method[0]!.toUpperCase()}${method.slice(1)}` : method;
        assert.ok(adapter.includes(symbol), `${stack} adapter is missing ${symbol}`);
      }
    } finally {
      await reference.cleanup();
    }
  }
});

test("the 10.4 skill links the machine-readable contract", async () => {
  const skill = await readFile(join(REPO, "skills/telegram-bot-api-104/SKILL.md"), "utf8");
  assert.ok(skill.includes("src/core/targets/api104-contract.ts"));
  for (const method of Object.keys(API104_PARAMS)) {
    assert.ok(skill.includes(method), `skill does not mention ${method}`);
  }
});

test("no source file outside the contract repeats a layout path literal", async () => {
  const layoutPaths = Object.values(LAYOUT).flatMap((layout) => Object.values(layout));
  const sources = (await listFiles(join(REPO, "src"))).filter((path) => path.endsWith(".ts"));
  const offenders: string[] = [];
  for (const path of sources) {
    if (path === "core/layout.ts") continue;
    const text = await readFile(join(REPO, "src", path), "utf8");
    for (const literal of layoutPaths) {
      if (literal.endsWith("/") || literal.endsWith(".lock")) continue;
      if (text.includes(`"${literal}"`)) offenders.push(`${path}: ${literal}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the templates directory is gone", async () => {
  const entries = await readdir(join(REPO, "src/core/projects"));
  assert.deepEqual(entries.toSorted(), ["inspect.ts", "verify.ts"]);
});
