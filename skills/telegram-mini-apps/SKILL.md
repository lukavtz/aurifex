---
name: telegram-mini-apps
description: Use when building or reviewing a Telegram Mini App, validating initData on the server, wiring a session endpoint, theming, or launching from a bot.
---

# Telegram Mini Apps

A Mini App is a web page opened inside Telegram. The page is untrusted. The bot
token stays on the server, and every sensitive action is authorized there.

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

Call `ready()` when the first screen is usable, not before the app renders. Respect
safe-area insets and design for a 320 px phone in both themes.

Do not add a heavy SDK for `ready`, `expand`, and `initData`. A small wrapper is
enough. If you need a feature, read its minimum client version first.

## Validate initData on the server

Algorithm:

1. Parse the raw query string. Keep all fields except `hash` (and `signature` if you
   use the Ed25519 third-party path).
2. Build `data_check_string`: `key=value` for every remaining field, sorted by key,
   joined with `\n`.
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
    .sort(([a], [b]) => a.localeCompare(b))
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
  and connect targets.
- Do not put the bot token, API keys, or admin secrets in the bundle. Route Bot API
  calls through the server.
- Treat form data, `start_param`, `sendData`, query parameters, and storage values as
  untrusted input.
- Escape text before inserting it into HTML. Prefer `textContent` over `innerHTML`.
- Payments inside the Mini App follow the bot's Stars flow; grant only on the bot's
  `successful_payment`, never on a page callback.
- If the app sends data back, handle `web_app_data` on the bot as untrusted input.

## Testing

- Valid `initData` succeeds; a one-character change to `hash` fails.
- Stale `auth_date` fails; missing `auth_date` fails.
- A valid signature for another bot token fails.
- A missing `user.id` fails.
- The session endpoint rejects an oversized body.
- The page renders static error text, not injected HTML, on failure.
- Test in real Telegram clients on Android, iOS, and desktop, in both themes.
- Test environment allows HTTP; production requires HTTPS.

## Checklist

- [ ] `ready()` and `expand()` called.
- [ ] `initData` validated server-side with HMAC-SHA256 and a constant-time compare.
- [ ] `auth_date` bounded.
- [ ] Own short-lived session issued.
- [ ] Bot token absent from the bundle.
- [ ] HTTPS and origin restriction.
- [ ] CSP and escaping.
- [ ] Payments granted only from `successful_payment`.

## Sources

Adapted from `nyxandro/telegram-bot-development-skill` (MIT),
`nzhulikov/telegram-bot-skills` (Apache-2.0), and Telegram Mini Apps documentation.
See `THIRD_PARTY_NOTICES.md`.
