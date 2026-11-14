# Security Policy

## Supported versions

Aurifex is pre-1.0. Security fixes land on the latest published release only.

| Version | Supported |
| ------- | --------- |
| 0.3.x   | Yes       |
| 0.2.x   | No        |
| 0.1.x   | No        |

## Install provenance

The installer fetches the repository archive at `AURIFEX_REF` (default `main`) and builds
the checkout locally. `AURIFEX_SOURCE_DIR` selects an existing local checkout. The
installer trusts the publisher; it does not verify release `SHA256SUMS`, SBOMs, or cosign
bundles. Release signing is a separate, non-blocking workflow step, so a release may ship
without a signature. Pin `AURIFEX_REF` to a tag when installing into production.

## Reporting a vulnerability

Report privately through the repository's Security tab (Advisories) when private
vulnerability reporting is enabled. If it is unavailable, contact the maintainer
`@lukavtz` directly. Do not open a public issue for a vulnerability. Include the affected
version, the surface (OMP, DeepSeek Harness, Claude Code, MCP server, CLI, installer, or
skill content), reproduction steps, and the impact. Use a throwaway bot and a throwaway
chat for any live proof.

You can expect an initial response within seven days. Confirmed issues are fixed on
`main` and disclosed in the advisory after the fix ships.

## Leaked bot tokens

A Telegram bot token is a credential: anyone holding it controls the bot. If a token is
exposed — in an issue, a log, a commit, a screenshot, or a bot project — do this:

1. Do not open a public issue. A public report keeps the token exposed.
2. Revoke the token immediately in [@BotFather](https://t.me/BotFather) with `/revoke`.
   Revocation issues a new token and invalidates the old one at once.
3. Replace the token wherever it is deployed, and check `getWebhookInfo` for a webhook
   URL you did not set.
4. Report the exposure privately through the advisory link above if it came from an
   Aurifex defect.

Remove the exposed value from history before publishing a fix. Rotating the token is
mandatory; deleting the message is not enough.

Aurifex never asks for and never prints a bot token, webhook secret, API key, or password.
Installer output, CLI errors, tool results, and verification evidence pass through
`redactSecrets`, and a token-shaped literal in a scanned project is reported as a check
id with a path and line, never as the value.

## Scope

In scope:

- the Aurifex package, CLI, installer, and host adapters;
- the MCP server: protocol handling, input validation, result size cap, and path bounds;
- `PathPolicy` and the bounded verification read;
- secret detection and redaction in all output;
- the skill corpus as shipped content: instructions that would cause an agent to build an
  insecure bot, or a skill that smuggles a credential;
- the two reference projects in `examples/`.

Out of scope:

- vulnerabilities in Telegram itself, in grammY or aiogram upstream, or in a user's bot
  that changed the documented defaults;
- damage caused by a user pasting a token into a public place;
- the host process itself, which runs the plugin as trusted code;
- the runtime behaviour of a deployed bot. `verify` is static; it does not certify a
  service.
