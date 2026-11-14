# Aiogram Commands Telegram bot

Hand-written reference implementation of the **Aurifex skills** for **Python + aiogram 3.31.0** — a
complete bot skeleton that the skills describe, kept in the repository as proof that the knowledge
produces a working bot. It is not generated, it has no `.aurifex/` manifest, and nothing rewrites it.

Bot API target: 10.4. The framework advertises 10.3;
methods added after that version use await bot(method) with a TelegramMethod subclass for methods newer than aiogram types.

## Quick start

```bash
cp .env.example .env
# set BOT_TOKEN and WEBHOOK_SECRET
uv sync
uv run pytest
```

## Features

- `/start` with an inline button, `/help`, and an admin-only `/stats`.
- Callback handling that acknowledges every query before the business logic runs.
- SQLAlchemy storage with Alembic migrations, optional Redis for dedupe and rate limits.
- Webhook and long-polling transports behind one entrypoint.
- A pytest suite that needs no network and no Telegram token.

## Verifying it

```bash
node dist/cli.js verify examples/aiogram_commands --json
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

## Bot API 10.4 typed raw adapter

`app/services/api104.py` implements typed `TelegramMethod` wrappers for Bot API 10.4
methods that aiogram 3.31.0 does not ship: `sendWidget`, `sendSharedWidget`,
`answerWidgetQuery`, `editMessageWidgetData`, `editSharedWidgetData`,
`sendRichMessage`, and `sendRichMessageDraft`. Call them as `await bot(method)` or
through the matching helper coroutine. Widget queries must be answered within 15
seconds; rich message drafts are temporary 30-second previews and must be replaced by
a final `sendRichMessage` call.
