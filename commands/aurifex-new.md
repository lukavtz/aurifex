---
description: Run Telegram bot discovery, then build the bot from the Aurifex skills and verify it
argument-hint: [grammy|aiogram] [goal]
allowed-tools: mcp__plugin_aurifex_aurifex__telegram_bot_target_resolve, mcp__plugin_aurifex_aurifex__telegram_bot_inspect, mcp__plugin_aurifex_aurifex__telegram_bot_verify
---

# /aurifex-new

Build a new Telegram bot from knowledge, not from a generator. You write every file;
the Aurifex tools answer questions and prove the result.

1. Read `skills/telegram-bot` and `skills/telegram-bot-stack-choice` first.
2. Run the discovery gate from `skills/telegram-bot-discovery`: ask every still-unknown material
   question in one compact message — goal and audience, stack, the exact features the user wants
   (inline buttons, scenes, media, payments, Mini App, LLM answers, broadcast), storage, locales,
   admin ids, and whether an existing project must be preserved. Propose a recommended value for
   each question. Never ask for a real token or secret in chat.
3. Do not write code until the user answers or explicitly accepts the defaults.
4. Call `telegram_bot_target_resolve` for the confirmed stack and record the pinned versions.
5. Summarize the bot, list every `assuming:` value, and get confirmation of the proposed BotSpec.
6. After confirmation, build exactly the confirmed features, following
   `skills/telegram-bot-recipes` for the layout and the per-feature procedures. Do not add features
   nobody asked for. Confirm method names and limits with `skills/telegram-bot-sources` instead of
   memory.
7. Run `telegram_bot_verify` and fix every `fail` finding. Report the check summary.
