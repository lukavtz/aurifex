import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { DomainResult } from "../../src/core/results.ts";
import { createPathPolicy, type PathPolicy } from "../../src/core/security/path-policy.ts";
import {
  DEPLOY_ALLOWED_UPDATES,
  planDeploy,
  validateDeployDomain,
  validateWebhookSecretValue,
  validateWebhookUrl,
} from "../../src/core/projects/deploy.ts";
import { generateTestHarness } from "../../src/core/projects/test-harness.ts";
import { upgradePlan } from "../../src/core/projects/upgrade.ts";

const roots: string[] = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function valueOf<T>(result: DomainResult<T>): T {
  assert.equal(result.status, "ok", result.status === "error" ? result.error.detail : "ok");
  if (result.status !== "ok") throw new Error("unreachable");
  return result.value;
}

async function project(
  stack: "grammy" | "aiogram",
  name = "bot",
): Promise<{ policy: PathPolicy; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "aurifex-deploy-"));
  roots.push(root);
  const policy = await createPathPolicy(root);
  if (stack === "grammy") {
    await policy.writeFile(
      `${name}/package.json`,
      `${JSON.stringify({ dependencies: { grammy: "1.46.0" } }, null, 2)}\n`,
    );
    await policy.writeFile(
      `${name}/.env.example`,
      "DATABASE_URL=postgres://bot:bot@postgres:5432/bot\nREDIS_URL=redis://redis:6379/0\n",
    );
  } else {
    await policy.writeFile(
      `${name}/pyproject.toml`,
      `[project]\nname = "demo-bot"\ndependencies = ["aiogram==3.31.0"]\n`,
    );
    await policy.writeFile(`${name}/.env.example`, "DATABASE_URL=\nREDIS_URL=\n");
  }
  return { policy, root };
}

test("validateDeployDomain accepts lowercase DNS domains", () => {
  assert.equal(validateDeployDomain("bot.example.com"), null);
  assert.equal(validateDeployDomain("a-b.example.co"), null);
  assert.equal(validateDeployDomain("x".repeat(63) + ".example.com"), null);
});

test("validateDeployDomain rejects schemes, ports, paths, and bad labels", () => {
  for (const domain of [
    "",
    "https://bot.example.com",
    "bot.example.com:443",
    "bot.example.com/path",
    "Bot.example.com",
    "bot..example.com",
    "bot_example.com",
    "-bot.example.com",
    "bot-.example.com",
    "bot.example.com.",
    "localhost",
  ]) {
    assert.notEqual(validateDeployDomain(domain), null, `expected rejection: ${domain}`);
  }
  assert.notEqual(validateDeployDomain(`${"a".repeat(64)}.example.com`), null);
});

test("validateWebhookUrl enforces https and the Telegram port allowlist", () => {
  assert.equal(validateWebhookUrl("https://bot.example.com/telegram/webhook"), null);
  assert.equal(validateWebhookUrl("https://bot.example.com:8443/telegram/webhook"), null);
  for (const url of [
    "http://bot.example.com/telegram/webhook",
    "https://bot.example.com:9443/telegram/webhook",
    "https://user:pass@bot.example.com/telegram/webhook",
    "not a url",
  ]) {
    assert.notEqual(validateWebhookUrl(url), null, `expected rejection: ${url}`);
  }
});

test("validateWebhookSecretValue enforces the webhook secret alphabet", () => {
  assert.equal(validateWebhookSecretValue("abc-_123"), null);
  assert.notEqual(validateWebhookSecretValue("bad secret"), null);
  assert.notEqual(validateWebhookSecretValue(""), null);
  assert.notEqual(validateWebhookSecretValue("x".repeat(257)), null);
});

