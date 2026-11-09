---
description: Plan a Telegram bot deployment and webhook registration without calling Telegram
argument-hint: <domain> [project-root] [webhook|polling]
allowed-tools: telegram_bot_deploy_plan
---

# /aurifex-deploy

Produce a deploy plan. This command never calls Telegram and never writes a real
secret.

1. Parse `$ARGUMENTS` as `<domain> [project-root] [webhook|polling]`. Default root
   is `.` and default mode is `webhook`. If the domain is missing, ask for it and
   stop.
2. Validate the domain: lowercase DNS labels, 1–253 characters, no scheme, path,
   port, or `..`.
3. Call `telegram_bot_deploy_plan` with `{ projectRoot, domain, mode }`. Do not pass
   `overwrite` unless the user explicitly asked.
4. Report:
   - every generated file with its relative path;
   - the required environment variable names;
   - the exact `setWebhook` parameters, including `secretToken:
"WEBHOOK_SECRET"`, `allowedUpdates`, `maxConnections: 40`, and
     `dropPendingUpdates: false`;
   - the preflight checklist.
5. Remind the operator that `setWebhook` is an explicit action and that the webhook
   URL must use HTTPS on port 443, 80, 88, or 8443.
6. On error, report the code and details. Do not hand-write Docker or Caddy files
   as a fallback.

Never print a token or a resolved secret. Never call `setWebhook` from this command.
