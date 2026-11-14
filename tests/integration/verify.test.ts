import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectBot } from "../../src/core/projects/inspect.ts";
import { verifyBot } from "../../src/core/projects/verify.ts";
import type { VerifyResult } from "../../src/core/projects/verify.ts";
import { serializeDomainResult } from "../../src/core/results.ts";
import { createPathPolicy } from "../../src/core/security/path-policy.ts";
import { copyReference, listFiles } from "../fixtures/reference-project.ts";

const EXPECTED_CHECKS = [
  "allowlist.present",
  "botapi.104",
  "botapi.104.types",
  "container.non_root",
  "dedupe.fail_closed",
  "deps.lockfile",
  "docker.healthcheck",
  "env.ignored",
  "logs.redaction",
  "miniapp.csp",
  "miniapp.session",
  "payments.schema",
  "payments.validation",
  "queue.schema",
  "queue.worker",
  "retry.retry_after",
  "scan.bounded",
  "secrets.file",
  "telemetry.metrics",
  "telemetry.readiness",
  "tests.infrastructure",
  "tests.present",
  "token.literal",
  "updates.allowed",
  "updates.dedupe",
  "webhook.constant_time",
  "webhook.https",
  "webhook.port",
  "webhook.secret",
];

async function policyFor(root: string) {
  return createPathPolicy(root);
}

function statusOf(result: VerifyResult, id: string): string | undefined {
  return result.checks.find((check) => check.id === id)?.status;
}

function detailOf(result: VerifyResult, id: string): string {
  return result.checks.find((check) => check.id === id)?.detail ?? "";
}

async function rewrite(root: string, path: string, edit: (text: string) => string): Promise<void> {
  const target = join(root, path);
  const original = await readFile(target, "utf8");
  const updated = edit(original);
  assert.notEqual(updated, original, `${path} mutation changed nothing`);
  await writeFile(target, updated);
}

async function append(root: string, path: string, extra: string): Promise<void> {
  await writeFile(join(root, path), `${await readFile(join(root, path), "utf8")}${extra}`);
}

async function rewriteAll(
  root: string,
  match: (path: string) => boolean,
  edit: (text: string) => string,
): Promise<void> {
  let changed = 0;
  for (const path of await listFiles(root)) {
    if (!match(path)) continue;
    const target = join(root, path);
    const original = await readFile(target, "utf8");
    const updated = edit(original);
    if (updated !== original) {
      changed += 1;
      await writeFile(target, updated);
    }
  }
  assert.ok(changed > 0, "no file matched the mutation");
}

async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

async function verify(referenceRoot: string) {
  const result = await verifyBot(".", await policyFor(referenceRoot));
  assert.ok(result.status === "ok", JSON.stringify(result));
  return result.value;
}

test("reference grammY project passes every check", async () => {
  const reference = await copyReference("grammy");
  try {
    const value = await verify(reference.root);
    assert.equal(value.ok, true, JSON.stringify(value.checks.filter((c) => c.status !== "pass")));
    assert.deepEqual(
      value.checks.map((check) => check.id),
      EXPECTED_CHECKS,
    );
    assert.deepEqual(value.summary, { pass: 29, warn: 0, fail: 0 });
  } finally {
    await reference.cleanup();
  }
});

test("reference aiogram project passes every check", async () => {
  const reference = await copyReference("aiogram");
  try {
    const value = await verify(reference.root);
    assert.equal(value.ok, true, JSON.stringify(value.checks.filter((c) => c.status !== "pass")));
    assert.deepEqual(value.summary, { pass: 29, warn: 0, fail: 0 });
  } finally {
    await reference.cleanup();
  }
});

test("a queue without a worker entrypoint fails queue.worker", async () => {
  const reference = await copyReference("grammy");
  try {
    await write(reference.root, "src/job/queue.ts", "export const queue = { claim: true };\n");
    const value = await verify(reference.root);
    assert.equal(value.ok, false);
    assert.equal(statusOf(value, "queue.worker"), "fail");
    assert.match(detailOf(value, "queue.worker"), /worker/);
  } finally {
    await reference.cleanup();
  }
});

test("a jobs schema without SKIP LOCKED fails queue.schema", async () => {
  const reference = await copyReference("grammy");
  try {
    await write(
      reference.root,
      "src/job/queue.ts",
      'export const claim = "SELECT id FROM jobs FOR UPDATE";\n',
    );
    await write(
      reference.root,
      "src/job/worker.ts",
      'import { claim } from "./queue.ts";\n\nexport const worker = claim;\n',
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "queue.schema"), "fail");
    assert.match(detailOf(value, "queue.schema"), /SKIP LOCKED/);
  } finally {
    await reference.cleanup();
  }
});

