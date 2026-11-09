# Telegram security rules

Non-negotiable. A violation blocks release.

1. **Token never leaves the server.** No token in source, logs, errors, URLs, build
   layers, Mini App bundles, or fixtures. Read it from the environment or a secret
   store. Revoke immediately on exposure.
2. **No token-shaped literal.** Any match of six or more digits, a colon, then 30 or
   more URL-safe characters is a failure, not a warning. Report it redacted.
3. **Webhook secret is mandatory.** Set `secret_token`; verify
   `X-Telegram-Bot-Api-Secret-Token` in constant time; reject missing or wrong with 401. Never compare with `===` or `==`.
4. **HTTPS and allowed ports only.** Webhook URL uses HTTPS on 443, 80, 88, or 8443.
   No redirects. No path secret as the only control.
5. **Admin allowlist is numeric and server-side.** Parse `ADMIN_IDS` as integers.
   Never authorize by username, display name, or a hidden keyboard button.
6. **Mini App initData is validated on the server.** HMAC-SHA256 with secret
   `HMAC_SHA256("WebAppData", bot_token)`, sorted data-check-string, constant-time
   hash compare, and a bounded `auth_date`. Never trust `initDataUnsafe`.
7. **Paths stay inside the authorized root.** Reject NUL, `..`, absolute escape,
   backslash, and symlinks after `realpath`. Writes use exclusive creation unless
   overwrite is explicit.
8. **Updates are at-least-once.** Deduplicate `update_id` atomically. Make side
   effects idempotent. Honor `retry_after` exactly.
9. **`allowed_updates` is explicit.** Subscribe only to handled update types, and
   re-register after changing handlers.
10. **One consumer per token.** Never run polling while a webhook is set.
11. **Payments grant only on `successful_payment`.** Answer pre-checkout within 10
    seconds; store the charge id uniquely; verify amount and currency; refund
    revokes the grant.
12. **Escape untrusted text.** Never build HTML by concatenation. Callback data,
    deep links, `start_param`, and web data are user input.
13. **Logs are redacted.** Redact token, webhook secret, API key, authorization
    header, `initData`, payment payloads, and file URLs.
14. **Container is non-root.** No secret in the image. Healthcheck hits a local
    endpoint.
15. **Dependencies are pinned and locked.** No unverified install scripts. Run the
    secret scan before commit.

When a rule conflicts with a shortcut, the rule wins.
