import type { BotStack } from "../spec/bot-spec.ts";
import type { DomainResult, FileRef } from "../results.ts";
import { domainFailure, domainSuccess } from "../results.ts";
import { PathPolicyError, type PathPolicy } from "../security/path-policy.ts";
import type { TemplateFile } from "./templates/shared.ts";
import { detectProjectStack, joinProjectPath, normalizeProjectRoot } from "./deploy.ts";

export interface HarnessResult {
  readonly files: readonly FileRef[];
  readonly commands: readonly string[];
}

export interface HarnessRequest {
  readonly projectRoot: string;
  readonly overwrite?: boolean;
}

const TELEGRAM_USER = {
  id: 100000001,
  is_bot: false,
  first_name: "Test",
  username: "test_user",
  language_code: "en",
};

const TELEGRAM_CHAT = {
  id: 100000001,
  type: "private",
  first_name: "Test",
  username: "test_user",
};

function updateStart(): string {
  return `${JSON.stringify(
    {
      update_id: 1001,
      message: {
        message_id: 1,
        date: 1700000000,
        from: TELEGRAM_USER,
        chat: TELEGRAM_CHAT,
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    },
    null,
    2,
  )}\n`;
}

function updateCallback(): string {
  return `${JSON.stringify(
    {
      update_id: 1002,
      callback_query: {
        id: "callback-1",
        from: TELEGRAM_USER,
        message: {
          message_id: 2,
          date: 1700000000,
          from: TELEGRAM_USER,
          chat: TELEGRAM_CHAT,
          text: "Choose",
        },
        chat_instance: "test-chat-instance",
        data: "demo",
      },
    },
    null,
    2,
  )}\n`;
}

function updateInline(): string {
  return `${JSON.stringify(
    {
      update_id: 1003,
      inline_query: {
        id: "inline-1",
        from: TELEGRAM_USER,
        query: "test",
        offset: "",
      },
    },
    null,
    2,
  )}\n`;
}

function updatePreCheckout(): string {
  return `${JSON.stringify(
    {
      update_id: 1004,
      pre_checkout_query: {
        id: "pre-checkout-1",
        from: TELEGRAM_USER,
        currency: "XTR",
        total_amount: 100,
        invoice_payload: "demo-payload",
      },
    },
    null,
    2,
  )}\n`;
}

function updateSuccessfulPayment(): string {
  return `${JSON.stringify(
    {
      update_id: 1005,
      message: {
        message_id: 3,
        date: 1700000000,
        from: TELEGRAM_USER,
        chat: TELEGRAM_CHAT,
        successful_payment: {
          currency: "XTR",
          total_amount: 100,
          invoice_payload: "demo-payload",
          telegram_payment_charge_id: "test-charge",
          provider_payment_charge_id: "test-provider-charge",
        },
      },
    },
    null,
    2,
  )}\n`;
}

function updateWebAppData(): string {
  return `${JSON.stringify(
    {
      update_id: 1006,
      message: {
        message_id: 4,
        date: 1700000000,
        from: TELEGRAM_USER,
        chat: TELEGRAM_CHAT,
        web_app_data: { data: "{}", button_text: "Open" },
      },
    },
    null,
    2,
  )}\n`;
}

function fakeTelegramTypeScript(): string {
  return `export interface FakeCall {
  readonly method: string;
  readonly payload: Record<string, unknown>;
}

const calls: FakeCall[] = [];

export function resetFakeTelegram(): void {
  calls.length = 0;
}

export function recordedCalls(): readonly FakeCall[] {
  return calls;
}

export async function fakeTelegramFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = url.split("/").at(-1) ?? "";
  const payload =
    init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>);
  calls.push({ method, payload });
  if (method === "getMe") {
    return Response.json({
      ok: true,
      result: { id: 1, is_bot: true, first_name: "Fake", username: "fake_bot" },
    });
  }
  return Response.json({ ok: true, result: true });
}
`;
}

function fakeTelegramPython(): string {
  return `from __future__ import annotations

from typing import Any

CALLS: list[dict[str, Any]] = []


def reset() -> None:
    CALLS.clear()


def fake_request(method: str, payload: dict[str, Any]) -> dict[str, Any]:
    CALLS.append({"method": method, "payload": payload})
    if method == "getMe":
        return {
            "ok": True,
            "result": {"id": 1, "is_bot": True, "first_name": "Fake", "username": "fake_bot"},
        }
    return {"ok": True, "result": True}
`;
}

function secretTestTypeScript(): string {
  return `import { test } from "node:test";
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

function acceptsSecret(header: string | undefined, expected: string): boolean {
  if (header === undefined) return false;
  const actual = Buffer.from(header);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

test("webhook rejects a wrong secret token", () => {
  assert.equal(acceptsSecret("wrong-secret", "correct-secret"), false);
});

test("webhook rejects a missing secret token", () => {
  assert.equal(acceptsSecret(undefined, "correct-secret"), false);
});

test("webhook accepts the configured secret token", () => {
  assert.equal(acceptsSecret("correct-secret", "correct-secret"), true);
});
`;
}

