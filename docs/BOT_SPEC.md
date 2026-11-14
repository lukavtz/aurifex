# BotSpec 1.1 — the interview contract

Status: current for `bot-spec-1.1.0`.
Sources: [`src/core/spec/bot-spec.ts`](../src/core/spec/bot-spec.ts),
[`schema/bot-spec-1.1.schema.json`](../schema/bot-spec-1.1.schema.json).

`BotSpec` is the document the agent proposes after questioning the user and the user
confirms before any code is written. It records the stack, the requested surfaces, the
storage, the locales, the security posture, and the payment catalogue. The agent builds
only what the document says. The TypeScript validator is authoritative; the JSON Schema
mirrors it for editors and CI.

## Interview rules

- Ask 3–7 questions in one block. Every question offers options and a recommended value.
- Every question maps to a field below. If an answer cannot be mapped, the field is not
  ready.
- Ask separately which surfaces the user wants: inline buttons, multi-step
  conversations, media, payments, Mini App, broadcasts. Do not add a surface to
  "complete" the bot.
- State assumptions explicitly (`assuming: postgres because horizontal workers are
wanted`) instead of inventing values.
- Do not write code before confirmation. If the user changes an answer, update the
  document and confirm again.

## Fields

| Field           | Type     | Required | Rules                                                |
| --------------- | -------- | -------- | ---------------------------------------------------- |
| `schemaVersion` | string   | yes      | exactly `bot-spec-1.1.0`                             |
| `name`          | string   | yes      | `^[a-z][a-z0-9_]{1,63}$`                             |
| `displayName`   | string   | yes      | trimmed nonempty, 1–128 chars, no control characters |
| `stack`         | string   | yes      | `grammy` or `aiogram`                                |
| `features`      | string[] | yes      | nonempty, unique, must contain `commands`            |
| `deployment`    | string   | yes      | `docker`                                             |
| `storage`       | object   | yes      | `postgres` and `redis` booleans                      |
| `i18n`          | object   | yes      | `defaultLocale` plus `en`, `ru`, optional `zh`       |
| `security`      | object   | yes      | `webhookSecret: true`, three booleans                |
| `runtime`       | object   | yes      | `queue` and `telemetry`; required in 1.1             |
| `miniapps`      | object   | no       | session TTL and allowed origins                      |
| `payments`      | object   | no       | product catalogue                                    |

Feature enum: `commands`, `llm`, `inline`, `payments`, `miniapps`, `moderation`,
`broadcast`, `widgets`, `rich`.

Locale enum: `en`, `ru`, `zh`. At least one locale is enabled, and the enabled
locales must include `defaultLocale`. `i18n.zh` defaults to `false`.

`security.webhookSecret` must be exactly `true`. A document cannot disable the
webhook secret.

`runtime.queue` is `postgres` or `none`. `runtime.telemetry` has three required
booleans: `otlp`, `prometheus`, `sentry`; all default to `false` when a 1.0 document
is normalized.

`miniapps.sessionTtlSeconds`: integer 300–2592000, default `86400`.
`miniapps.allowedOrigins`: array of canonical `https://` origins with no path,
query, fragment, credentials, or trailing slash. An empty array means same-origin
only.

`payments.products`: nonempty array of objects with:

| Field          | Rules                                         |
| -------------- | --------------------------------------------- |
| `id`           | `^[a-z][a-z0-9_]{1,31}$`, unique per document |
| `title`        | trimmed nonempty, 1–32 chars                  |
| `description`  | trimmed nonempty, 1–255 chars                 |
| `stars`        | integer 1–10000                               |
| `subscription` | boolean                                       |

`payments` is optional. When present, `features` must contain `payments`. Enabling
the `payments` feature requires Postgres and a Postgres queue, but does not by itself
require a `payments` block.

Unknown fields are rejected at every object level.

## Validation coupling

These rules are checked by `validateBotSpec`, not merely documented:

