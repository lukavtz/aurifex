// Generated job handlers and the broadcast/user-sync pieces shared by both
// stacks. Every handler receives the small worker context
// `{ bot, sql, queue, config, redis? }` (`{ bot, session_factory, queue,
// settings, redis? }` in Python) and never logs prompts, answers, or keys.
//
// The SQL below is the schema of record for broadcasts and deliveries. It is
// emitted verbatim into the generated migration; runtime queries are always
// parameterized.

import type { BotSpec } from "../../spec/bot-spec.ts";

export const BROADCAST_SQL = `CREATE TABLE broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed')),
  created_by bigint NOT NULL,
  last_user_id bigint NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE TABLE broadcast_deliveries (
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed')),
  error text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (broadcast_id, chat_id)
);
CREATE INDEX broadcasts_status_idx ON broadcasts (status, created_at);
CREATE INDEX broadcast_deliveries_chat_idx ON broadcast_deliveries (chat_id);
`;

export function renderLlmJobTs(_spec: BotSpec): string {
  return `import type { Bot } from "grammy";
import type { Redis } from "ioredis";
import type { Sql } from "postgres";
import type { Config } from "../config.js";
import type { ClaimedJob, Queue } from "../runtime/queue.js";

export const kind = "llm.request";

export const ERROR_TEXT = "The assistant is unavailable right now. Please try again later.";

const TIMEOUT_MS = 8_000;
const MAX_TOKENS = 800;

export interface LlmPayload {
  readonly chatId: number;
  readonly prompt: string;
  readonly replyToMessageId?: number;
  readonly updateId: number;
}

export interface LlmConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export interface JobContext {
  readonly bot: Bot;
  readonly sql: Sql;
  readonly queue: Queue;
  readonly config: Config;
  readonly redis?: Redis;
}

export function llmConfig(config: Config): LlmConfig | null {
  const baseUrl = config.LLM_BASE_URL.replace(/\\/+$/, "");
  if (baseUrl === "" || config.LLM_MODEL === "" || config.LLM_API_KEY === "") return null;
  return { baseUrl, model: config.LLM_MODEL, apiKey: config.LLM_API_KEY };
}

function readContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first.message?.content;
  return typeof content === "string" && content.trim() !== "" ? content.trim() : null;
}

// The prompt and the answer stay in memory only; no log sink is used.
export async function ask(prompt: string, config: LlmConfig | null): Promise<string> {
  if (config === null) return ERROR_TEXT;
  try {
    const response = await fetch(config.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return ERROR_TEXT;
    return readContent(await response.json()) ?? ERROR_TEXT;
  } catch {
    return ERROR_TEXT;
  }
}

function parsePayload(payload: unknown): LlmPayload {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("invalid llm payload");
  }
  const value = payload as Record<string, unknown>;
  const { chatId, prompt, replyToMessageId, updateId } = value;
  if (
    !Number.isSafeInteger(chatId) ||
    typeof prompt !== "string" ||
    !Number.isSafeInteger(updateId) ||
    (replyToMessageId !== undefined && !Number.isSafeInteger(replyToMessageId))
  ) {
    throw new Error("invalid llm payload");
  }
  return {
    chatId: chatId as number,
    prompt,
    updateId: updateId as number,
    ...(replyToMessageId === undefined ? {} : { replyToMessageId: replyToMessageId as number }),
  };
}

export async function handle(job: ClaimedJob, ctx: JobContext): Promise<void> {
  const payload = parsePayload(job.payload);
  const answer = await ask(payload.prompt, llmConfig(ctx.config));
  const options =
    payload.replyToMessageId === undefined
      ? undefined
      : { reply_parameters: { message_id: payload.replyToMessageId } };
  await ctx.bot.api.sendMessage(payload.chatId, answer, options);
}
`;
}

