/**
 * Bot API 10.4 types and method payloads missing from grammY 1.46.0 and
 * aiogram 3.31.0.
 *
 * Field names and optionality follow the official pages:
 * https://core.telegram.org/bots/api (Bot API 10.4, released 2026-11-09).
 * Machine-readable contract used by the verifier and by the 10.4 skill. No
 * renderers: rendering lived in the deleted generator.
 */

/** 10.4 surface Aurifex types. The pinned contract JSON records the full set of
 * methods and types the 10.4 changelog touches. */
export const API104_METHODS = [
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

/** Types added in 10.4 plus the pre-existing types whose shape 10.4 changed. */
export const API104_TYPES = [
  "Widget",
  "WidgetQuery",
  "SharedWidgetQuery",
  "WidgetQueryType",
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
  "TextQuote",
  "ReplyParameters",
  "Message",
  "ExternalReplyInfo",
  "MessageEntity",
] as const;

/** Payload fields the 10.4 changelog adds or renames, used to check raw calls. */
export const API104_PARAMS = {
  getUniqueGift: ["name"],
  getChatShareThemeBackdrops: [],
  deleteBusinessAccountGift: ["business_connection_id", "owned_gift_id"],
} as const satisfies Readonly<Record<string, readonly string[]>>;
