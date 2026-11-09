import { expect, test } from "bun:test";
import type { Bot } from "grammy";
import { createServer } from "../src/server.js";

function fakeBot(): Bot {
  return {
    isRunning: () => false,
    init: async () => undefined,
    handleUpdate: async () => undefined,
  } as unknown as Bot;
}

test("rejects webhook requests without the secret header", async () => {
  const server = await createServer(fakeBot(), "expected_secret");
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", onListening);
  await listening;
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    const response = await fetch("http://127.0.0.1:" + String(address.port) + "/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(response.status).toBe(401);
  } finally {
    const { promise, resolve } = Promise.withResolvers<void>();
    server.close(() => resolve());
    await promise;
  }
});