test("removing the framework secret wiring fails webhook.secret", async () => {
  const reference = await copyReference("grammy");
  try {
    await rewriteAll(
      reference.root,
      (path) => path.startsWith("src/") && !path.startsWith("src/telegram/"),
      (text) => text.replaceAll("secretToken", "secretValue").replaceAll("secret_token:", "kind:"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "webhook.secret"), "fail");
  } finally {
    await reference.cleanup();
  }
});

test("a planted token fails token.literal without echoing it", async () => {
  const reference = await copyReference("grammy");
  try {
    const token = ["1234567890", "Ab3".repeat(12)].join(":");
    await append(reference.root, "src/config.ts", `\nexport const leaked = "${token}";\n`);
    const value = await verify(reference.root);
    assert.equal(value.ok, false);
    assert.equal(statusOf(value, "token.literal"), "fail");
    const result = await verifyBot(".", await policyFor(reference.root));
    assert.ok(result.status === "ok");
    const serialized = serializeDomainResult(result);
    assert.equal(serialized.includes(token), false);
    assert.match(serialized, /1234567890:Ab3A/);
  } finally {
    await reference.cleanup();
  }
});

test("a project without .gitignore fails env.ignored", async () => {
  const reference = await copyReference("grammy");
  try {
    await rm(join(reference.root, ".gitignore"));
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "env.ignored"), "fail");
  } finally {
    await reference.cleanup();
  }
});

test("a missing 10.4 adapter fails botapi.104", async () => {
  const reference = await copyReference("aiogram");
  try {
    await rm(join(reference.root, "app/telegram/api104.py"));
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "botapi.104"), "fail");
    assert.match(detailOf(value, "botapi.104"), /adapter file is missing/);
  } finally {
    await reference.cleanup();
  }
});

test("an adapter without the 10.4 types fails botapi.104.types", async () => {
  const reference = await copyReference("grammy");
  try {
    await rewrite(reference.root, "src/telegram/api104-types.ts", (text) =>
      text.replaceAll("RichTextTonAddress", "RichTextText"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "botapi.104.types"), "fail");
    assert.match(detailOf(value, "botapi.104.types"), /RichTextTonAddress/);
  } finally {
    await reference.cleanup();
  }
});

test("payments without refunds fail payments.schema", async () => {
  const reference = await copyReference("grammy");
  try {
    await write(
      reference.root,
      "src/service/payments.ts",
      "export const PAYMENTS = { charge_id: true, subscriptions: true };\n",
    );
    await rewriteAll(
      reference.root,
      () => true,
      (text) => text.replaceAll(/refunds?/g, "returned_money"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "payments.schema"), "fail");
    assert.match(detailOf(value, "payments.schema"), /refunds/);
  } finally {
    await reference.cleanup();
  }
});

test("payments without amount validation fail payments.validation", async () => {
  const reference = await copyReference("grammy");
  try {
    await write(
      reference.root,
      "src/service/payments.ts",
      "export const PAYMENTS = { charge_id: true, refunds: true, subscriptions: true };\nexport const validate = { invoice_payload: true, currency: true };\n",
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "payments.validation"), "fail");
    assert.match(detailOf(value, "payments.validation"), /total_amount/);
  } finally {
    await reference.cleanup();
  }
});

test("config without _FILE indirection fails secrets.file", async () => {
  const reference = await copyReference("grammy");
  try {
    await rewriteAll(
      reference.root,
      () => true,
      (text) => text.replaceAll("BOT_TOKEN_FILE", "BOT"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "secrets.file"), "fail");
    assert.match(detailOf(value, "secrets.file"), /BOT_TOKEN_FILE/);
  } finally {
    await reference.cleanup();
  }
});

test("a readiness probe without dependency checks fails telemetry.readiness", async () => {
  const reference = await copyReference("grammy");
  try {
    await rewriteAll(
      reference.root,
      (path) => path.startsWith("src/"),
      (text) => text.replaceAll("/readyz", "/alive"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "telemetry.readiness"), "fail");
    assert.match(detailOf(value, "telemetry.readiness"), /readyz/);
  } finally {
    await reference.cleanup();
  }
});

test("a project without /metrics only warns telemetry.metrics", async () => {
  const reference = await copyReference("grammy");
  try {
    await rewriteAll(
      reference.root,
      (path) => path.startsWith("src/"),
      (text) => text.replaceAll("/metrics", "/measurements"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "telemetry.metrics"), "warn");
    assert.equal(value.summary.warn, 1);
  } finally {
    await reference.cleanup();
  }
});

