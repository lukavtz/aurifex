import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const skillNames = [
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

test("every skill has name, Use when description, Sources, and body < 8192 bytes", async () => {
  for (const name of skillNames) {
    const file = `skills/${name}/SKILL.md`;
    const text = await readContent(file);
    const fields = parseFrontmatter(text, file);

    assert.equal(fields.name, name, `${file}: name must match directory`);
    assert.ok(
      fields.description?.startsWith("Use when"),
      `${file}: description must start with "Use when"`,
    );
    assert.ok(text.includes("\n## Sources\n"), `${file}: missing Sources section`);

    const bodyEnd = text.indexOf("\n---\n", 4);
    const bytes = Buffer.byteLength(text.slice(bodyEnd + 5), "utf8");
    assert.ok(bytes < 8192, `${file}: body is ${bytes} bytes, must be below 8192`);
  }
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
  for (const file of commandFiles) {
    const relativePath = `commands/${file}`;
    const fields = parseFrontmatter(await readContent(relativePath), relativePath);
    assert.ok(fields.description, `${relativePath}: missing description`);
    assert.ok(fields["argument-hint"], `${relativePath}: missing argument-hint`);
    assert.ok(fields["allowed-tools"], `${relativePath}: missing allowed-tools`);
    assert.match(
      fields["allowed-tools"],
      /telegram_bot_[a-z_]+/,
      `${relativePath}: allowed-tools must name a telegram_bot_* tool`,
    );
  }
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
