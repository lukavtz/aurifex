---
description: Scaffold a production Telegram bot with Aurifex tools
argument-hint: <destination> [grammy|aiogram]
allowed-tools: telegram_bot_target_resolve, telegram_bot_scaffold
---

# /aurifex-new

Create a new bot project using the Aurifex core. Do not write implementation files
directly; the scaffold tool owns generation.

1. Parse `$ARGUMENTS` as `<destination> [grammy|aiogram]`. Default stack is
   `grammy`. If the destination is missing, ask for it and stop.
2. Call `telegram_bot_target_resolve` with the stack. Report the framework version,
   runtime constraint, and tested Bot API version. If the user needs a 10.4-only
   feature, mention the raw adapter path and do not block the scaffold.
3. Build a `BotSpec` with:
   - `name` derived from the destination directory;
   - `commands` non-empty;
   - `security.webhookSecret`, `security.adminAllowlist`, `security.rateLimit`, and
     `security.idempotency` all true;
   - the stack's default features.
     Validate it before calling the tool.
4. Call `telegram_bot_scaffold` with `{ destination, spec }`. Do not pass
   `overwrite` unless the user explicitly asked to overwrite.
5. On success, report:
   - the project root;
   - the file count and every returned relative path;
   - the exact `nextSteps` strings;
   - the `specHash`.
6. On error, report the error code and `details`. Do not create files by hand as a
   fallback.

Never print a token or a secret. Never execute project code. Never call Telegram.
