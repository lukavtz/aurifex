---
name: telegram-bot-discovery
description: Use when creating or materially changing a Telegram bot, before scaffolding or adding a feature. Ask the material product questions first, then confirm a BotSpec.
---

# Telegram bot discovery

Do not scaffold, add a feature, or write bot code until the material answers are
known. A destination path, a stack name, or a one-line idea is not an answer to the
rest. Ask once, in one compact message. Do not interrogate the user one line at a
time.

## Questions to ask

Ask only what is still unknown. Offer a default for each question.

1. **Goal** — what should the bot do, who uses it, and what does success look like?
2. **Name and directory** — display name and destination path.
3. **Stack** — TypeScript + grammY, or Python + aiogram? Preserve an existing stack
   when the user already has a project.
4. **Features** — commands, inline, LLM chat, Stars payments, Mini App, moderation,
   broadcast, Bot API 10.4 widgets, rich messages.
5. **Storage** — Postgres and Redis are required by queue, payments, dedupe, rate
   limits, and Mini App sessions. Do not silently enable them.
6. **Localization** — default locale and enabled `en`, `ru`, `zh`.
7. **Access control** — admin numeric IDs, whether an allowlist is needed, and who
   may use admin commands.
8. **Payments** — product ids, titles, descriptions, price in Stars, one-time or
   subscription, support text, refund policy.
9. **Broadcast** — audience, expected size, frequency, and whether users opted in.
10. **LLM** — provider/base URL, model, key source, and whether prompts must be
    stored or logged (default: neither).
11. **Mini App** — URL/origin, session lifetime, and whether authentication is
    required.
12. **Deployment** — domain, webhook or polling, and whether Docker Compose on a VPS
    is the target.
13. **Existing project** — repository path, current stack, and whether files must be
    preserved.

Never ask for a real token, webhook secret, API key, or password in chat. Tell the
user to put them in `.env` or `*_FILE` after generation.

## Confirmation gate

Before calling `telegram_bot_scaffold` or `telegram_bot_add_feature`:

- summarize the requested behavior in one paragraph;
- confirm the proposed spec fields that affect generated code;
- list any assumption with the word `assuming:`;
- confirm the proposed spec (`BotSpec`) with the user;

Only after confirmation call `telegram_bot_target_resolve`, then
`telegram_bot_scaffold`. Use `telegram_bot_add_feature` for one feature at a time.

## Defaults that are safe to propose

- TypeScript + grammY for a new Node/TypeScript project; Python + aiogram for an
  existing Python service.
- Docker Compose + Caddy; webhook in production, polling locally.
- Postgres for durable state; Redis only when dedupe, rate limiting, queue, or
  Mini App sessions are enabled.
- `en` default, `ru` enabled when the audience is Russian-speaking.
- Admin commands restricted by numeric `ADMIN_IDS`.
- LLM prompts and answers never logged.

Anything outside these defaults is the user's decision, not an inference.

## Sources

Authored for Aurifex. The question set follows the `BotSpec` contract in
`docs/SPEC.md` and `schema/bot-spec-1.1.schema.json`, so every answer maps to a
field that changes generated code.
