import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const skillNames = [
  "telegram-bot",
  "telegram-bot-discovery",
  "telegram-bot-sources",
  "telegram-bot-stack-choice",
  "telegram-bot-recipes",
  "telegram-bot-failures",
  "telegram-bot-api",
  "telegram-bot-api-104",
  "grammy",
  "aiogram",
  "telegram-security",
  "telegram-testing",
  "telegram-deploy",
  "telegram-payments",
  "telegram-mini-apps",
] as const;

const commandFiles = ["aurifex-new.md", "aurifex-verify.md", "aurifex-deploy.md"] as const;

const agentFiles = ["bot-architect.md", "bot-security-reviewer.md", "bot-test-writer.md"] as const;

const otherContent = [
  "rules/telegram-security.md",
  "prompts/review-bot.md",
  "THIRD_PARTY_NOTICES.md",
] as const;

function parseFrontmatter(text: string, file: string): Record<string, string> {
  assert.ok(text.startsWith("---\n"), `${file}: missing opening frontmatter`);
  const end = text.indexOf("\n---\n", 4);
  assert.ok(end > 0, `${file}: missing closing frontmatter`);

  const fields: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    assert.ok(colon > 0, `${file}: invalid frontmatter line ${JSON.stringify(line)}`);
    const key = line.slice(0, colon).trim();
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
    fields[key] = value;
  }
  return fields;
}

