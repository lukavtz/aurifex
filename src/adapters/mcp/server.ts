#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { createCoreOperations, type CoreOperations } from "../../core/operations.ts";
import { domainFailure, serializeDomainResult, type DomainResult } from "../../core/results.ts";
import { BOT_FEATURES } from "../../core/spec/bot-spec.ts";

const MAX_RESULT_BYTES = 262_144;

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

const stackSchema = z.enum(["grammy", "aiogram"]);
const featureSchema = z.enum(BOT_FEATURES);

export function createMcpServer(operations: CoreOperations): McpServer {
  const server = new McpServer({ name: "aurifex", version: "0.2.0" });

  server.registerTool(
    "telegram_bot_target_resolve",
    {
      description:
        "Resolve the pinned framework and runtime versions for a Telegram bot stack (grammY or aiogram).",
      inputSchema: z.object({ stack: stackSchema }).strict(),
    },
    async ({ stack }) => toolResult(await operations.resolveTarget({ stack })),
  );

  server.registerTool(
    "telegram_bot_scaffold",
    {
      description:
        "Scaffold a standalone, production-grade Telegram bot project from a validated BotSpec. First ask the discovery questions from skills/telegram-bot-discovery, confirm the proposed spec with the user, and never invent stack, feature, storage, locale, or payment values.",
      inputSchema: z
        .object({
          destination: z.string().min(1),
          spec: z.record(z.string(), z.unknown()),
          overwrite: z.boolean().optional(),
        })
        .strict(),
    },
    async ({ destination, spec, overwrite }) =>
      toolResult(
        await operations.scaffoldBot({
          destination,
          spec,
          ...(overwrite === undefined ? {} : { overwrite }),
        }),
      ),
  );

  server.registerTool(
    "telegram_bot_inspect",
    {
      description: "Inspect an existing bot project and report its stack, mode, and findings.",
      inputSchema: z.object({ projectRoot: z.string().min(1) }).strict(),
    },
    async ({ projectRoot }) => toolResult(await operations.inspectBot({ projectRoot })),
  );

  server.registerTool(
    "telegram_bot_verify",
    {
      description: "Run the security and production-readiness verification gate on a bot project.",
      inputSchema: z.object({ projectRoot: z.string().min(1) }).strict(),
    },
    async ({ projectRoot }) => toolResult(await operations.verifyBot({ projectRoot })),
  );

  server.registerTool(
    "telegram_bot_add_feature",
    {
      description:
        "Add a feature module (commands, llm, inline, payments, miniapps, moderation, broadcast, widgets, rich) to an existing bot project.",
      inputSchema: z
        .object({
          projectRoot: z.string().min(1),
          feature: featureSchema,
          name: z.string().min(1),
          overwrite: z.boolean().optional(),
        })
        .strict(),
    },
    async ({ projectRoot, feature, name, overwrite }) =>
      toolResult(
        await operations.addFeature({
          projectRoot,
          feature,
          name,
          ...(overwrite === undefined ? {} : { overwrite }),
        }),
      ),
  );

  server.registerTool(
    "telegram_bot_deploy_plan",
    {
      description:
        "Generate deployment files and a webhook setup plan for a bot project. Never calls Telegram.",
      inputSchema: z
        .object({
          projectRoot: z.string().min(1),
          domain: z.string().min(1),
          mode: z.enum(["webhook", "polling"]).optional(),
          overwrite: z.boolean().optional(),
        })
        .strict(),
    },
    async ({ projectRoot, domain, mode, overwrite }) =>
      toolResult(
        await operations.planDeploy({
          projectRoot,
          domain,
          ...(mode === undefined ? {} : { mode }),
          ...(overwrite === undefined ? {} : { overwrite }),
        }),
      ),
  );

  server.registerTool(
    "telegram_bot_test_harness",
    {
      description: "Generate Telegram update fixtures, fake-Telegram tests, and a compose harness.",
      inputSchema: z
        .object({
          projectRoot: z.string().min(1),
          overwrite: z.boolean().optional(),
        })
        .strict(),
    },
    async ({ projectRoot, overwrite }) =>
      toolResult(
        await operations.generateTestHarness({
          projectRoot,
          ...(overwrite === undefined ? {} : { overwrite }),
        }),
      ),
  );

  server.registerTool(
    "telegram_bot_upgrade",
    {
      description:
        "Verify generated files against .aurifex/manifest.json, then bump the manifest spec version. Dry-run unless apply is true; user files are never rewritten.",
      inputSchema: z
        .object({
          projectRoot: z.string().min(1),
          apply: z.boolean().optional(),
        })
        .strict(),
    },
    async ({ projectRoot, apply }) =>
      toolResult(
        await operations.upgradeProject({
          projectRoot,
          apply: apply === true,
        }),
      ),
  );

  server.registerTool(
    "telegram_bot_upgrade_plan",
    {
      description: "List Bot API 10.4 upgrade actions for a bot project.",
      inputSchema: z.object({ projectRoot: z.string().min(1) }).strict(),
    },
    async ({ projectRoot }) => toolResult(await operations.upgradePlan({ projectRoot })),
  );

  return server;
}

export function startMcpServer(operations: CoreOperations): StdioServerHandle {
  return serveStdio(() => createMcpServer(operations), {
    onerror: (error) => console.error(`aurifex-mcp: ${error.message}`),
  });
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