export function renderLlmEnqueueTs(): string {
  return `import type { Bot } from "grammy";
import type { Queue } from "../runtime/queue.js";

export const KIND = "llm.request";
export const USAGE_TEXT = "Usage: /llm <prompt>";
export const WORKING_TEXT = "Working on it.";

export interface LlmEnqueue {
  readonly chatId: number;
  readonly prompt: string;
  readonly replyToMessageId?: number;
  readonly updateId: number;
}

export async function enqueueLlm(queue: Queue, payload: LlmEnqueue): Promise<string> {
  return queue.enqueue(KIND, payload, { idempotencyKey: "llm:" + String(payload.updateId) });
}

export function register(bot: Bot, queue: Queue): void {
  bot.command("llm", async (ctx) => {
    const prompt = ctx.match.trim();
    if (prompt === "") {
      await ctx.reply(USAGE_TEXT);
      return;
    }
    const chatId = ctx.chat.id;
    const updateId = ctx.update.update_id;
    const payload: LlmEnqueue = {
      chatId,
      prompt,
      updateId,
      ...(ctx.message?.message_id === undefined ? {} : { replyToMessageId: ctx.message.message_id }),
    };
    await enqueueLlm(queue, payload);
    await ctx.reply(WORKING_TEXT);
  });
}
`;
}

export function renderLlmJobPy(_spec: BotSpec): string {
  return `from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import httpx
from aiogram import Bot
from aiogram.types import ReplyParameters
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.runtime.queue import ClaimedJob, Queue

KIND = "llm.request"
ERROR_TEXT = "The assistant is unavailable right now. Please try again later."
TIMEOUT_SECONDS = 8.0
MAX_TOKENS = 800


@dataclass(frozen=True)
class LlmConfig:
    base_url: str
    model: str
    api_key: str


class JobContext(Protocol):
    bot: Bot
    session_factory: async_sessionmaker[AsyncSession]
    queue: Queue
    settings: Settings
    redis: Redis | None


def llm_config(settings: Settings) -> LlmConfig | None:
    base_url = settings.llm_base_url.rstrip("/")
    if not base_url or not settings.llm_model or not settings.llm_api_key:
        return None
    return LlmConfig(
        base_url=base_url,
        model=settings.llm_model,
        api_key=settings.llm_api_key,
    )


def _read_content(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0]
    if not isinstance(first, dict):
        return None
    message = first.get("message")
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    return None


# The prompt and the answer stay in memory only; no log sink is used.
async def ask(prompt: str, config: LlmConfig | None) -> str:
    if config is None:
        return ERROR_TEXT
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(
                config.base_url + "/chat/completions",
                headers={"authorization": "Bearer " + config.api_key},
                json={
                    "model": config.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": MAX_TOKENS,
                },
            )
        if response.status_code != 200:
            return ERROR_TEXT
        return _read_content(response.json()) or ERROR_TEXT
    except Exception:  # noqa: BLE001
        return ERROR_TEXT


def _parse_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("invalid llm payload")
    chat_id = payload.get("chatId")
    prompt = payload.get("prompt")
    update_id = payload.get("updateId")
    reply_to = payload.get("replyToMessageId")
    if not isinstance(chat_id, int) or isinstance(chat_id, bool):
        raise ValueError("invalid llm payload")
    if not isinstance(prompt, str) or not isinstance(update_id, int) or isinstance(update_id, bool):
        raise ValueError("invalid llm payload")
    if reply_to is not None and (not isinstance(reply_to, int) or isinstance(reply_to, bool)):
        raise ValueError("invalid llm payload")
    parsed: dict[str, Any] = {"chatId": chat_id, "prompt": prompt, "updateId": update_id}
    if reply_to is not None:
        parsed["replyToMessageId"] = reply_to
    return parsed


async def handle(job: ClaimedJob, ctx: JobContext) -> None:
    payload = _parse_payload(job.payload)
    answer = await ask(str(payload["prompt"]), llm_config(ctx.settings))
    reply_to = payload.get("replyToMessageId")
    if reply_to is None:
        await ctx.bot.send_message(payload["chatId"], answer)
    else:
        await ctx.bot.send_message(
            payload["chatId"], answer, reply_parameters=ReplyParameters(message_id=reply_to)
        )
`;
}

