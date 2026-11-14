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
const SKIP = "AURIFEX_E2E=1 not set; skipping aiogram moderation generated-project test";

const SPEC = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "moderation_bot",
  displayName: "Moderation Bot",
  stack: "aiogram" as const,
  features: ["commands"],
  deployment: "docker",
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  storage: { postgres: false, redis: true },
  security: { webhookSecret: true, adminAllowlist: false, rateLimit: false, idempotency: true },
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
    env: { ...process.env, UV_PYTHON: "3.14" },
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
  "moderation handler is registered and blocks links without reaching downstream",
  { skip: ENABLED ? false : SKIP, timeout: 600_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "aurifex-moderation-"));
    try {
      const policy = await createPathPolicy(root);
      const scaffold = await scaffoldBot(
        { destination: "bot", spec: SPEC },
        { policy, now: () => new Date(0) },
      );
      assert.equal(scaffold.status, "ok", JSON.stringify(scaffold));

      const added = await addFeature(
        { projectRoot: "bot", feature: "moderation", name: "moderation" },
        { policy },
      );
      assert.equal(added.status, "ok", JSON.stringify(added));
      const paths = added.value.files.map((file) => file.path).toSorted();
      assert.ok(paths.includes("bot/app/handlers/moderation.py"), JSON.stringify(paths));
      assert.ok(paths.includes("bot/app/middlewares/moderation.py"), JSON.stringify(paths));

      const project = join(root, "bot");
      const handler = await readFile(join(project, "app", "handlers", "moderation.py"), "utf8");
      assert.match(handler, /def register\(dp: Dispatcher, _bot: Bot\)/);

      expectOk("uv lock", await run("uv", ["lock"], project));
      expectOk("uv sync --frozen", await run("uv", ["sync", "--frozen"], project));

      const probe = join(project, "moderation-probe.py");
      await writeFile(
        probe,
        `import asyncio
from unittest.mock import AsyncMock

from aiogram.types import Chat, Message, Update, User
from app.bot import create_bot, create_dispatcher
from app.config import Settings

async def main() -> None:
    settings = Settings(bot_token="123456:" + "A" * 32, webhook_secret="test_secret")
    bot = create_bot(settings)
    dp = create_dispatcher(settings, bot, None)
    assert any(type(m).__name__ == "ModerationMiddleware" for m in dp.message.middleware)
    names = [type(m).__name__ for m in dp.message.middleware]
    assert names.index("AllowlistMiddleware") < names.index("ModerationMiddleware"), names
    handled: list[str] = []
    @dp.message()
    async def catch_all(message: Message) -> None:
        handled.append(message.text or "")
    deleted = AsyncMock()
    original_delete = Message.delete
    Message.delete = deleted
    try:
        for update_id, text in [(1, "buy at https://example.com"), (2, "hello there")]:
            update = Update(update_id=update_id, message=Message(message_id=update_id, date=0, chat=Chat(id=1, type="private"), from_user=User(id=1, is_bot=False, first_name="T"), text=text))
            await dp.feed_update(bot, update)
        deleted.assert_awaited_once()
        assert handled == ["hello there"], handled
        print("moderation-ok")
    finally:
        Message.delete = original_delete
        await bot.session.close()

asyncio.run(main())
`,
      );
      const result = await run("uv", ["run", "python", probe], project);
      expectOk("moderation probe", result);
      assert.match(result.output, /moderation-ok/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);