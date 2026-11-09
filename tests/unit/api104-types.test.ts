import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  API104_METHODS,
  API104_TYPES,
  renderApi104TypesPy,
  renderApi104TypesTs,
} from "../../src/core/projects/templates/api104-types.ts";

const REQUIRED_METHODS = [
  "sendWidget",
  "sendSharedWidget",
  "answerWidgetQuery",
  "editMessageWidgetData",
  "editSharedWidgetData",
  "sendRichMessage",
  "sendRichMessageDraft",
  "getUniqueGift",
  "getChatShareThemeBackdrops",
  "deleteBusinessAccountGift",
  "verifyUser",
  "verifyChat",
] as const;

const REQUIRED_TYPES = [
  "Widget",
  "WidgetQuery",
  "SharedWidgetQuery",
  "WidgetQueryTypeData",
  "WidgetQueryTypeSignData",
  "WidgetQueryTypeSentTransaction",
  "WidgetQueryWallet",
  "InputWidgetMessageContent",
  "InputSharedWidgetMessageContent",
  "TonWalletCard",
  "TonWalletCardSticker",
  "TonNft",
  "TonNftAttribute",
  "TonWalletTransfer",
  "ChatShareTheme",
  "ChatShareThemeEmoji",
  "ChatShareThemeUniqueGift",
  "ChatShareThemeBackdrop",
  "ChatShareThemeBackdrops",
  "EmojiType",
  "EmojiTypeEmoji",
  "EmojiTypeCustomEmoji",
  "RichTextTonAddress",
  "PaidMessagesWaived",
  "AreaPosition",
] as const;

const dir = mkdtempSync(join(tmpdir(), "aurifex-api104-types-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const tsSource = renderApi104TypesTs();
const pySource = renderApi104TypesPy();

const tsPath = join(dir, "api104-types.ts");
writeFileSync(tsPath, tsSource, "utf8");
const pyPath = join(dir, "api104_types.py");
writeFileSync(pyPath, pySource, "utf8");

const python = spawnSync("python3", ["--version"], { encoding: "utf8" });

describe("api104 inventories", () => {
  it("lists every required 10.4 method", () => {
    for (const method of REQUIRED_METHODS) {
      assert.ok(API104_METHODS.includes(method), `missing method ${method}`);
    }
  });

  it("lists every required 10.4 type and the types it extends", () => {
    for (const type of REQUIRED_TYPES) {
      assert.ok(API104_TYPES.includes(type), `missing type ${type}`);
    }
    for (const type of [
      "TextQuote",
      "ReplyParameters",
      "Message",
      "ExternalReplyInfo",
      "MessageEntity",
    ] as const) {
      assert.ok(API104_TYPES.includes(type), `missing extended type ${type}`);
    }
  });
});

describe("renderApi104TypesTs", () => {
  it("emits required fields and strict discriminators", () => {
    assert.match(tsSource, /export interface Widget \{[\s\S]*?html: string;/);
    assert.match(tsSource, /export interface WidgetQueryTypeData \{\s*type: "data";/);
    assert.match(tsSource, /export interface WidgetQueryTypeSignData \{\s*type: "sign_data";/);
    assert.match(
      tsSource,
      /export interface WidgetQueryTypeSentTransaction \{\s*type: "sent_transaction";/,
    );
    assert.match(tsSource, /export interface EmojiTypeEmoji \{\s*type: "emoji";/);
    assert.match(tsSource, /export interface EmojiTypeCustomEmoji \{\s*type: "custom_emoji";/);
    assert.match(tsSource, /export interface ChatShareThemeEmoji \{\s*type: "emoji";/);
    assert.match(tsSource, /export interface ChatShareThemeUniqueGift \{\s*type: "unique_gift";/);
    assert.match(tsSource, /export interface RichTextTonAddress \{\s*type: "ton_address";/);
    assert.match(
      tsSource,
      /export type WidgetQueryType =\s*\| WidgetQueryTypeData\s*\| WidgetQueryTypeSignData\s*\| WidgetQueryTypeSentTransaction;/,
    );
    assert.match(
      tsSource,
      /export type ChatShareTheme = ChatShareThemeEmoji \| ChatShareThemeUniqueGift;/,
    );
    assert.match(tsSource, /export type EmojiType = EmojiTypeEmoji \| EmojiTypeCustomEmoji;/);
  });

  it("extends tables, messages, and entities exactly as documented", () => {
    assert.match(
      tsSource,
      /export interface TextQuote \{[\s\S]*?rich_texts\?: readonly RichText\[\];/,
    );
    assert.match(
      tsSource,
      /export interface ReplyParameters \{[\s\S]*?quote_rich_texts\?: readonly RichText\[\];/,
    );
    assert.match(tsSource, /export interface MessageApi104Fields \{[\s\S]*?widget\?: Widget;/);
    assert.match(tsSource, /ton_wallet_transfer\?: TonWalletTransfer;/);
    assert.match(tsSource, /paid_messages_waived\?: PaidMessagesWaived;/);
    assert.match(tsSource, /export interface ExternalReplyInfoApi104Fields \{\s*widget\?: Widget;/);
    assert.match(tsSource, /\| "ton_address"/);
    assert.match(tsSource, /\| "bank_card_number"/);
  });

  it("loads without framework imports", () => {
    assert.doesNotMatch(tsSource, /from\s+"grammy"|from\s+"aiogram"|^import .*aiogram/m);
    const check = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--exactOptionalPropertyTypes",
        "--target",
        "es2024",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--skipLibCheck",
        tsPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(check.status, 0, check.stdout + check.stderr);
  });
});

describe("renderApi104TypesPy", () => {
  it("emits TypedDict discriminators and the wire key for from", () => {
    assert.match(pySource, /class WidgetQueryTypeData\(TypedDict\):\s*type: Literal\["data"\]/);
    assert.match(
      pySource,
      /class WidgetQueryTypeSignData\(TypedDict\):\s*type: Literal\["sign_data"\]/,
    );
    assert.match(
      pySource,
      /class WidgetQueryTypeSentTransaction\(TypedDict\):\s*type: Literal\["sent_transaction"\]/,
    );
    assert.match(pySource, /"from": User,/);
    assert.match(
      pySource,
      /class TextQuote\(TypedDict\):[\s\S]*?rich_texts: NotRequired\[list\[RichText\]\]/,
    );
    assert.match(pySource, /quote_rich_texts: NotRequired\[list\[RichText\]\]/);
    assert.match(
      pySource,
      /class MessageApi104Fields\(TypedDict\):[\s\S]*?widget: NotRequired\[Widget\]/,
    );
    assert.match(pySource, /ton_address/);
    assert.match(pySource, /bank_card_number/);
    assert.doesNotMatch(pySource, /^\s*(from|import)\s+aiogram/m);
  });

  it("imports and exposes the required keys", (t) => {
    if (python.status !== 0) {
      t.skip("python3 unavailable");
      return;
    }
    const script = [
      "import importlib.util",
      `spec = importlib.util.spec_from_file_location("api104_types", ${JSON.stringify(pyPath)})`,
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      'assert module.WidgetQuery.__required_keys__ == frozenset({"id", "from", "chat_instance", "type", "data"})',
      'assert "rich_texts" in module.TextQuote.__optional_keys__',
      'assert "quote_rich_texts" in module.ReplyParameters.__optional_keys__',
      'assert "widget" in module.MessageApi104Fields.__optional_keys__',
      "assert module.PaidMessagesWaived.__required_keys__ == frozenset()",
      "print(module.WidgetQuery.__annotations__['from'])",
    ].join("\n");
    const run = spawnSync("python3", ["-c", script], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  });
});
