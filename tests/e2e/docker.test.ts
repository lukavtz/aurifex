import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { scaffoldBot } from "../../src/core/projects/scaffold.ts";
import { createPathPolicy } from "../../src/core/security/path-policy.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";
import type { BotStack } from "../../src/core/spec/bot-spec.ts";
import { DOCKER_SKIP, dockerAvailable, freePort, run, waitForHttp } from "../infra/pg.ts";

const ENABLED = process.env.AURIFEX_DOCKER === "1";
const BUILD_TIMEOUT_MS = 300_000;

const created: { containers: string[]; images: string[] } = { containers: [], images: [] };

function spec(stack: BotStack): Record<string, unknown> {
  return {
    schemaVersion: BOT_SPEC_VERSION,
    name: `docker_${stack}_bot`,
    displayName: `Docker ${stack} Bot`,
    stack,
    features: ["commands"],
    deployment: "docker",
    storage: { postgres: false, redis: false },
    i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
    security: { webhookSecret: true, adminAllowlist: false, rateLimit: false, idempotency: false },
    runtime: { queue: "none", telemetry: { otlp: false, prometheus: false, sentry: false } },
  };
}

async function build(stack: BotStack, root: string, tag: string): Promise<string> {
  const policy = await createPathPolicy(root);
  const scaffold = await scaffoldBot(
    { destination: stack, spec: spec(stack) },
    { policy, now: () => new Date(0) },
  );
  assert.equal(scaffold.status, "ok", JSON.stringify(scaffold));
  const project = join(root, stack);

  if (stack === "grammy") {
    const install = await run("bun", ["install", "--lockfile-only"], {
      cwd: project,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    assert.equal(install.code, 0, `bun install failed: ${install.stderr}`);
  } else {
    const lock = await run("uv", ["lock"], { cwd: project, timeoutMs: BUILD_TIMEOUT_MS });
    assert.equal(lock.code, 0, `uv lock failed: ${lock.stderr}`);
  }

  created.images.push(tag);
  const buildResult = await run("docker", ["build", "-t", tag, "."], {
    cwd: project,
    timeoutMs: BUILD_TIMEOUT_MS,
  });
  assert.equal(
    buildResult.code,
    0,
    `docker build failed: ${buildResult.stderr || buildResult.stdout}`,
  );
  return project;
}

after(async () => {
  for (const container of created.containers) {
    await run("docker", ["rm", "-f", container]);
  }
  for (const image of created.images) {
    await run("docker", ["rmi", "-f", image]);
  }
});

test(
  "generated images build, run as non-root, and answer /healthz",
  { skip: ENABLED ? false : DOCKER_SKIP, timeout: 600_000 },
  async () => {
    assert.ok(await dockerAvailable(), "AURIFEX_DOCKER=1 requires a running Docker daemon");
    const root = await mkdtemp(join(tmpdir(), "aurifex-docker-"));
    try {
      const stamp = `${process.pid}-${Date.now().toString(36)}`;
      const grammyTag = `aurifex-test-grammy-${stamp}`;
      const aiogramTag = `aurifex-test-aiogram-${stamp}`;

      const grammyProject = await build("grammy", root, grammyTag);
      await build("aiogram", root, aiogramTag);

      const users = await Promise.all(
        [grammyTag, aiogramTag].map(async (tag) => {
          const inspect = await run("docker", [
            "image",
            "inspect",
            "--format",
            "{{.Config.User}}",
            tag,
          ]);
          assert.equal(inspect.code, 0, inspect.stderr);
          return inspect.stdout.trim();
        }),
      );
      for (const user of users) {
        assert.notEqual(user, "", "image must declare a non-root user");
        assert.ok(user !== "root" && user !== "0", `image runs as ${user}`);
      }

      // The webhook server needs a Telegram API only to start main.ts; mount a
      // probe that serves the generated dist/server.js route with an inert bot.
      const port = await freePort();
      await writeFile(
        join(grammyProject, "probe.mjs"),
        `import { createServer } from "/app/dist/server.js";

const bot = { handleUpdate: async () => {}, init: async () => {}, isRunning: () => false };
const server = await createServer(bot, "probe_secret", "123456:probe");
server.listen(8080, "0.0.0.0", () => console.log("ready"));
`,
      );
      const container = `aurifex-health-${stamp}`;
      created.containers.push(container);
      const started = await run("docker", [
        "run",
        "-d",
        "--name",
        container,
        "-p",
        `127.0.0.1:${port}:8080`,
        "-v",
        `${join(grammyProject, "probe.mjs")}:/probe.mjs:ro`,
        grammyTag,
        "node",
        "/probe.mjs",
      ]);
      assert.equal(started.code, 0, started.stderr);

      const status = await waitForHttp(`http://127.0.0.1:${port}/healthz`, 60_000);
      assert.equal(status, 200);
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      assert.deepEqual(await response.json(), { ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
