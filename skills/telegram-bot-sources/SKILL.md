---
name: telegram-bot-sources
description: "Use when a Bot API method, field, limit, or SDK behavior must be confirmed rather than recalled. Русские триггеры: актуальные данные Telegram, проверить метод Bot API, какая версия aiogram, что нового в API."
---

# Confirming Telegram facts

Memory is L0. Anything that decides code — a method name, a field, a limit, an SDK
signature — is confirmed before it is used. This skill is the procedure for that.

Pinned context: Bot API **10.4** (2026-11-09), grammY **1.46.0**, aiogram **3.31.0**.
Both SDKs are typed to Bot API 10.3.

## Procedure

### 1. Pick the cheapest source that can prove the fact

| Fact                                          | First source                                          | Fallback                                        |
| --------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Does method `X` exist, and with which fields  | `tg_docs.py method X`                                 | https://core.telegram.org/bots/api.md           |
| Which fields does type `Y` have               | `tg_docs.py type Y`                                   | https://core.telegram.org/bots/api              |
| What changed and when                         | `tg_docs.py changelog --entries 2`                    | https://core.telegram.org/bots/api-changelog.md |
| A behavior described on a page                | `tg_docs.py page KEY --section NAME`                  | the page URL                                    |
| SDK signature, class, or default              | installed SDK (item 4) then Context7 (item 3)         | SDK release notes                               |
| Whether the structure is valid before sending | `skills/telegram-bot-api/scripts/telegram_payload.py` | —                                               |

### 2. Use the bundled documentation script

The script ships with this skill and needs no token and no dependencies:

```bash
python3 skills/telegram-bot-sources/scripts/tg_docs.py method sendRichMessage
python3 skills/telegram-bot-sources/scripts/tg_docs.py type InlineKeyboardButton --grep style
python3 skills/telegram-bot-sources/scripts/tg_docs.py page features --section "Guest Bots"
python3 skills/telegram-bot-sources/scripts/tg_docs.py changelog --entries 2
python3 skills/telegram-bot-sources/scripts/tg_docs.py method sendMessage --json
```

Options that matter: `--grep REGEX` with `--context N`, `--keep-links`, `--json`
(prints `{url, fetched_at, content}`), and `--cache-dir DIR` for offline reuse.

Exit codes are part of the contract:

| Code | Meaning                         | What to do                                                      |
| ---- | ------------------------------- | --------------------------------------------------------------- |
| 0    | Found and printed               | Cite it; this is L1                                             |
| 1    | No such page, section, or match | Check spelling; a missing page is not proof a feature is absent |
| 2    | Bad arguments                   | Fix the command; do not report an API fact                      |
| 3    | Network unavailable             | Mark the fact **unverified**; never present it as checked       |

Page keys include `api`, `changelog`, `formatting`, `rich-messages`, `features`,
`webapps`, `payments-stars`, `payments`, `faq`, `serverless`. Any `/bots/....md` path
is also accepted.

The script fetches only `core.telegram.org` over HTTPS and never calls the Bot API.

### 3. Context7 for SDK specifics

When a tool is available, resolve the library id first, then query against the
installed version:

1. `resolve-library-id` with the package name: `grammy` or `aiogram`.
2. Query with the resolved id and the version in the lockfile or venv. Known ids:
   `/grammyjs/grammy` and `/aiogram/aiogram`.
3. Treat an SDK answer as L1 only if it matches the installed version. A snippet for
   a newer major version is L0 for this project.

### 4. Trust the installed SDK over the model and over the docs

The SDK in the project is the thing that will compile.

Python — report the interpreter and the version, because PATH is often not the venv:

```bash
python3 -c "import sys, aiogram; print(sys.executable); print(aiogram.__version__)"
```

Node or Bun — read the resolved version from the lockfile, not `package.json`:

```bash
node -e "console.log(require.resolve('grammy/package.json'))"
bun pm ls | grep grammy
```

If the installed SDK is older than the docs, the docs describe a future the code
cannot reach. Use the raw adapter (`telegram-bot-api-104`) or upgrade deliberately.

### 5. Check releases when the question is about recency

- grammY: https://github.com/grammyjs/grammY/releases
- aiogram: https://github.com/aiogram/aiogram/releases

A release note plus a lockfile is enough to claim a version supports something. A
blog post alone is not.

### 6. Report the fact with its level

State what you checked and where: "10.4 `sendRichMessage` accepts `rich_message` —
`tg_docs.py method sendRichMessage`, L1". If the check failed (code 3, no network),
write "unverified: no network, based on memory" instead of a confident claim.

## Gotchas

- **A missing page does not mean a missing feature.** The docs site may 404 a name
  that is real, or a page may be shortened with links to per-method pages. A 404 is a
  reason to read the changelog, not a negative proof.
- **Fetched docs describe the newest Bot API.** The installed SDK may lag by a minor
  version. Both can be true at once: the method exists and the SDK cannot type it.
- **Cached output goes stale.** `--cache-dir` returns whatever was fetched earlier;
  use it only when you know the age, and delete it when the answer matters.
- **Never put a token in a URL that gets logged.** Bot API calls carry the token in
  the path; a logged URL leaks full control of the bot.
- **`--section` matches a heading fragment, not an exact title.** If nothing prints,
  the section name differs; run `page KEY` and look.
- **A successful fetch is not a validated payload.** Documentation proves the field
  exists; the payload validator proves the body is well-formed.

## Sources

- Bot API reference: https://core.telegram.org/bots/api.md
- Bot API changelog: https://core.telegram.org/bots/api-changelog.md
- Bot features: https://core.telegram.org/bots/features.md
- Mini Apps and `initData`: https://core.telegram.org/bots/webapps.md
- Stars payments: https://core.telegram.org/bots/payments-stars.md
- grammY releases: https://github.com/grammyjs/grammY/releases
- aiogram releases: https://github.com/aiogram/aiogram/releases
- Full grouped URL table: [references/official-urls.md](references/official-urls.md)
