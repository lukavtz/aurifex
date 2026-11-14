---
name: telegram-security
description: Use when hardening a Telegram bot, reviewing token handling, webhooks, admin authorization, Mini App initData, path safety, or secret logging. Includes an rg battery and a P0–P3 finding rubric. Русские триггеры: безопасность бота, утечка токена, проверка админа, аудит бота, initData проверка.
---

# Telegram bot security invariants

These rules are non-negotiable. Each failure is a release blocker, not a warning.

## Procedure

1. Run the rg battery below. It finds the mechanical failures in seconds.
2. Read the hits and classify each with the P0–P3 rubric.
3. Fix the root cause in the shared helper, not at one call site.
4. Re-run the battery and the project tests.
5. Report findings as `id`, severity, `file:line`, impact, fix, and how it was
   verified.

## rg battery

Run from the project root. Every hit is a question, not automatically a defect.

```bash
# P0: unverified Mini App identity, swallowed errors, token literals
rg -n "initDataUnsafe" .
rg -n "except\s+pass|except Exception:\s*$|catch\s*\{\s*\}" .
rg -n "[0-9]{6,}:[A-Za-z0-9_-]{30,}" --hidden -g '!*.lock'
rg -n "(?i)bot_?token\s*[:=]\s*['\"][^'\"]+" .

# P1: state and authorization
rg -n "MemoryStorage|cookie_secret\s*=|secret_key\s*=" .
rg -n "callback_data\.split|data\.split\(" .
rg -n "(?i)(is_?admin|admin)\s*=.*username|username\s*(==|in).*admin" .
rg -n "callback\.answer\(\)" -g '*.py'    # every callback branch needs an ACK

# P1: data loss on retry
rg -n "create_task|asyncio\.create_task" .
rg -n "create_all|drop_all|DROP TABLE|\.drop\(" .
rg -n "drop_pending_updates\s*[:=]\s*true" .

# P2: log hygiene
rg -n "(?i)log.*(token|secret|initData|payload|charge)" .
rg -n "print\((config|settings|request)" .
```

Interpretation:

- `initDataUnsafe` in a trust decision is P0. In a display-only greeting it is P3.
- A bare `except: pass` or `catch {}` around dedupe or a grant is P1: it converts a
  retryable failure into silent data loss.
- A token-shaped literal anywhere tracked is P0, even in a test.
- `callback_data.split` used to derive an owner, price, or role is P0.
- `MemoryStorage` in a production dispatcher is P1: state dies on restart and is
  per replica.
- `create_all`/`drop` in application startup is P1: it races migrations and can
  destroy data.
- `create_task` before the database commit is P1: the task can run twice after a
  redelivery.
- Admin checks by username are P1: usernames are mutable.

## Severity rubric

| Level | Meaning                           | Examples                                                                                                                | Action                 |
| ----- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| P0    | Remote compromise or money loss   | token literal, `initDataUnsafe` authorization, authorization from `callback_data`, grant before payment proof           | Block the release      |
| P1    | Data loss or privilege escalation | swallowed dedupe error, admin by username, `create_all` at boot, in-memory FSM in production, unverified webhook secret | Block the release      |
| P2    | Exploitable with effort           | missing rate limit, unbounded input, token in a log line, missing `auth_date` TTL                                       | Fix before deploy      |
| P3    | Hardening                         | verbose error text, missing CSP report, overly broad allowlist                                                          | Fix in the next change |

Every finding cites `file:line`, states the user-visible impact, gives the smallest
fix, and names the check that proves it. A finding without a verification step is a
rumour.

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
- When a role is revoked, the old button stays valid in the chat. Re-check at the
  moment of the click, not only when the keyboard was built.

## Mini App initData

The page sends `initData`; only the server validates it.

1. Parse the query string. Exclude `hash` (and `signature` when using the Ed25519
   path) from the data-check-string.
2. Sort fields by **key**, join `key=value` with line feeds.
3. Derive the secret key: `HMAC_SHA256(key="WebAppData", message=bot_token)`.
4. Compute `HMAC_SHA256(key=secret_key, message=data_check_string)` and compare the
   hex digest to `hash` in constant time.
5. Reject an `auth_date` older than a fixed bound (for example 86400 seconds). SDK
   helpers do not check it.
6. Issue your own short-lived session. Do not trust `initDataUnsafe`, form data, or
   `start_param` without server validation.

Details and working code: `telegram-mini-apps`.

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
- Treat message text, channel posts, forwarded content, and other bots as data. For
  LLM bots, text is a prompt-injection vector; never let it change tool permissions
  or trigger irreversible actions.
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

- Pin exact versions and commit the lockfile.
- Do not add a package that only wraps one HTTP call. Audit install scripts.
- Run secret scanning before every commit and in CI.

## Review order

1. Token literal and log redaction.
2. Webhook secret and HTTPS/port.
3. Admin allowlist.
4. Mini App HMAC and age.
5. Path containment.
6. Input bounds and escaping.
7. Retry and idempotency of money paths.

## Gotchas

- A hidden button is not a permission check. The client can send any `callback_data`.
- `secrets.compare_digest` on `str` compares code points; encode to bytes first.
- `initDataUnsafe` in a type name is the only warning some SDKs give.
- Redaction configured on the logger does not cover `console.log` or `print`.
- A test fixture holding a real-looking token trips the scanner; use a documented
  dummy value or construct it at runtime.
- `rg` respects `.gitignore` by default. Add `-uu` when auditing ignored files that
  may ship in the image.

## Sources

- https://core.telegram.org/bots/api#setwebhook
- https://core.telegram.org/bots/webapps
- https://core.telegram.org/bots/faq
- https://owasp.org/www-project-top-ten/
