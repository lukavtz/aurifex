export function renderWidgetsModule(): string {
  return `import type { Bot } from "grammy";
import { logger } from "../logger.js";
import { api104 } from "../telegram/api104.js";

interface WidgetQuery {
  readonly id: string;
  readonly data?: string;
  readonly type?: unknown;
}

function isWidgetQuery(value: unknown): value is WidgetQuery {
  if (typeof value !== "object" || value === null) return false;
  const query = value as Record<string, unknown>;
  return typeof query.id === "string" && query.id !== "" &&
    (query.type === undefined || (typeof query.type === "object" && query.type !== null)) &&
    (query.data === undefined || (typeof query.data === "string" && Buffer.byteLength(query.data, "utf8") <= 1024));
}

export function register(bot: Bot): void {
  const api = api104(bot);
  // Bot API 10.4 fields precede grammY's filter vocabulary.
  bot.use(async (ctx, next) => {
    const update = ctx.update as unknown as Record<string, unknown>;
    for (const kind of ["widget_query", "shared_widget_query"] as const) {
      if (update[kind] === undefined) continue;
      const query = update[kind];
      if (!isWidgetQuery(query)) {
        logger.warn({ kind }, "malformed or unknown widget query; not answered");
        continue;
      }
      try {
        await api.answerWidgetQuery({ widget_query_id: query.id, ...(query.data === undefined ? {} : { data: query.data }) });
      } catch (error) {
        logger.error({ kind, message: error instanceof Error ? error.message : "unknown" }, "answerWidgetQuery failed");
      }
    }
    await next();
  });
}
`;
}

export function renderWidgetsTest(): string {
  return `import assert from "node:assert/strict";
import { test } from "node:test";
import { Bot } from "grammy";
import type { Update } from "grammy/types";
import { register } from "../src/features/widgets.js";

const BOT_INFO = { id: 1, is_bot: true, first_name: "T", username: "test_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false } as const;

test("real grammY dispatch answers top-level widgets and passes other updates", async () => {
  const bot = new Bot("1:test", { botInfo: BOT_INFO });
  const calls: { method: string; payload: unknown }[] = [];
  bot.api.config.use(async (_prev, method, payload, _signal) => { calls.push({ method, payload }); return { ok: true, result: true } as never; });
  register(bot);
  let passed = 0;
  bot.use(async () => { passed += 1; });
  const update = async (value: unknown) => bot.handleUpdate(value as Update);
  await update({ update_id: 1, widget_query: { id: "one", data: "actual", type: {} } });
  await update({ update_id: 2, shared_widget_query: { id: "two", type: {} } });
  await update({ update_id: 3, widget_query: { data: "no id" } });
  await update({ update_id: 4, widget_query: { id: "bad", type: "unknown" } });
  await update({ update_id: 5, widget_query: { id: "large", data: "界".repeat(342) } });
  await update({ update_id: 6, message: { message_id: 1, date: 0, chat: { id: 1, type: "private" }, text: "hello" } });
  assert.deepEqual(calls, [
    { method: "answerWidgetQuery", payload: { widget_query_id: "one", data: "actual" } },
    { method: "answerWidgetQuery", payload: { widget_query_id: "two" } },
  ]);
  assert.equal(passed, 6);
});
`;
}