export function renderLlmEnqueuePy(): string {
  return `from __future__ import annotations

from typing import Any

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import Message, Update

from app.runtime.queue import Queue

KIND = "llm.request"
USAGE_TEXT = "Usage: /llm <prompt>"
WORKING_TEXT = "Working on it."

router = Router(name="llm")


async def enqueue_llm(
    queue: Queue,
    *,
    chat_id: int,
    prompt: str,
    reply_to_message_id: int | None,
    update_id: int,
) -> str:
    payload: dict[str, Any] = {"chatId": chat_id, "prompt": prompt, "updateId": update_id}
    if reply_to_message_id is not None:
        payload["replyToMessageId"] = reply_to_message_id
    return await queue.enqueue(KIND, payload, idempotency_key="llm:" + str(update_id))


@router.message(Command("llm"))
async def llm_command(
    message: Message,
    command: CommandObject,
    queue: Queue,
    event_update: Update,
) -> None:
    prompt = (command.args or "").strip()
    if not prompt:
        await message.answer(USAGE_TEXT)
        return
    await enqueue_llm(
        queue,
        chat_id=message.chat.id,
        prompt=prompt,
        reply_to_message_id=message.message_id,
        update_id=event_update.update_id,
    )
    await message.answer(WORKING_TEXT)


def register(dp: Dispatcher, _bot: Bot) -> None:
    dp.include_router(router)
`;
}

