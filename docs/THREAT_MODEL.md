# Threat model

Scope: the `aurifex` CLI, generated bots, and the generated production runtime.
This model covers the shipped code, not future platform expansion.

## Assets

- Telegram bot token and webhook secret.
- Postgres and Redis credentials, LLM API key.
- Payment records, charge ids, refunds, and subscription state.
- User ids, usernames, display names, and broadcast audience.
- Queued job payloads, including chat ids and prompts.
- Bot availability and the integrity of generated source.

## Trust boundaries

| Boundary                        | Untrusted side                             | Trusted side                |
| ------------------------------- | ------------------------------------------ | --------------------------- |
| Telegram to webhook             | update body, headers, `update_id`          | bot process                 |
| Browser to Mini App API         | cookies, `Origin`, CSRF header, `initData` | session store and bot       |
| Operator to CLI                 | spec file, paths, feature names            | path policy and domain core |
| Generated bot to Postgres/Redis | network input                              | database and cache          |
| Generated bot to Telegram       | API responses, `retry_after`               | local queue and payments    |
| Generated bot to LLM provider   | prompt and response                        | job worker                  |
| Package install                 | npm registry, host plugin CLI              | local installation          |

## Threats and mitigations

### Token or secret disclosure

- The scaffold never writes a token literal; `.env.example` values are empty.
- `NAME_FILE` indirection keeps secrets out of environment dumps; the loader
  refuses symlinks and checks file mode
  ([`runtime-secrets.ts`](../src/core/projects/templates/runtime-secrets.ts)).
- CLI output, install output, and error text pass through `redactSecrets`, which
  replaces token-shaped values and bearer headers
  ([`security/secrets.ts`](../src/core/security/secrets.ts)).
- `verify` fails a project containing a token-shaped literal and checks that
  `.env` is ignored ([`verify.ts`](../src/core/projects/verify.ts)).
- Structured logs redact `BOT_TOKEN`, `WEBHOOK_SECRET`, and `LLM_API_KEY`; the LLM
  client never logs the prompt, answer, or key.

### Webhook spoofing and replay

- grammY uses `webhookCallback(..., { secretToken })`; aiogram checks
  `X-Telegram-Bot-Api-Secret-Token` in constant time before dispatch
  ([`templates/grammy.ts`](../src/core/projects/templates/grammy.ts),
  [`templates/aiogram.ts`](../src/core/projects/templates/aiogram.ts)).
- `verify` checks the secret header, HTTPS, the allowed port, and constant-time
  comparison (`webhook.secret`, `webhook.https`, `webhook.port`,
  `webhook.constant_time`).
- `update_id` is claimed in Redis with `SET NX EX 86400` before handling
  ([`templates/grammy.ts`](../src/core/projects/templates/grammy.ts)).
- Mini App `auth_date` must be within the session TTL and not in the future. The
  HMAC hash is claimed once with `SET NX EX 300`
  ([`miniapp-session.ts`](../src/core/projects/templates/miniapp-session.ts)).

Residual risk: generated grammY dedupe returns `true` when Redis fails, so a
Redis outage disables duplicate suppression instead of stopping processing.
`verify` reports this as `dedupe.fail_closed: fail`; a deployment that treats
availability as more important must still accept possible duplicate updates.

### CSRF and hostile origins

- Mini App sessions are opaque 256-bit ids stored as SHA-256 hashes in Redis.
- The cookie is `HttpOnly; SameSite=Lax; Path=/`, with `Secure` on HTTPS.
- Mutating requests require an allowed `Origin` and `X-CSRF-Token` equal to the
  stored CSRF value; comparison uses `timingSafeEqual`.