async function readContent(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

async function walkMarkdown(relativeDir: string): Promise<string[]> {
  const entries = await readdir(path.join(repoRoot, relativeDir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdown(relativePath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relativePath);
    }
  }
  return files.toSorted();
}

// Construct the token pattern at runtime so this test does not match itself.
const tokenPattern = ["\\b", "\\d", "{6,}", ":", "[A-Za-z0-9_-]", "{30,}", "\\b"].join("");

test("the skill set is exactly the fifteen knowledge skills", async () => {
  const entries = await readdir(path.join(repoRoot, "skills"), { withFileTypes: true });
  const actual = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  assert.deepEqual(actual, [...skillNames].toSorted());
});

test("Bot API 10.4 skill covers the required first-class surfaces", async () => {
  const text = await readContent("skills/telegram-bot-api-104/SKILL.md");
  for (const term of [
    "sendWidget",
    "sendSharedWidget",
    "widget_query",
    "answerWidgetQuery",
    "editMessageWidgetData",
    "editSharedWidgetData",
    "15 seconds",
    "32768",
    "4096",
    "private chats",
    "ephemeral_message_parameters",
    "quote_rich_texts",
    "ton_wallet_transfer",
    "share_theme",
    "getUniqueGift",
    "bot.api.raw",
    "TelegramMethod",
  ]) {
    assert.ok(text.includes(term), `skills/telegram-bot-api-104/SKILL.md: missing ${term}`);
  }
});

test("discovery asks the material questions and gates the build", async () => {
  const skillFile = "skills/telegram-bot-discovery/SKILL.md";
  const text = await readContent(skillFile);

  for (const topic of ["Goal and audience", "Stack", "Features", "Locales", "Deployment"]) {
    assert.ok(text.includes(`**${topic}**`), `${skillFile}: missing question ${topic}`);
  }

  for (const gate of [
    "assuming:",
    "confirmation",
    "telegram-bot-recipes",
    "Never ask for a token",
  ]) {
    assert.ok(text.includes(gate), `${skillFile}: missing discovery gate text ${gate}`);
  }

  assert.equal(
    text.includes("telegram_bot_scaffold"),
    false,
    `${skillFile}: mentions removed tool`,
  );
  const secretQuestion = /^\d+\.\s+\*\*.*(?:token|secret|api key|password)/im.exec(text);
  assert.equal(secretQuestion, null, `${skillFile}: questions must never request credentials`);
});

test("agents have name and description frontmatter", async () => {
  for (const file of agentFiles) {
    const relativePath = `agents/${file}`;
    const fields = parseFrontmatter(await readContent(relativePath), relativePath);
    assert.ok(fields.name, `${relativePath}: missing name`);
    assert.equal(fields.name, file.replace(/\.md$/, ""), `${relativePath}: name mismatch`);
    assert.ok(fields.description?.startsWith("Use when"), `${relativePath}: weak description`);
  }
});

test("commands declare description, argument-hint, and telegram tool allowlist", async () => {
  const plugin = JSON.parse(await readContent(".claude-plugin/plugin.json")) as { name: string };
  const servers = JSON.parse(await readContent(".mcp.json")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(servers), ["aurifex"]);
  const namespace = `mcp__plugin_${plugin.name}_${Object.keys(servers)[0]}__`;
  const toolNames = ["telegram_bot_target_resolve", "telegram_bot_inspect", "telegram_bot_verify"];
  for (const file of commandFiles) {
    const relativePath = `commands/${file}`;
    const fields = parseFrontmatter(await readContent(relativePath), relativePath);
    assert.ok(fields.description, `${relativePath}: missing description`);
    assert.ok(fields["argument-hint"], `${relativePath}: missing argument-hint`);
    assert.ok(fields["allowed-tools"] !== undefined, `${relativePath}: missing allowed-tools`);
    for (const tool of fields["allowed-tools"].split(/,\s*/).filter((name) => name !== "")) {
      assert.ok(tool.startsWith(namespace), `${relativePath}: missing ${namespace} prefix`);
      assert.ok(
        toolNames.includes(tool.slice(namespace.length)),
        `${relativePath}: unknown tool ${tool}`,
      );
    }
  }
});

test("aurifex-new runs the discovery gate before writing code", async () => {
  const file = "commands/aurifex-new.md";
  const text = await readContent(file);
  const fields = parseFrontmatter(text, file);

  assert.match(fields.description ?? "", /discovery/i, `${file}: description must name discovery`);
  for (const reference of [
    "skills/telegram-bot-discovery",
    "skills/telegram-bot-recipes",
    "telegram_bot_target_resolve",
    "telegram_bot_verify",
  ]) {
    assert.ok(text.includes(reference), `${file}: must reference ${reference}`);
  }
  for (const gate of ["assuming:", "Do not write code until", "nobody asked for"]) {
    assert.ok(text.includes(gate), `${file}: missing ${gate}`);
  }
  assert.match(text, /never infer|never ask for a real token/i, `${file}: missing the hard gate`);
  assert.equal(text.includes("telegram_bot_scaffold"), false, `${file}: mentions removed tool`);
});

test("rules, prompt, and third-party notices exist and are non-empty", async () => {
  for (const file of otherContent) {
    const text = await readContent(file);
    assert.ok(text.trim().length > 100, `${file}: content is too small`);
  }

  const notices = await readContent("THIRD_PARTY_NOTICES.md");
  for (const term of [
    "github.com/nzhulikov/telegram-bot-skills",
    "github.com/nyxandro/telegram-bot-development-skill",
    "github.com/serejaris/telegram-skills",
    "github.com/grammyjs/grammY",
    "github.com/aiogram/aiogram",
    "Apache License 2.0",
    "MIT",
  ]) {
    assert.ok(notices.includes(term), `THIRD_PARTY_NOTICES.md: missing ${term}`);
  }
});

test("no content file contains a token-shaped literal", async () => {
  const files = [
    ...(await walkMarkdown("skills")),
    ...(await walkMarkdown("agents")),
    ...(await walkMarkdown("commands")),
    ...(await walkMarkdown("rules")),
    ...(await walkMarkdown("prompts")),
    "THIRD_PARTY_NOTICES.md",
  ];

  const re = new RegExp(tokenPattern, "g");
  for (const file of files) {
    const text = await readContent(file);
    re.lastIndex = 0;
    const match = re.exec(text);
    assert.equal(
      match,
      null,
      `${file}: token-shaped literal at offset ${match?.index ?? -1}; redact it`,
    );
  }
});
