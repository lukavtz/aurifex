---
name: telegram-deploy
description: Use when deploying a Telegram bot, writing Docker or Caddy files, registering a webhook, planning a rollout, backup, or diagnosing webhook delivery failures. Русские триггеры: деплой бота, вебхук не работает, докер для бота, откат релиза, бэкап базы бота.
---

# Deploying a Telegram bot

A deploy is a sequence of explicit checks, not a file copy. The bot must start with
validated config, receive only intended updates, and fail closed on a bad secret.

## Procedure

1. Run the project's full verification and record the image digest.
2. Confirm secrets come from the host store, and TLS resolves for the domain.
3. Run migrations as a one-shot job, then start the new container.
4. Wait for `/healthz` 200 and a clean `getMe`.
5. `getWebhookInfo` before switching anything: record the current URL, pending
   count, and `last_error_message`.
6. Register the webhook (or delete it for polling) as one explicit operator action.
7. Send one test update, watch errors, 429s, and queue depth.
8. Remove the old container after the soak window.

## Preflight

- [ ] `pnpm verify` or the project equivalent passes.
- [ ] `BOT_TOKEN`, `WEBHOOK_SECRET`, and `DATABASE_URL` come from the host secret
      store, not the image, the repository, or a compose default.
- [ ] The domain resolves to the host and has a valid TLS certificate.
- [ ] The container listens on the configured port and exposes `/healthz`.
- [ ] The container runs as non-root.
- [ ] `allowed_updates` matches the handler set.
- [ ] Exactly one consumer exists for the token.
- [ ] A rollback image and the previous environment are recorded.
- [ ] A backup exists and a restore has been rehearsed.

## Dockerfile

```dockerfile
FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
```

Requirements:

- multi-stage build;
- `USER` must be a non-root name or uid;
- no token, `.env`, or build secret in any layer;
- production dependencies only, or prune after install;
- healthcheck hits a local endpoint, never Telegram.

For Python, use `uv` with a lock, copy the virtualenv from the build stage, and run
as a non-root user. `uv run` is not a production process supervisor.

## Docker Compose

```yaml
services:
  bot:
    image: ghcr.io/example/bot:${TAG}
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "127.0.0.1:8080:8080"

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: bot
      POSTGRES_USER: bot
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bot -d bot"]
      interval: 10s
      timeout: 3s
      retries: 5

  redis:
    image: redis:8-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
  redisdata:
```

Do not publish Postgres or Redis ports to the host. Bind the bot to loopback and
put Caddy in front.

## Caddy

```caddyfile
bot.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8080
  request_body {
    max_size 1MB
  }
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
  }
}
```

Caddy obtains and renews TLS. The webhook path must reach the bot without a redirect
and without an extra body parser.

## Delivery semantics

- **Confirm only after the durable commit.** In webhook mode return 2xx after the
  update is persisted or its work committed. In polling mode advance the `offset`
  only after the same commit. A 2xx or an offset sent before commit turns a crash
  into lost work; after commit, a redelivery becomes a deduplicated no-op.
- Every retry path needs an idempotent handler. Telegram retries non-2xx, users
  double-tap, and a restore can replay. Claim `update_id` or a business key before
  side effects.
- `getWebhookInfo` first when switching transport. It shows the registered URL,
  `pending_update_count`, `last_error_date`, and `last_error_message`. Switching
  blind can leave two consumers or an old secret.
- `deleteWebhook({ drop_pending_updates: true })` discards every queued update,
  including paid ones. It is not a startup step and not part of a normal polling
  start; the default is `false`.
- Graceful shutdown: stop accepting new updates, finish or requeue in-flight work,
  close storage, exit non-zero only on failure. Do not kill the process mid-grant.

## Webhook registration

Run this as an explicit operator action after the new version is healthy:

```ts
await bot.api.setWebhook(webhookUrl, {
  secret_token: webhookSecret,
  allowed_updates: ["message", "callback_query", "pre_checkout_query"],
  max_connections: 40,
  drop_pending_updates: false,
});
```

Rules:

- HTTPS only.
- Port 443, 80, 88, or 8443.
- `drop_pending_updates: true` is destructive; it can discard paid updates.
- Re-register after changing the handler set, because omitting `allowed_updates`
  keeps the previous value.
- Store the secret in the same secret store as the token.

Polling alternative:

```ts
await bot.api.deleteWebhook({ drop_pending_updates: false });
await bot.start({ allowed_updates });
```

Never run polling while a webhook is active.

## Rollout

1. Build and push an immutable image tag. Record the digest.
2. Run migrations as a one-shot job, not in every replica.
3. Start the new container; wait for `/healthz` to return 200.
4. Read `getWebhookInfo`, then register or confirm the webhook.
5. Send one test update to a test chat.
6. Watch error rate, 429 count, webhook `last_error_message`, and queue depth.
7. Remove the old container after the soak window.

Use one replica per token unless updates are deduplicated in shared storage. A load
balancer alone does not deduplicate; handlers must claim `update_id` atomically.

## Backup and restore

- Back up the database on a schedule and before every migration; keep the dump off
  the same host.
- Redis holds dedupe keys and queue state: `appendonly yes`, and treat a lost Redis
  as lost leases, not lost money.
- A restore must be rehearsed: restore into a staging database, run migrations, and
  start a bot against a test token.
- Never restore production data into a shared environment.
- Record the restore command next to the backup job.

## Rollback

- Keep the previous image digest and environment.
- Roll back the image before rolling back a schema migration.
- If the webhook is broken, switch to a known-good image and re-register with the
  same URL and secret.
- Never force-push or rewrite deployment history to hide a failed release.

## Post-deploy checks

- `getMe` succeeds.
- `getWebhookInfo.url` is the intended URL, `pending_update_count` is stable, and
  `last_error_message` is absent.
- `/healthz` returns 200 without secrets.
- A wrong secret returns 401.
- A valid update produces exactly one handler execution.
- Logs contain no token, secret, or full webhook URL.

## Gotchas

- A 2xx returned before commit looks healthy and loses the update on restart.
  Telegram will not retry what it saw acknowledged.
- `drop_pending_updates=true` on a token with a backlog deletes the backlog,
  including `successful_payment` updates.
- Omitting `allowed_updates` in `setWebhook` keeps the previous list. Changing the
  handlers without re-registering silently drops the new types.
- Two replicas behind a load balancer each receive updates unless the handler
  claims `update_id` atomically.
- A healthcheck that calls Telegram fails during an outage and restarts a healthy
  bot.
- Restoring a database without restoring the dedupe keys replays recent updates;
  handlers must tolerate that.

## Sources

- https://core.telegram.org/bots/api#setwebhook
- https://core.telegram.org/bots/webhooks
- https://core.telegram.org/bots/api#getwebhookinfo
- https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
