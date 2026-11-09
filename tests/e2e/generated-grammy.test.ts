import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scaffoldBot } from "../../src/core/projects/scaffold.ts";
import type { ScaffoldResult } from "../../src/core/projects/scaffold.ts";
import type { DomainResult } from "../../src/core/results.ts";
import { createPathPolicy } from "../../src/core/security/path-policy.ts";
import { BOT_FEATURES, BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";

const ENABLED = process.env.AURIFEX_E2E === "1";
const SKIP_REASON = "AURIFEX_E2E=1 not set; skipping generated grammY project end-to-end test";

// Token-shaped but inert: satisfies the generated token regex, never valid.
const DUMMY_TOKEN = ["123456", "A".repeat(32)].join(":");

interface RunResult {
  readonly code: number | null;
  readonly output: string;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collect = (chunk: Buffer): void => {
    output += chunk.toString("utf8");
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.once("error", reject);
  child.once("close", (code) => resolve({ code, output }));
  return promise;
}

function expectExit(name: string, result: RunResult): void {
  assert.equal(result.code, 0, `${name} exited with ${result.code}\n${result.output}`);
}

const SPEC = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "e2e_bot",
  displayName: "E2E Bot",
  stack: "grammy",
  features: [...BOT_FEATURES],
  deployment: "docker",
  storage: { postgres: true, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: true, zh: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
  runtime: {
    queue: "postgres",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

test(
  "generated grammY project installs, typechecks, tests and builds",
  { skip: ENABLED ? false : SKIP_REASON, timeout: 600_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "aurifex-e2e-grammy-"));
    try {
      const policy = await createPathPolicy(root);
      const scaffold: DomainResult<ScaffoldResult> = await scaffoldBot(
        { destination: "bot", spec: SPEC },
        { policy, now: () => new Date(0) },
      );
      assert.ok(scaffold.status === "ok", `scaffold failed: ${JSON.stringify(scaffold)}`);
      const project = join(root, "bot");

      expectExit("bun install", await run("bun", ["install"], project));
      await stat(join(project, "bun.lock"));

      expectExit("bun run typecheck", await run("bun", ["run", "typecheck"], project));
      expectExit("bun test", await run("bun", ["test"], project));
      expectExit("bun run build", await run("bun", ["run", "build"], project));
      await stat(join(project, "dist", "main.js"));

      const config = await run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          "import { loadConfig } from './dist/config.js'; process.stdout.write(loadConfig().BOT_MODE);",
        ],
        project,
        {
          BOT_TOKEN: DUMMY_TOKEN,
          WEBHOOK_SECRET: "e2e_webhook_secret",
          DATABASE_URL: "postgres://bot:bot@127.0.0.1:5432/bot",
          REDIS_URL: "redis://127.0.0.1:6379/0",
          BOT_MODE: "polling",
        },
      );
      expectExit("node config import", config);
      assert.equal(config.output.trim(), "polling");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
