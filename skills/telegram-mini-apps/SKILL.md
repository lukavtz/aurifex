---
name: telegram-mini-apps
description: Use when building or reviewing a Telegram Mini App, validating initData on the server, wiring a session endpoint, theming, CloudStorage, or launching the app from a bot. Русские триггеры: мини-приложение, Mini App, initData, веб-апп телеграма, CloudStorage.
---

# Telegram Mini Apps

A Mini App is a web page opened inside Telegram. The page is untrusted. The bot token
stays on the server, and every sensitive action is authorized there.

## Procedure

1. Read the launch section and wire `ready()`/`expand()` behind a guard.
2. On the server, validate `initData`: parse, strip `hash`, sort by key, HMAC-SHA256,
   compare in constant time, then check your own `auth_date` TTL.
3. Issue your own short-lived session token from `POST /api/miniapp/session`.
4. Authorize every data-changing endpoint with that session, not with `initData`.
5. Set CSP, HTTPS, and the BotFather origin allowlist.
6. Route Bot API calls through the server; the bundle carries no token.
7. Test the validation failure cases and both themes on a 320 px phone.

## Launch and client API

The page reads `window.Telegram.WebApp`. Guard it because it is absent in a normal
browser:

```ts
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
const initData = tg?.initData ?? "";
```

Useful members:

- `initData` — signed query string. Send it to your server exactly as received.
- `initDataUnsafe` — unverified. Never authorize with it.
- `colorScheme`, `themeParams`, `onEvent("themeChanged", ...)`.
- `HapticFeedback`, `BackButton`, `MainButton`, `SettingsButton`.
- `CloudStorage`, `DeviceStorage`, `SecureStorage` — small key-value stores; your
  database remains the source of truth.
- `openLink`, `openTelegramLink`, `shareToStory`, `requestContact`,
  `requestWriteAccess`.
- `sendData` — returns a string to the bot as a `web_app_data` message; the payload
  is at most **4096 bytes**.

Call `ready()` when the first screen is usable, not before the app renders. Respect
safe-area insets and design for a 320 px phone in both themes.

Do not add a heavy SDK for `ready`, `expand`, and `initData`. A small wrapper is
enough. If you need a feature, read its minimum client version first.

## Validate initData on the server

Algorithm:

1. Parse the raw query string. Keep all fields except `hash` (and `signature` if you
   use the Ed25519 third-party path).
2. Build `data_check_string`: `key=value` for every remaining field, **sorted by
   key**, joined with `\n`. Sort keys, not whole `key=value` lines: the orders differ
   as soon as one key is a prefix of another.
3. `secret_key = HMAC_SHA256(key="WebAppData", message=bot_token)`.
4. `expected = HMAC_SHA256(key=secret_key, message=data_check_string)` as hex.
5. Compare `expected` with `hash` in constant time.
6. Reject when `auth_date` is older than your bound (for example 86400 seconds).

Node:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function validateInitData(raw: string, botToken: string, maxAge = 86400) {
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  params.delete("signature");

  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || Date.now() / 1000 - authDate > maxAge) {
    return null;
  }
  return Object.fromEntries(params);
}
```

Python:

```python
import hashlib, hmac, time
from urllib.parse import parse_qsl

def validate_init_data(raw: str, bot_token: str, max_age: int = 86400):
    pairs = dict(parse_qsl(raw, keep_blank_values=True))
    received = pairs.pop("hash", None)
    pairs.pop("signature", None)
    if not received:
        return None
    check = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        return None
    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError:
        return None
    if time.time() - auth_date > max_age:
        return None
    return pairs
```

`auth_date` is not validated by the signature path or by any SDK helper. The TTL is
yours: without it, a captured `initData` string authorizes forever.

After validation, issue your own short-lived session cookie or token. Do not resend
`initData` forever, and do not trust a client-generated user id.

## Session endpoint

`POST /api/miniapp/session`:

- accepts `{ initData: string }`, maximum 8 KiB;
- validates HMAC and age;
- extracts the numeric `user.id` from the validated fields;
- returns your own session token and a display name;
- returns 401 on any failure with a static message;
- never returns the bot token, raw initData, or internal errors.

The client posts the raw `initData`; the server never trusts a user id sent beside
it.

## Page security

- Serve only over HTTPS in production.
- Restrict the Mini App origin in BotFather; do not load the page through redirects
  or untrusted third-party origins.
- Add a Content-Security-Policy that allows only your own scripts, styles, images,
  and connect targets. No `unsafe-eval`, no wildcard `connect-src`.
- Do not put the bot token, API keys, or admin secrets in the bundle. Route Bot API
  calls through the server.
- Treat form data, `start_param`, `sendData`, query parameters, and storage values as
  untrusted input.
- Escape text before inserting it into HTML. Prefer `textContent` over `innerHTML`.
- Payments inside the Mini App follow the bot's Stars flow; grant only on the bot's
  `successful_payment`, never on a page callback.
- If the app sends data back, handle `web_app_data` on the bot as untrusted input and
  check `web_app_data.button_text` only for display.

## CloudStorage limits

- 1024 keys per user per bot.
- 4096 characters per value.
- Writes are asynchronous and can fail; never make them the only copy of data the
  user paid for.
- `SecureStorage` is client-side, not a secret store. Keep secrets server-side.

## Testing

- Valid `initData` succeeds; a one-character change to `hash` fails.
- Stale `auth_date` fails; missing `auth_date` fails.
- A valid signature for another bot token fails.
- A missing `user.id` fails.
- The session endpoint rejects an oversized body.
- The page renders static error text, not injected HTML, on failure.
- Test in real Telegram clients on Android, iOS, and desktop, in both themes.
- Test environment allows HTTP; production requires HTTPS.

## Gotchas

- `initDataUnsafe.user` is attacker-controlled. It is fine for a greeting, never for
  authorization.
- Sorting `key=value` strings instead of keys passes most fixtures and fails on real
  payloads. Sort keys.
- `URLSearchParams` decodes `+` as a space; signatures do not. Preserve the raw
  string when hashing.
- `auth_date` is seconds, not milliseconds. A millisecond comparison rejects every
  valid launch.
- `sendData` over 4096 bytes is dropped silently; chunk or store server-side.
- A Mini App opened outside Telegram has empty `initData`; render a clear fallback
  instead of a half-working page.

## Checklist

- [ ] `ready()` and `expand()` called.
- [ ] `initData` validated server-side with HMAC-SHA256 and a constant-time compare.
- [ ] `auth_date` bounded by your own TTL.
- [ ] Own short-lived session issued.
- [ ] Bot token absent from the bundle.
- [ ] HTTPS and origin restriction.
- [ ] CSP and escaping.
- [ ] Payments granted only from `successful_payment`.

## Sources

- https://core.telegram.org/bots/webapps
- https://core.telegram.org/bots/api#validating-data-received-via-the-mini-app
- https://docs.telegram-mini-apps.com/
- https://core.telegram.org/bots/api#webappdata
