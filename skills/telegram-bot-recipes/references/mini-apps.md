# Mini App: launch, validation, session

**Goal.** Open a web page from the bot and authorize its requests without trusting
the page.

**Read this when.** The spec asks for a Mini App, a web form, a catalog, or a
payment flow that needs a real UI.

Client API details, theming, and the full security checklist live in
`../../telegram-mini-apps/SKILL.md`. This file is the bot-side wiring and the
minimum server code.

## Trust boundary

The page is untrusted. `initDataUnsafe`, local storage, and any `user_id` sent in
a request body are attacker-controlled. Only the signed `initData` string proves
who opened the app, and only the server can check it.

## Steps

1. **Create the button.** A `web_app` button on a reply keyboard or an inline
   keyboard, or a menu button. HTTPS only; the origin must be set in BotFather.
2. **Receive the raw string.** The page posts `{ initData }` exactly as Telegram
   gave it. Do not parse it in the browser and forward fields.
3. **Validate the signature.** Remove `hash` (and `signature` when you use the
   Ed25519 path), sort the remaining pairs **by key**, join `key=value` with `\n`,
   derive the secret from the bot token, compare in constant time.
4. **Enforce your own `auth_date` TTL.** The SDK does not check it. Reject missing,
   non-integer, or old values; a 24-hour window is a common default.
5. **Issue your own session.** Set an HttpOnly, Secure, SameSite cookie backed by
   a server-side session row with an expiry. The page never sees the bot token.
6. **Bound `sendData`.** The page can send up to 4096 bytes back to the bot; treat
   it as untrusted input and validate the fields you defined.
7. **Set a Content-Security-Policy** that allows only your own script, style,
   image, and connect origins. No inline script from untrusted sources.

## Server validation — grammY / TypeScript

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function validateInitData(raw: string, botToken: string, maxAgeSeconds = 86_400) {
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (hash === null || hash.length !== 64) return null;
  params.delete("hash");
  params.delete("signature");

  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  const received = Buffer.from(hash, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate)) return null;
  if (Date.now() / 1000 - authDate > maxAgeSeconds) return null;
  return Object.fromEntries(params) as Record<string, string>;
}
```

Session endpoint — the only place that mints a session:

```ts
app.post("/api/session", async (req, res) => {
  const raw = typeof req.body?.initData === "string" ? req.body.initData : "";
  if (raw.length === 0 || raw.length > 8192) return res.status(400).json({ error: "bad_request" });

  const data = validateInitData(raw, process.env.BOT_TOKEN!);
  if (data === null) return res.status(401).json({ error: "unauthorized" });

  const userId = Number(JSON.parse(data.user).id);
  const session = await sessions.create(userId, { ttlSeconds: 3600 });
  res.cookie("sid", session.token, { httpOnly: true, secure: true, sameSite: "lax" });
  res.json({ name: session.displayName });
});
```

## Server validation — aiogram / Python

```python
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

def validate_init_data(raw: str, bot_token: str, max_age: int = 86_400) -> dict[str, str] | None:
    pairs = dict(parse_qsl(raw, keep_blank_values=True))
    received = pairs.pop("hash", None)
    pairs.pop("signature", None)
    if not received or len(received) != 64:
        return None
    check = "\n".join(f"{key}={pairs[key]}" for key in sorted(pairs))
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

```python
@web.post("/api/session")
async def session(request: Request) -> Response:
    body = await request.json()
    raw = body.get("initData", "")
    if not isinstance(raw, str) or not 0 < len(raw) <= 8192:
        return Response(status_code=400)
    data = validate_init_data(raw, os.environ["BOT_TOKEN"])
    if data is None:
        return Response(status_code=401)
    user_id = int(json.loads(data["user"])["id"])
    token = await sessions.create(user_id, ttl_seconds=3600)
    response = Response(status_code=204)
    response.set_cookie("sid", token, httponly=True, secure=True, samesite="lax")
    return response
```

## Sending the app and receiving its data

```ts
import { InlineKeyboard } from "grammy";

await ctx.reply("Открыть каталог:", {
  reply_markup: new InlineKeyboard().webApp("Каталог", "https://app.example.com/"),
});

bot.on("message:web_app_data", async (ctx) => {
  const raw = ctx.message.web_app_data.data;
  if (Buffer.byteLength(raw, "utf8") > 4096) return ctx.reply("Данные слишком большие.");
  const parsed = parseKnownShape(raw); // your schema, not the page's
  if (parsed === null) return ctx.reply("Не понял данные формы.");
  await orders.create(ctx.from.id, parsed);
});
```

```python
await message.answer("Открыть каталог:",
                     reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
                         InlineKeyboardButton(text="Каталог", web_app=WebAppInfo(url="https://app.example.com/"))
                     ]]))

@router.message(F.web_app_data)
async def on_web_app_data(message: Message, orders: OrdersRepo) -> None:
    raw = message.web_app_data.data
    if len(raw.encode()) > 4096:
        await message.answer("Данные слишком большие.")
        return
    parsed = parse_known_shape(raw)
    if parsed is None:
        await message.answer("Не понял данные формы.")
        return
    await orders.create(message.from_user.id, parsed)
```

## Storage and CSP

- `sendData`: 4096 bytes maximum, no binary; send ids and let the server read the
  rest from its database.
- `CloudStorage`: 1024 keys, 4096 characters per value, per user per bot. It is a
  cache, not the source of truth.
- CSP baseline: `default-src 'self'; img-src 'self' data:; style-src 'self';
script-src 'self'; connect-src 'self'`.
- The bundle contains no token, no admin secret, no database URL.

## Checks

- A valid `initData` creates a session; a one-character change to `hash` gets 401.
- Stale `auth_date` gets 401; a missing one gets 401.
- `initData` signed for another bot token gets 401.
- A body over 8 KiB is rejected before parsing.
- `sendData` over 4096 bytes is rejected in the handler.
- Two sessions for one user are independent and both expire.