export function renderBroadcastJobTs(): string {
  return `import type { Bot } from "grammy";
import { GrammyError } from "grammy";
import type { Redis } from "ioredis";
import type { Sql } from "postgres";
import type { Config } from "../config.js";
import type { ClaimedJob, Queue } from "../runtime/queue.js";

export const kind = "broadcast.send";

const GLOBAL_PER_SECOND = 30;
const RATE_KEY_PREFIX = "broadcast:rate:";
const MAX_ERROR_LENGTH = 512;

export interface BroadcastPayload {
  readonly broadcastId: string;
  readonly text: string;
  readonly createdBy: number;
}

export interface JobContext {
  readonly bot: Bot;
  readonly sql: Sql;
  readonly queue: Queue;
  readonly config: Config;
  readonly redis?: Redis;
}

interface BroadcastRow {
  last_user_id: string;
  sent: number;
  failed: number;
  status: string;
}

const RECLAIM_SQL =
  "DELETE FROM broadcast_deliveries WHERE broadcast_id = $1 AND status = 'pending' AND sent_at < now() - make_interval(secs => $2);";
const SELECT_BROADCAST_SQL =
  "SELECT last_user_id, sent, failed, status FROM broadcasts WHERE id = $1;";
const START_SQL = "UPDATE broadcasts SET status = 'running', finished_at = NULL WHERE id = $1;";
const PAGE_USERS_SQL = "SELECT id FROM users WHERE id > $1::bigint ORDER BY id LIMIT 100;";
const CLAIM_DELIVERY_SQL =
  "INSERT INTO broadcast_deliveries (broadcast_id, chat_id, status) VALUES ($1, $2, 'pending') ON CONFLICT (broadcast_id, chat_id) DO NOTHING RETURNING chat_id;";
const UPDATE_DELIVERY_SQL =
  "UPDATE broadcast_deliveries SET status = $3, error = $4, sent_at = now() WHERE broadcast_id = $1 AND chat_id = $2;";
const UPDATE_PROGRESS_SQL =
  "UPDATE broadcasts SET last_user_id = $2::bigint, sent = $3, failed = $4, status = 'running' WHERE id = $1;";
const FINISH_SQL = "UPDATE broadcasts SET status = 'done', finished_at = now() WHERE id = $1;";

interface DeliveryResult {
  readonly chatId: number;
  readonly ok: boolean;
  readonly error: string | null;
}

function parsePayload(payload: unknown): BroadcastPayload {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("invalid broadcast payload");
  }
  const value = payload as Record<string, unknown>;
  const { broadcastId, text, createdBy } = value;
  if (
    typeof broadcastId !== "string" ||
    broadcastId === "" ||
    typeof text !== "string" ||
    text === "" ||
    typeof createdBy !== "number" ||
    !Number.isSafeInteger(createdBy)
  ) {
    throw new Error("invalid broadcast payload");
  }
  return { broadcastId, text, createdBy };
}

function clipError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

// Global fixed window shared by every worker:
// INCR broadcast:rate:<second> and EXPIRE 2. Over-limit workers wait for the
// next second instead of bursting past Telegram's 30 messages/second cap.
async function takeRateSlot(redis: Redis): Promise<void> {
  for (;;) {
    const key = RATE_KEY_PREFIX + String(Math.floor(Date.now() / 1000));
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 2);
    }
    if (count <= GLOBAL_PER_SECOND) return;
    await sleep(Math.max(1, 1000 - (Date.now() % 1000)));
  }
}

function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof GrammyError)) return null;
  const retryAfter = error.parameters?.retry_after;
  if (error.error_code !== 429 || typeof retryAfter !== "number") return null;
  return retryAfter;
}

async function sendWithRetry(bot: Bot, chatId: number, text: string): Promise<DeliveryResult> {
  try {
    await bot.api.sendMessage(chatId, text);
    return { chatId, ok: true, error: null };
  } catch (error) {
    const retryAfter = retryAfterSeconds(error);
    if (retryAfter === null) return { chatId, ok: false, error: clipError(error) };
    await sleep(retryAfter * 1000);
    try {
      await bot.api.sendMessage(chatId, text);
      return { chatId, ok: true, error: null };
    } catch (retryError) {
      return { chatId, ok: false, error: clipError(retryError) };
    }
  }
}

export async function handle(job: ClaimedJob, ctx: JobContext): Promise<void> {
  const payload = parsePayload(job.payload);
  const redis = ctx.redis;
  if (redis === undefined) throw new Error("broadcast requires REDIS_URL");

  // A crashed worker leaves 'pending' delivery claims behind; recycle them so
  // the resumed job still reaches those users.
  await ctx.sql.unsafe(RECLAIM_SQL, [
    payload.broadcastId,
    ctx.config.QUEUE_VISIBILITY_TIMEOUT_SECONDS,
  ]);

  const rows = (await ctx.sql.unsafe(SELECT_BROADCAST_SQL, [
    payload.broadcastId,
  ])) as unknown as BroadcastRow[];
  const broadcast = rows[0];
  if (broadcast === undefined || broadcast.status === "done") return;

  let lastUserId = Number(broadcast.last_user_id);
  let sent = Number(broadcast.sent);
  let failed = Number(broadcast.failed);

  await ctx.sql.unsafe(START_SQL, [payload.broadcastId]);

  for (;;) {
    const page = (await ctx.sql.unsafe(PAGE_USERS_SQL, [
      lastUserId,
    ])) as unknown as { id: string }[];
    if (page.length === 0) break;

    const results: DeliveryResult[] = [];
    for (const user of page) {
      const chatId = Number(user.id);
      // The delivery primary key makes the claim exclusive across workers: only
      // the worker that inserts the row sends this message.
      const claimed = (await ctx.sql.unsafe(CLAIM_DELIVERY_SQL, [
        payload.broadcastId,
        chatId,
      ])) as unknown as { chat_id: string }[];
      if (claimed.length === 0) continue;

      await takeRateSlot(redis);
      const result = await sendWithRetry(ctx.bot, chatId, payload.text);
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
      }
      results.push(result);
    }

    const last = page.at(-1);
    if (last !== undefined) lastUserId = Number(last.id);

    // Delivery statuses, counters, and the cursor commit together so a restart
    // resumes at exactly this page boundary.
    await ctx.sql.begin(async (tx) => {
      for (const result of results) {
        await tx.unsafe(UPDATE_DELIVERY_SQL, [
          payload.broadcastId,
          result.chatId,
          result.ok ? "sent" : "failed",
          result.error,
        ]);
      }
      await tx.unsafe(UPDATE_PROGRESS_SQL, [payload.broadcastId, lastUserId, sent, failed]);
    });
  }

  await ctx.sql.unsafe(FINISH_SQL, [payload.broadcastId]);
}
`;
}

