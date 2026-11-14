---
name: telegram-bot-recipes
description: Use when writing the actual bot code: commands, inline buttons, conversations, media, groups, admin, payments, Mini Apps, LLM answers, broadcast. Русские триггеры: написать код бота, инлайн кнопки, сцены, загрузка файлов, админка, рассылка.
---

# Telegram bot recipes

This skill turns a confirmed `BotSpec` into working code for exactly the requested
features. It owns the build order, the canonical file layout, and one recipe per
user-facing surface. It does not own API limits, deployment, security policy, or
the 10.4 method table; those live in sibling skills and are linked from each
recipe.

Read [`references/project-layout.md`](references/project-layout.md) before creating the first file. Read exactly
the recipe files for the features in the confirmed spec, not the whole set.

## Procedure

### 1. Confirm the input

Read `../telegram-bot/SKILL.md` for the hard rules and
`../telegram-bot-discovery/SKILL.md` for the interview. Do not write code until
`BotSpec` is confirmed: stack, requested features, storage, locales, payment
products. If the user asked for inline buttons, build inline buttons and nothing
else; every unrequested screen is scope creep.

Read [`references/project-layout.md`](references/project-layout.md) now. It is the only place that enumerates
paths for both stacks, and it fixes the module boundaries: one entrypoint, thin
handlers, business logic in services, all SQL in one place, configuration from
the environment only.

### 2. Build the main path first

Write one vertical slice, end to end, before any breadth:

```
update -> handler -> business operation -> database -> visible result
```

The slice must be runnable and observable: the user presses the primary action,
the database changes, the chat shows a result. No settings screen, no admin panel,
no placeholder menus before this path works.

### 3. Then settings and admin

Only for the sections the spec asks for. Settings show current values and validate
input; admin actions re-check the actor's role server-side on every press.

### 4. Then background work

Queue, worker, broadcast, scheduled jobs, LLM streaming. Background work never
runs inside a webhook handler and always has a durable record before the transport
is acknowledged.

### 5. Verify before reporting

Run `aurifex verify` (or the `verify` CLI command) over the project and fix every
`fail`. Static verification does not run code, so also run the project's own tests.
Read `../telegram-testing/SKILL.md` for the scenario matrix.

### Which reference to read

The reference files are the only place in this skill with code snippets. Each one
has the same shape: goal, when to read it, steps, code for grammY/TypeScript and
aiogram/Python, and a verification step.

| The spec asks for                                              | Read                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| Any file, any new module, choosing where code goes             | [`references/project-layout.md`](references/project-layout.md) |
| `/start`, `/help`, command menu, deep links, command scopes    | [`references/commands.md`](references/commands.md)             |
| Inline keyboards, callback handling, pagination, stale buttons | [`references/inline-buttons.md`](references/inline-buttons.md) |
| Multi-step forms, FSM, scenes, cancel/back                     | [`references/conversations.md`](references/conversations.md)   |
| Photos, documents, voice, albums, downloads, `file_id` reuse   | [`references/media.md`](references/media.md)                   |
| Groups, topics, membership events, ephemeral replies           | [`references/groups.md`](references/groups.md)                 |
| Owner, roles, privileged actions, audit, confirmation          | [`references/admin.md`](references/admin.md)                   |
| Stars invoice, pre-checkout, fulfilment                        | [`references/payments.md`](references/payments.md)             |
| Mini App launch, `initData` validation, session, `sendData`    | [`references/mini-apps.md`](references/mini-apps.md)           |
| Model answers, streaming drafts, output neutralization         | [`references/llm.md`](references/llm.md)                       |
| Mass messaging, rate control, opt-out, resume                  | [`references/broadcast.md`](references/broadcast.md)           |
| Widgets, rich messages, ephemeral API, TON, themes, gifts      | [`references/bot-api-104.md`](references/bot-api-104.md)       |

### Ownership boundaries

Do not restate another skill's content; link to it instead.

- API limits, text escaping, splitting, payload validation: `../telegram-bot-api/SKILL.md`.
- Bot API 10.4 method table and raw-adapter fields: `../telegram-bot-api-104/SKILL.md`.
- Security rubric and audit patterns: `../telegram-security/SKILL.md`.
- Polling/webhook operation, shutdown, backup: `../telegram-deploy/SKILL.md`.
- Test scenarios and fixtures: `../telegram-testing/SKILL.md`.
- Framework quirks (`BOT_INFO`, transformers, `feed_update`, middleware order):
  `../grammy/SKILL.md` and `../aiogram/SKILL.md`.
- Which stack and storage to pick: `../telegram-bot-stack-choice/SKILL.md`.
- Fetching current facts: `../telegram-bot-sources/SKILL.md`.

### Code rules that apply to every recipe

1. Actor identity comes from the update (`from.id`), never from callback text,
   display name, or a value the client can set.
2. Authorization is read from storage on every action. A visible button is not a
   permission.
3. Every state-changing handler is idempotent under a repeated update.
4. Business state lives in the database, not in memory.
5. Side effects that must survive a restart go through a durable outbox or queue.
6. Secrets come from environment variables and never appear in code, logs, or
   callback payloads.

## Gotchas

- Handlers grow fat because each feature adds validation inline. Put validation
  and SQL in the service layer from the first slice; retrofitting it after three
  features costs a rewrite.
- Following the layout table is not optional. The verifier looks for these exact
  modules: a renamed queue worker makes the feature invisible, and a missing file
  can pass as "not configured" while the code exists elsewhere.
- The reference files contain snippets, not a framework. Copy the shape, adapt
  names, keep the boundaries.
- Background code that is never imported is dead code. Register the worker,
  the middleware, and the queue consumer in the entrypoint in the same change
  that creates them.
- An LLM or webhook timeout multiplied by a retry turns one user action into
  several paid calls. Persist the operation before calling anything slow.
- Verification is static. Passing `verify` means the required artefacts exist,
  not that the bot works; the project's tests and one real chat still decide.

## Sources

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram Bot features and scopes: https://core.telegram.org/bots/features
- grammY documentation: https://grammy.dev/guide/
- aiogram documentation: https://docs.aiogram.dev/en/latest/
