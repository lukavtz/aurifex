import type { BotFeature, BotSpec } from "../../spec/bot-spec.ts";
import { slugToTitle } from "../../spec/bot-spec.ts";
import { renderMiniApp } from "../templates/miniapp.ts";
import type { TemplateFile } from "../templates/shared.ts";

function file(path: string, content: string): TemplateFile {
  return { path, content };
}

function commandModule(name: string): string {
  return `import type { Bot } from "grammy";

export const COMMAND = ${JSON.stringify(`/${name}`)};

export function register(bot: Bot): void {
  bot.command(${JSON.stringify(name)}, async (ctx) => {
    await ctx.reply(${JSON.stringify(`${slugToTitle(name)} is not implemented yet.`)});
  });
}
`;
}

function commandTest(name: string): string {
  return `import assert from "node:assert/strict";
import { test } from "node:test";

import { register } from "../src/features/${name}.ts";

interface FakeContext {
  reply(text: string): Promise<void>;
}

type RegisterTarget = Parameters<typeof register>[0];

test(${JSON.stringify(`/${name} replies`)} , async () => {
  const handlers = new Map<string, (ctx: FakeContext) => Promise<void>>();
  const fake = {
    command(command: string, handler: (ctx: FakeContext) => Promise<void>): void {
      handlers.set(command, handler);
    },
  };
  register(fake as unknown as RegisterTarget);
  const handler = handlers.get(${JSON.stringify(name)});
  assert.ok(handler);
  const replies: string[] = [];
  await handler({
    reply: async (text: string) => {
      replies.push(text);
    },
  });
  assert.equal(replies.length, 1);
});
`;
}

const LLM_MODULE = `import type { Bot } from "grammy";

const TIMEOUT_MS = 8_000;
const MAX_TOKENS = 800;
const ERROR_TEXT = "The assistant is unavailable right now. Please try again later.";

interface LlmConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

function readConfig(): LlmConfig | null {
  const baseUrl = (process.env.LLM_BASE_URL ?? "").replace(/\\/+$/, "");
  const model = process.env.LLM_MODEL ?? "";
  const apiKey = process.env.LLM_API_KEY ?? "";
  if (baseUrl === "" || model === "" || apiKey === "") return null;
  return { baseUrl, model, apiKey };
}

function readContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first.message?.content;
  return typeof content === "string" && content.trim() !== "" ? content.trim() : null;
}

export async function ask(prompt: string): Promise<string> {
  const config = readConfig();
  if (config === null) return ERROR_TEXT;
  try {
    const response = await fetch(config.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return ERROR_TEXT;
    return readContent(await response.json()) ?? ERROR_TEXT;
  } catch {
    return ERROR_TEXT;
  }
}

export function register(bot: Bot): void {
  bot.command("llm", async (ctx) => {
    const prompt = ctx.match.trim();
    if (prompt === "") {
      await ctx.reply("Usage: /llm <prompt>");
      return;
    }
    await ctx.reply(await ask(prompt));
  });
}
`;

const LLM_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";

import { ask } from "../src/features/llm.ts";

const ERROR_TEXT = "The assistant is unavailable right now. Please try again later.";

test("llm returns a static error without configuration", async () => {
  const saved = {
    base: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
    key: process.env.LLM_API_KEY,
  };
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_API_KEY;
  try {
    assert.equal(await ask("hello"), ERROR_TEXT);
  } finally {
    if (saved.base !== undefined) process.env.LLM_BASE_URL = saved.base;
    if (saved.model !== undefined) process.env.LLM_MODEL = saved.model;
    if (saved.key !== undefined) process.env.LLM_API_KEY = saved.key;
  }
});
`;

const INLINE_MODULE = `import type { Bot } from "grammy";

