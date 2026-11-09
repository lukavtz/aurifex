---
description: Run Telegram bot discovery, then scaffold with Aurifex tools
argument-hint: <destination> [grammy|aiogram]
allowed-tools: telegram_bot_target_resolve, telegram_bot_scaffold
---

# /aurifex-new

Create a new bot project using the Aurifex core. Do not write implementation files
directly; the scaffold tool owns generation. Discovery happens before
`telegram_bot_scaffold`: asking the material questions and confirming the spec is
the first step, and the tool call is the last one.

1. Run the discovery gate from `skills/telegram-bot-discovery` before `telegram_bot_scaffold`.
   Ask every still-unknown material question in one compact message: goal and
   audience, name/destination, stack preference, features, storage, locales, admin
   IDs, payment products, broadcast, LLM, Mini App, deployment, and whether an
   existing project must be preserved. Propose a default for each; never ask for a
   real token or secret in chat.
2. Do not scaffold until the user answers or explicitly accepts the defaults.
   Summarize the requested bot and show every `assuming:` value. Never infer the
   stack or material fields. Get confirmation for a materially incomplete answer. A one-line idea, a directory, or a stack
   name does not answer the other questions.
3. Parse `$ARGUMENTS` as optional `<destination> [grammy|aiogram]`. Treat both as
   hints only, never as answers: if the stack is absent, ask for it. Never infer the
   stack from the destination, the repository language, or a default.
4. Call `telegram_bot_target_resolve` with the chosen stack. Report the framework
   version, runtime constraint, and tested Bot API version. If a 10.4-only feature
   is needed, mention the raw adapter and continue.
5. Build a `BotSpec` from the confirmed answers:
   - `commands` non-empty;
   - `security.webhookSecret` true;
   - storage/queue/runtime only where the selected features require them;
   - locale flags from the answer, not a fake default;
   - payment products when `payments` is selected;
   - Mini App origins/TTL when `miniapps` is selected.
6. Validate the spec before calling the tool.
7. Call `telegram_bot_scaffold` with `{ destination, spec }`. Do not pass
   `overwrite` unless the user explicitly asked to overwrite.
8. On success, report:
   - the project root;
   - the file count and every returned relative path;
   - the exact `nextSteps` strings;
   - the `specHash`.
9. On error, report the error code and `details`. Do not create files by hand as a
   fallback.

Never print a token or a secret. Never execute project code. Never call Telegram.
