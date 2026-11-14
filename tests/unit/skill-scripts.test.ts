import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { REPO } from "../fixtures/reference-project.ts";

const TEXT = join(REPO, "skills/telegram-bot-api/scripts/tg_text.py");
const PAYLOAD = join(REPO, "skills/telegram-bot-api/scripts/telegram_payload.py");
const DOCS = join(REPO, "skills/telegram-bot-sources/scripts/tg_docs.py");

function python(): string {
  return process.env.PYTHON ?? "python3";
}

function run(
  script: string,
  args: readonly string[],
  stdin?: string,
  extraEnv?: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    code: number;
    stdout: string;
    stderr: string;
  }>();
  const child = spawn(python(), [script, ...args], {
    cwd: REPO,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1", ...extraEnv },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.on("error", reject);
  child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  child.stdin.end(stdin ?? "");
  return promise;
}

test("tg_text escapes HTML and measures UTF-16 length", async () => {
  const escaped = await run(TEXT, ["escape-html"], "a&b <c>");
  assert.equal(escaped.code, 0, escaped.stderr);
  assert.equal(escaped.stdout.trim(), "a&amp;b &lt;c&gt;");

  const emoji = await run(TEXT, ["length"], "🙂");
  assert.equal(emoji.code, 0, emoji.stderr);
  const measured = JSON.parse(emoji.stdout) as { code_points: number; utf16_units: number };
  assert.equal(measured.code_points, 1);
  assert.equal(measured.utf16_units, 2);
});

test("tg_text splits long text while keeping markup balanced", async () => {
  const input = `<b>${"word ".repeat(1200)}</b>`;
  const split = await run(TEXT, ["split", "--html", "--limit", "1000", "--json"], input);
  assert.equal(split.code, 0, split.stderr);
  const chunks = JSON.parse(split.stdout) as string[];
  assert.ok(chunks.length > 1, "long input must split");
  for (const chunk of chunks) {
    assert.ok([...chunk].length <= 1000 + 16, `chunk too long: ${chunk.length}`);
    assert.equal((chunk.match(/<b>/g) ?? []).length, (chunk.match(/<\/b>/g) ?? []).length);
  }
});

test("tg_text neutralizes HTML in model output", async () => {
  const neutralized = await run(TEXT, ["neutralize-markdown-html"], "**bold** <b>tag</b>");
  assert.equal(neutralized.code, 0, neutralized.stderr);
  assert.equal(neutralized.stdout.includes("<b>"), false);
  assert.ok(neutralized.stdout.includes("&lt;b&gt;"));
});

async function validatePayload(method: string, body: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "aurifex-payload-"));
  try {
    const file = join(dir, "request.json");
    await writeFile(file, JSON.stringify(body));
    const result = await run(PAYLOAD, ["--method", method, "--file", file, "--json"]);
    return {
      ...result,
      findings: JSON.parse(result.stdout) as { severity: string; code: string }[],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("telegram_payload accepts a valid sendMessage request", async () => {
  const result = await validatePayload("sendMessage", { chat_id: 1, text: "hello" });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.findings, []);
});

test("telegram_payload rejects a 4097-character message", async () => {
  const result = await validatePayload("sendMessage", { chat_id: 1, text: "x".repeat(4097) });
  assert.notEqual(result.code, 0);
  assert.ok(result.findings.some((finding) => finding.severity === "error"));
});

test("telegram_payload rejects an unknown field", async () => {
  const result = await validatePayload("sendMessage", { chat_id: 1, text: "hi", nope: true });
  assert.notEqual(result.code, 0);
  assert.ok(result.findings.some((finding) => finding.code === "unknown_field"));
});

test("tg_docs changelog works offline from a cache directory", async () => {
  const cache = await mkdtemp(join(tmpdir(), "aurifex-tg-docs-"));
  try {
    // tg_docs caches a page as its site path with slashes replaced by "__", extension kept.
    const page = join(cache, "bots__api-changelog.md");
    const fixture = [
      "# Bot API changelog",
      "",
      "### 2026",
      "",
      "#### November 9, 2026",
      "",
      "## Bot API 10.4",
      "",
      "- 2026-11-09: cached-page-only marker.",
      "",
    ].join("\n");
    await writeFile(page, fixture);
    const result = await run(
      DOCS,
      ["changelog", "--entries", "1", "--cache-dir", cache, "--json"],
      undefined,
      {
        HTTPS_PROXY: "http://127.0.0.1:9",
        HTTP_PROXY: "http://127.0.0.1:9",
        NO_PROXY: "",
        no_proxy: "",
      },
    );
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as { url: string; content: string };
    assert.match(payload.content, /## Bot API 10\.4/);
    assert.match(payload.content, /2026-11-09/);
    assert.match(payload.content, /cached-page-only marker/, "the cached page must be the source");
    assert.equal(await readFile(page, "utf8"), fixture, "a fetch must not overwrite the cache");
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});
