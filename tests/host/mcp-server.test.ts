import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

import { type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import { toolResult } from "../../src/adapters/mcp/server.ts";
import { domainFailure, domainSuccess } from "../../src/core/results.ts";

function structuredStatus(result: CallToolResult): string {
  return z.object({ status: z.string() }).loose().parse(result.structuredContent).status;
}

const repoRoot = resolve(import.meta.dirname, "../..");
const serverPath = join(repoRoot, "src/adapters/mcp/server.ts");

const responseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
type JsonRpcResponse = z.infer<typeof responseSchema>;

const toolsSchema = z.object({
  tools: z.array(z.object({ name: z.string(), description: z.string() }).loose()),
});

const callResultSchema = z.object({
  isError: z.boolean(),
  structuredContent: z.object({ status: z.string() }).loose(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()),
});

class StdioClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, (message: JsonRpcResponse) => void>();
  readonly #stdout: string[] = [];
  #buffer = "";
  #nextId = 1;

  constructor(env: NodeJS.ProcessEnv, entry: string = serverPath) {
    this.#child = spawn(process.execPath, ["--experimental-strip-types", entry], {
      cwd: repoRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk: string) => this.#onData(chunk));
    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", () => undefined);
  }

  #onData(chunk: string): void {
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line === "") continue;
      this.#stdout.push(line);
      const parsed = responseSchema.safeParse(JSON.parse(line));
      if (!parsed.success) continue;
      const resolvePending = this.#pending.get(parsed.data.id);
      this.#pending.delete(parsed.data.id);
      resolvePending?.(parsed.data);
    }
  }

  request(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.#nextId++;
    // Hang guard only; the server answers all three requests well under this bound.
    const { promise, resolve: resolveResponse, reject } = Promise.withResolvers<JsonRpcResponse>();
    const timer = setTimeout(() => {
      this.#pending.delete(id);
      reject(new Error(`timeout waiting for ${method}`));
    }, 30_000);
    this.#pending.set(id, (message) => {
      clearTimeout(timer);
      resolveResponse(message);
    });
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return promise;
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  assertOnlyJsonStdout(): void {
    assert.ok(this.#stdout.length > 0, "server wrote nothing to stdout");
    for (const line of this.#stdout) {
      assert.doesNotThrow(() => JSON.parse(line), `non-JSON stdout line: ${line}`);
    }
  }

  async close(): Promise<void> {
    this.#child.stdin.end();
    const { promise, resolve: resolveExit } = Promise.withResolvers<void>();
    this.#child.once("exit", () => resolveExit());
    setTimeout(() => {
      this.#child.kill("SIGKILL");
      resolveExit();
    }, 10_000).unref();
    await promise;
  }
}

let root = "";
let client: StdioClient | undefined;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "aurifex-mcp-"));
});

after(async () => {
  await client?.close();
  if (root !== "") await rm(root, { recursive: true, force: true });
});

test("toolResult marks failures and caps oversized output", () => {
  const ok = toolResult(domainSuccess({ value: "small" }));
  assert.equal(ok.isError, false);
  assert.equal(structuredStatus(ok), "ok");

  const failed = toolResult(
    domainFailure({ code: "invalid_request", detail: "bad", retryable: false }),
  );
  assert.equal(failed.isError, true);

  const oversized = toolResult(domainSuccess({ blob: "x".repeat(300_000) }));
  assert.equal(oversized.isError, true);
  assert.equal(structuredStatus(oversized), "error");
  const content = oversized.content[0];
  assert.equal(content?.type, "text");
  const body = z
    .object({ error: z.object({ code: z.string() }) })
    .parse(JSON.parse(content?.type === "text" ? content.text : ""));
  assert.equal(body.error.code, "output_too_large");
});

test("stdio server exposes 9 tools and resolves targets", { timeout: 60_000 }, async () => {
  client = new StdioClient({ ...process.env, AURIFEX_ROOT: root });

  const initialized = await client.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "aurifex-test", version: "0.0.0" },
  });
  assert.equal(initialized.error, undefined);
  client.notify("notifications/initialized");

  const listed = await client.request("tools/list", {});
  assert.equal(listed.error, undefined);
  const tools = toolsSchema.parse(listed.result).tools;
  assert.equal(tools.length, 9);
  assert.deepEqual(tools.map((tool) => tool.name).toSorted(), [
    "telegram_bot_add_feature",
    "telegram_bot_deploy_plan",
    "telegram_bot_inspect",
    "telegram_bot_scaffold",
    "telegram_bot_target_resolve",
    "telegram_bot_test_harness",
    "telegram_bot_upgrade",
    "telegram_bot_upgrade_plan",
    "telegram_bot_verify",
  ]);
  for (const name of ["telegram_bot_scaffold", "telegram_bot_add_feature"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.match(tool?.description ?? "", /skills\/telegram-bot-discovery/);
    assert.match(tool?.description ?? "", /confirm/i);
  }
  assert.equal(
    tools.find((tool) => tool.name === "telegram_bot_verify")?.description,
    "Run static file-content checks; no project code execution, network, or Telegram calls.",
  );

  const called = await client.request("tools/call", {
    name: "telegram_bot_target_resolve",
    arguments: { stack: "grammy" },
  });
  assert.equal(called.error, undefined);
  const outcome = callResultSchema.parse(called.result);
  assert.equal(outcome.structuredContent.status, "ok");
  assert.equal(outcome.isError, false);
  assert.equal(outcome.content[0]?.type, "text");
  const body = z.object({ status: z.string() }).parse(JSON.parse(outcome.content[0]?.text ?? ""));
  assert.equal(body.status, "ok");

  client.assertOnlyJsonStdout();
});

test(
  "server exposes nine tools without any installed node_modules",
  { timeout: 60_000 },
  async (t) => {
    const isolated = await mkdtemp(join(tmpdir(), "aurifex-mcp-isolated-"));
    t.after(() => rm(isolated, { recursive: true, force: true }));
    await cp(join(repoRoot, "src"), join(isolated, "src"), {
      recursive: true,
      filter: (source) => !source.includes("node_modules"),
    });
    const bare = new StdioClient(
      { ...process.env, AURIFEX_ROOT: isolated },
      join(isolated, "src", "adapters", "mcp", "server.ts"),
    );
    try {
      const initialized = await bare.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "aurifex-isolated", version: "0.0.0" },
      });
      assert.equal(initialized.error, undefined);
      const listed = await bare.request("tools/list", {});
      assert.equal(listed.error, undefined);
      assert.equal(toolsSchema.parse(listed.result).tools.length, 9);
    } finally {
      await bare.close();
    }
  },
);

test(
  "initialize answers only with the supported protocol version",
  { timeout: 60_000 },
  async () => {
    for (const [requested, expected] of [
      ["2025-11-25", "2025-11-25"],
      ["1999-01-01", "2025-11-25"],
    ] as const) {
      const versionClient = new StdioClient({ ...process.env, AURIFEX_ROOT: root });
      try {
        const initialized = await versionClient.request("initialize", {
          protocolVersion: requested,
          capabilities: {},
          clientInfo: { name: "aurifex-version", version: "0.0.0" },
        });
        assert.equal(initialized.error, undefined);
        const version = z
          .object({ protocolVersion: z.string() })
          .parse(initialized.result).protocolVersion;
        assert.equal(version, expected, `requested ${requested}`);
        const listed = await versionClient.request("tools/list", {});
        assert.equal(toolsSchema.parse(listed.result).tools.length, 9);
      } finally {
        await versionClient.close();
      }
    }
  },
);
