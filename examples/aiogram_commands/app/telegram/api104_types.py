"""Bot API 10.4 types and method payloads missing from framework releases.

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