- Responses set CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`,
  and `Referrer-Policy: no-referrer`
  ([`miniapp-session.ts`](../src/core/projects/templates/miniapp-session.ts)).

Residual risk: an empty `allowedOrigins` list falls back to same-origin
comparison using the request host. A reverse proxy that rewrites `Host` must be
configured consistently.

### SQL injection

- Runtime SQL uses parameter placeholders. The queue, payments, broadcast, and
  user-sync statements are emitted as constants with `$n` parameters
  ([`queue.ts`](../src/core/projects/templates/queue.ts),
  [`payments.ts`](../src/core/projects/templates/payments.ts),
  [`jobs.ts`](../src/core/projects/templates/jobs.ts)).
- Schema and migration SQL is checked in, not assembled from user input.
- Error strings stored in `jobs.last_error` are clipped, never executed.

Residual risk: generated code that an operator edits can reintroduce string
interpolation. `verify` does not perform taint analysis.

### Duplicate or replayed jobs

- `jobs.idempotency_key` is unique. `enqueue` uses
  `ON CONFLICT DO NOTHING` and reads the existing id on conflict.
- Claim uses `FOR UPDATE SKIP LOCKED`, so two workers cannot claim one row.
- A stuck running job returns to `pending` after the visibility timeout.
- Job attempts and dead-letter state are bounded.

Residual risk: delivery is at-least-once. A handler can run twice after a crash
between the side effect and `complete`. Handlers must key external effects on the
job payload or idempotency key.

### Payment replay and refund abuse

- Invoice payloads bind product, user, and a nonce; malformed, unknown-product, or
  mismatched-user payloads are rejected.
- Pre-checkout validates product, amount, and `XTR` currency and writes nothing.
- `successful_payment` uses the Telegram charge id as the primary key with
  `ON CONFLICT DO NOTHING`; fulfillment is enqueued once per charge id.
- Refund and chargeback state is recorded; refund requests are idempotent;
  subscription cancellation is admin-only.
- Reconciliation records Telegram transactions and never grants entitlements.

Residual risk: a refunded payment whose entitlement was already delivered is not
revoked automatically. The operator must decide whether to revoke access.

### SSRF and prompt-data leakage through the LLM path

- The LLM request runs in a worker, not in the webhook.
- `LLM_BASE_URL` is operator configuration, not user input.
- Requests use an 8-second timeout, a bounded token count, and a static error on
  failure. Prompts and answers are not logged.

Residual risk: `LLM_BASE_URL` is not restricted to a public host. An operator can
point it at an internal service. There is no per-user LLM quota beyond the
optional Redis rate limiter; cost abuse is possible if the feature is exposed to
untrusted users.

### Queue and database compromise

- Generated credentials come from files or environment, never from Compose
  literals.
- Postgres and Redis bind to the Compose network; only Caddy publishes 80/443.
- The bot container runs as a non-root user; `verify` checks this.
- The worker has its own process and can be stopped without taking down the
  webhook.

Residual risk: anyone with database write access can enqueue arbitrary jobs.
Job handlers must validate payload shape rather than trusting the producer.

### Path traversal and unsafe scaffolds

- All reads and writes go through `PathPolicy`, which resolves real paths,
  rejects symlink escape, and confines writes to the authorized root
  ([`security/path-policy.ts`](../src/core/security/path-policy.ts)).
- `new` rejects a destination outside `--root`; feature paths are validated for
  absolute paths, `..`, and backslashes.
- Existing files are not replaced without `--overwrite`; feature writes are
  rolled back on failure.

### Supply chain

- Root development dependencies are pinned exactly; generated projects pin exact
  framework, database, telemetry, and test versions
  ([`package.json`](../package.json),
  [`templates/shared.ts`](../src/core/projects/templates/shared.ts)).
- A lockfile is expected; `verify` warns when it is absent (`deps.lockfile`).
- Release builds produce `SHA256SUMS`, an SBOM, and a keyless cosign signature;
  npm publishing runs only when `NPM_TOKEN` exists
  ([`release.yml`](../.github/workflows/release.yml)).
- The CLI prints and executes host install commands; it does not fetch or run
  arbitrary scripts from the project.

Residual risk: npm installs execute transitive lifecycle scripts. Production
images should install with a frozen lockfile, and generated projects should use
their checked-in lockfile. A compromised upstream package remains possible.

### Admin command abuse

- Admin commands check `ADMIN_IDS` server-side through `isAdmin`; an empty list
  denies every admin command.
- The allowlist is parsed defensively: invalid entries are dropped, not coerced.
- Broadcast status, refunds, and subscription cancellation are admin-only.

Residual risk: `ADMIN_IDS` is an environment value. Anyone who can change it can
grant themselves admin access.

## Verification coverage

`aurifex verify` checks the generated project for token literals, ignored `.env`,
webhook secret handling, HTTPS and port constraints, constant-time comparison,
non-root container, healthcheck, readiness, metrics, Mini App session and CSP,
Bot API 10.4 types, payment schema and amount/currency/payload checks, queue
worker and schema, secret-file indirection, dedupe failure mode, and tests.

Checks are static. They do not prove runtime behavior; generated tests and
integration tests cover that. See
[`src/core/projects/verify.ts`](../src/core/projects/verify.ts) and
[`docs/TEST_PLAN.md`](TEST_PLAN.md).
