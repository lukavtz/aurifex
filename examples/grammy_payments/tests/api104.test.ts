import { expect, test } from "bun:test";
import type { Bot } from "grammy";
import type { Message } from "grammy/types";
import { api104 } from "../src/telegram/api104.js";

interface Call {
  readonly method: string;
  readonly payload: unknown;
}

function fakeBot(calls: Call[]): Bot {
  const raw = new Proxy(
    {},
    {
      get: (_target, property) => async (payload: unknown) => {
        calls.push({ method: String(property), payload });
        return property === "sendWidget" || property === "sendRichMessage"
          ? ({ message_id: 1 } as Message)
          : true;
      },
    },
  );
  return { api: { raw } } as unknown as Bot;
}

test("sendWidget forwards the payload through the raw client", async () => {
  const calls: Call[] = [];
  const api = api104(fakeBot(calls));
  await api.sendWidget({ chat_id: 1, html: "<b>hi</b>" });
  expect(calls).toEqual([{ method: "sendWidget", payload: { chat_id: 1, html: "<b>hi</b>" } }]);
});

test("answerWidgetQuery forwards the query id", async () => {
  const calls: Call[] = [];
  const api = api104(fakeBot(calls));
  await api.answerWidgetQuery({ widget_query_id: "q1", data: "ok" });
  expect(calls).toEqual([
    { method: "answerWidgetQuery", payload: { widget_query_id: "q1", data: "ok" } },
  ]);
});

test("sendMessageEphemeral uses the raw sendMessage method", async () => {
  const calls: Call[] = [];
  const api = api104(fakeBot(calls));
  await api.sendMessageEphemeral({
    text: "hello",
    ephemeral_message_parameters: { receiver_user_id: 7 },
  });
  expect(calls[0]?.method).toBe("sendMessage");
});

test("sendRichMessageDraft forwards the draft id", async () => {
  const calls: Call[] = [];
  const api = api104(fakeBot(calls));
  await api.sendRichMessageDraft({
    chat_id: 1,
    draft_id: 42,
    rich_message: { markdown: "Generating..." },
  });
  expect(calls[0]?.payload).toMatchObject({ chat_id: 1, draft_id: 42 });
});
