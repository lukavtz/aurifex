# Grammy Commands Telegram bot

This is a **reference implementation of the Aurifex skills** for **TypeScript + grammY 1.46.0** — a
complete bot skeleton that the skills describe, kept in the repository as proof that the knowledge
produces a working bot. It is hand-written, it has no `.aurifex/` manifest, and nothing rewrites it.

Bot API target: 10.4. The framework advertises 10.3;
methods added after that version use bot.api.raw.<method>(payload) for methods newer than the framework types.

## Quick start

```bash
cp .env.example .env
# set BOT_TOKEN and WEBHOOK_SECRET
bun install
bun run typecheck
bun test
```

## Features

- `/start` with an inline button, `/help`, and an admin-only `/stats`.
- Callback handling that acknowledges every query before the business logic runs.
- PostgreSQL storage with Drizzle migrations, optional Redis for dedupe and rate limits.
- Webhook and long-polling transports behind one entrypoint.
- A typecheck and a test suite that need no network and no Telegram token.

## Structure

Every directory owns one role, so a file moves only when its role changes.

```
src/
  main.ts      entry: config, telemetry, transport, shutdown
  bot.ts       bot construction and dispatcher wiring
  config.ts    environment parsing and startup validation
  logger.ts    pino logger with secret redaction
  http/        transport and probes: webhook server, /healthz, /readyz, /metrics, secret files
  guard/       admission checks: dedupe, rate limit, admin allowlist, callback ACK, retry
  store/       persistence: Postgres connection and Drizzle schema
  telegram/    typed raw adapter for the Bot API 10.4 methods
  features/    handlers: /start, /help, admin stats
  i18n/        copy for en, ru, zh
tests/         update-boundary tests; no network, no Telegram token
```

## Verifying it

```bash
node dist/cli.js verify examples/grammy_commands --json
```

The verifier runs 29 static checks and reports `"ok": true` with zero failures for this
project. It reads file contents only: no project code is executed, no network call is
made, and no Telegram API is contacted.

## Security

- `.env` is ignored; never commit a bot token.
- Webhook requests require the `X-Telegram-Bot-Api-Secret-Token` header.
- Admin commands use a server-side numeric ID allowlist.
- Update IDs are deduplicated for 24 hours.
- Logs redact tokens, secrets, and authorization headers.

## Deployment

```bash
docker compose up -d --build
```

Terminate TLS at Caddy and call `setWebhook` with the secret from `WEBHOOK_SECRET`.

## Bot API 10.4 (typed raw adapter)

grammY 1.46.0 advertises Bot API 10.3. Bot API 10.4 methods go through
`src/telegram/api104.ts`, a typed adapter over `bot.api.raw`:

- `sendWidget` / `sendSharedWidget` — HTML widgets, 1-32768 bytes, at most 4096 compressed.
- `answerWidgetQuery` — answer widget requests within 15 seconds.
- `editMessageWidgetData` / `editSharedWidgetData` — update widget state.
- `sendRichMessage` / `sendRichMessageDraft` — rich messages and streaming drafts.
- `sendMessageEphemeral` — ephemeral messages via `ephemeral_message_parameters`.

Widgets and rich messages are enabled by the `widgets` and `rich` features.
