#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { createCoreOperations, type CoreOperations } from "../../core/operations.ts";
import { domainFailure, serializeDomainResult, type DomainResult } from "../../core/results.ts";

const MAX_RESULT_BYTES = 262_144;
const SERVER_VERSION = "0.3.1";
const PROTOCOL_VERSION = "2025-11-25";

/**
 * Tool result shape. Mirrors the MCP `CallToolResult` structurally so the
 * plugin keeps working when installed without node_modules (Claude plugin
 * cache copies never carry runtime dependencies).
 */
export interface CallToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

export function toolResult(result: DomainResult<unknown>): CallToolResult {
  let text = serializeDomainResult(result);
  let payload: DomainResult<unknown> = result;
  if (Buffer.byteLength(text, "utf8") > MAX_RESULT_BYTES) {
    payload = domainFailure({
      code: "output_too_large",
      detail: `result exceeds ${MAX_RESULT_BYTES} bytes`,
      retryable: false,
    });
    text = serializeDomainResult(payload);
  }
  return {
    content: [{ type: "text", text }],
    structuredContent: payload as unknown as Record<string, unknown>,
    isError: payload.status === "error",
  };
}

interface JsonSchema {
  readonly type?: "object" | "string" | "boolean";
  readonly enum?: readonly string[];
  readonly minLength?: number;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  run(operations: CoreOperations, args: Record<string, unknown>): Promise<DomainResult<unknown>>;
}

const STACKS = ["grammy", "aiogram"] as const;
const PROJECT_ROOT: JsonSchema = { type: "string", minLength: 1 };

function tool(
  name: string,
  description: string,
  inputSchema: JsonSchema,
  run: ToolDefinition["run"],
): ToolDefinition {
  return { name, description, inputSchema, run };
}

export const TOOLS: readonly ToolDefinition[] = [
  tool(
    "telegram_bot_target_resolve",
    "Resolve the pinned framework and runtime versions for a Telegram bot stack (grammY or aiogram).",
    {
      type: "object",
      properties: { stack: { type: "string", enum: STACKS } },
      required: ["stack"],
      additionalProperties: false,
    },
    (operations, args) => operations.resolveTarget({ stack: args.stack as "grammy" | "aiogram" }),
  ),
  tool(
    "telegram_bot_inspect",
    "Inspect an existing bot project and report its stack, mode, and findings.",
    {
      type: "object",
      properties: { projectRoot: PROJECT_ROOT },
      required: ["projectRoot"],
      additionalProperties: false,
    },
    (operations, args) => operations.inspectBot({ projectRoot: args.projectRoot as string }),
  ),
  tool(
    "telegram_bot_verify",
    "Run static file-content checks; no project code execution, network, or Telegram calls.",
    {
      type: "object",
      properties: { projectRoot: PROJECT_ROOT },
      required: ["projectRoot"],
      additionalProperties: false,
    },
    (operations, args) => operations.verifyBot({ projectRoot: args.projectRoot as string }),
  ),
];

function validateValue(schema: JsonSchema, value: unknown, path: string): void {
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${path} must be an object`);
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) throw new Error(`${path}.${key} is required`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in record) validateValue(child, record[key], `${path}.${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in (schema.properties ?? {}))) throw new Error(`${path}.${key} is not allowed`);
      }
    }
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") throw new Error(`${path} must be a string`);
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new Error(`${path} must not be empty`);
    }
  } else if (schema.type === "boolean" && typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }
  if (schema.enum !== undefined && !schema.enum.includes(value as string)) {
    throw new Error(`${path} must be one of: ${schema.enum.join(", ")}`);
  }
}

export function validateArguments(
  definition: ToolDefinition,
  args: unknown,
): Record<string, unknown> {
  validateValue(definition.inputSchema, args, definition.name);
  return args as Record<string, unknown>;
}

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

async function handleRequest(
  operations: CoreOperations,
  request: JsonRpcRequest,
): Promise<Record<string, unknown> | undefined> {
  if (request.id === undefined) return undefined; // notification, never answered
  const respond = (result: unknown): Record<string, unknown> => ({
    jsonrpc: "2.0",
    id: request.id,
    result,
  });
  const fail = (code: number, message: string): Record<string, unknown> => ({
    jsonrpc: "2.0",
    id: request.id,
    error: { code, message },
  });

  switch (request.method) {
    case "initialize": {
      // Exactly one supported revision. A client may request any string; always
      // answer with the supported revision rather than echoing an unknown one.
      return respond({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "aurifex", version: SERVER_VERSION },
      });
    }
    case "ping":
      return respond({});
    case "tools/list":
      return respond({
        tools: TOOLS.map((definition) => ({
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema,
        })),
      });
    case "tools/call": {
      const name = request.params?.name;
      const definition = TOOLS.find((candidate) => candidate.name === name);
      if (definition === undefined) return fail(-32602, `unknown tool: ${String(name)}`);
      try {
        const args = validateArguments(definition, request.params?.arguments ?? {});
        return respond(toolResult(await definition.run(operations, args)));
      } catch (error) {
        return respond(
          toolResult(
            domainFailure({
              code: "invalid_request",
              detail: error instanceof Error ? error.message : "unexpected failure",
              retryable: false,
            }),
          ),
        );
      }
    }
    default:
      return fail(-32601, `unknown method: ${String(request.method)}`);
  }
}

export function startMcpServer(operations: CoreOperations): { close(): Promise<void> } {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue: Promise<void> = Promise.resolve();
  lines.on("line", (line) => {
    const text = line.trim();
    if (text === "") return;
    queue = queue.then(async () => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(text) as JsonRpcRequest;
      } catch {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`,
        );
        return;
      }
      const response = await handleRequest(operations, request);
      if (response !== undefined) process.stdout.write(`${JSON.stringify(response)}\n`);
    });
  });
  return {
    close: async () => {
      lines.close();
      await queue;
    },
  };
}

export async function runCli(): Promise<void> {
  const root = process.env.AURIFEX_ROOT ?? process.cwd();
  const operations = await createCoreOperations({ root });
  const handle = startMcpServer(operations);
  const shutdown = (signal: string): void => {
    console.error(`aurifex-mcp: received ${signal}, shutting down`);
    handle.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(`aurifex-mcp: shutdown failed: ${String(error)}`);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  await runCli();
}
