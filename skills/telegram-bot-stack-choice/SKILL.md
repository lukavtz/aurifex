---
name: telegram-bot-stack-choice
description: "Use when choosing a framework, hosting mode, database, queue, or cache for a new Telegram bot, or when asked whether to keep an existing stack. Русские триггеры: что выбрать grammy или aiogram, long polling или webhook, нужна ли база, нужен ли redis."
---

# Stack and runtime choice

Decide seven things, in this order: language and framework, transport, queue,
storage, cache, Mini App, payments. Each has a default; a condition changes it. Record
every choice in the `BotSpec`; do not infer a choice the user did not make.

Pinned versions: **grammY 1.46.0** (TypeScript, Node >= 24.9, Bun) and **aiogram
3.31.0** (Python 3.11-3.14). Both are typed to Bot API 10.3; 10.4 needs a raw adapter.

## Procedure

### 1. Language and framework

Read the surrounding project first. The language of the existing codebase wins.

| Situation                                                         | Default                                                      | Change when                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| Existing TypeScript/Node/Bun project                              | grammY 1.46.0                                                | never; keep the framework already in `package.json` |
| Existing Python project                                           | aiogram 3.31.0                                               | keep `python-telegram-bot` if it is already there   |
| New project, no other code                                        | ask; propose based on the user's stack and deployment target | a team constraint or an existing library decides it |
| Existing project on Telegraf, python-telegram-bot, or another SDK | keep it                                                      | only the user may ask for a migration               |

Never migrate a working bot to another framework as part of an unrelated task. The
migration is a separate decision with its own risk.

If the user has no preference and no surrounding code, ask once: "TypeScript with
grammY, or Python with aiogram?" and state the consequence (Bun/Node toolchain vs
`uv`/venv). Do not pick silently.

### 2. Transport

| Option                      | Use when                                                         | Cost                                                                    |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Long polling (`getUpdates`) | development, a single process, no public HTTPS, a VPS behind NAT | one consumer only; updates buffered 24 h; needs a long-running process  |
| Webhook (`setWebhook`)      | production, a public HTTPS endpoint, serverless                  | HTTPS on 443, 80, 88, or 8443; retries on non-2xx; needs a secret token |

Default: polling for local development, webhook for production. If the host cannot
serve HTTPS on an allowed port, polling is correct, not a compromise.

Hard constraints:

- One consumer per token. Two polling processes, or polling plus a webhook, split or
  duplicate updates; the API returns `409 Conflict`.
- `getUpdates` and a webhook are mutually exclusive. Call `deleteWebhook` before
  switching to polling, and `setWebhook` before switching to a webhook.
- `getWebhookInfo` before switching transport in production, so you see the current
  URL, pending count, and last error.

### 3. Queue

Add a queue when either is true:

- work can outlive the response window (webhook ack, payment confirmation,
  broadcast, media processing, an LLM call longer than a few seconds);
- work must survive a restart (paid delivery, outbox sends, retries with backoff).

Default: no queue for a command-and-reply bot with fast handlers. With a queue, the
handler commits an inbox/outbox row and returns; a worker does the rest. This also
gives you retry and rate-limit control instead of sleeping inside a handler.

### 4. Storage

| Store         | Use when                                                       | Change when                                                       |
| ------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| SQLite (file) | one process, modest write rate, simple deployment              | concurrent writers appear, or more than one instance runs         |
| PostgreSQL    | concurrent writers, multiple instances, queue, payments, audit | never for a toy single-process bot unless the host already has it |

Default: SQLite for a single-process bot, PostgreSQL when the plan includes a
worker, payments, or more than one instance. Durable business state goes in the
database, not in framework FSM memory: FSM in memory dies on restart.

### 5. Cache and Redis

Redis is not a default. Add it only for one of these:

- cross-process dedupe of `update_id`;
- rate limiting shared by instances;
- a queue that needs a broker (rather than a database table);
- Mini App sessions that must be shared between instances.

If none applies, a database table covers dedupe and a simple counter covers rate
limiting. Do not add Redis "for later".

### 6. Mini App

Choose a Mini App only when the interface needs real UI: forms, lists, media, a
canvas, or a multi-screen flow that would be painful as messages.

A Mini App requires: a public HTTPS origin, server-side `initData` validation
(HMAC over key-sorted pairs), a TTL for `auth_date`, a session exchanged for a short
server token, CSP, and no bot token in the bundle. Read `telegram-mini-apps` and
`telegram-security` before building one.

### 7. Payments

Choose Telegram Stars when selling digital goods or services inside Telegram, and
only with the user's product list: title, description, price in Stars, one-time or
subscription, refund policy. Empty product list means no invoice can be created;
ask before wiring payments. `pre_checkout_query` must be answered within 10 seconds
and must fail closed. Read `telegram-payments`.

### 8. Record the decisions

Write the seven choices into the `BotSpec` before code: framework, transport,
queue yes/no, storage, cache yes/no, Mini App yes/no, payments yes/no. Each has a
version or a concrete product appended where it matters. Unanswered questions are
`assuming:` entries, not silent defaults.

## What you must not do

- Do not invent a stack for a project that has one.
- Do not add a database, Redis, a queue, or a worker the user did not approve.
- Do not add features (inline buttons, scenes, media, Mini App, payments, broadcast)
  beyond the request.
- Do not add locales. Default locale plus only the languages the user named.
- Do not invent payment products, prices, or refund terms.

## Gotchas

- **Two consumers on one token steal each other's updates.** A leftover polling
  script next to the production webhook, or a second container, produces random
  "missing update" reports. Confirm exactly one consumer in `getWebhookInfo` and in
  the process list.
- **`setWebhook` with `drop_pending_updates=true` discards the queue.** It is useful
  for cleaning a test bot, never a startup step in production: the updates you drop
  are gone.
- **Middleware registration differs between grammY and aiogram.** A file can exist,
  be imported, and never run because it was never attached to the dispatcher or the
  router. Registration is part of the stack decision, not an afterthought.
- **SQLite with two workers corrupts or locks.** If the plan includes a worker,
  decide PostgreSQL at the same time, not after the first `database is locked`.
- **A webhook needs a public hostname before deploy.** Choosing webhook without a
  domain and a certificate moves the problem, not solves it.
- **Serverless changes the model.** With a serverless host, in-memory state and
  in-process schedulers do not exist; storage and queue choices must be external.

## Sources

- Bot API: updates, webhook, and limits: https://core.telegram.org/bots/api
- Webhook method and parameters: https://core.telegram.org/bots/api#setwebhook
- Bot features and testing: https://core.telegram.org/bots/features
- Mini Apps and `initData`: https://core.telegram.org/bots/webapps
- Stars payments: https://core.telegram.org/bots/payments-stars
- grammY documentation and releases: https://grammy.dev/ and https://github.com/grammyjs/grammY/releases
- aiogram documentation and releases: https://docs.aiogram.dev/en/latest/ and https://github.com/aiogram/aiogram/releases
