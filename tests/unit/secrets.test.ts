import assert from "node:assert/strict";
import test from "node:test";

import {
  WEBHOOK_SECRET_RE,
  assertWebhookSecret,
  findTelegramTokens,
  isTelegramToken,
  redactSecrets,
} from "../../src/core/security/secrets.ts";

const TOKEN_ID = "123456789";
const TOKEN_BODY = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const TOKEN = `${TOKEN_ID}:${TOKEN_BODY}`;

test("detects a token with line number and redacted prefix", () => {
  const hits = findTelegramTokens(`clean line\nvalue ${TOKEN} end`);
  assert.equal(hits.length, 1);
  const [hit] = hits;
  assert.ok(hit);
  assert.equal(hit.line, 2);
  assert.equal(hit.redacted, `${TOKEN_ID}:${TOKEN_BODY.slice(0, 4)}…`);
  assert.ok(!hit.redacted.includes(TOKEN_BODY));
});

test("finds a token embedded in an API URL", () => {
  const url = `https://api.telegram.org/bot${TOKEN}/getMe`;
  const hits = findTelegramTokens(url);
  assert.equal(hits.length, 1);
  assert.ok(!hits[0]!.redacted.includes(TOKEN_BODY));
  assert.ok(!redactSecrets(`curl ${url}`).includes(TOKEN));
});

test("ignores placeholder token bodies", () => {
  const placeholder = `${TOKEN_ID}:${"x".repeat(35)}`;
  assert.deepEqual(findTelegramTokens(placeholder), []);
  assert.equal(isTelegramToken(placeholder), false);
});

test("isTelegramToken validates shape", () => {
  assert.equal(isTelegramToken(TOKEN), true);
  assert.equal(isTelegramToken(`${TOKEN_ID}:short`), false);
  assert.equal(isTelegramToken(TOKEN_BODY), false);
  assert.equal(isTelegramToken(`abc:${TOKEN_BODY}`), false);
});

test("redactSecrets redacts tokens and bearer values", () => {
  const input = `token ${TOKEN}\nAuthorization: Bearer sk-live-12345`;
  const output = redactSecrets(input);
  assert.ok(!output.includes(TOKEN));
  assert.ok(!output.includes(TOKEN_BODY));
  assert.ok(!output.includes("sk-live-12345"));
  assert.ok(output.includes(`${TOKEN_ID}:<redacted>`));
  assert.ok(output.includes("Authorization: Bearer <redacted>"));
});

test("webhook secret regex accepts valid boundaries", () => {
  for (const value of ["a", "A_b-9", "a".repeat(256)]) {
    assert.ok(WEBHOOK_SECRET_RE.test(value));
    assert.doesNotThrow(() => assertWebhookSecret(value));
  }
});

test("webhook secret rejects empty, oversized and illegal values", () => {
  for (const value of ["", "a".repeat(257), "bad secret!", "bad secret"]) {
    assert.throws(() => assertWebhookSecret(value), /1-256 characters/);
  }
});