export function renderBroadcastJobPy(): string {
  return `from __future__ import annotations

import asyncio
import time
from typing import Any, Protocol

from aiogram import Bot
from aiogram.exceptions import TelegramRetryAfter
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.runtime.queue import ClaimedJob, Queue

KIND = "broadcast.send"
GLOBAL_PER_SECOND = 30
RATE_KEY_PREFIX = "broadcast:rate:"
MAX_ERROR_LENGTH = 512

RECLAIM_SQL = text(
    """
    DELETE FROM broadcast_deliveries
    WHERE broadcast_id = :broadcast_id
      AND status = 'pending'
      AND sent_at < now() - make_interval(secs => :visibility)
    """
)
SELECT_BROADCAST_SQL = text(
    "SELECT last_user_id, sent, failed, status FROM broadcasts WHERE id = :broadcast_id"
)
START_SQL = text(
    "UPDATE broadcasts SET status = 'running', finished_at = NULL WHERE id = :broadcast_id"
)
PAGE_USERS_SQL = text(
    "SELECT id FROM users WHERE id > :last_user_id::bigint ORDER BY id LIMIT 100"
)
CLAIM_DELIVERY_SQL = text(
    """
    INSERT INTO broadcast_deliveries (broadcast_id, chat_id, status)
    VALUES (:broadcast_id, :chat_id, 'pending')
    ON CONFLICT (broadcast_id, chat_id) DO NOTHING
    RETURNING chat_id
    """
)
UPDATE_DELIVERY_SQL = text(
    """
    UPDATE broadcast_deliveries
    SET status = :status, error = :error, sent_at = now()
    WHERE broadcast_id = :broadcast_id AND chat_id = :chat_id
    """
)
UPDATE_PROGRESS_SQL = text(
    """
    UPDATE broadcasts
    SET last_user_id = :last_user_id::bigint, sent = :sent, failed = :failed,
        status = 'running'
    WHERE id = :broadcast_id
    """
)
FINISH_SQL = text(
    "UPDATE broadcasts SET status = 'done', finished_at = now() WHERE id = :broadcast_id"
)


class JobContext(Protocol):
    bot: Bot
    session_factory: async_sessionmaker[AsyncSession]
    queue: Queue
    settings: Settings
    redis: Redis | None


def _parse_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("invalid broadcast payload")
    broadcast_id = payload.get("broadcastId")
    message_text = payload.get("text")
    created_by = payload.get("createdBy")
    if not isinstance(broadcast_id, str) or not broadcast_id:
        raise ValueError("invalid broadcast payload")
    if not isinstance(message_text, str) or not message_text:
        raise ValueError("invalid broadcast payload")
    if not isinstance(created_by, int) or isinstance(created_by, bool):
        raise ValueError("invalid broadcast payload")
    return {"broadcastId": broadcast_id, "text": message_text, "createdBy": created_by}


def _clip_error(error: BaseException) -> str:
    return str(error)[:MAX_ERROR_LENGTH]


# Global fixed window shared by every worker:
# INCR broadcast:rate:<second> and EXPIRE 2. Over-limit workers wait for the
# next second instead of bursting past Telegram's 30 messages/second cap.
async def take_rate_slot(redis: Redis) -> None:
    while True:
        key = RATE_KEY_PREFIX + str(int(time.time()))
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 2)
        if count <= GLOBAL_PER_SECOND:
            return
        await asyncio.sleep(max(0.001, 1.0 - (time.time() % 1.0)))


async def send_with_retry(bot: Bot, chat_id: int, message_text: str) -> tuple[bool, str | None]:
    try:
        await bot.send_message(chat_id, message_text)
        return True, None
    except TelegramRetryAfter as error:
        await asyncio.sleep(error.retry_after)
        try:
            await bot.send_message(chat_id, message_text)
            return True, None
        except Exception as retry_error:  # noqa: BLE001
            return False, _clip_error(retry_error)
    except Exception as error:  # noqa: BLE001
        return False, _clip_error(error)


async def handle(job: ClaimedJob, ctx: JobContext) -> None:
    payload = _parse_payload(job.payload)
    redis = ctx.redis
    if redis is None:
        raise RuntimeError("broadcast requires REDIS_URL")

    broadcast_id = payload["broadcastId"]
    async with ctx.session_factory() as session:
        async with session.begin():
            await session.execute(
                RECLAIM_SQL,
                {
                    "broadcast_id": broadcast_id,
                    "visibility": ctx.settings.queue_visibility_timeout_seconds,
                },
            )
            row = (
                await session.execute(SELECT_BROADCAST_SQL, {"broadcast_id": broadcast_id})
            ).mappings().first()
    if row is None or row["status"] == "done":
        return

    last_user_id = int(row["last_user_id"])
    sent = int(row["sent"])
    failed = int(row["failed"])

    async with ctx.session_factory() as session:
        async with session.begin():
            await session.execute(START_SQL, {"broadcast_id": broadcast_id})

    while True:
        async with ctx.session_factory() as session:
            page = [
                int(page_row[0])
                for page_row in await session.execute(
                    PAGE_USERS_SQL, {"last_user_id": last_user_id}
                )
            ]
        if not page:
            break

        results: list[tuple[int, bool, str | None]] = []
        for chat_id in page:
            async with ctx.session_factory() as session:
                async with session.begin():
                    # The delivery primary key makes the claim exclusive across
                    # workers: only the worker that inserts the row sends.
                    claimed = (
                        await session.execute(
                            CLAIM_DELIVERY_SQL,
                            {"broadcast_id": broadcast_id, "chat_id": chat_id},
                        )
                    ).first()
            if claimed is None:
                continue

            await take_rate_slot(redis)
            ok, error = await send_with_retry(ctx.bot, chat_id, payload["text"])
            if ok:
                sent += 1
            else:
                failed += 1
            results.append((chat_id, ok, error))

        last_user_id = page[-1]
        # Delivery statuses, counters, and the cursor commit together so a
        # restart resumes at exactly this page boundary.
        async with ctx.session_factory() as session:
            async with session.begin():
                for chat_id, ok, error in results:
                    await session.execute(
                        UPDATE_DELIVERY_SQL,
                        {
                            "broadcast_id": broadcast_id,
                            "chat_id": chat_id,
                            "status": "sent" if ok else "failed",
                            "error": error,
                        },
                    )
                await session.execute(
                    UPDATE_PROGRESS_SQL,
                    {
                        "broadcast_id": broadcast_id,
                        "last_user_id": last_user_id,
                        "sent": sent,
                        "failed": failed,
                    },
                )

    async with ctx.session_factory() as session:
        async with session.begin():
            await session.execute(FINISH_SQL, {"broadcast_id": broadcast_id})
`;
}

