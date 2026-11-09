/**
 * Bot API 10.4 types and method payloads missing from grammY 1.46.0 and
 * aiogram 3.31.0.
 *
 * Field names and optionality follow the official pages:
 * https://core.telegram.org/bots/api (Bot API 10.4, released 2026-11-09).
 * Both renderers emit stdlib-only modules: no framework imports, so the same
 * contract can be shared by the TypeScript and Python adapters.
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

export function renderApi104TypesTs(): string {
  return `/**
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
  | WidgetQueryTypeData
  | WidgetQueryTypeSignData
  | WidgetQueryTypeSentTransaction;

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
`;
}

export function renderApi104TypesPy(): string {
  return `"""Bot API 10.4 types and method payloads missing from framework releases.

Source: https://core.telegram.org/bots/api (released 2026-11-09).
Stdlib only: TypedDict models mirror the JSON wire shape, so the "from" key is
kept verbatim. Optional fields use NotRequired and literal discriminators use
Literal, matching the Bot API docs exactly.
"""

from typing import Literal, NotRequired, TypedDict

ChatType = Literal["private", "group", "supergroup", "channel"]


class User(TypedDict):
    id: int
    is_bot: bool
    first_name: str
    last_name: NotRequired[str]
    username: NotRequired[str]
    language_code: NotRequired[str]
    is_premium: NotRequired[Literal[True]]
    added_to_attachment_menu: NotRequired[Literal[True]]
    can_join_groups: NotRequired[bool]
    can_read_all_group_messages: NotRequired[bool]
    supports_guest_queries: NotRequired[bool]
    supports_inline_queries: NotRequired[bool]
    can_connect_to_business: NotRequired[bool]
    has_main_web_app: NotRequired[bool]
    has_topics_enabled: NotRequired[bool]
    allows_users_to_create_topics: NotRequired[bool]
    can_manage_bots: NotRequired[bool]
    supports_join_request_queries: NotRequired[bool]


class Chat(TypedDict):
    id: int
    type: ChatType
    title: NotRequired[str]
    username: NotRequired[str]
    first_name: NotRequired[str]
    last_name: NotRequired[str]
    is_forum: NotRequired[Literal[True]]
    is_direct_messages: NotRequired[Literal[True]]


class AreaPosition(TypedDict):
    """Renamed from StoryAreaPosition in 10.4; also used by TON wallet cards."""

    x_percentage: float
    y_percentage: float
    width_percentage: float
    height_percentage: float
    rotation_angle: float
    corner_radius_percentage: float


class Sticker(TypedDict):
    """Core fields only; optional media metadata stays in the framework model."""

    file_id: str
    file_unique_id: str
    type: Literal["regular", "mask", "custom_emoji"]
    width: int
    height: int
    is_animated: bool
    is_video: bool


class UniqueGiftColors(TypedDict):
    model_custom_emoji_id: str
    symbol_custom_emoji_id: str
    light_theme_main_color: int
    light_theme_other_colors: list[int]
    dark_theme_main_color: int
    dark_theme_other_colors: list[int]


class UniqueGiftModel(TypedDict):
    name: str
    sticker: Sticker
    rarity_per_mille: int
    rarity: NotRequired[Literal["uncommon", "rare", "epic", "legendary"]]


class UniqueGiftSymbol(TypedDict):
    name: str
    sticker: Sticker
    rarity_per_mille: int


class UniqueGiftBackdropColors(TypedDict):
    center_color: int
    edge_color: int
    symbol_color: int
    text_color: int


class UniqueGiftBackdrop(TypedDict):
    name: str
    colors: UniqueGiftBackdropColors
    rarity_per_mille: int


class UniqueGift(TypedDict):
    """Pre-10.4 type referenced by TonNft.gift and ChatShareThemeUniqueGift.gift."""

    gift_id: str
    base_name: str
    name: str
    number: int
    model: UniqueGiftModel
    symbol: UniqueGiftSymbol
    backdrop: UniqueGiftBackdrop
    is_premium: NotRequired[Literal[True]]
    is_burned: NotRequired[Literal[True]]
    is_from_blockchain: NotRequired[Literal[True]]
    colors: NotRequired[UniqueGiftColors]
    publisher_chat: NotRequired[Chat]


class Widget(TypedDict):
    id: NotRequired[str]
    width: NotRequired[int]
    height: NotRequired[int]
    html: str
    public_data: NotRequired[str]
    chat_data: NotRequired[str]


class WidgetQueryWallet(TypedDict):
    address: str
    amount: str
    public_key: NotRequired[str]
    state_init: NotRequired[str]


class TonNftAttribute(TypedDict):
    trait_type: str
    value: str


class TonNft(TypedDict):
    address: str
    collection_address: NotRequired[str]
    index: str
    name: str
    description: str
    attributes: NotRequired[list[TonNftAttribute]]
    gift: NotRequired[UniqueGift]


class TonWalletCardSticker(TypedDict):
    position: AreaPosition
    nft: TonNft


class TonWalletCard(TypedDict):
    address: str
    amount: str
    stickers: list[TonWalletCardSticker]
    background_nft_address: NotRequired[str]


class WidgetQueryTypeData(TypedDict):
    type: Literal["data"]
    wallet_card: NotRequired[TonWalletCard]


class WidgetQueryTypeSignData(TypedDict):
    type: Literal["sign_data"]
    wallet: WidgetQueryWallet
    sign_data: str


class WidgetQueryTypeSentTransaction(TypedDict):
    type: Literal["sent_transaction"]
    wallet: WidgetQueryWallet
    msg_hash: str


WidgetQueryType = (
    WidgetQueryTypeData | WidgetQueryTypeSignData | WidgetQueryTypeSentTransaction
)

# Functional syntax keeps the JSON key "from" without a Python keyword clash.
WidgetQuery = TypedDict(
    "WidgetQuery",
    {
        "id": str,
        "from": User,
        "chat": NotRequired[Chat],
        "message_id": NotRequired[int],
        "inline_message_id": NotRequired[str],
        "chat_instance": str,
        "chat_type": NotRequired[ChatType | Literal["sender"]],
        "type": WidgetQueryType,
        "data": str,
        "widget_id": NotRequired[str],
    },
)


SharedWidgetQuery = TypedDict(
    "SharedWidgetQuery",
    {
        "id": str,
        "from": User,
        "type": WidgetQueryType,
        "data": str,
        "widget_id": str,
    },
)


MessageEntityType = Literal[
    "mention",
    "hashtag",
    "cashtag",
    "bot_command",
    "url",
    "email",
    "phone_number",
    "bank_card_number",
    "ton_address",
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "spoiler",
    "blockquote",
    "expandable_blockquote",
    "code",
    "pre",
    "text_link",
    "text_mention",
    "custom_emoji",
    "date_time",
]


class MessageEntity(TypedDict):
    type: MessageEntityType
    offset: int
    length: int
    url: NotRequired[str]
    user: NotRequired[User]
    language: NotRequired[str]
    custom_emoji_id: NotRequired[str]
    unix_time: NotRequired[int]
    date_time_format: NotRequired[str]


class InputSharedWidgetMessageContent(TypedDict):
    widget_id: str
    chat_data: NotRequired[str]
    caption: NotRequired[str]
    parse_mode: NotRequired[str]
    caption_entities: NotRequired[list[MessageEntity]]
    show_caption_above_media: NotRequired[bool]


class TonWalletTransfer(TypedDict):
    transaction_id: str
    peer_address: str
    amount: str
    comment: NotRequired[str]


class EmojiTypeEmoji(TypedDict):
    type: Literal["emoji"]
    emoji: str


class EmojiTypeCustomEmoji(TypedDict):
    type: Literal["custom_emoji"]
    custom_emoji_id: str


EmojiType = EmojiTypeEmoji | EmojiTypeCustomEmoji


class ChatShareThemeEmoji(TypedDict):
    type: Literal["emoji"]
    emojis: list[EmojiType]
    background_backdrop_id: NotRequired[int]


class ChatShareThemeUniqueGift(TypedDict):
    type: Literal["unique_gift"]
    gift: UniqueGift


ChatShareTheme = ChatShareThemeEmoji | ChatShareThemeUniqueGift


class ChatShareThemeBackdrop(TypedDict):
    id: int
    name: str
    colors: UniqueGiftBackdropColors


class ChatShareThemeBackdrops(TypedDict):
    backdrops: list[ChatShareThemeBackdrop]


# RichText is a 28-variant recursive union. Only the 10.4 addition
# (RichTextTonAddress) is exhaustively typed; other variants stay structural.
RichText = str | list["RichText"] | dict[str, object]


class RichTextTonAddress(TypedDict):
    type: Literal["ton_address"]
    text: RichText
    address: str


class PaidMessagesWaived(TypedDict):
    """Currently holds no information; kept as a named type for clarity."""


class InputWidgetMessageContent(TypedDict):
    html: str
    width: NotRequired[int]
    height: NotRequired[int]
    public_data: NotRequired[str]
    chat_data: NotRequired[str]
    caption: NotRequired[str]
    parse_mode: NotRequired[str]
    caption_entities: NotRequired[list[MessageEntity]]
    show_caption_above_media: NotRequired[bool]
    allow_queries: NotRequired[bool]
    is_shared: NotRequired[bool]


class TextQuote(TypedDict):
    text: str
    entities: NotRequired[list[MessageEntity]]
    rich_texts: NotRequired[list[RichText]]
    position: int
    is_manual: NotRequired[Literal[True]]


class ReplyParameters(TypedDict):
    message_id: NotRequired[int]
    chat_id: NotRequired[int | str]
    ephemeral_message_id: NotRequired[int]
    allow_sending_without_reply: NotRequired[bool]
    quote: NotRequired[str]
    quote_parse_mode: NotRequired[str]
    quote_entities: NotRequired[list[MessageEntity]]
    quote_rich_texts: NotRequired[list[RichText]]
    quote_position: NotRequired[int]
    checklist_task_id: NotRequired[int]
    poll_option_id: NotRequired[str]


class MessageApi104Fields(TypedDict):
    """10.4 additions to Message; merge with the framework Message model."""

    widget: NotRequired[Widget]
    ton_wallet_transfer: NotRequired[TonWalletTransfer]
    paid_messages_waived: NotRequired[PaidMessagesWaived]


class ExternalReplyInfoApi104Fields(TypedDict):
    """10.4 addition to ExternalReplyInfo."""

    widget: NotRequired[Widget]


class GetUniqueGiftParams(TypedDict):
    name: str


class GetChatShareThemeBackdropsParams(TypedDict):
    """The method takes no parameters."""


class DeleteBusinessAccountGiftParams(TypedDict):
    business_connection_id: str
    owned_gift_id: str


class VerifyUserParams(TypedDict):
    user_id: int
    custom_description: NotRequired[str]
    custom_description_parse_mode: NotRequired[str]
    custom_description_entities: NotRequired[list[MessageEntity]]


class VerifyChatParams(TypedDict):
    chat_id: int | str
    custom_description: NotRequired[str]
    custom_description_parse_mode: NotRequired[str]
    custom_description_entities: NotRequired[list[MessageEntity]]
`;
}
