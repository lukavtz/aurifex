---
name: telegram-security
description: Use when hardening a Telegram bot, reviewing token handling, webhooks, admin authorization, Mini App initData, path safety, or secret logging.
---

# Telegram bot security invariants

These rules are non-negotiable. Each failure is a release blocker, not a warning.

## Token handling

- The token is the bot. Read it from the environment or a secret store; never from
  source, a client bundle, a Mini App, a URL, or a default value.
- Never log the token, the request URL, `getFile` URLs, or full Bot API errors that
  may echo parameters. Log a redacted identifier instead.
- A token-shaped literal is a failure. The canonical pattern is six or more digits,
  a colon, then 30 or more URL-safe characters. Scan every tracked text file.
- If a token leaks, revoke it in BotFather and redeploy. The old token dies at once.
  Rotating a token does not undo data already exposed.
- Use a separate bot and token for development, staging, and production.

## Webhook secret

- Set `secret_token` in `setWebhook`. It must be 1–256 characters from
  `[A-Za-z0-9_-]`; generate at least 32 random bytes.
- Verify `X-Telegram-Bot-Api-Secret-Token` on every request, in constant time.
- Reject a missing or wrong header with 401 and no detail. Do not fall back to a
  path secret; URLs leak into logs and proxies.
- Use HTTPS only. Telegram delivers webhooks on ports 443, 80, 88, or 8443.
- Do not follow redirects. Pin the public hostname and certificate chain.
- Use a framework callback that performs the check (`secretToken` in grammY,
  `secret_token` in aiogram). Custom code must not compare with `===` or `==`.

Constant-time comparison in Node:

```ts
import { timingSafeEqual } from "node:crypto";

export function secretMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Python:

```python
import hmac

def secret_matches(actual: str | None, expected: str) -> bool:
    if actual is None:
        return False
    return hmac.compare_digest(actual.encode(), expected.encode())
```

## Authorization

- Admin checks use numeric Telegram user ids from the update. A username is mutable
  and spoofable; never authorize by username or display name.
- Store `ADMIN_IDS` as a set of integers. Parse once at startup and reject invalid
  values. Empty means no admins, not all admins.
- Check server-side in every privileged handler. Hiding a keyboard button is not
  authorization; a client can send any callback data.
- For group actions, verify rights with `getChatMember` or
  `getChatAdministrators`; do not trust `sender_chat` or message text.
- Re-check sensitive permissions when they change; cache for a short time only.

## Mini App initData

The page sends `initData`; only the server validates it.

1. Parse the query string. Exclude `hash` (and `signature` when using the Ed25519
   path) from the data-check-string.
2. Sort fields by key, join `key=value` with line feeds.
3. Derive the secret key: `HMAC_SHA256(key="WebAppData", message=bot_token)`.
4. Compute `HMAC_SHA256(key=secret_key, message=data_check_string)` and compare the
   hex digest to `hash` in constant time.
5. Reject an `auth_date` older than a fixed bound (for example 86400 seconds).
6. Issue your own short-lived session. Do not trust `initDataUnsafe`, form data, or
   `start_param` without server validation.

## Paths and files

- Every filesystem operation resolves through one path policy rooted at an
  authorized directory.
- Reject NUL, empty paths, backslashes, `.` and `..` components, and absolute paths
  outside the root. After `realpath`, re-check containment.
- Reject symlinks for reads and writes; overwrite must never follow a symlink.
- Create files exclusively (`wx`) unless explicit overwrite is requested.
- Enforce a size limit before reading (`1 MiB` default).
- Do not write outside the project root, even for logs, caches, or migrations.

## Untrusted input

- `callback_data` is limited to 64 bytes and is user-controlled. Validate shape,
  size, and ownership; look up state server-side.
- Escape every dynamic value for the parse mode, or send plain text. Never build
  HTML by concatenation.
- Check file sizes from the update before downloading. Never expose a `getFile` URL
  that contains the token.
- Treat message text, channel posts, forwarded content, and other bots as data.
  For LLM bots, text is a prompt-injection vector; never let it change tool
  permissions or trigger irreversible actions.
- Bound all user-controlled work: length, item count, file size, execution time.

## Logging and data

- Configure redaction for `BOT_TOKEN`, `WEBHOOK_SECRET`, `LLM_API_KEY`, and
  `Authorization` headers (`pino` `redact`, structlog processors).
- Log update ids, chat ids, method names, and error codes. Do not log message text,
  `initData`, payment payloads, or full URLs unless the product requires it.
- Collect the minimum data. Store it encrypted, keep keys separate, delete on
  request, and publish a privacy policy that matches the implementation.
- Do not use Telegram user data to train models or build datasets.

## Dependencies and supply chain

- Pin exact versions in generated projects and commit the lockfile.
- Verification warns when no lockfile exists; production requires one.
- Do not add a package that only wraps one HTTP call. Audit install scripts.
- Run secret scanning before every commit and in CI.

## Review order

1. Token literal and log redaction.
2. Webhook secret and HTTPS/port.
3. Admin allowlist.
4. Mini App HMAC and age.
5. Path containment.
6. Input bounds and escaping.

Report a finding with `id`, severity, file and line, the user-visible impact, and the
smallest fix. A failed mandatory check makes the bot unshippable.

## Sources

Adapted from `nyxandro/telegram-bot-development-skill` (MIT),
`nzhulikov/telegram-bot-skills` (Apache-2.0), and Telegram Bot API documentation.
See `THIRD_PARTY_NOTICES.md`.
