/**
 * Bot API 10.4 types and method payloads.
 *
 * Source: https://core.telegram.org/bots/api (released 2026-11-09).
 * No framework imports: this module is standalone and shared by both adapters.
 * Optionality matches the Bot API docs exactly; "true" is the Bot API's
 * literal Boolean-True marker and is typed as the literal true.
 */

export type ChatType = "private" | "group" | "supergroup" | "channel";

export interface User {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: true;
  added_to_attachment_menu?: true;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_guest_queries?: boolean;
  supports_inline_queries?: boolean;
  can_connect_to_business?: boolean;
  has_main_web_app?: boolean;
  has_topics_enabled?: boolean;
  allows_users_to_create_topics?: boolean;
  can_manage_bots?: boolean;
  supports_join_request_queries?: boolean;
}

export interface Chat {
  id: number;
  type: ChatType;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: true;
  is_direct_messages?: true;
}

/** Renamed from StoryAreaPosition in 10.4; now also used by TON wallet cards. */
export interface AreaPosition {
  x_percentage: number;
  y_percentage: number;
  width_percentage: number;
  height_percentage: number;
  rotation_angle: number;
  corner_radius_percentage: number;
}

/** Optional media fields (thumbnail, premium_animation, mask_position) stay
 * owned by the framework Sticker model and are not duplicated here. */
export interface Sticker {
  file_id: string;
  file_unique_id: string;
  type: "regular" | "mask" | "custom_emoji";
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
}

export interface UniqueGiftColors {
  model_custom_emoji_id: string;
  symbol_custom_emoji_id: string;
  light_theme_main_color: number;
  light_theme_other_colors: readonly number[];
  dark_theme_main_color: number;
  dark_theme_other_colors: readonly number[];
}

export interface UniqueGiftModel {
  name: string;
  sticker: Sticker;
  rarity_per_mille: number;
  rarity?: "uncommon" | "rare" | "epic" | "legendary";
}

export interface UniqueGiftSymbol {
  name: string;
  sticker: Sticker;
  rarity_per_mille: number;
}

export interface UniqueGiftBackdropColors {
  center_color: number;
  edge_color: number;
  symbol_color: number;
  text_color: number;
}

export interface UniqueGiftBackdrop {
  name: string;
  colors: UniqueGiftBackdropColors;
  rarity_per_mille: number;
}

/** Pre-10.4 type referenced by TonNft.gift and ChatShareThemeUniqueGift.gift. */
export interface UniqueGift {
  gift_id: string;
  base_name: string;
  name: string;
  number: number;
  model: UniqueGiftModel;
  symbol: UniqueGiftSymbol;
  backdrop: UniqueGiftBackdrop;
  is_premium?: true;
  is_burned?: true;
  is_from_blockchain?: true;
  colors?: UniqueGiftColors;
  publisher_chat?: Chat;
}

export interface Widget {
  /** Shared widget id; omitted when the widget is not shared. */
  id?: string;
  width?: number;
  height?: number;
  html: string;
  public_data?: string;
  chat_data?: string;
}

export interface WidgetQueryWallet {
  address: string;
  amount: string;
  public_key?: string;
  state_init?: string;
}

export interface WidgetQueryTypeData {
  type: "data";
  wallet_card?: TonWalletCard;
}

export interface WidgetQueryTypeSignData {
  type: "sign_data";
  wallet: WidgetQueryWallet;
  sign_data: string;
}

export interface WidgetQueryTypeSentTransaction {
  type: "sent_transaction";
  wallet: WidgetQueryWallet;
  msg_hash: string;
}

export type WidgetQueryType =
  WidgetQueryTypeData | WidgetQueryTypeSignData | WidgetQueryTypeSentTransaction;

export interface WidgetQuery {
  id: string;
  from: User;
  chat?: Chat;
  message_id?: number;
  inline_message_id?: string;
  chat_instance: string;
  chat_type?: "sender" | ChatType;
  type: WidgetQueryType;
  data: string;
  widget_id?: string;
}

export interface SharedWidgetQuery {
  id: string;
  from: User;
  type: WidgetQueryType;
  data: string;
  widget_id: string;
}

export interface InputWidgetMessageContent {
  html: string;
  width?: number;
  height?: number;
  public_data?: string;
  chat_data?: string;
  caption?: string;
  parse_mode?: string;
  caption_entities?: readonly MessageEntity[];
  show_caption_above_media?: boolean;
  allow_queries?: boolean;
  is_shared?: boolean;
}