export function register(bot: Bot): void {
  bot.on("inline_query", async (ctx) => {
    const text = ctx.inlineQuery.query.trim() === "" ? "Hello" : ctx.inlineQuery.query.trim();
    await ctx.answerInlineQuery(
      [
        {
          type: "article",
          id: "share",
          title: "Send this text",
          description: text,
          input_message_content: { message_text: text },
        },
      ],
      { cache_time: 0 },
    );
  });
}
`;

const INLINE_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";

import { register } from "../src/features/inline.ts";

interface FakeInlineQuery {
  readonly query: string;
}

interface FakeContext {
  readonly inlineQuery: FakeInlineQuery;
  answerInlineQuery(results: readonly { readonly type: string }[], other?: { cache_time?: number }): Promise<void>;
}

type RegisterTarget = Parameters<typeof register>[0];

test("inline query answers with one article", async () => {
  const handlers: ((ctx: FakeContext) => Promise<void>)[] = [];
  const fake = { on: (_event: string, handler: (ctx: FakeContext) => Promise<void>) => handlers.push(handler) };
  register(fake as unknown as RegisterTarget);
  const handler = handlers[0];
  assert.ok(handler);
  const answers: (readonly { readonly type: string }[])[] = [];
  await handler({
    inlineQuery: { query: "hello" },
    answerInlineQuery: async (results) => {
      answers.push(results);
    },
  });
  assert.equal(answers.length, 1);
  assert.equal(answers[0]?.length, 1);
});
`;

const PAYMENTS_MODULE = `import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Bot } from "grammy";

const PRICE_STARS = 1;
const TITLE = "Support the bot";

export function storePath(): string {
  return process.env.PAYMENTS_PATH ?? join("data", "payments.jsonl");
}

export async function recordPayment(payment: {
  readonly chargeId: string;
  readonly totalAmount: number;
  readonly userId: number;
}): Promise<void> {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  const line = JSON.stringify({ ...payment, recordedAt: new Date().toISOString() });
  await appendFile(path, line + "\\n", { encoding: "utf8", mode: 0o600 });
}

export function register(bot: Bot): void {
  bot.command("buy", async (ctx) => {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (chatId === undefined || userId === undefined) return;
    await bot.api.sendInvoice(chatId, TITLE, "One star", "stars:" + userId, "XTR", [
      { label: TITLE, amount: PRICE_STARS },
    ]);
  });

  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    const userId = ctx.from?.id;
    if (payment === undefined || userId === undefined) return;
    await recordPayment({
      chargeId: payment.telegram_payment_charge_id,
      totalAmount: payment.total_amount,
      userId,
    });
    await ctx.reply("Payment received. Thank you!");
  });
}
`;

const PAYMENTS_TEST = `import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { recordPayment } from "../src/features/payments.ts";

test("recordPayment appends one line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "payments-"));
  const path = join(directory, "payments.jsonl");
  const saved = process.env.PAYMENTS_PATH;
  process.env.PAYMENTS_PATH = path;
  try {
    await recordPayment({ chargeId: "charge", totalAmount: 1, userId: 7 });
    const content = await readFile(path, "utf8");
    assert.equal(content.trim().split("\\n").length, 1);
    assert.match(content, /"userId":7/);
  } finally {
    if (saved === undefined) delete process.env.PAYMENTS_PATH;
    else process.env.PAYMENTS_PATH = saved;
  }
});
`;

const MODERATION_MODULE = `import type { Bot } from "grammy";

const DEFAULT_BLOCKED = ["casino", "crypto giveaway"] as const;

export function blockedWords(): readonly string[] {
  const raw = process.env.MODERATION_BLOCKED_WORDS ?? "";
  const words = raw
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word !== "");
  return words.length === 0 ? DEFAULT_BLOCKED : words;
}

export function isBlocked(text: string): boolean {
  const lowered = text.toLowerCase();
  if (lowered.includes("http://") || lowered.includes("https://")) return true;
  return blockedWords().some((word) => lowered.includes(word));
}

export function register(bot: Bot): void {
  bot.on("message:text", async (ctx, next) => {
    if (!isBlocked(ctx.message.text)) {
      await next();
      return;
    }
    try {
      await ctx.deleteMessage();
    } catch {
      // The bot may lack delete rights; the warning below still applies.
    }
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Message removed by moderation.");
    }
  });
}
`;

const MODERATION_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";

import { isBlocked } from "../src/features/moderation.ts";

test("moderation blocks links", () => {
  assert.equal(isBlocked("buy at https://example.com"), true);
  assert.equal(isBlocked("hello there"), false);
});
`;

const BROADCAST_MODULE = `import { GrammyError } from "grammy";
import type { Bot } from "grammy";

const GLOBAL_PER_SECOND = 30;

export function idempotencyKey(broadcastId: string, userId: number): string {
  return "broadcast:" + broadcastId + ":" + userId;
}

class GlobalRateLimiter {
  private next = 0;

