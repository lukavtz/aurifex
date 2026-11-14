import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { REPO } from "../fixtures/reference-project.ts";

const SCRIPT = join(REPO, "scripts/check-skills.mjs");

function run(root?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    code: number;
    stdout: string;
    stderr: string;
  }>();
  const child = spawn(process.execPath, root === undefined ? [SCRIPT] : [SCRIPT, "--root", root], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.on("error", reject);
  child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  return promise;
}

const VALID = [
  "---",
  "name: demo",
  "description: Use when testing the checker. Русские триггеры: демо.",
  "---",
  "",
  "# Demo",
  "",
  "## Procedure",
  "",
  "1. Do the thing.",
  "",
  "## Gotchas",
  "",
  "- A trap.",
  "",
  "## Sources",
  "",
  "- https://core.telegram.org/bots/api",
  "- https://grammy.dev/guide/",
  "- https://docs.aiogram.dev/en/latest/",
  "",
].join("\n");

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aurifex-check-skills-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

test("the repository passes the skills contract", async () => {
  const result = await run();
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^check-skills: ok · 15 skills$/m);
});

test("a missing section fails", async () => {
  const root = await fixture({
    "skills/demo/SKILL.md": VALID.replace("## Gotchas", "## Traps"),
  });
  const result = await run(root);
  await rm(root, { recursive: true, force: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /demo: missing "## Gotchas" section/);
});

test("fewer than three source URLs fail", async () => {
  const root = await fixture({
    "skills/demo/SKILL.md": VALID.replace("- https://docs.aiogram.dev/en/latest/\n", ""),
  });
  const result = await run(root);
  await rm(root, { recursive: true, force: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /demo: "## Sources" lists 2 absolute https URL\(s\)/);
});

test("a mismatch between directory and frontmatter name fails", async () => {
  const root = await fixture({
    "skills/demo/SKILL.md": VALID.replace("name: demo", "name: other"),
  });
  const result = await run(root);
  await rm(root, { recursive: true, force: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /demo: frontmatter name must be "demo"/);
});

test("a dangling relative link fails", async () => {
  const root = await fixture({
    "skills/demo/SKILL.md": VALID.replace(
      "1. Do the thing.",
      "1. See [reference](references/x.md).",
    ),
  });
  const result = await run(root);
  await rm(root, { recursive: true, force: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /demo: link target does not exist: references\/x\.md/);
});

test("a removed tool name fails", async () => {
  const root = await fixture({
    "skills/demo/SKILL.md": VALID.replace("1. Do the thing.", "1. Call telegram_bot_deploy_plan."),
  });
  const result = await run(root);
  await rm(root, { recursive: true, force: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /demo: mentions removed tool telegram_bot_deploy_plan/);
});

test("a token-shaped literal fails", async () => {
  const token = ["1234567890", "Ab3".repeat(12)].join(":");
  const root = await fixture({
    "skills/demo/SKILL.md": VALID.replace("1. Do the thing.", `1. Use ${token}.`),
  });
  const result = await run(root);
  await rm(root, { recursive: true, force: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /demo: contains a token-like literal/);
});

test("a body over 500 lines fails", async () => {
  const filler = Array.from({ length: 520 }, (_, index) => `- line ${index + 1}`).join("\n");
  const root = await fixture({
    "skills/demo/SKILL.md": VALID.replace("- A trap.", `- A trap.\n${filler}`),
  });
  const result = await run(root);
  await rm(root, { recursive: true, force: true });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /demo: body is \d+ lines \(max 500\)/);
});
