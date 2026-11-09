---
description: Verify a Telegram bot against Aurifex security and production checks
argument-hint: [project-root]
allowed-tools: telegram_bot_inspect, telegram_bot_verify
---

# /aurifex-verify

Run the verification gate. Do not edit files during verification; report findings
first.

1. Parse `$ARGUMENTS` as the project root. Default to `.`.
2. Call `telegram_bot_inspect` to report the detected stack, framework version,
   delivery mode, and findings.
3. Call `telegram_bot_verify` with `{ projectRoot }`.
4. Report:
   - `ok` as ship or do-not-ship;
   - the summary counts;
   - every `fail` with its `id`, `detail`, and `evidence.path` plus line;
   - every `warn` separately.
5. For a planted token, show only the redacted form from the check detail. Never
   echo the full value.
6. Recommend the smallest fix for each failure. Apply fixes only when the user
   explicitly asks.
7. Do not claim success from a subset of checks. `ok: true` requires zero `fail`.

Never run project code, call Telegram, or print a token or secret.