function secretTestPython(): string {
  return `import hmac


def secret_matches(header: str | None, expected: str) -> bool:
    if header is None:
        return False
    return hmac.compare_digest(header, expected)


def test_webhook_rejects_wrong_secret() -> None:
    assert not secret_matches("wrong-secret", "correct-secret")


def test_webhook_rejects_missing_secret() -> None:
    assert not secret_matches(None, "correct-secret")


def test_webhook_accepts_configured_secret() -> None:
    assert secret_matches("correct-secret", "correct-secret")
`;
}

function tgfakeCompose(): string {
  return `services:
  tgfake:
    image: ghcr.io/evilfreelancer/tgfake:1.4.0
    ports:
      - "8081:8080"
  redis:
    image: redis:8-alpine
`;
}

function harnessFiles(stack: BotStack): TemplateFile[] {
  const files: TemplateFile[] = [
    { path: "fixtures/updates/start.json", content: updateStart() },
    { path: "fixtures/updates/callback.json", content: updateCallback() },
    { path: "fixtures/updates/inline.json", content: updateInline() },
    { path: "fixtures/updates/pre_checkout.json", content: updatePreCheckout() },
    { path: "fixtures/updates/successful_payment.json", content: updateSuccessfulPayment() },
    { path: "fixtures/updates/webapp_data.json", content: updateWebAppData() },
    { path: "tests/e2e/tgfake.compose.yml", content: tgfakeCompose() },
  ];
  if (stack === "grammy") {
    files.push({ path: "tests/fake-telegram.ts", content: fakeTelegramTypeScript() });
  } else {
    files.push({ path: "tests/fake_telegram.py", content: fakeTelegramPython() });
  }
  return files;
}

function failureFrom(error: unknown): DomainResult<never> {
  if (error instanceof PathPolicyError) {
    return domainFailure({ code: error.code, detail: error.message, retryable: false });
  }
  return domainFailure({
    code: "internal_error",
    detail: error instanceof Error ? error.message : "unexpected harness failure",
    retryable: false,
  });
}

async function exists(policy: PathPolicy, path: string): Promise<boolean> {
  try {
    await policy.readText(path);
    return true;
  } catch (error) {
    if (error instanceof PathPolicyError && error.code === "not_a_file") return false;
    throw error;
  }
}

export async function generateTestHarness(
  request: HarnessRequest,
  options: { readonly policy: PathPolicy },
): Promise<DomainResult<HarnessResult>> {
  const { policy } = options;
  const projectRoot = normalizeProjectRoot(request.projectRoot);
  try {
    if (projectRoot !== "") await policy.resolveExisting(projectRoot);
    const stack = await detectProjectStack(policy, projectRoot);
    if (stack === null) {
      return domainFailure({
        code: "project_unreadable",
        detail: "project has no grammY package.json or aiogram pyproject.toml",
        retryable: false,
        details: { path: "projectRoot" },
      });
    }

    const files = harnessFiles(stack);
    const secretPath =
      stack === "grammy" ? "tests/webhook-secret.test.ts" : "tests/test_webhook_secret.py";
    const secretTarget = joinProjectPath(projectRoot, secretPath);
    if (!(await exists(policy, secretTarget))) {
      files.push({
        path: secretPath,
        content: stack === "grammy" ? secretTestTypeScript() : secretTestPython(),
      });
    }

    if (request.overwrite !== true) {
      const existing: string[] = [];
      for (const file of files) {
        const target = joinProjectPath(projectRoot, file.path);
        if (await exists(policy, target)) existing.push(target);
      }
      if (existing.length > 0) {
        return domainFailure({
          code: "destination_exists",
          detail: `harness files already exist: ${existing.join(", ")}`,
          retryable: false,
          details: { paths: existing },
        });
      }
    }

    const refs: FileRef[] = [];
    const created: string[] = [];
    try {
      for (const file of files) {
        const target = joinProjectPath(projectRoot, file.path);
        const existed = await exists(policy, target);
        const written = await policy.writeFile(target, file.content, {
          overwrite: request.overwrite === true,
        });
        refs.push(written);
        if (!existed) created.push(target);
      }
    } catch (error) {
      for (const path of created) await policy.removeFile(path).catch(() => undefined);
      throw error;
    }

    const commands: string[] = [
      stack === "grammy" ? "bun test" : "uv run pytest",
      "docker compose -f tests/e2e/tgfake.compose.yml up",
    ];
    return domainSuccess({ files: refs, commands });
  } catch (error) {
    return failureFrom(error);
  }
}
