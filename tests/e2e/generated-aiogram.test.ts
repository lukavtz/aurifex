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
const SKIP_REASON = "AURIFEX_E2E=1 not set; skipping generated aiogram project end-to-end test";

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
  stack: "aiogram",
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

const UV_ENV = { UV_PYTHON: "3.14" };

test(
  "generated aiogram project locks, syncs, lints, typechecks and tests",
  { skip: ENABLED ? false : SKIP_REASON, timeout: 600_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "aurifex-e2e-aiogram-"));
    try {
      const policy = await createPathPolicy(root);
      const scaffold: DomainResult<ScaffoldResult> = await scaffoldBot(
        { destination: "bot", spec: SPEC },
        { policy, now: () => new Date(0) },
      );
      assert.ok(scaffold.status === "ok", `scaffold failed: ${JSON.stringify(scaffold)}`);
      const project = join(root, "bot");

      expectExit("uv lock", await run("uv", ["lock"], project, UV_ENV));
      await stat(join(project, "uv.lock"));

      expectExit("uv sync --frozen", await run("uv", ["sync", "--frozen"], project, UV_ENV));
      expectExit(
        "uv run ruff check .",
        await run("uv", ["run", "ruff", "check", "."], project, UV_ENV),
      );
      expectExit("uv run mypy app", await run("uv", ["run", "mypy", "app"], project, UV_ENV));
      expectExit("uv run pytest -q", await run("uv", ["run", "pytest", "-q"], project, UV_ENV));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
