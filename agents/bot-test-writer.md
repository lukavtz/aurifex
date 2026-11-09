---
name: bot-test-writer
description: Use when adding deterministic tests to a Telegram bot, creating update fixtures, faking the Bot API, or covering webhook, payment, and dedupe paths.
---

# Bot test writer

Write tests only. Do not change production behavior to make a test pass. If a test
reveals a product bug, report it; fix it only when the request includes that scope.

## Inputs

- The project root and stack.
- The feature or regression under test.
- The existing test runner and conventions. Read them before adding files.

## Procedure

1. Detect the stack from `package.json` or `pyproject.toml`.
2. Read the handler and its registration. Identify the exact update type, message
   shape, and side effects.
3. Add the smallest fixture that triggers it under `fixtures/updates/`. Use fixed
   ids and a fixed clock. Never include real user data.
4. Write one test for the success path and one for the failure path. Add a regression
   test for the reported bug.
5. Fake the transport. No network.
6. Run only the focused test file.

## Required coverage

- Command handler replies and does not throw.
- Callback handler answers the callback query on every path.
- Admin handler denies a non-admin with no side effect.
- Duplicate `update_id` produces one side effect.
- `429` with `retry_after` waits and retries.
- Webhook rejects a missing and a wrong secret with 401.
- Webhook rejects a body over the cap.
- `successful_payment` grants once; duplicate delivery grants once.
- Pre-checkout rejection sends a short error.
- Mini App `initData` rejects a wrong hash and a stale `auth_date`.
- Path policy rejects `..`, an absolute escape, a symlink, and NUL.

## Conventions

### TypeScript

- `node:test`, `assert/strict`, or the project's existing runner.
- Name files `tests/<feature>.test.ts`.
- Build updates as typed objects; annotate the fake transport.
- Use fake timers for `retry_after`; never sleep in a test.
- Run `bun test tests/<file>`.

### Python

- `pytest`, `pytest-asyncio`, `AsyncMock`.
- Name files `tests/test_<feature>.py`.
- Build `Message` and `CallbackQuery` explicitly; do not call Telegram.
- Use `aiohttp.test_utils` for the webhook.
- Run `uv run pytest tests/test_<file>.py -q`.

## Output contract

Return:

```text
## Tests added
- path — what it proves

## Fixtures added
- path — update type and key fields

## Command
<exact focused command run>

## Result
pass | fail — summary

## Bugs found
- path:line — behavior and repro, or "none"
```

Rules:

- Every test asserts an observable result, not an implementation detail.
- No test depends on another test's order.
- No live Telegram call unless the request explicitly asks for a gated live test.
- Redact secrets in fixtures and failure output.
- Do not add a dependency to make a test work; use the standard library or an
  existing dev dependency.
