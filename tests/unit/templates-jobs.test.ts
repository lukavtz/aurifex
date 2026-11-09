import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BotSpec } from "../../src/core/spec/bot-spec.ts";
import {
  BROADCAST_SQL,
  renderBroadcastCommandPy,
  renderBroadcastCommandTs,
  renderBroadcastJobPy,
  renderBroadcastJobTs,
  renderLlmEnqueuePy,
  renderLlmEnqueueTs,
  renderLlmJobPy,
  renderLlmJobTs,
  renderUserSyncPy,
  renderUserSyncTs,
} from "../../src/core/projects/templates/jobs.ts";

const SPEC = {} as unknown as BotSpec;

describe("BROADCAST_SQL", () => {
  it("creates broadcasts and broadcast_deliveries with the plan columns", () => {
    for (const fragment of [
      "CREATE TABLE broadcasts (",
      "id uuid PRIMARY KEY DEFAULT gen_random_uuid()",
      "text text NOT NULL",
      "status text NOT NULL DEFAULT 'pending'",
      "created_by bigint NOT NULL",
      "last_user_id bigint NOT NULL DEFAULT 0",
      "sent integer NOT NULL DEFAULT 0",
      "failed integer NOT NULL DEFAULT 0",
      "created_at timestamptz NOT NULL DEFAULT now()",
      "finished_at timestamptz",
      "CREATE TABLE broadcast_deliveries (",
      "broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE",
      "chat_id bigint NOT NULL",
      "error text",
      "sent_at timestamptz NOT NULL DEFAULT now()",
    ]) {
      assert.ok(BROADCAST_SQL.includes(fragment), `missing fragment: ${fragment}`);
    }
  });

  it("makes (broadcast_id, chat_id) the delivery primary key", () => {
    assert.ok(BROADCAST_SQL.includes("PRIMARY KEY (broadcast_id, chat_id)"));
  });

  it("indexes the resume cursor and delivery chat id", () => {
    assert.ok(
      BROADCAST_SQL.includes(
        "CREATE INDEX broadcasts_status_idx ON broadcasts (status, created_at);",
      ),
    );
    assert.ok(
      BROADCAST_SQL.includes(
        "CREATE INDEX broadcast_deliveries_chat_idx ON broadcast_deliveries (chat_id);",
      ),
    );
  });
});

describe("renderLlmJobTs", () => {
  const source = renderLlmJobTs(SPEC);

  it("renders deterministically", () => {
    assert.equal(source, renderLlmJobTs(SPEC));
  });

  it("uses the approved job kind and handler signature", () => {
    assert.ok(source.includes('export const kind = "llm.request";'));
    assert.ok(
      source.includes(
        "export async function handle(job: ClaimedJob, ctx: JobContext): Promise<void>",
      ),
    );
    assert.ok(
      source.includes(
        "export async function ask(prompt: string, config: LlmConfig | null): Promise<string>",
      ),
    );
  });

  it("carries the documented payload shape", () => {
    for (const field of [
      "readonly chatId: number;",
      "readonly prompt: string;",
      "readonly replyToMessageId?: number;",
      "readonly updateId: number;",
    ]) {
      assert.ok(source.includes(field), `missing payload field: ${field}`);
    }
  });

  it("calls the OpenAI-compatible endpoint with the timeout and token cap", () => {
    assert.ok(source.includes('config.baseUrl + "/chat/completions"'));
    assert.ok(source.includes("AbortSignal.timeout(TIMEOUT_MS)"));
    assert.ok(source.includes("const TIMEOUT_MS = 8_000;"));
    assert.ok(source.includes("const MAX_TOKENS = 800;"));
  });

  it("sends the answer and the static error through the bot API", () => {
    assert.ok(source.includes("await ctx.bot.api.sendMessage(payload.chatId, answer, options);"));
    assert.ok(source.includes('"The assistant is unavailable right now. Please try again later."'));
  });

  it("never logs the prompt, answer, or key", () => {
    assert.ok(!source.includes("logger"));
    assert.ok(!source.includes("console."));
    assert.ok(!/log[^\n]*(prompt|answer|apiKey)/i.test(source));
  });
});