  constructor(private readonly perSecond: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const interval = Math.ceil(1000 / this.perSecond);
    const slot = Math.max(now, this.next);
    this.next = slot + interval;
    if (slot > now) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, slot - now);
      await promise;
    }
  }
}

async function sendWithRetry(bot: Bot, chatId: number, text: string): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, text);
  } catch (error) {
    if (!(error instanceof GrammyError)) throw error;
    const retryAfter = error.parameters?.retry_after;
    if (error.error_code !== 429 || typeof retryAfter !== "number") throw error;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, retryAfter * 1000);
    await promise;
    await bot.api.sendMessage(chatId, text);
  }
}

async function withChatLock<T>(
  locks: Map<number, Promise<void>>,
  chatId: number,
  task: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(chatId) ?? Promise.resolve();
  const gate = Promise.withResolvers<void>();
  locks.set(
    chatId,
    previous.then(() => gate.promise),
  );
  await previous;
  try {
    return await task();
  } finally {
    gate.resolve();
  }
}

export interface BroadcastResult {
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

export async function broadcastText(
  bot: Bot,
  chatIds: readonly number[],
  text: string,
  broadcastId: string,
): Promise<BroadcastResult> {
  const limiter = new GlobalRateLimiter(GLOBAL_PER_SECOND);
  const locks = new Map<number, Promise<void>>();
  // ponytail: in-process idempotency only; move to Redis if restarts must not repeat sends.
  const completed = new Set<string>();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  await Promise.all(
    chatIds.map((chatId) =>
      withChatLock(locks, chatId, async () => {
        const key = idempotencyKey(broadcastId, chatId);
        if (completed.has(key)) {
          skipped += 1;
          return;
        }
        try {
          await limiter.wait();
          await sendWithRetry(bot, chatId, text);
          completed.add(key);
          sent += 1;
        } catch {
          failed += 1;
        }
      }),
    ),
  );

  return { sent, skipped, failed };
}

function adminIds(): readonly number[] {
  return (process.env.ADMIN_IDS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

export function register(bot: Bot): void {
  bot.command("broadcast", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined || !adminIds().includes(userId)) {
      await ctx.reply("Not authorized.");
      return;
    }
    const text = ctx.match.trim();
    if (text === "") {
      await ctx.reply("Usage: /broadcast <text>");
      return;
    }
    const result = await broadcastText(bot, adminIds(), text, String(Date.now()));
    await ctx.reply("Broadcast finished: " + result.sent + " sent, " + result.failed + " failed.");
  });
}
`;

const BROADCAST_TEST = `import assert from "node:assert/strict";
import { test } from "node:test";

import { broadcastText, idempotencyKey } from "../src/features/broadcast.ts";

type BotTarget = Parameters<typeof broadcastText>[0];

test("idempotency key is stable", () => {
  assert.equal(idempotencyKey("b1", 7), "broadcast:b1:7");
});

test("broadcast skips repeated recipients", async () => {
  const delivered: number[] = [];
  const fake = {
    api: {
      sendMessage: async (chatId: number) => {
        delivered.push(chatId);
      },
    },
  };
  const bot = fake as unknown as BotTarget;
  const first = await broadcastText(bot, [1, 2], "hello", "b1");
  assert.deepEqual(first, { sent: 2, skipped: 0, failed: 0 });
  const second = await broadcastText(bot, [1, 2], "hello", "b1");
  assert.deepEqual(second, { sent: 0, skipped: 2, failed: 0 });
  assert.deepEqual(delivered, [1, 2]);
});
`;

const MINIAPP_MODULE = `import { createHmac, timingSafeEqual } from "node:crypto";

import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";

export const SESSION_PATH = "/api/miniapp/session";
const MAX_AGE_SECONDS = 86_400;

export interface MiniAppUser {
  readonly id: number;
  readonly firstName: string;
  readonly lastName?: string;
  readonly username?: string;
}

export interface MiniAppSession {
  readonly user: MiniAppUser;
  readonly authDate: number;
}

export interface MiniAppRequest {
  readonly body: string;
  readonly botToken: string;
}

export interface MiniAppResponse {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

function parseUser(raw: string): MiniAppUser | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "number" || !Number.isInteger(record.id)) return null;
  if (typeof record.first_name !== "string") return null;
  return {
    id: record.id,
    firstName: record.first_name,
    ...(typeof record.last_name === "string" ? { lastName: record.last_name } : {}),
    ...(typeof record.username === "string" ? { username: record.username } : {}),
  };
}