test("planDeploy renders the grammY deployment files and webhook contract", async () => {
  const { policy } = await project("grammy");
  const result = valueOf(
    await planDeploy({ projectRoot: "bot", domain: "bot.example.com" }, { policy }),
  );

  assert.deepEqual(
    result.files.map((file) => file.path),
    [
      "bot/Dockerfile",
      "bot/docker-compose.yml",
      "bot/.dockerignore",
      "bot/Caddyfile",
      "bot/scripts/set-webhook.ts",
    ],
  );
  assert.equal(result.setWebhook.url, "https://bot.example.com/telegram/webhook");
  assert.equal(result.setWebhook.secretToken, "WEBHOOK_SECRET");
  assert.equal(result.setWebhook.maxConnections, 40);
  assert.equal(result.setWebhook.dropPendingUpdates, false);
  assert.deepEqual(result.setWebhook.allowedUpdates, DEPLOY_ALLOWED_UPDATES);
  assert.ok(result.env.includes("DATABASE_URL"));
  assert.ok(result.env.includes("REDIS_URL"));

  const caddy = await policy.readText("bot/Caddyfile");
  assert.ok(caddy.includes("bot.example.com"));
  assert.ok(caddy.includes("reverse_proxy bot:8080"));

  const dockerfile = await policy.readText("bot/Dockerfile");
  assert.match(dockerfile, /^USER (?!root\b)\S+$/m);

  const compose = await policy.readText("bot/docker-compose.yml");
  assert.ok(compose.includes("caddy:"));
  assert.ok(compose.includes("postgres:"));
  assert.ok(compose.includes("redis:"));

  const script = await policy.readText("bot/scripts/set-webhook.ts");
  assert.ok(script.includes("secret_token: secret"));
  assert.ok(script.includes('parsed.protocol !== "https:"'));
  assert.ok(script.includes("ALLOWED_PORTS"));
  assert.ok(script.includes("<redacted>"));
});

test("planDeploy renders the aiogram deployment files and python webhook script", async () => {
  const { policy } = await project("aiogram");
  const result = valueOf(
    await planDeploy({ projectRoot: "bot", domain: "bot.example.com" }, { policy }),
  );

  assert.ok(result.files.some((file) => file.path === "bot/scripts/set_webhook.py"));
  assert.ok(!result.files.some((file) => file.path === "bot/scripts/set-webhook.ts"));
  assert.ok(!result.env.includes("DATABASE_URL"));

  const dockerfile = await policy.readText("bot/Dockerfile");
  assert.match(dockerfile, /^USER bot$/m);

  const script = await policy.readText("bot/scripts/set_webhook.py");
  assert.ok(script.includes('parsed.scheme != "https"'));
  assert.ok(script.includes("secret_token=secret"));
  assert.ok(script.includes("urlparse"));
  assert.ok(script.includes("<redacted>"));
});

test("planDeploy refuses existing deployment files unless overwrite is true", async () => {
  const { policy } = await project("grammy");
  valueOf(await planDeploy({ projectRoot: "bot", domain: "bot.example.com" }, { policy }));
  await policy.writeFile("bot/Dockerfile", "custom\n", { overwrite: true });

  const refused = await planDeploy({ projectRoot: "bot", domain: "bot.example.com" }, { policy });
  assert.equal(refused.status, "error");
  if (refused.status === "error") assert.equal(refused.error.code, "destination_exists");
  assert.equal(await policy.readText("bot/Dockerfile"), "custom\n");

  valueOf(
    await planDeploy(
      { projectRoot: "bot", domain: "bot.example.com", overwrite: true },
      { policy },
    ),
  );
  assert.match(await policy.readText("bot/Dockerfile"), /^FROM /);
});

test("planDeploy rejects polling mode checklist webhook command", async () => {
  const { policy } = await project("grammy");
  const result = valueOf(
    await planDeploy(
      { projectRoot: "bot", domain: "bot.example.com", mode: "polling" },
      { policy },
    ),
  );
  assert.ok(result.checklist.some((item) => item.includes("BOT_MODE=polling")));
  assert.ok(!result.checklist.some((item) => item.startsWith("bun run scripts/set-webhook.ts")));
});

