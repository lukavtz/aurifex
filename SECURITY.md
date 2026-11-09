# Security Policy

## Supported versions

Aurifex is pre-1.0. Security fixes land on the latest published release only.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Report privately through the repository's Security tab (Advisories) when private
vulnerability reporting is enabled. If it is unavailable, contact the maintainer
`@lukavtz` directly. Do not open a public issue for a vulnerability. Include the affected version, the host
(OMP, DeepSeek Harness, Claude Code, MCP, CLI, or a generated project), reproduction
steps, and the impact. Use a throwaway bot and a throwaway chat for any live proof.

You can expect an initial response within seven days. Confirmed issues are fixed on
`main` and disclosed in the advisory after the fix ships.

## Leaked bot tokens

A Telegram bot token is a credential: anyone holding it controls the bot. If a token is
exposed, in an issue, a log, a commit, or a screenshot:

1. Do not open a public issue. A public report keeps the token exposed.
2. Revoke the token immediately in [@BotFather](https://t.me/BotFather) with `/revoke`.
   Revocation issues a new token and invalidates the old one at once.
3. Replace the token wherever it is deployed, and check `getWebhookInfo` for a webhook
   URL you did not set.
4. Report the exposure privately through the advisory link above if it came from an
   Aurifex defect.

Remove the exposed value from history before publishing a fix. Rotating the token is
mandatory; deleting the message is not enough.

## Scope

In scope: the Aurifex package, its CLI, host adapters, and the projects it generates with
default templates — path traversal, secret leakage, webhook authentication bypass,
update replay, unsafe container defaults, and dependency compromise.

Out of scope: vulnerabilities in Telegram itself, in grammY or aiogram upstream, and in
third-party deployments that disabled the generated security defaults.
