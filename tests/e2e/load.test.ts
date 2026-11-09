import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { scaffoldBot } from "../../src/core/projects/scaffold.ts";
import { createPathPolicy } from "../../src/core/security/path-policy.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import { freePort, LOAD_SKIP, run, waitForHttp } from "../infra/pg.ts";

const ENABLED = process.env.AURIFEX_LOAD === "1";
const LOAD_SCRIPT = fileURLToPath(new URL("../../scripts/load-webhook.mjs", import.meta.url));
const SECRET = "load_secret";

const SPEC = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "load_grammy_bot",
  displayName: "Load Bot",
  stack: "grammy",
  features: ["commands"],
  deployment: "docker",
  storage: { postgres: false, redis: false },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: { webhookSecret: true, adminAllowlist: false, rateLimit: false, idempotency: false },
  runtime: { queue: "none", telemetry: { otlp: false, prometheus: false, sentry: false } },
} as const;

test(
  "generated webhook meets the p95 and error-rate thresholds",
  { skip: ENABLED ? false : LOAD_SKIP, timeout: 180_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "aurifex-load-"));
    let child: ChildProcess | undefined;
    try {
      const policy = await createPathPolicy(root);
      const scaffold = await scaffoldBot(
        { destination: "bot", spec: SPEC },
        { policy, now: () => new Date(0) },
      );
      assert.equal(scaffold.status, "ok", JSON.stringify(scaffold));
      const project = join(root, "bot");

      const install = await run("bun", ["install"], { cwd: project });
      assert.equal(install.code, 0, install.stderr);
      const build = await run("bun", ["run", "build"], { cwd: project });
      assert.equal(build.code, 0, `${build.stdout}\n${build.stderr}`);

      const port = await freePort();
      await writeFile(
        join(project, "probe.mjs"),
        `import { createServer } from "./dist/server.js";

const bot = { handleUpdate: async () => {}, init: async () => {}, isRunning: () => false };
const server = await createServer(bot, ${JSON.stringify(SECRET)}, "123456:probe");
server.listen(Number(process.env.PORT ?? 8080), "127.0.0.1", () => console.log("ready"));
`,
      );

      const spawned = spawn(process.execPath, ["probe.mjs"], {
        cwd: project,
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = spawned;
      let output = "";
      spawned.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      spawned.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      const { promise: exited, resolve: onExit } = Promise.withResolvers<number | null>();
      spawned.once("exit", (code) => onExit(code));
      spawned.once("error", () => onExit(1));

      try {
        await waitForHttp(`http://127.0.0.1:${port}/healthz`, 30_000);
      } catch (error) {
        throw new Error(`generated server did not start:\n${output}\n${String(error)}`, {
          cause: error,
        });
      }

      const load = await run(process.execPath, [LOAD_SCRIPT], {
        env: {
          WEBHOOK_URL: `http://127.0.0.1:${port}/telegram/webhook`,
          WEBHOOK_SECRET: SECRET,
        },
        timeoutMs: 120_000,
      });
      assert.equal(load.code, 0, `load thresholds failed: ${load.stdout}\n${load.stderr}`);

      const summaryLine = load.stdout.trim().split("\n").at(-1) ?? "{}";
      const summary = JSON.parse(summaryLine) as {
        ok: boolean;
        p95Ms: number;
        errorRate: number;
        non2xx: number;
        requests: number;
      };
      assert.equal(summary.ok, true);
      assert.ok(summary.requests > 0);
      assert.equal(summary.non2xx, 0);
      assert.ok(summary.p95Ms <= 250, `p95 ${summary.p95Ms}ms exceeds 250ms`);
      assert.ok(summary.errorRate <= 0.001, `error rate ${summary.errorRate} exceeds 0.1%`);

      // The server stayed alive for the whole run.
      assert.equal(await Promise.race([exited, Promise.resolve("running")]), "running");
    } finally {
      child?.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  },
);
