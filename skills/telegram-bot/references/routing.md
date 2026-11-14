# Routing table

Signal on the left, skills on the right. Read the skills in the order listed; the
first one sets the scope, the rest supply detail. Every name below is a directory
under `skills/`; read its `SKILL.md`.

## By mode

| Signal in the request                                                  | Read in order                                                                                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "make me a bot", "сделай бота", empty repository                       | `telegram-bot-discovery` → `telegram-bot-stack-choice` → `telegram-bot-recipes` → framework skill → `telegram-security` → `telegram-testing` → `telegram-deploy` |
| Existing repo, one feature to add                                      | framework skill → `telegram-bot-recipes` → `telegram-bot-failures` if it is a fix                                                                                |
| "review", "audit", "готов ли к запуску"                                | `telegram-security` → `telegram-bot-failures` → `telegram-testing`                                                                                               |
| "format this post", escaping, HTML/MarkdownV2, a table in a message    | `telegram-bot-api`                                                                                                                                               |
| Assistant, model, streaming, prompts, quotas                           | `telegram-bot-recipes` (LLM section) → `telegram-bot-api` (drafts, limits) → `telegram-security`                                                                 |
| Moderation, topics, join requests, channel rights, ephemeral replies   | `telegram-bot-recipes` (groups/admin) → `telegram-security`                                                                                                      |
| Stars, subscription, refund, paid access                               | `telegram-payments` → `telegram-bot-api` (limits)                                                                                                                |
| Web UI inside Telegram, `initData`, CloudStorage                       | `telegram-mini-apps` → `telegram-security`                                                                                                                       |
| Webhook, polling, Docker, VPS, "bot went silent"                       | `telegram-deploy` → `telegram-bot-failures`                                                                                                                      |
| "how many characters", "does method X exist", "which version"          | `telegram-bot-sources`                                                                                                                                           |
| Bot API 10.4 widgets, rich messages, TON, share themes, gifts          | `telegram-bot-api-104` → `telegram-bot-api`                                                                                                                      |
| "which framework", "grammY or aiogram", "do I need Redis"              | `telegram-bot-stack-choice` → `telegram-bot-discovery`                                                                                                           |
| Duplicated messages, dead buttons, failed payment, `initData` rejected | `telegram-bot-failures`                                                                                                                                          |

## By artifact the agent must produce

| Artifact                           | Skill that defines its shape |
| ---------------------------------- | ---------------------------- |
| Confirmed `BotSpec`                | `telegram-bot-discovery`     |
| Stack and runtime decisions        | `telegram-bot-stack-choice`  |
| Project layout and feature slice   | `telegram-bot-recipes`       |
| Bot API payload and text           | `telegram-bot-api`           |
| 10.4 raw call                      | `telegram-bot-api-104`       |
| grammY wiring                      | `grammy`                     |
| aiogram wiring                     | `aiogram`                    |
| Payment flow                       | `telegram-payments`          |
| Mini App session                   | `telegram-mini-apps`         |
| Runtime and delivery               | `telegram-deploy`            |
| Security findings with `file:line` | `telegram-security`          |
| Test scenarios                     | `telegram-testing`           |
| Symptom diagnosis                  | `telegram-bot-failures`      |
| Verified API fact                  | `telegram-bot-sources`       |

## Secondary skills by mode

A mode always has a framework skill behind it:

| Framework in the project                        | Framework skill                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| TypeScript, Node, Bun                           | `grammy`                                                         |
| Python                                          | `aiogram`                                                        |
| python-telegram-bot or Telegraf already present | keep it; `telegram-bot-api` for contract details, do not migrate |

## Ordering rules

1. `telegram-bot-discovery` runs before any code for a new bot or a material change.
2. `telegram-bot-sources` runs before a claim about a method, field, limit, or SDK
   version. A memory-based answer is L0 and must be labelled unverified.
3. `telegram-bot-failures` runs before speculative refactoring: find the row, apply
   the fix, run the stated check.
4. `telegram-security` runs for any change that touches authorization, payments,
   `initData`, admin commands, or secrets.
5. `telegram-testing` last, so the tests describe behavior that actually exists.

## When two skills disagree

The owner wins:

| Topic                                | Owner                   |
| ------------------------------------ | ----------------------- |
| Limits, escaping, payload validation | `telegram-bot-api`      |
| Delivery, webhook lifecycle, backup  | `telegram-deploy`       |
| Security rubric and `rg` battery     | `telegram-security`     |
| Bot API 10.4 methods and fields      | `telegram-bot-api-104`  |
| Failure symptoms and fixes           | `telegram-bot-failures` |
| Framework registration and types     | `grammy`, `aiogram`     |
| Project layout and feature recipes   | `telegram-bot-recipes`  |
| Fact acquisition procedure           | `telegram-bot-sources`  |
