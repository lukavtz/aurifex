import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { addFeature } from "../../src/core/projects/add-feature.ts";
import { scaffoldBot } from "../../src/core/projects/scaffold.ts";
import { createPathPolicy } from "../../src/core/security/path-policy.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";

const ENABLED = process.env.AURIFEX_E2E === "1";
const SKIP = "AURIFEX_E2E=1 not set; skipping widgets generated-project test";

const SPEC = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "widget_bot",
  displayName: "Widget Bot",
  stack: "grammy" as const,
  features: ["commands"],
  deployment: "docker",
  storage: { postgres: false, redis: false },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: { webhookSecret: true, adminAllowlist: false, rateLimit: false, idempotency: false },
  runtime: { queue: "none", telemetry: { otlp: false, prometheus: false, sentry: false } },
};

interface RunResult {
  readonly code: number | null;
  readonly output: string;
}

function run(command: string, args: readonly string[], cwd: string): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const child = spawn(command, [...args], {
    cwd,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.once("error", reject);
  child.once("close", (code) => resolve({ code, output }));
  return promise;
}

function expectOk(label: string, result: RunResult): void {
  assert.equal(result.code, 0, `${label} exited ${result.code}\n${result.output}`);
}

test(
  "widgets registration and top-level update delivery with real grammY",
  { skip: ENABLED ? false : SKIP, timeout: 600_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "aurifex-widgets-"));
    try {
      const policy = await createPathPolicy(root);
      const scaffold = await scaffoldBot(
        { destination: "bot", spec: SPEC },
        { policy, now: () => new Date(0) },
      );
      assert.equal(scaffold.status, "ok", JSON.stringify(scaffold));

      const added = await addFeature(
        { projectRoot: "bot", feature: "widgets", name: "widget" },
        { policy },
      );
      assert.equal(added.status, "ok", JSON.stringify(added));
      assert.deepEqual(
        added.value.files.map((file) => file.path).toSorted(),
        ["bot/src/features/widget.ts", "bot/tests/widget.test.ts"],
      );

      const project = join(root, "bot");
      expectOk("bun install", await run("bun", ["install"], project));
      expectOk("bun run build", await run("bun", ["run", "build"], project));

      const main = await readFile(join(project, "src", "main.ts"), "utf8");
      assert.match(main, /widget_query/);
      assert.match(main, /shared_widget_query/);

      const probe = join(project, "widgets-probe.ts");
      await writeFile(
        probe,
        `import { Bot } from "grammy";
import { register } from "./dist/features/widget.js";

const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: "T",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as const;

const calls: Array<{ method: string; payload: unknown }> = [];
const bot = new Bot("1:test", { botInfo: BOT_INFO });
bot.api.config.use(async (_prev, method, payload, _signal) => {
  calls.push({ method, payload });
  return { ok: true, result: true } as never;
});
register(bot);
await bot.handleUpdate({
  update_id: 1,
  widget_query: { id: "q1", data: "x" },
} as never);
await bot.handleUpdate({
  update_id: 2,
  shared_widget_query: { id: "q2" },
} as never);
let next = false;
bot.use(async (ctx) => {
  next = ctx.update.update_id === 3;
});
await bot.handleUpdate({
  update_id: 3,
  message: { message_id: 1, date: 0, chat: { id: 1, type: "private" }, text: "hi" },
} as never);
if (next !== true) throw new Error("non-widget update did not reach next");
if (calls.length !== 2) throw new Error("unexpected API calls: " + JSON.stringify(calls));
const expected = [
  { method: "answerWidgetQuery", payload: { widget_query_id: "q1", data: "x" } },
  { method: "answerWidgetQuery", payload: { widget_query_id: "q2" } },
];
if (JSON.stringify(calls) !== JSON.stringify(expected)) {
  throw new Error("wrong payloads: " + JSON.stringify(calls));
}
process.stdout.write(JSON.stringify(calls));
`,
      );
      const result = await run("bun", [probe], project);
      expectOk("widgets probe", result);
      assert.equal(
        result.output,
        JSON.stringify([
          { method: "answerWidgetQuery", payload: { widget_query_id: "q1", data: "x" } },
          { method: "answerWidgetQuery", payload: { widget_query_id: "q2" } },
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);