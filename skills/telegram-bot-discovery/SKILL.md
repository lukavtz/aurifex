---
name: telegram-bot-discovery
description: Use when creating or materially changing a Telegram bot, before any code is written. Ask the material product questions in one block with options and defaults, map every answer to a BotSpec field, and get the spec confirmed. Русские триггеры: новый телеграм-бот, создать бота, какие вопросы задать, согласовать бота, функции бота.
---

# Telegram bot discovery

The agent writes the bot itself. There is no generator: discovery exists so the
code matches what the owner asked for, not what the agent assumed. Do not write
bot code, install packages, or create files until the owner confirms the spec.

## Procedure

1. Read `telegram-bot` for the hard rules and `telegram-bot-stack-choice` when the
   stack, storage, or transport is not already fixed.
2. Ask the open questions below in **one** message, as a numbered list, each with
   options and one recommended value. Ask only what is still unknown.
3. Fill `BotSpec` from the answers using the mapping table. Record every choice
   the owner did not make as an `assuming:` line.
4. Summarize the requested behavior in one short paragraph and show the proposed
   spec fields that change code: stack, features, storage, queue, locales,
   payments, admins.
5. Ask for explicit confirmation. Only then build, reading `telegram-bot-recipes`
   for the requested features and nothing else.
6. After building, run `telegram_bot_verify`.

### Questions to ask (one block, 3–7 items)

Ask only the items that apply; an existing project answers several of them.

1. **Goal and audience** — what single job should the bot do, and who runs it?
   Options: one main flow; several small commands; an AI chat; a storefront;
   a Mini App. Recommended: one main flow.
2. **Stack** — options: TypeScript + grammY 1.46, Python + aiogram 3.31.
   Recommended: the stack the project already uses; for an empty directory,
   grammY.
3. **Features** — ask explicitly and let the owner pick: commands only, inline
   buttons, scenes/conversations, media, Stars payments, Mini App, LLM chat,
   broadcast, moderation, Bot API 10.4 widgets/rich messages. Recommended:
   `commands` only. Nothing unrequested gets built.
4. **Storage and queue** — options: none, PostgreSQL, PostgreSQL + Redis.
   Recommended: none for commands only; PostgreSQL + queue when any of LLM,
   broadcast, or payments is selected; Redis only for dedupe, rate limits, or
   Mini App sessions.
5. **Locales** — options: `en`; `en` + `ru`; `en` + `ru` + `zh`. Recommended: `en`,
   plus `ru` when the audience is Russian-speaking.
6. **Payments** (only if payments were selected) — product ids, titles, one-line
   descriptions, price in Stars (1–10000), one-time or subscription, refund and
   support text. Recommended: one one-time product.
7. **Deployment** — options: webhook behind a domain, or long polling.
   Recommended: webhook in production, polling locally; port `8080` unless taken.

Never ask for a token, webhook secret, API key, or password in chat. Tell the
owner to put them in `.env` or a `*_FILE` after the bot exists.

### Answer to BotSpec mapping

| Answer                        | BotSpec field                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (fixed)                       | `schemaVersion`: `"bot-spec-1.1.0"`                                                                                                                           |
| Display name, slug            | `name` (lowercase `[a-z][a-z0-9_]{1,63}`), `displayName` (≤128)                                                                                               |
| Stack                         | `stack`: `grammy` or `aiogram`                                                                                                                                |
| Features                      | `features`: non-empty list that always contains `commands`; others from `llm`, `inline`, `payments`, `miniapps`, `moderation`, `broadcast`, `widgets`, `rich` |
| Storage                       | `storage.postgres`, `storage.redis` (booleans)                                                                                                                |
| Queue                         | `runtime.queue`: `postgres` or `none`; forced to `postgres` when `llm`, `broadcast`, or `payments` is present                                                 |
| Admins, allowlist, rate limit | `security.adminAllowlist`, `security.rateLimit`; `security.webhookSecret` and `security.idempotency` stay `true`                                              |
| Locales                       | `i18n.defaultLocale`, `i18n.en`, `i18n.ru`, `i18n.zh`                                                                                                         |
| Payments                      | `payments.products[]`: `id` (≤32), `title` (≤32), `description` (≤255), `stars` (1–10000), `subscription`                                                     |
| Mini App                      | `miniapps.sessionTtlSeconds` (300–2592000), `miniapps.allowedOrigins` (canonical `https://` origins)                                                          |
| Telemetry                     | `runtime.telemetry.otlp`, `.prometheus`, `.sentry`                                                                                                            |
| Deploy                        | `deployment` is the constant `"docker"`                                                                                                                       |

Not BotSpec fields, still needed for the build: `frameworkVersion` / `runtimeVersion`
come from `telegram_bot_target_resolve` (grammY 1.46.0 on Node ≥24.9.0, aiogram
3.31.0 on Python 3.11–3.14); transport (`webhook` or `polling`), `deploy.domain`,
and `deploy.port` live in env config and the deployment files. Say so instead of
inventing spec fields.

### Assumptions

Write one `assuming:` line per unresolved choice, immediately after the summary,
for example:

```text
assuming: single locale en
assuming: PostgreSQL for state, no Redis
assuming: webhook on bot.example.com, port 8080
assuming: no admin commands
```

Each line is a decision the owner can veto in one word. Never leave an assumption
implicit, and never turn one into a feature the owner did not ask for.

## Gotchas

- "A bot like X" is not a spec. Ask what X does that the owner wants, then map it
  to `features`.
- A path, a language, or a host OS is not a stack decision. Ask, or keep the
  existing project's stack.
- Selecting `llm`, `broadcast`, or `payments` silently forces PostgreSQL and a
  queue. Tell the owner that cost before they confirm.
- Empty `ADMIN_IDS` means no admins, not all admins. Confirm who is an admin.
- `callback_data` is user-controlled and limited to 64 bytes; never plan
  authorization or long state into it.
- Bot API 10.4 (widgets, ephemeral replies) needs a raw adapter on both SDKs. Say
  that before promising native support.
- Do not paste a draft project tree or sample code into the questions. It biases
  the answers and skips the confirmation gate.

## Sources

- https://core.telegram.org/bots/features
- https://core.telegram.org/bots/api
- https://core.telegram.org/bots/webapps
- https://core.telegram.org/bots/payments-stars
