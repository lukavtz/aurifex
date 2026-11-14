import { resolve } from "node:path";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";

import type { CoreOperations } from "../../core/operations.ts";
import { domainFailure, serializeDomainResult, type DomainResult } from "../../core/results.ts";
import { createHostCoreOperations, DISCOVERY_GUIDANCE } from "../shared.ts";

interface ToolOutput {
  readonly content: [{ readonly type: "text"; readonly text: string }];
  readonly details: DomainResult<unknown>;
}

const operationsByRoot = new Map<string, Promise<CoreOperations>>();

function operationsFor(cwd: string): Promise<CoreOperations> {
  const root = resolve(cwd);
  let operations = operationsByRoot.get(root);
  if (operations === undefined) {
    operations = createHostCoreOperations(root);
    operationsByRoot.set(root, operations);
  }
  return operations;
}

async function runTool(
  ctx: ExtensionContext,
  signal: AbortSignal | undefined,
  operation: (operations: CoreOperations) => Promise<DomainResult<unknown>>,
): Promise<ToolOutput> {
  const result = signal?.aborted
    ? domainFailure({ code: "aborted", detail: "operation aborted", retryable: true })
    : await operation(await operationsFor(ctx.cwd));
  return {
    content: [{ type: "text", text: serializeDomainResult(result) }],
    details: result,
  };
}

const NEW_COMMAND_PROMPT = [
  "Start a new Telegram bot project.",
  "",
  "1. Read the skills/telegram-bot and skills/telegram-bot-stack-choice skills before writing anything.",
  "2. Read skills/telegram-bot-discovery and ask its questions in one compact message: goal and audience, stack (grammY or aiogram; never infer it), the exact features the user wants (inline buttons, scenes, media, payments, Mini App, LLM answers, broadcast), storage, locales, admin ids, and whether an existing project must be preserved.",
  "3. Never ask for a bot token, webhook secret, API key, or password; those belong in the environment.",
  "4. Summarize the bot, list every `assuming:` value, and get confirmation of the proposed BotSpec.",
  "5. Only after that confirmation write the code yourself, following skills/telegram-bot-recipes for exactly the confirmed features. Do not add features nobody asked for.",
  "6. Finish with telegram_bot_verify and fix every failing check.",
].join("\n");

async function commandVerify(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const projectRoot = (await ctx.ui.input("Project root", ".")) ?? ".";
  const operations = await operationsFor(ctx.cwd);
  const result = await operations.verifyBot({ projectRoot });
  if (result.status === "error") {
    ctx.ui.notify(`Aurifex: ${result.error.detail}`, "error");
    return;
  }
  if (result.value.ok) {
    ctx.ui.notify(`Aurifex: verification passed (${result.value.checks.length} checks)`, "info");
    return;
  }
  const failed = result.value.checks
    .filter((check) => check.status === "fail")
    .map((check) => check.id);
  ctx.ui.notify(`Aurifex: verification failed: ${failed.join(", ")}`, "error");
}

export default function aurifex(pi: ExtensionAPI): void {
  const z = pi.zod;

  pi.setLabel("Aurifex");

  pi.on("before_agent_start", (event) =>
    event.systemPrompt.includes(DISCOVERY_GUIDANCE)
      ? undefined
      : { systemPrompt: [...event.systemPrompt, DISCOVERY_GUIDANCE] },
  );

  pi.registerTool({
    name: "telegram_bot_target_resolve",
    label: "Resolve Telegram Bot Target",
    description: "Resolve the pinned grammY or aiogram target and Bot API warnings for a stack.",
    parameters: z
      .object({
        stack: z.enum(["grammy", "aiogram"]).describe("Bot stack"),
      })
      .strict(),
    approval: "read",
    execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
      runTool(ctx, signal, (operations) => operations.resolveTarget({ stack: params.stack })),
  });

  pi.registerTool({
    name: "telegram_bot_inspect",
    label: "Inspect Telegram Bot",
    description: "Inspect an existing bot project for stack, mode, and security findings.",
    parameters: z
      .object({
        projectRoot: z.string().describe("Project root relative to the workspace root"),
      })
      .strict(),
    approval: "read",
    execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
      runTool(ctx, signal, (operations) =>
        operations.inspectBot({ projectRoot: params.projectRoot }),
      ),
  });

  pi.registerTool({
    name: "telegram_bot_verify",
    label: "Verify Telegram Bot",
    description:
      "Run static file-content checks; no project code execution, network, or Telegram calls.",
    parameters: z
      .object({
        projectRoot: z.string().describe("Project root relative to the workspace root"),
      })
      .strict(),
    approval: "read",
    execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
      runTool(ctx, signal, (operations) =>
        operations.verifyBot({ projectRoot: params.projectRoot }),
      ),
  });

  pi.registerCommand("aurifex-new", {
    description: "Start a Telegram bot through the discovery gate",
    handler: async (args) => {
      const trimmed = args.trim();
      await pi.sendUserMessage(
        trimmed === "" ? NEW_COMMAND_PROMPT : `${NEW_COMMAND_PROMPT}\n\nUser arguments: ${trimmed}`,
      );
    },
  });
  pi.registerCommand("aurifex-verify", {
    description: "Verify a Telegram bot project",
    handler: commandVerify,
  });
  pi.registerCommand("aurifex-deploy", {
    description: "Plan a Telegram bot deployment",
    handler: async (args) => {
      const trimmed = args.trim();
      const prompt = [
        "Plan the delivery of this Telegram bot.",
        "",
        "Read the skills/telegram-deploy skill and follow it: confirm the offset or the HTTP response only after the durable commit, check getWebhookInfo before switching transport, keep handlers idempotent because Telegram retries, and shut down gracefully.",
        trimmed === "" ? "" : `User arguments: ${trimmed}`,
      ]
        .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
        .join("\n");
      await pi.sendUserMessage(prompt);
    },
  });
}