test("documentation alone cannot satisfy telemetry checks", async () => {
  const reference = await copyReference("grammy");
  try {
    await rewriteAll(
      reference.root,
      (path) => !path.endsWith(".md"),
      (text) => text.replaceAll("/metrics", "/measurements").replaceAll("/readyz", "/alive"),
    );
    await append(reference.root, "README.md", "\nGET /metrics\nGET /readyz\n");
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "telemetry.metrics"), "warn");
    assert.equal(statusOf(value, "telemetry.readiness"), "fail");
  } finally {
    await reference.cleanup();
  }
});

test("a miniapp session without HttpOnly fails miniapp.session", async () => {
  const reference = await copyReference("grammy");
  try {
    await write(
      reference.root,
      "src/miniapp/session.ts",
      'export const cookie = "aurifex_session=; HttpOnly";\nexport const sessionKey = "miniapp:session";\n',
    );
    await rewriteAll(
      reference.root,
      () => true,
      (text) => text.replaceAll("HttpOnly", "SameSite=Strict"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "miniapp.session"), "fail");
    assert.match(detailOf(value, "miniapp.session"), /HttpOnly/);
  } finally {
    await reference.cleanup();
  }
});

test("a miniapp without CSP fails miniapp.csp", async () => {
  const reference = await copyReference("grammy");
  try {
    await write(
      reference.root,
      "src/miniapp/session.ts",
      'export const cookie = "aurifex_session=; HttpOnly";\nexport const sessionKey = "miniapp:session";\n',
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "miniapp.csp"), "fail");
  } finally {
    await reference.cleanup();
  }
});

test("a Dockerfile without HEALTHCHECK fails docker.healthcheck", async () => {
  const reference = await copyReference("grammy");
  try {
    await rewrite(reference.root, "Dockerfile", (text) =>
      text
        .split("\n")
        .filter((line) => !line.startsWith("HEALTHCHECK"))
        .join("\n"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "docker.healthcheck"), "fail");
  } finally {
    await reference.cleanup();
  }
});

test("dedupe that returns true on error fails dedupe.fail_closed", async () => {
  const reference = await copyReference("grammy");
  try {
    await append(
      reference.root,
      "src/guard/dedupe.ts",
      "\nexport async function loose(): Promise<boolean> {\n  try {\n    return true;\n  } catch {\n    return true;\n  }\n}\n",
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "dedupe.fail_closed"), "fail");
  } finally {
    await reference.cleanup();
  }
});

test("dropping allowed_updates fails updates.allowed", async () => {
  const reference = await copyReference("grammy");
  try {
    await rewrite(reference.root, "src/main.ts", (text) =>
      text.replaceAll("allowed_updates", "update_kinds").replaceAll("allowedUpdates", "kinds"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "updates.allowed"), "fail");
  } finally {
    await reference.cleanup();
  }
});

test("removing update_id deduplication fails updates.dedupe", async () => {
  const reference = await copyReference("grammy");
  try {
    await rewriteAll(
      reference.root,
      () => true,
      (text) => text.replaceAll("update_id", "claim_token"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "updates.dedupe"), "fail");
  } finally {
    await reference.cleanup();
  }
});

test("tests without infrastructure signals only warn tests.infrastructure", async () => {
  const reference = await copyReference("grammy");
  try {
    await rewriteAll(
      reference.root,
      (path) => path.startsWith("tests/"),
      (text) => text.replaceAll(/postgres|redis/gi, "database"),
    );
    const value = await verify(reference.root);
    assert.equal(statusOf(value, "tests.infrastructure"), "warn");
  } finally {
    await reference.cleanup();
  }
});

test("inspect reports the stack, mode, and the Bot API 10.4 gap", async () => {
  const reference = await copyReference("grammy");
  try {
    const result = await inspectBot(".", await policyFor(reference.root));
    assert.ok(result.status === "ok", JSON.stringify(result));
    assert.equal(result.value.stack, "grammy");
    assert.equal(result.value.mode, "webhook");
    assert.equal(result.value.botApi, "10.4");
    assert.ok(result.value.rawGap.length > 0);
  } finally {
    await reference.cleanup();
  }
});

test("a symlinked project root fails with unauthorized_path", async (t) => {
  const reference = await copyReference("grammy");
  const outside = await mkdtemp(join(tmpdir(), "aurifex-outside-verify-"));
  try {
    try {
      await symlink(reference.root, join(outside, "linked"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("symlink requires privileges on this platform");
        return;
      }
      throw error;
    }
    const result = await verifyBot("linked", await policyFor(outside));
    assert.ok(result.status === "error", JSON.stringify(result));
    assert.equal(result.error.code, "unauthorized_path");
  } finally {
    await reference.cleanup();
    await rm(outside, { recursive: true, force: true });
  }
});