export function validateInitData(
  initData: string,
  botToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): MiniAppSession | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (hash === null || hash === "") return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => key + "=" + value)
    .sort()
    .join("\\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(hash.toLowerCase(), "utf8");
  if (
    expectedBytes.length !== receivedBytes.length ||
    !timingSafeEqual(expectedBytes, receivedBytes)
  ) {
    return null;
  }
  const authDate = Number(params.get("auth_date") ?? "0");
  if (!Number.isInteger(authDate) || authDate <= 0) return null;
  if (nowSeconds - authDate > MAX_AGE_SECONDS) return null;
  const rawUser = params.get("user");
  if (rawUser === null) return null;
  const user = parseUser(rawUser);
  if (user === null) return null;
  return { user, authDate };
}

export async function handleSession(request: MiniAppRequest): Promise<MiniAppResponse> {
  let payload: unknown;
  try {
    payload = JSON.parse(request.body);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  if (typeof payload !== "object" || payload === null) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const initData = (payload as { initData?: unknown }).initData;
  if (typeof initData !== "string" || initData === "") {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const session = validateInitData(initData, request.botToken);
  if (session === null) return { status: 401, body: { error: "invalid_init_data" } };
  const displayName = [session.user.firstName, session.user.lastName ?? ""]
    .filter((part) => part !== "")
    .join(" ");
  return { status: 200, body: { user: { id: session.user.id, displayName } } };
}

export const route = { method: "POST", path: SESSION_PATH, handler: handleSession } as const;

export function register(bot: Bot): void {
  bot.command("miniapp", async (ctx) => {
    const url = process.env.MINIAPP_URL ?? process.env.WEBHOOK_URL ?? "";
    if (!url.startsWith("https://")) {
      await ctx.reply("Set WEBHOOK_URL to an HTTPS URL to open the mini app.");
      return;
    }
    await ctx.reply("Open the mini app:", {
      reply_markup: new InlineKeyboard().webApp("Open", url),
    });
  });
}
`;

const MINIAPP_TEST = `import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { handleSession, validateInitData } from "../src/features/miniapp.ts";

const TOKEN = "unit-test-token";

function signedInitData(authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "query",
    user: JSON.stringify({ id: 7, first_name: "Test" }),
  });
  const checkString = [...params.entries()]
    .map(([key, value]) => key + "=" + value)
    .sort()
    .join("\\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(checkString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

test("valid initData is accepted", () => {
  const now = 1_800_000_000;
  const session = validateInitData(signedInitData(now - 60), TOKEN, now);
  assert.ok(session);
  assert.equal(session.user.id, 7);
});

test("session response keeps the user contract used by the Mini App", async () => {
  const now = Math.floor(Date.now() / 1000);
  const response = await handleSession({
    body: JSON.stringify({ initData: signedInitData(now - 60) }),
    botToken: TOKEN,
  });
  assert.equal(response.status, 200);
  const user = response.body.user as { id?: number; displayName?: string } | undefined;
  assert.equal(user?.id, 7);
  assert.equal(typeof user?.displayName, "string");
});

test("stale initData is rejected", () => {
  const now = 1_800_000_000;
  assert.equal(validateInitData(signedInitData(now - 90_000), TOKEN, now), null);
});

test("tampered initData is rejected", () => {
  const now = 1_800_000_000;
  const tampered = signedInitData(now - 60).replace("user=%7B%22id%22%3A7", "user=%7B%22id%22%3A8");
  assert.equal(validateInitData(tampered, TOKEN, now), null);
});
`;

const WIDGETS_MODULE = `import type { Bot } from "grammy";

import { api104 } from "../telegram/api104.js";

const ANSWER_TIMEOUT_MS = 15_000;

export function widgetQueryId(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return null;
  for (const field of ["widget_query", "shared_widget_query"] as const) {
    if (!(field in message)) continue;
    const query = (message as Record<string, unknown>)[field];
    if (typeof query !== "object" || query === null || !("id" in query)) continue;
    if (typeof query.id === "string" && query.id !== "") return query.id;
  }
  return null;
}

export function register(bot: Bot): void {
  const api = api104(bot);
  bot.on("message", async (ctx, next) => {
    const queryId = widgetQueryId(ctx.message);
    if (queryId === null) {
      await next();
      return;
    }
    const startedAt = Date.now();
    await api.answerWidgetQuery({ widget_query_id: queryId, data: "ack" });
    if (Date.now() - startedAt > ANSWER_TIMEOUT_MS) return;
  });
}
`;

function widgetsTest(name: string): string {
  return `import assert from "node:assert/strict";
import { test } from "node:test";

import { register, widgetQueryId } from "../src/features/${name}.ts";

test("widget query id is read from both update shapes", () => {
  assert.equal(widgetQueryId({ widget_query: { id: "one" } }), "one");
  assert.equal(widgetQueryId({ shared_widget_query: { id: "two" } }), "two");
  assert.equal(widgetQueryId({}), null);
  assert.equal(widgetQueryId("nope"), null);
});

test("register is exported", () => {
  assert.equal(typeof register, "function");
});
`;
}

const RICH_MODULE = `import type { Bot } from "grammy";

import { api104 } from "../telegram/api104.js";

export function promptFrom(text: string | undefined): string {
  const value = text ?? "";
  const index = value.indexOf(" ");
  return (index === -1 ? "" : value.slice(index + 1)).trim();
}

export function richMessage(markdown: string): { readonly markdown: string } {
  return { markdown };
}

export function register(bot: Bot): void {
  const api = api104(bot);
  bot.command("rich", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const markdown = promptFrom(ctx.message?.text);
    if (markdown === "") {
      await ctx.reply("Usage: /rich <text>");
      return;
    }
    await api.sendRichMessageDraft({
      chat_id: chatId,
      draft_id: Date.now(),
      rich_message: richMessage(markdown),
    });
    await api.sendRichMessage({ chat_id: chatId, rich_message: richMessage(markdown) });
  });
}
`;

function richTest(name: string): string {
  return `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { promptFrom, register, richMessage } from "../src/features/${name}.ts";

test("rich prompt strips the command", () => {
  assert.equal(promptFrom("/rich hello *world*"), "hello *world*");
  assert.equal(promptFrom("/rich"), "");
  assert.equal(promptFrom(undefined), "");
});

test("rich payload uses rich_message", async () => {
  assert.deepEqual(richMessage("*hi*"), { markdown: "*hi*" });
  const source = await readFile(new URL("../src/features/${name}.ts", import.meta.url), "utf8");
  assert.match(source, /rich_message: richMessage\\(/);
});

test("register is exported", () => {
  assert.equal(typeof register, "function");
});
`;
}

export function renderGrammyFeature(
  feature: BotFeature,
  name: string,
  spec: BotSpec,
): TemplateFile[] {
  switch (feature) {
    case "commands":
      return [
        file(`src/features/${name}.ts`, commandModule(name)),
        file(`tests/${name}.test.ts`, commandTest(name)),
      ];
    case "llm":
      return [file("src/features/llm.ts", LLM_MODULE), file("tests/llm.test.ts", LLM_TEST)];
    case "inline":
      return [
        file("src/features/inline.ts", INLINE_MODULE),
        file("tests/inline.test.ts", INLINE_TEST),
      ];
    case "payments":
      return [
        file("src/features/payments.ts", PAYMENTS_MODULE),
        file("tests/payments.test.ts", PAYMENTS_TEST),
      ];
    case "miniapps":
      return [
        ...renderMiniApp(spec),
        file("src/features/miniapp.ts", MINIAPP_MODULE),
        file("tests/miniapp.test.ts", MINIAPP_TEST),
      ];
    case "moderation":
      return [
        file("src/features/moderation.ts", MODERATION_MODULE),
        file("tests/moderation.test.ts", MODERATION_TEST),
      ];
    case "broadcast":
      return [
        file("src/features/broadcast.ts", BROADCAST_MODULE),
        file("tests/broadcast.test.ts", BROADCAST_TEST),
      ];
    case "widgets":
      return [
        file(`src/features/${name}.ts`, WIDGETS_MODULE),
        file(`tests/${name}.test.ts`, widgetsTest(name)),
      ];
    case "rich":
      return [
        file(`src/features/${name}.ts`, RICH_MODULE),
        file(`tests/${name}.test.ts`, richTest(name)),
      ];
  }
}
