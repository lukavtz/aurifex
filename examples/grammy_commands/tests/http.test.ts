import { expect, test } from "bun:test";
import type { Bot } from "grammy";
import type { Sql } from "postgres";
import { createServer, type ServerOptions } from "../src/http/server.js";

function fakeBot(): Bot {
  return {
    isRunning: () => false,
    init: async () => undefined,
    handleUpdate: async () => undefined,
  } as unknown as Bot;
}

const serverOptions: ServerOptions = {
  config: {
    MINIAPP_SESSION_TTL_SECONDS: 86_400,
    MINIAPP_ALLOWED_ORIGINS: "",
  } as unknown as ServerOptions["config"],
};

async function fetchServer(
  path: string,
  init: RequestInit = {},
  options: ServerOptions = serverOptions,
): Promise<Response> {
  const server = await createServer(
    fakeBot(),
    "expected_secret",
    ["123456", "session-test"].join(":"),
    options,
  );
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", resolve);
  await promise;
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    return await fetch("http://127.0.0.1:" + String(address.port) + path, init);
  } finally {
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    server.close(() => onClosed());
    await closed;
  }
}

test("healthz returns ok without dependencies", async () => {
  const response = await fetchServer("/healthz");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

test("readyz returns the 503 shape when postgres fails", async () => {
  const failingSql = (() => {
    throw new Error("postgres down");
  }) as unknown as Sql;
  const response = await fetchServer("/readyz", {}, { ...serverOptions, sql: failingSql });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    ok: false,
    checks: { postgres: "fail", redis: "skip" },
  });
});

test("metrics exposes the bounded metric names", async () => {
  const response = await fetchServer("/metrics");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/plain");
  const body = await response.text();
  expect(body).toContain("bot_updates_total");
  expect(body).toContain("job_failures_total");
});