export function renderBroadcastCommandTs(): string {
  return `import type { Bot } from "grammy";
import type { Redis } from "ioredis";
import type { Sql } from "postgres";
import type { Config } from "../config.js";
import { kind as BROADCAST_KIND } from "../jobs/broadcast.js";
import type { Queue } from "../runtime/queue.js";

export interface BroadcastDeps {
  readonly sql: Sql;
  readonly queue: Queue;
  readonly config: Config;
  readonly redis?: Redis;
}

const ADMIN_ONLY_TEXT = "This command is restricted to administrators.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSERT_BROADCAST_SQL =
  "INSERT INTO broadcasts (text, created_by) VALUES ($1, $2) RETURNING id;";
const SELECT_BROADCAST_SQL = "SELECT status, sent, failed, last_user_id FROM broadcasts WHERE id = $1;";

function isAdmin(config: Config, userId: number | undefined): boolean {
  if (userId === undefined || !Number.isSafeInteger(userId)) return false;
  return config.ADMIN_IDS.includes(userId);
}

export function register(bot: Bot, deps: BroadcastDeps): void {
  bot.command("broadcast", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined || !isAdmin(deps.config, userId)) {
      await ctx.reply(ADMIN_ONLY_TEXT);
      return;
    }
    const text = ctx.match.trim();
    if (text === "") {
      await ctx.reply("Usage: /broadcast <text>");
      return;
    }
    const rows = (await deps.sql.unsafe(INSERT_BROADCAST_SQL, [
      text,
      userId,
    ])) as unknown as { id: string }[];
    const broadcastId = rows[0]?.id;
    if (broadcastId === undefined) throw new Error("broadcast insert failed");
    await deps.queue.enqueue(
      BROADCAST_KIND,
      { broadcastId, text, createdBy: userId },
      { idempotencyKey: "broadcast:" + broadcastId },
    );
    await ctx.reply("Broadcast " + broadcastId + " queued.");
  });

  bot.command("broadcast_status", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId === undefined || !isAdmin(deps.config, userId)) {
      await ctx.reply(ADMIN_ONLY_TEXT);
      return;
    }
    const broadcastId = ctx.match.trim();
    if (!UUID_RE.test(broadcastId)) {
      await ctx.reply("Usage: /broadcast_status <broadcast id>");
      return;
    }
    const rows = (await deps.sql.unsafe(SELECT_BROADCAST_SQL, [
      broadcastId,
    ])) as unknown as {
      status: string;
      sent: number;
      failed: number;
      last_user_id: string;
    }[];
    const row = rows[0];
    if (row === undefined) {
      await ctx.reply("Broadcast not found.");
      return;
    }
    await ctx.reply(
      "status=" +
        row.status +
        " sent=" +
        String(row.sent) +
        " failed=" +
        String(row.failed) +
        " last_user_id=" +
        String(row.last_user_id),
    );
  });
}
`;
}