| Condition                                             | Requirement                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `features` contains `llm`, `broadcast`, or `payments` | `storage.postgres === true` and `runtime.queue === "postgres"` |
| no queued feature                                     | `runtime.queue === "none"`                                     |
| `security.idempotency` or `security.rateLimit`        | `storage.redis === true`                                       |
| `miniapps` present                                    | `storage.redis === true`                                       |
| `payments` present                                    | feature `payments` is enabled                                  |
| duplicate feature or product id                       | rejected                                                       |

Mismatched combinations fail with `invalid_request`; the error carries
`details.path`. The agent must fix the document or the user's decision — not bypass the
validator.

## Surface mapping

| User asked for                    | Feature / field                                                      |
| --------------------------------- | -------------------------------------------------------------------- |
| slash commands, `/start`          | `commands` (always present)                                          |
| inline buttons and callback flows | part of `commands`; `callback_data` design follows the recipes skill |
| multi-step conversations          | no dedicated enum value; `commands` plus a server-side state store   |
| AI answers                        | `llm` plus `storage.postgres` and a queue                            |
| files, photos, albums             | `commands` plus media handling; no dedicated enum value              |
| Telegram Stars                    | `payments` with a `payments.products` catalogue                      |
| web app inside Telegram           | `miniapps` plus `storage.redis`                                      |
| channel or group moderation       | `moderation`                                                         |
| messages to all users             | `broadcast` plus `storage.postgres` and a queue                      |
| Bot API 10.4 widgets              | `widgets`                                                            |
| rich messages and drafts          | `rich`                                                               |

## 1.0 to 1.1 normalization

`bot-spec-1.0.0` documents are accepted only through the normalizer, then validated
by the same rules. The normalized result always reports `bot-spec-1.1.0`.

| Input                                | Normalized value |
| ------------------------------------ | ---------------- |
| missing `i18n.zh`                    | `false`          |
| missing `runtime`                    | synthesized      |
| missing `miniapps.sessionTtlSeconds` | `86400`          |
| missing `miniapps.allowedOrigins`    | `[]`             |
| missing `runtime.telemetry`          | all `false`      |

Synthesized 1.0 queue: `postgres` when `features` contains `llm`, `broadcast`, or
`payments` and `storage.postgres` is true; otherwise `none`. The resulting document
must still pass the coupling rules above.

A 1.1 document without `runtime` fails.

## Minimal document

```json
{
  "schemaVersion": "bot-spec-1.1.0",
  "name": "demo_bot",
  "displayName": "Demo Bot",
  "stack": "grammy",
  "features": ["commands"],
  "deployment": "docker",
  "storage": { "postgres": false, "redis": false },
  "i18n": { "defaultLocale": "en", "en": true, "ru": false },
  "security": {
    "webhookSecret": true,
    "adminAllowlist": false,
    "rateLimit": false,
    "idempotency": false
  },
  "runtime": {
    "queue": "none",
    "telemetry": { "otlp": false, "prometheus": false, "sentry": false }
  }
}
```

`i18n.zh` may be omitted; normalization sets it to `false`.

## Schema versus validator

The JSON Schema checks structure, enums, patterns, and the cross-field rules that
JSON Schema can express. The validator additionally:

- trims strings before the length check;
- requires origins to equal `new URL(value).origin`, so `https://EXAMPLE.com` is
  rejected as non-canonical;
- requires product ids to be unique even when the product objects differ;
- parses each origin with `new URL`, so a malformed host or port that matches the
  schema pattern is still rejected.

Consequence: a document that passes the schema can still be rejected by
`validateBotSpec`. Always validate with the TypeScript function before treating the
document as confirmed. The reverse mismatch is limited to raw string length: a value
padded with spaces can pass the validator after trimming but fail the schema's
`maxLength`.

Schema tests: [`tests/unit/schema.test.ts`](../tests/unit/schema.test.ts).
