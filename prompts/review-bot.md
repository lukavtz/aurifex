# Review a Telegram bot

Review the project against the current Bot API and the installed framework. Report
only evidence-backed findings, ordered by severity. Do not rewrite the bot in the
review.

## 0. Baseline

- [ ] State the Bot API version and the framework version. Confirm the framework's
      tested version; do not assume native support for newer methods.
- [ ] Search the code for methods the framework does not type. Raw calls must live
      in one adapter with documented fields.
- [ ] Confirm the project builds and its own tests pass. Report the exact commands.

## 1. Secrets

- [ ] No token-shaped literal in any tracked text file.
- [ ] Token read from environment or secret store; no default.
- [ ] No token in logs, errors, URLs, file paths, client bundles, or Docker layers.
- [ ] Logs redact token, webhook secret, API key, authorization header, `initData`,
      payment payloads, and file URLs.

## 2. Update delivery

- [ ] Exactly one consumer per token. No polling with a webhook set.
- [ ] Webhook checks `X-Telegram-Bot-Api-Secret-Token` in constant time and returns
      401 on failure.
- [ ] HTTPS only, port 443, 80, 88, or 8443.
- [ ] Body size capped; slow work off the request path.
- [ ] `allowed_updates` lists every handled type.
- [ ] `update_id` deduplicated atomically; side effects idempotent.
- [ ] `429` waits `retry_after`.
- [ ] Graceful shutdown stops intake and finishes or requeues work.
- [ ] `/healthz` exists and leaks nothing.

## 3. Authorization

- [ ] Admin ids are numeric and checked server-side on every privileged handler.
- [ ] A non-admin callback is denied with no side effect.
- [ ] Group rights come from Telegram, not message text.
- [ ] Callback data is validated for shape, size, and ownership.

## 4. Mini App

- [ ] `initData` validated on the server with the documented HMAC-SHA256 algorithm.
- [ ] Hash compared in constant time.
- [ ] `auth_date` bounded; stale data rejected.
- [ ] `initDataUnsafe` is not used for authorization.
- [ ] Bot token absent from the page bundle.
- [ ] Session token short-lived; page input treated as untrusted.
- [ ] HTTPS, origin restriction, CSP, and escaping.

## 5. Payments

- [ ] Digital goods use `XTR`.
- [ ] Pre-checkout answered within 10 seconds, cheaply.
- [ ] Grant only on `successful_payment`.
- [ ] Charge id unique; amount and currency checked.
- [ ] Refund revokes the grant.
- [ ] `/paysupport` and terms exist.
- [ ] Duplicate payment delivery grants once.

## 6. Files and paths

- [ ] All filesystem access goes through one path policy.
- [ ] `..`, absolute escape, NUL, backslash, and symlink are rejected.
- [ ] Writes use exclusive creation unless overwrite is explicit.
- [ ] File size bounded before reading.

## 7. Operations

- [ ] Container runs as non-root.
- [ ] No secret in the image.
- [ ] Healthcheck hits a local endpoint.
- [ ] Lockfile committed; dependencies pinned.
- [ ] Webhook registration script reads secrets from the environment.
- [ ] Rollback image and previous environment recorded.
- [ ] `getWebhookInfo` monitored for pending updates and last error.

## 8. User experience

- [ ] `/start` explains the bot and offers buttons.
- [ ] `/help` exists and matches real commands.
- [ ] Every callback query is answered on every path.
- [ ] Every user message gets a reply, including failures.
- [ ] Destructive actions are confirmed.
- [ ] Long output is split within limits.
- [ ] Dynamic text is escaped or sent plain.

## Output

For each finding: severity, `path:line`, what the user experiences, and the smallest
fix. End with:

- **Verdict**: ship, ship with fixes, or do not ship.
- **What was verified**: commands and check ids.
- **What was not verified**: live behavior, missing credentials, or inaccessible
  services.

Never print a secret. Redact evidence as `<redacted>`.