describe("renderLlmEnqueueTs", () => {
  const source = renderLlmEnqueueTs();

  it("enqueues under the update-id idempotency key", () => {
    assert.ok(source.includes('export const KIND = "llm.request";'));
    assert.ok(source.includes('idempotencyKey: "llm:" + String(payload.updateId)'));
    assert.ok(source.includes("await enqueueLlm(queue, payload);"));
    assert.ok(source.includes('"Working on it."'));
  });

  it("does not call the LLM synchronously from the command", () => {
    assert.ok(!source.includes("chat/completions"));
    assert.ok(!source.includes("ask("));
  });
});

describe("renderLlmJobPy", () => {
  const source = renderLlmJobPy(SPEC);

  it("uses the Python job names and kind", () => {
    assert.ok(source.includes('KIND = "llm.request"'));
    assert.ok(source.includes("async def handle(job: ClaimedJob, ctx: JobContext) -> None:"));
    assert.ok(source.includes("async def ask(prompt: str, config: LlmConfig | None) -> str:"));
  });

  it("uses httpx with an 8 second timeout and the same payload", () => {
    assert.ok(source.includes("httpx.AsyncClient(timeout=8.0)"));
    assert.ok(source.includes('config.base_url + "/chat/completions"'));
    assert.ok(source.includes('"max_tokens": MAX_TOKENS'));
    assert.ok(source.includes('payload.get("replyToMessageId")'));
    assert.ok(source.includes('ctx.bot.send_message(payload["chatId"], answer)'));
  });

  it("never logs the prompt, answer, or key", () => {
    assert.ok(!source.includes("logging"));
    assert.ok(!source.includes("logger"));
  });
});

describe("renderLlmEnqueuePy", () => {
  it("enqueues with the update-id idempotency key", () => {
    const source = renderLlmEnqueuePy();
    assert.ok(source.includes('KIND = "llm.request"'));
    assert.ok(source.includes('idempotency_key="llm:" + str(update_id)'));
    assert.ok(source.includes('WORKING_TEXT = "Working on it."'));
    assert.ok(!source.includes("chat/completions"));
  });
});

describe("renderBroadcastJobTs", () => {
  const source = renderBroadcastJobTs();

  it("uses the approved kind and payload", () => {
    assert.ok(source.includes('export const kind = "broadcast.send";'));
    assert.ok(
      source.includes(
        "export async function handle(job: ClaimedJob, ctx: JobContext): Promise<void>",
      ),
    );
    for (const field of [
      "readonly broadcastId: string;",
      "readonly text: string;",
      "readonly createdBy: number;",
    ]) {
      assert.ok(source.includes(field), `missing payload field: ${field}`);
    }
  });

  it("pages users by cursor and skips claimed deliveries", () => {
    assert.ok(source.includes("SELECT id FROM users WHERE id > $1::bigint ORDER BY id LIMIT 100"));
    assert.ok(source.includes("ON CONFLICT (broadcast_id, chat_id) DO NOTHING"));
    assert.ok(source.includes("if (claimed.length === 0) continue;"));
  });

  it("paces globally through the Redis fixed window", () => {
    assert.ok(source.includes("GLOBAL_PER_SECOND = 30"));
    assert.ok(source.includes('RATE_KEY_PREFIX = "broadcast:rate:"'));
    assert.ok(source.includes("INCR broadcast:rate:<second>"));
    assert.ok(source.includes("redis.expire(key, 2)"));
    assert.ok(source.includes("await redis.incr(key)"));
  });

  it("honors a 429 retry_after exactly once", () => {
    assert.ok(source.includes("error.error_code !== 429"));
    assert.ok(source.includes("error.parameters?.retry_after"));
    assert.ok(source.includes("await sleep(retryAfter * 1000)"));
    assert.ok(source.includes("return { chatId, ok: false, error: clipError(retryError) };"));
  });

  it("commits deliveries, counters, and the cursor together", () => {
    assert.ok(source.includes("await ctx.sql.begin(async (tx) =>"));
    assert.ok(
      source.includes("UPDATE broadcasts SET last_user_id = $2::bigint, sent = $3, failed = $4"),
    );
    assert.ok(
      source.includes("UPDATE broadcast_deliveries SET status = $3, error = $4, sent_at = now()"),
    );
    assert.ok(source.includes("UPDATE broadcasts SET status = 'done', finished_at = now()"));
  });
});

