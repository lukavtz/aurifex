#!/usr/bin/env node
// Scans repository text files for Telegram bot token literals.
// No dependencies: plain Node ESM, deterministic, read-only.
import { open, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "raw",
  "dist",
  "coverage",
  ".venv",
  "__pycache__",
  "tests/fixtures",
]);

const SKIP_DIR_NAMES = new Set(SKIP_DIRS);
const SKIP_PATHS = [...SKIP_DIRS].filter((entry) => entry.includes("/"));

// Same shape as src/core/security/secrets.ts:TELEGRAM_TOKEN_RE.
const TOKEN_RE = /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g;
const PLACEHOLDER_RE =
  /^(?:x+|your[_-]?.*|token|example|placeholder|dummy|redacted|change[_-]?me)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

function redact(token) {
  const [id = "", body = ""] = token.split(":");
  return `${id}:${body.slice(0, 4)}…`;
}

function isPlaceholder(token) {
  const body = token.slice(token.indexOf(":") + 1);
  return PLACEHOLDER_RE.test(body.replace(/[_-]+/g, "_"));
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    const rel = relative(ROOT, absolute).split("\\").join("/");
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (SKIP_PATHS.some((skip) => rel === skip || rel.startsWith(`${skip}/`))) continue;
      yield* walk(absolute);
      continue;
    }
    if (!entry.isFile()) continue;
    yield { absolute, rel };
  }
}

async function readTextFile(absolute) {
  const handle = await open(absolute, "r");
  try {
    const info = await handle.stat();
    if (info.size > MAX_BYTES) return null;
    const buffer = await handle.readFile();
    if (buffer.subarray(0, 8192).includes(0)) return null;
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

const findings = [];
for await (const file of walk(ROOT)) {
  const text = await readTextFile(file.absolute);
  if (text === null) continue;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = TOKEN_RE.exec(line)) !== null) {
      if (isPlaceholder(match[0])) continue;
      findings.push({ path: file.rel, line: index + 1, redacted: redact(match[0]) });
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.path}:${finding.line}: telegram token literal ${finding.redacted}`);
  }
  console.error(`check-no-secrets: ${findings.length} finding(s)`);
  process.exit(1);
}

console.error("check-no-secrets: clean");
