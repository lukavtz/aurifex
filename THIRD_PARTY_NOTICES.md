# Third-party notices

Aurifex contains original text informed by the projects below. Bundled scripts are named
explicitly; everything else was rewritten for this package. Each upstream license is
reproduced or referenced at its repository.

## telegram-engineering

- Repository: https://github.com/Ikhdev1/telegram-engineering
- Release: `v3.0.0` (Bot API 10.3 snapshot, 2026-08-24)
- License: none declared in the upstream repository at the referenced release.
- Adapted into: `skills/telegram-bot/`, `skills/telegram-bot-sources/`,
  `skills/telegram-bot-stack-choice/`, `skills/telegram-bot-recipes/`,
  `skills/telegram-bot-failures/`, `skills/telegram-bot-api/`,
  `skills/telegram-bot-api-104/`, `skills/telegram-security/`,
  `skills/telegram-testing/`, `skills/telegram-deploy/`,
  `skills/telegram-payments/`, `skills/telegram-mini-apps/`.
- What was adapted: the mode router, the hard-rules list (identity from the update,
  authority from storage, idempotent updates, business state in a database, outbox
  delivery, immediate callback acknowledgement, untrusted text is not markup, secrets in
  the environment, no invented methods, preserve the project stack), the L0–L3 evidence
  scale, the failure catalogue structure, the delivery and limits references, and the
  audit rubric. All prose was rewritten in English and updated from Bot API 10.3 to 10.4.
- Bundled verbatim as offline helpers, with the repository's plain attribution:
  `skills/telegram-bot-api/scripts/tg_text.py` (HTML/MarkdownV2 escaping, length, split),
  `skills/telegram-bot-api/scripts/telegram_payload.py` (payload validation), and
  `skills/telegram-bot-sources/scripts/tg_docs.py` (official documentation lookup with a
  local cache). These scripts are standard-library-only and run offline except for the
  documentation fetch.
- No upstream license file is present. If this material is redistributed outside the
  project, confirm permission with its owner first. The reference clone under `raw/` is
  not part of the published package.

## agentskills.io

- Source: https://agentskills.io
- License: not applicable; these are published authoring practices, not code.
- Adapted into: every `skills/*/SKILL.md` and `tools/check-skills.mjs`.
- What was adapted: the structural rules — `SKILL.md` under 500 lines, progressive
  disclosure into `references/`, a procedure-first body, a dedicated gotchas section, and
  a verification loop that closes with an observable check. No text was copied; the rules
  are applied and enforced by the repository checker.

## telegram-bot-skills

- Repository: https://github.com/nzhulikov/telegram-bot-skills
- License: Apache License 2.0
- Adapted into: `skills/telegram-bot-api/`, `skills/telegram-bot-api-104/`,
  `skills/telegram-security/`, `skills/telegram-testing/`,
  `skills/telegram-payments/`, `skills/telegram-mini-apps/`,
  `skills/telegram-deploy/`.
- What was adapted: language-agnostic coverage of Bot API method families, update
  delivery, security, payments, Mini Apps, and operational limits, rewritten and
  condensed for this package.

## telegram-bot-development-skill

- Repository: https://github.com/nyxandro/telegram-bot-development-skill
- License: MIT
- Adapted into: `skills/telegram-security/`, `skills/telegram-testing/`,
  `skills/telegram-deploy/`, `skills/telegram-payments/`,
  `skills/telegram-mini-apps/`, `skills/telegram-bot-failures/`, and
  `prompts/review-bot.md`.
- What was adapted: the freshness workflow, update delivery invariants, security and
  privacy checklist, Stars payment rules, Mini App `initData` validation, and the
  pre-release review checklist, rewritten for Aurifex.

## telegram-skills

- Repository: https://github.com/serejaris/telegram-skills
- License: MIT
- Adapted into: `skills/telegram-bot-api-104/SKILL.md` and
  `skills/telegram-bot-api-104/references/methods-104.md`.
- What was adapted: widget constraints and delivery behavior, widget query lifecycle, and
  rich-message composition notes, verified against the official Bot API 10.4 page and
  rewritten.

## grammY

- Repository: https://github.com/grammyjs/grammY
- License: MIT
- Adapted into: `skills/grammy/SKILL.md`, `skills/telegram-bot-api-104/SKILL.md`,
  `skills/telegram-bot-failures/SKILL.md`.
- What was adapted: Bot API client usage, webhook callback options (`secretToken`,
  `timeoutMilliseconds`, `onTimeout`), the raw API proxy and transformer signatures, and
  the `BOT_INFO` requirements. Examples are original and minimal.

## aiogram

- Repository: https://github.com/aiogram/aiogram
- License: MIT
- Adapted into: `skills/aiogram/SKILL.md`, `skills/telegram-bot-api-104/SKILL.md`,
  `skills/telegram-testing/SKILL.md`.
- What was adapted: dispatcher and router patterns, middleware ordering,
  `SimpleRequestHandler` webhook integration, `dp.feed_update` test entry, and the
  `TelegramMethod` raw-call pattern. Examples are original and minimal.

## Telegram Bot API documentation

- Source: https://core.telegram.org/bots/api
- Used as the primary factual source for Bot API 10.4 methods, classes, limits, and field
  names. Telegram documentation is not a third-party code license; method and field names
  are factual and are used descriptively.

## Notes

- No code from a repository without a license is vendored except the three scripts named
  above, which are bundled with explicit attribution and a stated license status.
- Reference clones under `raw/` are ignored by git and are not part of the published
  package.
- Upstream licenses remain in effect for their respective material. Aurifex's own code
  and text are licensed under the repository's MIT license.
