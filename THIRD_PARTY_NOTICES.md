# Third-party notices

Aurifex contains original text informed by the projects below. No source code is
vendored from them unless stated. Each upstream license is reproduced or referenced
at its repository; this file records attribution for adapted material.

## telegram-bot-skills

- Repository: https://github.com/nzhulikov/telegram-bot-skills
- License: Apache License 2.0
- Adapted into: `skills/telegram-bot-api/`, `skills/telegram-bot-api-104/`,
  `skills/telegram-security/`, `skills/telegram-testing/`,
  `skills/telegram-payments/`, `skills/telegram-mini-apps/`, and
  `skills/telegram-deploy/`.
- What was adapted: language-agnostic coverage of Bot API method families,
  update delivery, security, payments, Mini Apps, and operational limits,
  rewritten and condensed for this package.

## telegram-bot-development-skill

- Repository: https://github.com/nyxandro/telegram-bot-development-skill
- License: MIT
- Adapted into: `skills/telegram-security/`, `skills/telegram-testing/`,
  `skills/telegram-deploy/`, `skills/telegram-payments/`,
  `skills/telegram-mini-apps/`, and `prompts/review-bot.md`.
- What was adapted: the freshness workflow, update delivery invariants,
  security and privacy checklist, Stars payment rules, Mini App `initData`
  validation, and the pre-release review checklist, rewritten for Aurifex.

## telegram-skills

- Repository: https://github.com/serejaris/telegram-skills
- License: MIT
- Adapted into: `skills/telegram-bot-api-104/SKILL.md` and
  `skills/telegram-bot-api-104/references/methods-104.md`.
- What was adapted: widget constraints and delivery behavior, widget query
  lifecycle, and rich-message composition notes, verified against the official
  Bot API 10.4 page and rewritten.

## grammY

- Repository: https://github.com/grammyjs/grammY
- License: MIT
- Adapted into: `skills/grammy/SKILL.md`, `skills/telegram-bot-api-104/SKILL.md`.
- What was adapted: Bot API client usage, webhook callback options
  (`secretToken`, `timeoutMilliseconds`, `onTimeout`), and the raw API proxy
  pattern. Examples are original and minimal.

## aiogram

- Repository: https://github.com/aiogram/aiogram
- License: MIT
- Adapted into: `skills/aiogram/SKILL.md`, `skills/telegram-bot-api-104/SKILL.md`.
- What was adapted: dispatcher and router patterns, `SimpleRequestHandler`
  webhook integration, and the `TelegramMethod` raw-call pattern. Examples are
  original and minimal.

## Telegram Bot API documentation

- Source: https://core.telegram.org/bots/api
- Used as the primary factual source for Bot API 10.4 methods, classes, limits,
  and field names. Telegram documentation is not a third-party code license;
  method and field names are factual and are used descriptively.

## Notes

- No code from a repository without a license is vendored.
- Reference clones under `raw/` are ignored by git and are not part of the
  published package.
- Upstream licenses remain in effect for their respective material. Aurifex's
  own code and text are licensed under the repository's MIT license.