export function renderBroadcastCommandPy(): string {
  return `from __future__ import annotations

import re

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import Message
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.jobs.broadcast import KIND as BROADCAST_KIND
from app.runtime.queue import Queue

ADMIN_ONLY_TEXT = "This command is restricted to administrators."
UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

router = Router(name="broadcast")


def _is_admin(settings: Settings, user_id: int | None) -> bool:
    return user_id is not None and user_id in settings.admin_id_set


@router.message(Command("broadcast"))
async def broadcast_command(
    message: Message,
    command: CommandObject,
    session_factory: async_sessionmaker[AsyncSession],
    queue: Queue,
    settings: Settings,
) -> None:
    user = message.from_user
    if user is None or not _is_admin(settings, user.id):
        await message.answer(ADMIN_ONLY_TEXT)
        return
    broadcast_text = (command.args or "").strip()
    if not broadcast_text:
        await message.answer("Usage: /broadcast <text>")
        return
    async with session_factory() as session:
        async with session.begin():
            result = await session.execute(
                text(
                    "INSERT INTO broadcasts (text, created_by) "
                    "VALUES (:text, :created_by) RETURNING id"
                ),
                {"text": broadcast_text, "created_by": user.id},
            )
            row = result.first()
    if row is None:
        raise RuntimeError("broadcast insert failed")
    broadcast_id = str(row[0])
    await queue.enqueue(
        BROADCAST_KIND,
        {"broadcastId": broadcast_id, "text": broadcast_text, "createdBy": user.id},
        idempotency_key="broadcast:" + broadcast_id,
    )
    await message.answer("Broadcast " + broadcast_id + " queued.")


@router.message(Command("broadcast_status"))
async def broadcast_status(
    message: Message,
    command: CommandObject,
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
) -> None:
    user = message.from_user
    if user is None or not _is_admin(settings, user.id):
        await message.answer(ADMIN_ONLY_TEXT)
        return
    broadcast_id = (command.args or "").strip()
    if not UUID_PATTERN.match(broadcast_id):
        await message.answer("Usage: /broadcast_status <broadcast id>")
        return
    async with session_factory() as session:
        async with session.begin():
            row = (
                await session.execute(
                    text(
                        "SELECT status, sent, failed FROM broadcasts WHERE id = :id"
                    ),
                    {"id": broadcast_id},
                )
            ).mappings().first()
    if row is None:
        await message.answer("Broadcast not found.")
        return
    await message.answer(
        "status=" + str(row["status"]) + " sent=" + str(row["sent"]) + " failed=" + str(row["failed"])
    )


def register(dp: Dispatcher, _bot: Bot) -> None:
    dp.include_router(router)
`;
}