test("planDeploy rejects an unknown stack and a project outside the policy root", async () => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-deploy-"));
  roots.push(root);
  const policy = await createPathPolicy(root);
  await policy.writeFile("bot/README.md", "no manifest\n");
  const unknown = await planDeploy({ projectRoot: "bot", domain: "bot.example.com" }, { policy });
  assert.equal(unknown.status, "error");
  if (unknown.status === "error") assert.equal(unknown.error.code, "project_unreadable");

  const outside = await mkdtemp(join(tmpdir(), "aurifex-outside-"));
  roots.push(outside);
  const escaped = await planDeploy({ projectRoot: outside, domain: "bot.example.com" }, { policy });
  assert.equal(escaped.status, "error");
  if (escaped.status === "error") assert.equal(escaped.error.code, "unauthorized_path");
});

test("generateTestHarness writes fixtures, fake transport, secret test, and tgfake compose", async () => {
  const { policy } = await project("grammy");
  const result = valueOf(await generateTestHarness({ projectRoot: "bot" }, { policy }));
  const paths = result.files.map((file) => file.path);

  const fixtures = [
    "start",
    "callback",
    "inline",
    "pre_checkout",
    "successful_payment",
    "webapp_data",
  ];
  for (const fixture of fixtures) {
    const path = `bot/fixtures/updates/${fixture}.json`;
    assert.ok(paths.includes(path), path);
    JSON.parse(await policy.readText(path));
  }
  assert.ok(paths.includes("bot/tests/fake-telegram.ts"));
  assert.ok(paths.includes("bot/tests/webhook-secret.test.ts"));
  assert.ok(paths.includes("bot/tests/e2e/tgfake.compose.yml"));
  assert.deepEqual(result.commands, [
    "bun test",
    "docker compose -f tests/e2e/tgfake.compose.yml up",
  ]);

  const compose = await policy.readText("bot/tests/e2e/tgfake.compose.yml");
  assert.ok(compose.includes("ghcr.io/evilfreelancer/tgfake:1.4.0"));
  assert.ok(compose.includes("redis:"));
  assert.ok((await policy.readText("bot/tests/fake-telegram.ts")).includes("fakeTelegramFetch"));
  assert.ok((await policy.readText("bot/tests/webhook-secret.test.ts")).includes("SECRET_HEADER"));

  const refused = await generateTestHarness({ projectRoot: "bot" }, { policy });
  assert.equal(refused.status, "error");
  if (refused.status === "error") assert.equal(refused.error.code, "destination_exists");
});

test("generateTestHarness renders python transport and secret test for aiogram", async () => {
  const { policy } = await project("aiogram");
  const result = valueOf(await generateTestHarness({ projectRoot: "bot" }, { policy }));
  const paths = result.files.map((file) => file.path);
  assert.ok(paths.includes("bot/tests/fake_telegram.py"));
  assert.ok(paths.includes("bot/tests/test_webhook_secret.py"));
  assert.deepEqual(result.commands, [
    "uv run pytest",
    "docker compose -f tests/e2e/tgfake.compose.yml up",
  ]);
  assert.ok((await policy.readText("bot/tests/fake_telegram.py")).includes("fake_request"));
});

test("upgradePlan lists raw-method guidance without touching files", async () => {
  const { policy } = await project("grammy");
  const result = valueOf(await upgradePlan("bot", policy));
  assert.equal(result.currentBotApi, "10.3");
  assert.equal(result.targetBotApi, "10.4");
  const actions = result.actions.join("\n");
  assert.ok(actions.includes("sendWidget"));
  assert.ok(actions.includes("answerWidgetQuery"));
  assert.ok(actions.includes("Ephemeral callback replies"));
  assert.ok(actions.toLowerCase().includes("quote"));
  assert.ok(actions.includes("TON wallet cards"));
  assert.ok(actions.includes("bot.api.raw."));
  assert.deepEqual(await policy.listFiles("bot"), ["bot/.env.example", "bot/package.json"]);
});

test("upgradePlan uses the aiogram raw escape hatch and rejects unknown projects", async () => {
  const { policy } = await project("aiogram");
  const result = valueOf(await upgradePlan("bot", policy));
  assert.ok(result.actions.join("\n").includes("await bot("));

  await policy.writeFile("empty/README.md", "no manifest\n");
  const missing = await upgradePlan("empty", policy);
  assert.equal(missing.status, "error");
  if (missing.status === "error") assert.equal(missing.error.code, "project_unreadable");
});
