# Official URLs by topic

Prefer the `.md` form: it is the same content without navigation and is what
`tg_docs.py` fetches. Pages change; the URL stays the citation.

## API contract

| Topic                                               | URL                                                             |
| --------------------------------------------------- | --------------------------------------------------------------- |
| Full Bot API reference                              | https://core.telegram.org/bots/api.md                           |
| Reference, HTML view (methods and types jump links) | https://core.telegram.org/bots/api                              |
| All types                                           | https://core.telegram.org/bots/api/types.md                     |
| Using a local Bot API server                        | https://core.telegram.org/bots/api#using-a-local-bot-api-server |
| Testing your bot                                    | https://core.telegram.org/bots/features.md#testing-your-bot     |

## Changes

| Topic                   | URL                                             |
| ----------------------- | ----------------------------------------------- |
| Changelog, newest first | https://core.telegram.org/bots/api-changelog.md |
| Blog announcements      | https://telegram.org/blog                       |

## Formatting and messages

| Topic                                            | URL                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| Ordinary formatting (HTML, MarkdownV2, entities) | https://core.telegram.org/bots/api/formatting.md                       |
| Rich messages: grammar, limits, buttons          | https://core.telegram.org/bots/api/rich-messages.md                    |
| `InputRichMessage`                               | https://core.telegram.org/bots/api/types/inputrichmessage.md           |
| `sendRichMessage`                                | https://core.telegram.org/bots/api/methods/sendrichmessage.md          |
| `sendMessage`                                    | https://core.telegram.org/bots/api/methods/sendmessage.md              |
| `InlineKeyboardButton`                           | https://core.telegram.org/bots/api/types/inlinekeyboardbutton.md       |
| `RichMessageButton`                              | https://core.telegram.org/bots/api/types/richmessagebutton.md          |
| `EphemeralMessageParameters`                     | https://core.telegram.org/bots/api/types/ephemeralmessageparameters.md |
| `sendMessageDraft`                               | https://core.telegram.org/bots/api/methods/sendmessagedraft.md         |
| `sendRichMessageDraft`                           | https://core.telegram.org/bots/api/methods/sendrichmessagedraft.md     |

## Updates and delivery

| Topic                    | URL                                                          |
| ------------------------ | ------------------------------------------------------------ |
| `setWebhook`             | https://core.telegram.org/bots/api#setwebhook                |
| `setWebhook` method page | https://core.telegram.org/bots/api/methods/setwebhook.md     |
| `getUpdates`             | https://core.telegram.org/bots/api/methods/getupdates.md     |
| `getWebhookInfo`         | https://core.telegram.org/bots/api/methods/getwebhookinfo.md |
| Update payload reference | https://core.telegram.org/bots/api#update                    |

## Features and surfaces

| Topic                                | URL                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| Bot features overview                | https://core.telegram.org/bots/features.md                                          |
| Inline mode                          | https://core.telegram.org/bots/inline.md                                            |
| Payments (non-Stars)                 | https://core.telegram.org/bots/payments.md                                          |
| Payments for digital goods and Stars | https://core.telegram.org/bots/payments-stars.md                                    |
| Mini Apps                            | https://core.telegram.org/bots/webapps.md                                           |
| Validating `initData`                | https://core.telegram.org/bots/webapps.md#validating-data-received-via-the-mini-app |
| Telegram Serverless                  | https://core.telegram.org/bots/serverless.md                                        |
| Bot FAQ (may lag the changelog)      | https://core.telegram.org/bots/faq.md                                               |
| Bot developers terms                 | https://telegram.org/tos/bot-developers                                             |
| Test environment                     | https://core.telegram.org/bots/features.md#testing-your-bot                         |
| Client API and TDLib (not Bot API)   | https://core.telegram.org/api                                                       |

## SDKs

| SDK                 | Documentation                         | Releases                                                            |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| grammY (TypeScript) | https://grammy.dev/                   | https://github.com/grammyjs/grammY/releases                         |
| aiogram (Python)    | https://docs.aiogram.dev/en/latest/   | https://github.com/aiogram/aiogram/releases                         |
| python-telegram-bot | https://docs.python-telegram-bot.org/ | https://github.com/python-telegram-bot/python-telegram-bot/releases |
| Telegraf (Node.js)  | https://telegraf.js.org/              | https://github.com/telegraf/telegraf/releases                       |

## Context7 ids

| Package | Library id         |
| ------- | ------------------ |
| grammY  | `/grammyjs/grammy` |
| aiogram | `/aiogram/aiogram` |

Resolve the id before querying; the resolved id may include a version segment. Query
against the version installed in the project, not the newest one.