export function renderUserSyncTs(): string {
  return `import type { Bot, Context, MiddlewareFn } from "grammy";
import type { Sql } from "postgres";

const MAX_USERNAME = 32;
const MAX_DISPLAY_NAME = 64;

const USER_UPSERT_SQL =
  "INSERT INTO users (id, username, display_name) VALUES ($1, $2, $3) " +
  "ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, " +
  "display_name = EXCLUDED.display_name, updated_at = now();";

export interface UserSyncDeps {
  readonly sql: Sql;
}

export function userSyncMiddleware(sql: Sql): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const from = ctx.from;
    if (from !== undefined && from.id > 0) {
      const username = from.username === undefined ? null : from.username.slice(0, MAX_USERNAME);
      const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ").slice(0, MAX_DISPLAY_NAME);
      await sql.unsafe(USER_UPSERT_SQL, [from.id, username, displayName]);
    }
    await next();
  };
}

export function register(bot: Bot, deps: UserSyncDeps): void {
  bot.use(userSyncMiddleware(deps.sql));
}
`;
}

export function renderUserSyncPy(): string {
  return `from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware, Bot, Dispatcher
from aiogram.types import TelegramObject
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

USER_UPSERT_SQL = text(
    """
    INSERT INTO users (id, username, display_name)
    VALUES (:id, :username, :display_name)
    ON CONFLICT (id) DO UPDATE
    SET username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        updated_at = now()
    """
)
MAX_USERNAME = 32
MAX_DISPLAY_NAME = 64


def _display_name(first_name: str, last_name: str | None) -> str:
    return " ".join(part for part in (first_name, last_name) if part)[:MAX_DISPLAY_NAME]


class UserSyncMiddleware(BaseMiddleware):
    def __init__(
        self, session_factory: async_sessionmaker[AsyncSession] | None = None
    ) -> None:
        self._session_factory = session_factory

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = getattr(event, "from_user", None)
        session_factory = data.get("session_factory") or self._session_factory
        if user is not None and session_factory is not None:
            username = user.username[:MAX_USERNAME] if user.username else None
            async with session_factory() as session:
                async with session.begin():
                    await session.execute(
                        USER_UPSERT_SQL,
                        {
                            "id": user.id,
                            "username": username,
                            "display_name": _display_name(user.first_name, user.last_name),
                        },
                    )
        return await handler(event, data)


def register(dp: Dispatcher, _bot: Bot) -> None:
    dp.update.middleware(UserSyncMiddleware())
`;
}
