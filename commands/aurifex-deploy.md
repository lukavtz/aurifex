---
description: Plan a Telegram bot deployment and webhook registration without calling Telegram
argument-hint: [project-root] [domain]
allowed-tools:
---

# /aurifex-deploy

Nothing here executes remotely. Produce a plan the user can run.

1. Read `skills/telegram-deploy` and follow its delivery semantics.
2. Parse `$ARGUMENTS` as the project root (default `.`) and the public domain.
3. Confirm the transport: long polling needs one process and no public HTTPS; webhook needs HTTPS
   on 443/80/88/8443 and exactly one consumer per token.
4. Ask for `getWebhookInfo` output before changing the transport. Never suggest
   `deleteWebhook(drop_pending_updates=true)` as a normal startup step.
5. State the order explicitly: durable commit, then the 2xx or the offset, because Telegram retries
   on failure; handlers must be idempotent by `update_id`.
6. Cover graceful shutdown, readiness checks, and the backup/restore path.
7. Never print a bot token, webhook secret, or the full `setWebhook` URL containing the token.