export interface InputSharedWidgetMessageContent {
  widget_id: string;
  chat_data?: string;
  caption?: string;
  parse_mode?: string;
  caption_entities?: readonly MessageEntity[];
  show_caption_above_media?: boolean;
}

export interface TonWalletCardSticker {
  position: AreaPosition;
  nft: TonNft;
}

export interface TonWalletCard {
  address: string;
  amount: string;
  stickers: readonly TonWalletCardSticker[];
  background_nft_address?: string;
}

export interface TonNftAttribute {
  trait_type: string;
  value: string;
}

export interface TonNft {
  address: string;
  collection_address?: string;
  index: string;
  name: string;
  description: string;
  attributes?: readonly TonNftAttribute[];
  gift?: UniqueGift;
}

export interface TonWalletTransfer {
  /** May be empty when the transfer has not been sent yet. */
  transaction_id: string;
  peer_address: string;
  amount: string;
  comment?: string;
}

export interface EmojiTypeEmoji {
  type: "emoji";
  emoji: string;
}

export interface EmojiTypeCustomEmoji {
  type: "custom_emoji";
  custom_emoji_id: string;
}

export type EmojiType = EmojiTypeEmoji | EmojiTypeCustomEmoji;

export interface ChatShareThemeEmoji {
  type: "emoji";
  emojis: readonly EmojiType[];
  background_backdrop_id?: number;
}

export interface ChatShareThemeUniqueGift {
  type: "unique_gift";
  gift: UniqueGift;
}

export type ChatShareTheme = ChatShareThemeEmoji | ChatShareThemeUniqueGift;

export interface ChatShareThemeBackdrop {
  id: number;
  name: string;
  colors: UniqueGiftBackdropColors;
}

export interface ChatShareThemeBackdrops {
  backdrops: readonly ChatShareThemeBackdrop[];
}

/** RichText is a 28-variant recursive union. Only the 10.4 addition
 * (RichTextTonAddress) is exhaustively typed here; other variants stay
 * structural so this module does not fork the framework's union. */
export type RichText = string | readonly RichText[] | { readonly type: string };

export interface RichTextTonAddress {
  type: "ton_address";
  text: RichText;
  address: string;
}

/** Currently holds no information; kept as a named type for clarity. */
export type PaidMessagesWaived = Readonly<Record<string, never>>;

export type MessageEntityType =
  | "mention"
  | "hashtag"
  | "cashtag"
  | "bot_command"
  | "url"
  | "email"
  | "phone_number"
  | "bank_card_number"
  | "ton_address"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "spoiler"
  | "blockquote"
  | "expandable_blockquote"
  | "code"
  | "pre"
  | "text_link"
  | "text_mention"
  | "custom_emoji"
  | "date_time";

export interface MessageEntity {
  type: MessageEntityType;
  offset: number;
  length: number;
  url?: string;
  user?: User;
  language?: string;
  custom_emoji_id?: string;
  unix_time?: number;
  date_time_format?: string;
}

export interface TextQuote {
  /** May be empty when the quote was chosen from a rich message. */
  text: string;
  entities?: readonly MessageEntity[];
  rich_texts?: readonly RichText[];
  position: number;
  is_manual?: true;
}

export interface ReplyParameters {
  message_id?: number;
  chat_id?: number | string;
  ephemeral_message_id?: number;
  allow_sending_without_reply?: boolean;
  quote?: string;
  quote_parse_mode?: string;
  quote_entities?: readonly MessageEntity[];
  quote_rich_texts?: readonly RichText[];
  quote_position?: number;
  checklist_task_id?: number;
  poll_option_id?: string;
}

/** 10.4 additions to Message. Merge with the framework type:
 * type Message104 = Message & MessageApi104Fields. */
export interface MessageApi104Fields {
  widget?: Widget;
  ton_wallet_transfer?: TonWalletTransfer;
  paid_messages_waived?: PaidMessagesWaived;
}

/** 10.4 addition to ExternalReplyInfo. */
export interface ExternalReplyInfoApi104Fields {
  widget?: Widget;
}

export interface GetUniqueGiftParams {
  name: string;
}

export type GetChatShareThemeBackdropsParams = Readonly<Record<string, never>>;

export interface DeleteBusinessAccountGiftParams {
  business_connection_id: string;
  owned_gift_id: string;
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
