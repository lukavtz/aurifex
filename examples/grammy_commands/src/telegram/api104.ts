import type { Bot } from "grammy";
import type { Message } from "grammy/types";

// Bot API 10.4 methods are newer than the grammY 1.46.0 types, so every call
// goes through bot.api.raw behind one narrow cast. Native framework support is
// never claimed; update this adapter when grammY ships the same methods.
export type MessageEntity = Record<string, unknown>;
export type ReplyMarkup = Record<string, unknown>;
export type ReplyParameters = Record<string, unknown>;
export type SuggestedPostParameters = Record<string, unknown>;
export type InputRichBlock = Record<string, unknown>;
export type InputRichMessageMedia = Record<string, unknown>;

export interface EphemeralMessageParameters {
  /** Identifier of the user who will receive the message. */
  receiver_user_id?: number;
  /** Identifier of the callback query, when the message answers one. */
  callback_query_id?: string;
  /** Show the ephemeral message in place of the original message. */
  replace_callback_query_message?: boolean;
}

/** Exactly one of html, markdown, or blocks must be set. */
export interface InputRichMessage {
  blocks?: readonly InputRichBlock[];
  html?: string;
  markdown?: string;
  media?: readonly InputRichMessageMedia[];
  is_rtl?: boolean;
  skip_entity_detection?: boolean;
}

export interface SendWidgetParams {
  chat_id: number | string;
  message_thread_id?: number;
  /** HTML widget source, 1-32768 bytes; at most 4096 bytes after zlib compression. */
  html: string;
  /** Widget width in logical pixels; clamped to 200..bubble width. */
  width?: number;
  /** Widget height in logical pixels; clamped to 50..600. */
  height?: number;
  /** Public widget data, 0-1024 bytes. */
  public_data?: string;
  /** Message-specific widget data, 0-1024 bytes. */
  chat_data?: string;
  /** Caption, 0-1024 characters after entity parsing. */
  caption?: string;
  parse_mode?: string;
  caption_entities?: readonly MessageEntity[];
  show_caption_above_media?: boolean;
  allow_queries?: boolean;
  is_shared?: boolean;
  disable_notification?: boolean;
  protect_content?: boolean;
  allow_paid_broadcast?: boolean;
  message_effect_id?: string;
  reply_parameters?: ReplyParameters;
  reply_markup?: ReplyMarkup;
}

export interface SendSharedWidgetParams {
  chat_id: number | string;
  message_thread_id?: number;
  widget_id: string;
  /** Message-specific widget data, 0-1024 bytes. */
  chat_data?: string;
  /** Caption, 0-1024 characters after entity parsing. */
  caption?: string;
  parse_mode?: string;
  caption_entities?: readonly MessageEntity[];
  show_caption_above_media?: boolean;
  disable_notification?: boolean;
  protect_content?: boolean;
  allow_paid_broadcast?: boolean;
  message_effect_id?: string;
  reply_parameters?: ReplyParameters;
  reply_markup?: ReplyMarkup;
}

export interface AnswerWidgetQueryParams {
  /** Identifier of the widget query; the query must be answered within 15 seconds. */
  widget_query_id: string;
  /** Data returned to the widget, 0-1024 bytes. */
  data?: string;
}

export interface EditMessageWidgetDataParams {
  chat_id?: number | string;
  message_id?: number;
  inline_message_id?: string;
  /** New public widget data, 0-1024 bytes; empty string clears it. */
  public_data?: string;
  /** New message-specific widget data, 0-1024 bytes; empty string clears it. */
  chat_data?: string;
}

export interface EditSharedWidgetDataParams {
  widget_id: string;
  /** New public widget data, 0-1024 bytes; empty string clears it. */
  public_data: string;
  /** Client-side cache time in seconds, 5-3600. */
  cache_time?: number;
}

export interface SendRichMessageParams {
  business_connection_id?: string;
  chat_id?: number | string;
  message_thread_id?: number;
  direct_messages_topic_id?: number;
  ephemeral_message_parameters?: EphemeralMessageParameters;
  rich_message: InputRichMessage;
  disable_notification?: boolean;
  protect_content?: boolean;
  allow_paid_broadcast?: boolean;
  message_effect_id?: string;
  suggested_post_parameters?: SuggestedPostParameters;
  reply_parameters?: ReplyParameters;
  reply_markup?: ReplyMarkup;
}

export interface SendRichMessageDraftParams {
  /** Private chat identifier. */
  chat_id: number;
  message_thread_id?: number;
  /** Non-zero draft identifier; updates with the same id animate. */
  draft_id: number;
  rich_message: InputRichMessage;
  can_stop?: boolean;
  keep_on_stop?: boolean;
}

