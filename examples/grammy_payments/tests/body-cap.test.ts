import { expect, test } from "bun:test";
import { request } from "node:http";
import type { Bot } from "grammy";
import { createServer } from "../src/server.js";

function fakeBot(): Bot {
  return {
    isRunning: () => false,
    init: async () => undefined,
    handleUpdate: async () => undefined,
  } as unknown as Bot;
}

function postChunked(port: number): Promise<"rejected" | "responded"> {
  const { promise, resolve, reject } = Promise.withResolvers<"rejected" | "responded">();
  const req = request(
    {
      host: "127.0.0.1",
      port,
      path: "/telegram/webhook",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "expected_secret",
      },
    },
    (res) => {
      res.resume();
      reject(new Error("server responded with " + String(res.statusCode)));
    },
  );
  req.on("error", () => resolve("rejected"));
  req.write(Buffer.alloc(600_000, 0x61));
  req.write(Buffer.alloc(600_000, 0x61));
  req.end();
  return promise;
}

test("destroys the connection on a chunked body over 1 MiB", async () => {
  const server = await createServer(fakeBot(), "expected_secret", "");
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", resolve);
  await promise;
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    expect(await postChunked(address.port)).toBe("rejected");
  } finally {
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    server.close(() => onClosed());
    await closed;
  }
});