describe("renderBroadcastJobPy", () => {
  const source = renderBroadcastJobPy();

  it("uses the Python names and the same delivery skip", () => {
    assert.ok(source.includes('KIND = "broadcast.send"'));
    assert.ok(source.includes("async def handle(job: ClaimedJob, ctx: JobContext) -> None:"));
    assert.ok(source.includes("ON CONFLICT (broadcast_id, chat_id) DO NOTHING"));
    assert.ok(source.includes("LIMIT 100"));
  });

  it("paces through the Redis fixed window and retries 429 once", () => {
    assert.ok(source.includes("await redis.incr(key)"));
    assert.ok(source.includes("await redis.expire(key, 2)"));
    assert.ok(source.includes("INCR broadcast:rate:<second>"));
    assert.ok(source.includes("TelegramRetryAfter"));
    assert.ok(source.includes("await asyncio.sleep(error.retry_after)"));
  });

  it("commits counters and the cursor in one transaction", () => {
    assert.ok(source.includes("async with session.begin():"));
    assert.ok(source.includes("UPDATE broadcasts"));
    assert.ok(source.includes("UPDATE broadcast_deliveries"));
  });
});

describe("renderBroadcastCommandTs", () => {
  const source = renderBroadcastCommandTs();

  it("registers the admin-only commands", () => {
    assert.ok(source.includes('bot.command("broadcast"'));
    assert.ok(source.includes('bot.command("broadcast_status"'));
    assert.ok(source.includes("ADMIN_ONLY_TEXT"));
    assert.ok(source.includes("isAdmin(deps.config, userId)"));
  });

  it("inserts the broadcast and enqueues the idempotent job", () => {
    assert.ok(source.includes("INSERT INTO broadcasts (text, created_by)"));
    assert.ok(source.includes('idempotencyKey: "broadcast:" + broadcastId'));
    assert.ok(source.includes("BROADCAST_KIND"));
  });
});

describe("renderBroadcastCommandPy", () => {
  const source = renderBroadcastCommandPy();

  it("registers the admin-only router handlers", () => {
    assert.ok(source.includes('Command("broadcast")'));
    assert.ok(source.includes('Command("broadcast_status")'));
    assert.ok(source.includes("settings.admin_id_set"));
    assert.ok(source.includes("ADMIN_ONLY_TEXT"));
  });

  it("inserts and enqueues with the broadcast idempotency key", () => {
    assert.ok(source.includes("INSERT INTO broadcasts (text, created_by)"));
    assert.ok(source.includes('idempotency_key="broadcast:" + broadcast_id'));
    assert.ok(source.includes("BROADCAST_KIND"));
  });
});

describe("renderUserSyncTs", () => {
  const source = renderUserSyncTs();

  it("upserts on every update with bounded profile fields", () => {
    assert.ok(source.includes("INSERT INTO users (id, username, display_name)"));
    assert.ok(source.includes("ON CONFLICT (id) DO UPDATE"));
    assert.ok(source.includes("updated_at = now()"));
    assert.ok(source.includes(".slice(0, MAX_USERNAME)"));
    assert.ok(source.includes(".slice(0, MAX_DISPLAY_NAME)"));
    assert.ok(source.includes("await next();"));
  });

  it("registers the middleware before handlers", () => {
    assert.ok(source.includes("bot.use(userSyncMiddleware(deps.sql));"));
  });
});

describe("renderUserSyncPy", () => {
  const source = renderUserSyncPy();

  it("upserts on every update with bounded profile fields", () => {
    assert.ok(source.includes("ON CONFLICT (id) DO UPDATE"));
    assert.ok(source.includes("updated_at = now()"));
    assert.ok(source.includes("user.username[:MAX_USERNAME]"));
    assert.ok(source.includes("[:MAX_DISPLAY_NAME]"));
    assert.ok(source.includes("return await handler(event, data)"));
  });

  it("installs the base middleware at update level", () => {
    assert.ok(source.includes("class UserSyncMiddleware(BaseMiddleware)"));
    assert.ok(source.includes("dp.update.middleware(UserSyncMiddleware())"));
  });
});
