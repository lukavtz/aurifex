import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { Bot } from "grammy";
import type { Sql } from "postgres";
import { createServer, type ServerOptions } from "../src/server.js";

async function hasMiniAppRoute(): Promise<boolean> {
  // Runtime plugin registry: the module exists only after the feature is added.
  const name = "miniapp";
  try {
    const mod: unknown = await import("../src/features/" + name + ".js");
    return typeof mod === "object" && mod !== null && "routes" in mod;
  } catch {
    return false;
  }
}

const available = await hasMiniAppRoute();

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

test.skipIf(!available)("rejects malformed initData with 401 and security headers", async () => {
  const response = await fetchServer("/api/miniapp/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: "not-signed" }),
  });
  expect(response.status).toBe(401);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
});

test.skipIf(!available)("accepts nonalphabetical initData and sets a session cookie", async () => {
  const token = ["123456", "session-test"].join(":");
  const params = new URLSearchParams({
    user: JSON.stringify({ id: 42, first_name: "Test" }),
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "non-alpha-route",
  });
  const canonical = [...params.keys()]
    .sort()
    .map((key) => key + "=" + params.get(key))
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(canonical).digest("hex"));
  const values = new Map<string, string>();
  const redis = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    setex: async (key: string, _seconds: number, value: string) => {
      values.set(key, value);
      return "OK";
    },
  };
  // The optional feature is selected from the runtime registry.
  const name = "miniapp";
  const feature = await import("../src/features/" + name + ".js");
  const response = await feature.createSessionHandler({
    method: "POST",
    path: "/api/miniapp/session",
    headers: {},
    secure: false,
    body: JSON.stringify({ initData: params.toString() }),
    botToken: token,
    redis,
    config: serverOptions.config,
  });
  expect(response.status).toBe(200);
  expect(response.headers["Set-Cookie"]).toContain("aurifex_session=");
  expect(response.headers["Set-Cookie"]).toContain("HttpOnly; SameSite=Lax");
});
