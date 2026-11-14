#!/usr/bin/env node
// Validates every skills/<name>/SKILL.md against the knowledge contract.
// Deterministic, no dependencies: run by tests and by `pnpm check:skills`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LINES = 500;
const MIN_SOURCES = 3;
const MAX_DESCRIPTION = 1024;
const REQUIRED_SECTIONS = ["Procedure", "Gotchas", "Sources"];
const REMOVED_TOOLS = [
  "telegram_bot_scaffold",
  "telegram_bot_add_feature",
  "telegram_bot_deploy_plan",
  "telegram_bot_test_harness",
  "telegram_bot_upgrade",
  "telegram_bot_upgrade_plan",
];
const TOKEN_LIKE = /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function frontmatter(lines) {
  if (lines[0] !== "---") return { fields: {}, body: lines, bodyStart: 0 };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { fields: {}, body: lines, bodyStart: 0 };
  return {
    fields: parseFields(lines.slice(1, end)),
    body: lines.slice(end + 1),
    bodyStart: end + 1,
  };
}

function parseFields(block) {
  const fields = {};
  for (const line of block) {
    const match = /^([a-zA-Z_][\w-]*):\s*(.*)$/.exec(line);
    if (match !== null) fields[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return fields;
}

function sectionText(body, heading) {
  const start = body.findIndex((line) => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(line));
  if (start === -1) return undefined;
  let end = body.length;
  for (let index = start + 1; index < body.length; index += 1) {
    if (/^##\s+/.test(body[index])) {
      end = index;
      break;
    }
  }
  return body.slice(start + 1, end).join("\n");
}

function checkSkill(name, skillsDir) {
  const file = join(skillsDir, name, "SKILL.md");
  const problems = [];
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [`cannot read ${file}`];
  }
  const lines = text.split("\n");
  const { fields, body } = frontmatter(lines);

  if (fields.name !== name) {
    problems.push(`frontmatter name must be "${name}" (found "${fields.name ?? ""}")`);
  }
  const description = fields.description ?? "";
  if (description === "") problems.push("frontmatter description is missing");
  else if (description.length > MAX_DESCRIPTION) {
    problems.push(`description is ${description.length} characters (max ${MAX_DESCRIPTION})`);
  }

  const bodyLines = body.filter((line, index) => !(index === 0 && line === "")).length;
  if (bodyLines > MAX_LINES) problems.push(`body is ${bodyLines} lines (max ${MAX_LINES})`);

  for (const heading of REQUIRED_SECTIONS) {
    if (sectionText(body, heading) === undefined) problems.push(`missing "## ${heading}" section`);
  }

  const sources = sectionText(body, "Sources") ?? "";
  const urls = new Set(
    (sources.match(/https:\/\/[^\s)"'<>]+/g) ?? []).map((url) => url.replace(/[.,;]+$/, "")),
  );
  if (urls.size < MIN_SOURCES) {
    problems.push(`"## Sources" lists ${urls.size} absolute https URL(s) (min ${MIN_SOURCES})`);
  }

  const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const relative = target.split("#")[0];
    if (relative === "") continue;
    const resolved = resolve(dirname(file), relative);
    try {
      statSync(resolved);
    } catch {
      problems.push(`link target does not exist: ${target}`);
    }
  }

  const token = TOKEN_LIKE.exec(text);
  if (token !== null) problems.push("contains a token-like literal");

  for (const tool of REMOVED_TOOLS) {
    if (text.includes(tool)) problems.push(`mentions removed tool ${tool}`);
  }

  return problems;
}

function main() {
  const skillsDir = join(argValue("--root") ?? ROOT, "skills");
  let names;
  try {
    names = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
  } catch (error) {
    console.error(`check-skills: cannot read ${skillsDir}: ${error.message}`);
    process.exit(1);
  }
  if (names.length === 0) {
    console.error(`check-skills: no skills found in ${skillsDir}`);
    process.exit(1);
  }

  const offenders = [];
  for (const name of names) {
    for (const problem of checkSkill(name, skillsDir)) offenders.push(`${name}: ${problem}`);
  }
  if (offenders.length > 0) {
    console.error("check-skills: failed");
    for (const offender of offenders) console.error(`  - ${offender}`);
    process.exit(1);
  }
  console.log(`check-skills: ok · ${names.length} skills`);
}

main();
