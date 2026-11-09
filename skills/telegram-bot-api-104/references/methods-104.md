# Bot API 10.4 object reference

Verified against `https://core.telegram.org/bots/api` on 2026-11-09. Check the live
page before relying on a field.

## Widget methods

| Method                  | Required                                         | Optional                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sendWidget`            | `chat_id`, `html`                                | `message_thread_id`, `width`, `height`, `public_data`, `chat_data`, `caption`, `parse_mode`, `caption_entities`, `show_caption_above_media`, `allow_queries`, `is_shared`, `disable_notification`, `protect_content`, `allow_paid_broadcast`, `message_effect_id`, `reply_parameters`, `reply_markup` |
| `sendSharedWidget`      | `chat_id`, `widget_id`                           | `message_thread_id`, `chat_data`, `caption`, `parse_mode`, `caption_entities`, `show_caption_above_media`, `disable_notification`, `protect_content`, `allow_paid_broadcast`, `message_effect_id`, `reply_parameters`, `reply_markup`                                                                 |
| `answerWidgetQuery`     | `widget_query_id`                                | `data`                                                                                                                                                                                                                                                                                                |
| `editMessageWidgetData` | `chat_id` + `message_id`, or `inline_message_id` | `public_data`, `chat_data`                                                                                                                                                                                                                                                                            |
| `editSharedWidgetData`  | `widget_id`, `public_data`                       | `cache_time`                                                                                                                                                                                                                                                                                          |

Widget limits:

- `html`: 1–32768 bytes raw; at most 4096 bytes after zlib maximum compression.
- `width`: omitted for full width; clamped 200 to the bubble maximum.
- `height`: omitted for auto; clamped 50–600.
- `public_data`, `chat_data`: 0–1024 bytes each.
- `caption`: 0–1024 characters after entity parsing.
- `answerWidgetQuery.data`: 0–1024 bytes.
- `editSharedWidgetData.cache_time`: 5–3600 seconds; default stays 30.
- Shared public data changes at most once per second.
- Each user sends at most 5 widget queries per 5 seconds across all widgets.
- Answer a widget query within 15 seconds.

## WidgetQuery

| Field               | Type            | Notes                                      |
| ------------------- | --------------- | ------------------------------------------ |
| `id`                | String          | Query id for `answerWidgetQuery`           |
| `from`              | User            | Sender                                     |
| `chat`              | Chat            | Optional; omitted for inline messages      |
| `message_id`        | Integer         | Optional; omitted for inline messages      |
| `inline_message_id` | String          | Optional                                   |
| `chat_instance`     | String          | Global chat identifier                     |
| `chat_type`         | String          | Optional; inline widgets only              |
| `type`              | WidgetQueryType | `data`, `sign_data`, or `sent_transaction` |
| `data`              | String          | 1–64 bytes                                 |
| `widget_id`         | String          | Optional; present for shared widgets       |

`SharedWidgetQuery` has `id`, `from`, `type`, `data`, and `widget_id`.

## WidgetQueryType

| Type               | Fields                                           |
| ------------------ | ------------------------------------------------ |
| `data`             | optional `wallet_card: TonWalletCard`            |
| `sign_data`        | `wallet: WidgetQueryWallet`, `sign_data: String` |
| `sent_transaction` | `wallet: WidgetQueryWallet`, `msg_hash: String`  |

`WidgetQueryWallet`: `address`, `amount`, optional `public_key`, optional
`state_init`. `state_init` is omitted if and only if `public_key` is omitted.

## EphemeralMessageParameters

| Field                            | Type    | Notes                                             |
| -------------------------------- | ------- | ------------------------------------------------- |
| `receiver_user_id`               | Integer | Optional for a callback reply; otherwise required |
| `callback_query_id`              | String  | Callback that triggered the message               |
| `replace_callback_query_message` | Boolean | Show in place of the original                     |

Rules:

- Without `receiver_user_id`, a callback reply is visible only to the user who
  pressed the button.
- `chat_id` is ignored when `receiver_user_id` is omitted.
- Works in any chat except channel direct messages chats.
- Still call `answerCallbackQuery`.
- Reply to an ephemeral message with `reply_parameters.ephemeral_message_id` within
  15 seconds; the reply must itself be ephemeral.

## Rich quotes

`TextQuote`:

- `text`: may be empty for a rich-message quote.
- `entities`: optional; only bold, italic, underline, strikethrough, spoiler,
  custom emoji, and date-time are kept.
- `rich_texts`: optional array of `RichText`.
- `position`: UTF-16 offset; for rich quotes, relative to joined plain texts.
- `is_manual`: optional true.

`ReplyParameters.quote_rich_texts`: array of `RichText`, one per quoted text in
order. Allowed: plain text, bold, italic, underline, strikethrough, spoiler,
subscript, superscript, date-time, custom emoji, mathematical expression, and
arrays of them.

## TON wallet

`TonWalletCard`:

| Field                    | Type                          | Notes                              |
| ------------------------ | ----------------------------- | ---------------------------------- |
| `address`                | String                        | Wallet address                     |
| `amount`                 | String                        | Balance in smallest units, decimal |
| `stickers`               | Array of TonWalletCardSticker | Stickers on the card               |
| `background_nft_address` | String                        | Optional                           |

`TonWalletCardSticker`: `position: AreaPosition`, `nft: TonNft`.

`TonNft`: `address`, `owner_address`, `name`, `description`, optional
`attributes: TonNftAttribute[]`, optional `gift: UniqueGift`.

`TonNftAttribute`: `trait_type`, `value`.

`TonWalletTransfer`:

| Field            | Type   | Notes                                      |
| ---------------- | ------ | ------------------------------------------ |
| `transaction_id` | String | May be empty before sending                |
| `peer_address`   | String | Transfer peer                              |
| `amount`         | String | Smallest units, decimal; negative outgoing |
| `comment`        | String | Optional; omitted if encrypted             |

Also added: `RichTextTonAddress`, and the `ton_address` message entity type.

## Chat share themes

`ChatFullInfo.share_theme` is one of:

- `ChatShareThemeEmoji`: `type: "emoji"`, `emojis: EmojiType[]` (0–6), optional
  `background_backdrop_id`.
- `ChatShareThemeUniqueGift`: `type: "unique_gift"`, `gift: UniqueGift`.

`EmojiType`:

- `{ "type": "emoji", "emoji": "<emoji>" }`
- `{ "type": "custom_emoji", "custom_emoji_id": "<id>" }`

`getChatShareThemeBackdrops` takes no parameters. It returns
`ChatShareThemeBackdrops.backdrops: ChatShareThemeBackdrop[]`.
Each backdrop has `id`, `name`, and `colors: UniqueGiftBackdropColors`.

## Unique gifts

`getUniqueGift({ name })` returns `UniqueGift`:

| Field                | Type               | Notes                                     |
| -------------------- | ------------------ | ----------------------------------------- |
| `gift_id`            | String             | Regular gift it was upgraded from         |
| `base_name`          | String             | Human-readable base name                  |
| `name`               | String             | Unique name, used in `t.me/nft/...` links |
| `number`             | Integer            | Unique number among the same base gift    |
| `model`              | UniqueGiftModel    | Model                                     |
| `symbol`             | UniqueGiftSymbol   | Symbol                                    |
| `backdrop`           | UniqueGiftBackdrop | Backdrop                                  |
| `is_premium`         | True               | Optional                                  |
| `is_burned`          | True               | Optional                                  |
| `is_from_blockchain` | True               | Optional                                  |
| `colors`             | UniqueGiftColors   | Optional                                  |
| `publisher_chat`     | Chat               | Optional                                  |

`deleteBusinessAccountGift` removes a non-limited, non-refunded regular gift owned
by a managed business account. It requires `can_convert_gifts_to_stars`.

## Sources

Telegram Bot API 10.4 (`core.telegram.org/bots/api`); `nzhulikov/telegram-bot-skills`
(Apache-2.0); `serejaris/telegram-skills` (MIT). See `THIRD_PARTY_NOTICES.md`.
