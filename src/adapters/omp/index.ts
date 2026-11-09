import { resolve } from "node:path";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";

import type { CoreOperations } from "../../core/operations.ts";
import { domainFailure, serializeDomainResult, type DomainResult } from "../../core/results.ts";
import { BOT_FEATURES } from "../../core/spec/bot-spec.ts";
import { createHostCoreOperations } from "../shared.ts";

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

const DISCOVERY_GUIDANCE =
  "Before telegram_bot_scaffold or telegram_bot_add_feature, run the discovery questions in skills/telegram-bot-discovery and confirm the proposed BotSpec; never infer the stack, features, storage, locales, or payment products for the user. Never ask for or print bot tokens, webhook secrets, API keys, or passwords. Own generated projects through the aurifex tools, and run telegram_bot_verify after changing a generated bot.";

const NEW_COMMAND_PROMPT = [
  "Start a new Aurifex Telegram bot project.",
  "",
  "1. Read skills/telegram-bot-discovery and ask its material questions in one compact message: goal and audience, name and destination, stack (grammY or aiogram; never infer it), features, storage (Postgres/Redis), locales, admin IDs, payment products, broadcast audience, LLM provider, Mini App, deployment target, and whether an existing project must be preserved.",
  "2. Never ask for a bot token, webhook secret, API key, or password; those belong in .env or *_FILE after generation.",
  "3. Summarize the bot, list every `assuming:` value, and get confirmation of the proposed BotSpec.",
  "4. Only after that confirmation call telegram_bot_target_resolve, then telegram_bot_scaffold. Do not create project files by hand.",
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

async function commandDeploy(_args: string, ctx: ExtensionCommandContext): Promise<void> {
  const domain = (await ctx.ui.input("Domain", "bot.example.com")) ?? "bot.example.com";
  const operations = await operationsFor(ctx.cwd);
  const result = await operations.planDeploy({ projectRoot: ".", domain });
  if (result.status === "error") {
    ctx.ui.notify(`Aurifex: ${result.error.detail}`, "error");
    return;
  }
  ctx.ui.notify(
    `Aurifex: ${result.value.files.length} deploy files; WEBHOOK_URL=${result.value.setWebhook.url}`,
    "info",
  );
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
    name: "telegram_bot_scaffold",
    label: "Scaffold Telegram Bot",
    description:
      "Scaffold a production Telegram bot project from a validated BotSpec. First ask the discovery questions from skills/telegram-bot-discovery, confirm the proposed spec with the user, and never invent stack, feature, storage, locale, or payment values.",
    parameters: z
      .object({
        destination: z.string().describe("Destination directory inside the project root"),
        spec: z.unknown().describe("Bot spec object"),
        overwrite: z.boolean().optional().describe("Overwrite files rendered by this operation"),
      })
      .strict(),
    approval: "write",
    execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
      runTool(ctx, signal, (operations) =>
        operations.scaffoldBot(
          params.overwrite === undefined
            ? { destination: params.destination, spec: params.spec }
            : { destination: params.destination, spec: params.spec, overwrite: params.overwrite },
        ),
      ),
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
    description: "Run the security and production-readiness verification gate for a bot project.",
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

  pi.registerTool({
    name: "telegram_bot_add_feature",
    label: "Add Bot Feature",
    description: "Generate a feature module and tests for an existing bot project.",
    parameters: z
      .object({
        projectRoot: z.string().describe("Project root relative to the workspace root"),
        feature: z.enum(BOT_FEATURES).describe("Feature to add"),
        name: z.string().describe("Feature module name"),
        overwrite: z.boolean().optional().describe("Overwrite existing feature files"),
      })
      .strict(),
    approval: "write",
    execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
      runTool(ctx, signal, (operations) =>
        operations.addFeature(
          params.overwrite === undefined
            ? {
                projectRoot: params.projectRoot,
                feature: params.feature,
                name: params.name,
              }
            : {
                projectRoot: params.projectRoot,
                feature: params.feature,
                name: params.name,
                overwrite: params.overwrite,
              },
        ),
      ),
  });

  pi.registerTool({
    name: "telegram_bot_deploy_plan",
    label: "Plan Bot Deployment",
    description: "Render deployment files and a setWebhook plan without calling Telegram.",
    parameters: z
      .object({
        projectRoot: z.string().describe("Project root relative to the workspace root"),
        domain: z.string().describe("Public bot domain"),
        mode: z.enum(["webhook", "polling"]).optional().describe("Update delivery mode"),
        overwrite: z.boolean().optional().describe("Overwrite existing deploy files"),
      })
      .strict(),
    approval: "write",
    execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
      runTool(ctx, signal, (operations) =>
        operations.planDeploy({
          projectRoot: params.projectRoot,
          domain: params.domain,
          ...(params.mode === undefined ? {} : { mode: params.mode }),
          ...(params.overwrite === undefined ? {} : { overwrite: params.overwrite }),
        }),
      ),
  });

  pi.registerTool({
    name: "telegram_bot_test_harness",
    label: "Generate Bot Test Harness",
    description: "Generate update fixtures, a fake Telegram server, and security tests.",
    parameters: z
      .object({
        projectRoot: z.string().describe("Project root relative to the workspace root"),
        overwrite: z.boolean().optional().describe("Overwrite existing harness files"),
      })
      .strict(),
    approval: "write",
    execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
      runTool(ctx, signal, (operations) =>
        operations.generateTestHarness(
          params.overwrite === undefined
            ? { projectRoot: params.projectRoot }
            : { projectRoot: params.projectRoot, overwrite: params.overwrite },
        ),
      ),
  });

  pi.registerTool({
    name: "telegram_bot_upgrade",
    label: "Upgrade Bot Project",
    description:
      "Verify generated files against .aurifex/manifest.json, then bump the manifest spec version. Dry-run unless apply is true; user files are never rewritten.",
    parameters: z
      .object({
        projectRoot: z.string().describe("Project root relative to the workspace root"),
        apply: z
          .boolean()
          .optional()
          .describe("Write the migrated manifest. Defaults to false (dry run)."),
      })
      .strict(),
    approval: "write",
    execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
      runTool(ctx, signal, (operations) =>
        operations.upgradeProject({
          projectRoot: params.projectRoot,
          apply: params.apply === true,
        }),
      ),
  });

  pi.registerTool({
    name: "telegram_bot_upgrade_plan",
    label: "Plan Bot API Upgrade",
    description: "List Bot API 10.4 raw-method actions for an existing bot project.",
    parameters: z
      .object({
        projectRoot: z.string().describe("Project root relative to the workspace root"),
      })
      .strict(),
    approval: "read",
    execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
      runTool(ctx, signal, (operations) =>
        operations.upgradePlan({ projectRoot: params.projectRoot }),
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
    handler: commandDeploy,
  });
}