export interface SendMessageEphemeralParams {
  chat_id?: number | string;
  message_thread_id?: number;
  text: string;
  parse_mode?: string;
  entities?: readonly MessageEntity[];
  ephemeral_message_parameters: EphemeralMessageParameters;
  reply_parameters?: ReplyParameters;
  reply_markup?: ReplyMarkup;
}

export interface GetUniqueGiftParams {
  gift_id: string;
}
export interface GetChatShareThemeBackdropsParams {
  chat_id: number | string;
}
export interface DeleteBusinessAccountGiftParams {
  business_connection_id: string;
  gift_id: string;
}
export interface VerifyUserParams {
  user_id: number;
  custom_description?: string;
  custom_description_parse_mode?: string;
  custom_description_entities?: readonly MessageEntity[];
}
export interface VerifyChatParams {
  chat_id: number | string;
  custom_description?: string;
  custom_description_parse_mode?: string;
  custom_description_entities?: readonly MessageEntity[];
}

interface RawApi104 {
  sendWidget(payload: SendWidgetParams): Promise<Message>;
  sendSharedWidget(payload: SendSharedWidgetParams): Promise<Message>;
  answerWidgetQuery(payload: AnswerWidgetQueryParams): Promise<true>;
  editMessageWidgetData(payload: EditMessageWidgetDataParams): Promise<true>;
  editSharedWidgetData(payload: EditSharedWidgetDataParams): Promise<true>;
  sendRichMessage(payload: SendRichMessageParams): Promise<Message>;
  sendRichMessageDraft(payload: SendRichMessageDraftParams): Promise<true>;
  sendMessage(payload: SendMessageEphemeralParams): Promise<Message>;
  getUniqueGift(payload: GetUniqueGiftParams): Promise<unknown>;
  getChatShareThemeBackdrops(payload: GetChatShareThemeBackdropsParams): Promise<unknown>;
  deleteBusinessAccountGift(payload: DeleteBusinessAccountGiftParams): Promise<true>;
  verifyUser(payload: VerifyUserParams): Promise<true>;
  verifyChat(payload: VerifyChatParams): Promise<true>;
}

export interface Api104 {
  sendWidget(payload: SendWidgetParams): Promise<Message>;
  sendSharedWidget(payload: SendSharedWidgetParams): Promise<Message>;
  answerWidgetQuery(payload: AnswerWidgetQueryParams): Promise<true>;
  editMessageWidgetData(payload: EditMessageWidgetDataParams): Promise<true>;
  editSharedWidgetData(payload: EditSharedWidgetDataParams): Promise<true>;
  sendRichMessage(payload: SendRichMessageParams): Promise<Message>;
  sendRichMessageDraft(payload: SendRichMessageDraftParams): Promise<true>;
  sendMessageEphemeral(payload: SendMessageEphemeralParams): Promise<Message>;
  getUniqueGift(payload: GetUniqueGiftParams): Promise<unknown>;
  getChatShareThemeBackdrops(payload: GetChatShareThemeBackdropsParams): Promise<unknown>;
  deleteBusinessAccountGift(payload: DeleteBusinessAccountGiftParams): Promise<true>;
  verifyUser(payload: VerifyUserParams): Promise<true>;
  verifyChat(payload: VerifyChatParams): Promise<true>;
}

export function api104(bot: Bot): Api104 {
  const raw = bot.api.raw as unknown as RawApi104;
  return {
    sendWidget: (payload) => raw.sendWidget(payload),
    sendSharedWidget: (payload) => raw.sendSharedWidget(payload),
    answerWidgetQuery: (payload) => raw.answerWidgetQuery(payload),
    editMessageWidgetData: (payload) => raw.editMessageWidgetData(payload),
    editSharedWidgetData: (payload) => raw.editSharedWidgetData(payload),
    sendRichMessage: (payload) => raw.sendRichMessage(payload),
    sendRichMessageDraft: (payload) => raw.sendRichMessageDraft(payload),
    // Bot API 10.4 has no sendMessageEphemeral method: ephemeral delivery is
    // sendMessage with ephemeral_message_parameters.
    sendMessageEphemeral: (payload) => raw.sendMessage(payload),
    getUniqueGift: (payload) => raw.getUniqueGift(payload),
    getChatShareThemeBackdrops: (payload) => raw.getChatShareThemeBackdrops(payload),
    deleteBusinessAccountGift: (payload) => raw.deleteBusinessAccountGift(payload),
    verifyUser: (payload) => raw.verifyUser(payload),
    verifyChat: (payload) => raw.verifyChat(payload),
  };
}
