---
name: telegram-bot
description: "Use when any Telegram bot work starts: build, review, fix, deploy, or answer a Bot API question. Routes to the right skill and states the hard rules. Русские триггеры: телеграм-бот, бот в телеге, кнопки в боте, мини-приложение, оплата звёздами."
---

# Telegram bot — router

This skill is the entry point. It classifies the request, names the skills to read,
and states the rules that hold in every mode. It does not contain recipes, limits,
or framework syntax; those live in the named skills.

Current baselines: **Bot API 10.4** (released 2026-11-09), **grammY 1.46.0**,
**aiogram 3.31.0**. Both SDKs are typed only up to Bot API 10.3, so 10.4 surfaces go
through a typed raw adapter. If a fact about a method, field, limit, or SDK behavior
matters, confirm it with `telegram-bot-sources` instead of recalling it.

## Procedure

### 1. Classify the request into one mode

Read the request and, when a repository is present, read the code before answering.
Pick one primary mode; mixed requests combine modes but keep one primary.

| Mode                | Signals                                      | Then read                                                                       |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| New bot             | "make a bot", no code yet, empty repo        | `telegram-bot-discovery` → `telegram-bot-stack-choice` → `telegram-bot-recipes` |
| Edit existing bot   | a repo or file, an error, one new feature    | the code first, then `telegram-bot-recipes` and the framework skill             |
| Review / audit      | "check", "audit", "is it ready"              | `telegram-security`, then `telegram-bot-failures` for concrete defects          |
| Text / formatting   | "format this post", HTML, MarkdownV2, tables | `telegram-bot-api` (escaping, limits, payload helpers)                          |
| AI / LLM bot        | assistant, model, streaming, prompts         | `telegram-bot-recipes` (LLM section) + `telegram-bot-api`                       |
| Groups and channels | moderation, topics, join requests, ephemeral | `telegram-bot-recipes` (groups/admin) + `telegram-security`                     |
| Payments            | Stars, subscription, refund, digital goods   | `telegram-payments`                                                             |
| Mini App            | web UI inside Telegram, initData             | `telegram-mini-apps` + `telegram-security`                                      |
| Deploy / delivery   | webhook, polling, Docker, VPS, incident      | `telegram-deploy`                                                               |
| API fact question   | "how many characters", "does method X exist" | `telegram-bot-sources`, answer with a source                                    |

Full signal table, including secondary skills per mode: [references/routing.md](references/routing.md).

### 2. Follow the named skills in order

Read a skill before designing the part it covers, not after. When two skills touch
the same topic, the owner wins: limits and escaping in `telegram-bot-api`, delivery
in `telegram-deploy`, security rubric in `telegram-security`, Bot API 10.4 in
`telegram-bot-api-104`, failures in `telegram-bot-failures`, framework specifics in
`grammy` and `aiogram`.

### 3. Gate: no code before the answers

For a new bot or a material change, do not scaffold, add a feature, or write bot
code before the discovery questions are answered and the proposed `BotSpec` is
confirmed by the user. Ask once, in one compact block, with a recommended value for
each question. Record every assumption as `assuming: ...`. Ask what exactly is
needed (inline buttons, scenes, media, payments, Mini App) so the build contains
only the requested functions.

For a short factual question, answer directly with a source; no questionnaire.

### 4. Build only the requested slice

Build the main path first: update → handler → business operation → database →
visible result. Add settings, admin screens, and edge cases after. Do not add
features the user did not ask for.

### 5. Verify and report

Prove behavior with the checks named in `telegram-testing`. Label every claim with
its evidence level. Report with the handoff template in [references/hard-rules.md](references/hard-rules.md)
so the user sees files, run steps, roles, what was checked, and what remains.

## The 12 hard rules

These hold in every mode. Each one, with a counter-example, is in
[references/hard-rules.md](references/hard-rules.md).

1. Identity comes only from the update object (`from.id`, verified `initData`).
2. Authorization comes only from stored data, never from the update. `callback_data`,
   text, username, a hidden menu, or a command scope are not credentials. The owner
   is a numeric ID from trusted configuration, not the first `/start`.
3. Every update is idempotent: dedupe `(bot_id, update_id)` plus a domain key.
   Confirm the offset or a 2xx only after a durable commit.
4. Conversation state lives in a database, not in process memory. Concurrent
   transitions use a transaction conditioned on a version or a lock.
5. Telegram and the database are not atomic: outbound work goes through an outbox
   with retries. Never promise exactly-once delivery.
6. Call `answerCallbackQuery` immediately on every branch, including refusal and a
   stale button. An ACK is not proof that the operation succeeded.
7. Render user text only through the escaper of the target parse mode.
8. Untrusted text never becomes markup: text from a user, a model, or a document
   never turns into tags, buttons, links, or mentions.
9. Secrets (token, webhook secret, API keys, sessions) come only from the
   environment. Never ask for them in chat and never log a Bot API URL with a token.
10. Rendering has no side effects: a render or formatting function does not send
    messages, mutate state, or charge anything.
11. Never invent a Bot API method, field, or limit. Confirm it against the contract
    and the installed SDK; without a check, label the claim unverified.
12. Preserve the project's existing stack. Add Redis, queues, Mini App, an admin
    web UI, or multi-tenancy only when a real requirement needs it.

## Evidence scale

Every factual claim in a report carries a level:

| Level | Meaning                                                                                                        | Example wording                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| L0    | Model memory or plain documentation; nothing was run                                                           | "By memory, `sendMessage` is 4096 characters"                                |
| L1    | Static check: SDK typings, SDK source at the pinned version, official contract page, offline payload validator | "`sendRichMessage` is in the 10.4 contract and in the project's raw adapter" |
| L2    | Local execution: tests with the real dispatcher and a temporary database, no Telegram                          | "A repeated update writes one row; test passes"                              |
| L3    | Live Telegram: a test bot and chat, visible result in a client                                                 | "The table and buttons are visible in the Android client"                    |

Rule: a claim without L1 or higher is labelled **unverified**. L2 does not mean "works
in Telegram"; a live API and client view stay unverified without a test bot. Say so
explicitly.

## Gotchas

- **There are no tables in ordinary Telegram messages.** `sendMessage` renders plain
  text with a parse mode, not a layout. For a table use a rich message
  (`sendRichMessage`) or an aligned monospace block; do not fake a grid with spaces
  in proportional text.
- **The first `/start` must not confer ownership.** Anyone can press start first.
  Seed the owner from `ADMIN_IDS` in trusted configuration and verify it.
- **`callback_data` is not authorization.** It is user-controlled input, capped at 64
  bytes. It selects what to do; it never proves who may do it.
- **A status message is not a result.** "Queued" or "ACK sent" is not the business
  outcome. Report the outcome the user can see.
- **A file that exists is not a file that runs.** Framework registration differs;
  check that middleware and handlers are actually attached to the dispatcher/router.
- **The newest docs are not the installed SDK.** Telegram docs describe 10.4 while
  grammY 1.46.0 and aiogram 3.31.0 are typed to 10.3.

## Sources

- Bot API reference and changelog: https://core.telegram.org/bots/api and https://core.telegram.org/bots/api-changelog
- Bot features and surfaces: https://core.telegram.org/bots/features
- grammY documentation and releases: https://grammy.dev/ and https://github.com/grammyjs/grammY/releases
- aiogram documentation and releases: https://docs.aiogram.dev/en/latest/ and https://github.com/aiogram/aiogram/releases
- Adapted from the internal `telegram-engineering` knowledge base (Bot API 10.3 snapshot, upgraded to 10.4 here). See `THIRD_PARTY_NOTICES.md`.
