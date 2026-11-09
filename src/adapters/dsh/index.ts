/** DeepSeek Harness projection for Aurifex. @module */

import { resolve } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { defineTool, type ToolRunContext } from "@deepseek-ai/dsh-tools";
import schema from "@deepseek-ai/schemastery";

import { createCoreOperations, type CoreOperations } from "../../core/operations.ts";
import { serializeDomainResult, type DomainResult } from "../../core/results.ts";
import { BOT_FEATURES, type BotFeature, type BotStack } from "../../core/spec/bot-spec.ts";

/** Cordis plugin name; keep this stable after publishing. */
export const name = "aurifex";

/** Host services required before this plugin loads. */
export const inject = ["tools", "systemPrompt"];

/** Plugin configuration supplied by the profile composition. */
export interface AurifexConfig {
  /** Directory that bounds every operation; resolved against `process.cwd()`. */
  readonly root?: string;
}

/** Loader-visible configuration schema. */
export const Config: schema<AurifexConfig> = schema.object({
  root: schema.string().default("."),
});

/** Four-sentence operating guidance appended to the host system prompt. */
export const AURIFEX_GUIDANCE =
  "Before telegram_bot_scaffold or telegram_bot_add_feature, run the discovery questions from skills/telegram-bot-discovery — goal, name, stack, features, storage, locales, admins, payments, broadcast, LLM, Mini App, deployment, existing project — and confirm the proposed BotSpec; never infer the stack, features, storage, locales, or payment products. Never ask for or print bot tokens, webhook secrets, API keys, or passwords. Use telegram_bot_scaffold to create a project before writing files by hand. Run telegram_bot_verify after changing a generated bot, and prefer telegram_bot_deploy_plan over ad-hoc Docker or Caddy edits.";

const JSON_OUTPUT = { type: "json" as const } as const;

function renderResult(_args: unknown, value: unknown) {
  return [
    {
      type: "text" as const,
      text: serializeDomainResult(value as DomainResult<unknown>),
    },
  ];
}

/** Domain results are lossless JSON; the tool DSL's JsonValue is structurally closed. */
function toJson(result: DomainResult<unknown>): never {
  return result as unknown as never;
}

function ensureActive(exec: Readonly<ToolRunContext>): void {
  if (exec.signal.aborted) throw new Error("aurifex: cancelled");
}

function withOverwrite(overwrite: boolean | undefined): { overwrite?: boolean } {
  return overwrite === undefined ? {} : { overwrite };
}

async function createTools(operations: CoreOperations) {
  const targetResolve = defineTool({
    name: "telegram_bot_target_resolve",
    description:
      "Resolve the pinned framework, runtime, Bot API version, feature support, and warnings for one bot stack. Read-only: no filesystem or network access.",
    parameters: {
      stack: {
        type: "string",
        enum: ["grammy", "aiogram"],
        required: true,
        description: "Bot stack to resolve.",
      },
    },
    output: { schema: JSON_OUTPUT, render: renderResult },
    execute: async (args, exec) => {
      ensureActive(exec);
      return toJson(await operations.resolveTarget({ stack: args.stack as BotStack }));
    },
  });

  const scaffold = defineTool({
    name: "telegram_bot_scaffold",
    description:
      "Scaffold a complete production bot project from a BotSpec. Run the discovery interview from skills/telegram-bot-discovery and get the proposed BotSpec confirmed first; never invent stack, feature, storage, or payment values. Writes files under the workspace root and refuses a non-empty destination unless overwrite is true.",
    parameters: {
      destination: {
        type: "string",
        required: true,
        description: "Destination directory relative to the workspace root.",
      },
      spec: {
        type: "json",
        required: true,
        description: "BotSpec document (bot-spec-1.1.0; bot-spec-1.0.0 is upgraded).",
      },
      overwrite: {
        type: "boolean",
        description: "Replace files that already exist. Defaults to false.",
      },
    },
    output: { schema: JSON_OUTPUT, render: renderResult },
    execute: async (args, exec) => {
      ensureActive(exec);
      return toJson(
        await operations.scaffoldBot({
          destination: args.destination,
          spec: args.spec,
          ...withOverwrite(args.overwrite),
        }),
      );
    },
  });

  const inspect = defineTool({
    name: "telegram_bot_inspect",
    description:
      "Inspect an existing bot project to detect its stack, framework version, webhook or polling mode, and configuration findings. Read-only: never executes project code.",
    parameters: {
      projectRoot: {
        type: "string",
        required: true,
        description: "Project root relative to the configured Aurifex workspace root.",
      },
    },
    output: { schema: JSON_OUTPUT, render: renderResult },
    execute: async (args, exec) => {
      ensureActive(exec);
      return toJson(await operations.inspectBot({ projectRoot: args.projectRoot }));
    },
  });

  const verify = defineTool({
    name: "telegram_bot_verify",
    description:
      "Run the security and production verification gate on a bot project. Returns per-check pass, warn, and fail statuses; no network and no project execution.",
    parameters: {
      projectRoot: {
        type: "string",
        required: true,
        description: "Project root relative to the configured Aurifex workspace root.",
      },
    },
    output: { schema: JSON_OUTPUT, render: renderResult },
    execute: async (args, exec) => {
      ensureActive(exec);
      return toJson(await operations.verifyBot({ projectRoot: args.projectRoot }));
    },
  });

  const addFeature = defineTool({
    name: "telegram_bot_add_feature",
    description:
      "Add one feature module (commands, llm, inline, payments, miniapps, moderation, broadcast) to an existing bot project for its detected stack. Refuses to replace existing files unless overwrite is true.",
    parameters: {
      projectRoot: {
        type: "string",
        required: true,
        description: "Project root relative to the configured Aurifex workspace root.",
      },
      feature: {
        type: "string",
        enum: BOT_FEATURES,
        required: true,
        description: "Feature family to add.",
      },
      name: {
        type: "string",
        required: true,
        description: "Feature module name; use miniapp for the miniapps feature.",
      },
      overwrite: {
        type: "boolean",
        description: "Replace files that already exist. Defaults to false.",
      },
    },
    output: { schema: JSON_OUTPUT, render: renderResult },
    execute: async (args, exec) => {
      ensureActive(exec);
      return toJson(
        await operations.addFeature({
          projectRoot: args.projectRoot,
          feature: args.feature as BotFeature,
          name: args.name,
          ...withOverwrite(args.overwrite),
        }),
      );
    },
  });

  const deployPlan = defineTool({
    name: "telegram_bot_deploy_plan",
    description:
      "Render deployment files (Dockerfile, compose, Caddyfile, set-webhook script) and an operator checklist for a bot domain. Never calls Telegram or applies infrastructure.",
    parameters: {
      projectRoot: {
        type: "string",
        required: true,
        description: "Project root relative to the configured Aurifex workspace root.",
      },
      domain: {
        type: "string",
        required: true,
        description: "Public webhook domain without scheme, path, or port.",
      },
      mode: {
        type: "string",
        enum: ["webhook", "polling"],
        description: "Deployment mode; defaults to the project configuration.",
      },
      overwrite: {
        type: "boolean",
        description: "Replace files that already exist. Defaults to false.",
      },
    },
    output: { schema: JSON_OUTPUT, render: renderResult },
    execute: async (args, exec) => {
      ensureActive(exec);
      return toJson(
        await operations.planDeploy({
          projectRoot: args.projectRoot,
          domain: args.domain,
          ...(args.mode === undefined ? {} : { mode: args.mode }),
          ...withOverwrite(args.overwrite),
        }),
      );
    },
  });

  const testHarness = defineTool({
    name: "telegram_bot_test_harness",
    description:
      "Generate update fixtures, a fake Telegram transport, and a tgfake compose file for an existing bot project. Writes files only; never runs containers.",
    parameters: {
      projectRoot: {
        type: "string",
        required: true,
        description: "Project root relative to the configured Aurifex workspace root.",
      },
      overwrite: {
        type: "boolean",
        description: "Replace files that already exist. Defaults to false.",
      },
    },
    output: { schema: JSON_OUTPUT, render: renderResult },
    execute: async (args, exec) => {
      ensureActive(exec);
      return toJson(
        await operations.generateTestHarness({
          projectRoot: args.projectRoot,
          ...withOverwrite(args.overwrite),
        }),
      );
    },
  });

  const upgrade = defineTool({
    name: "telegram_bot_upgrade",
    description:
      "Verify generated files against .aurifex/manifest.json, then bump the manifest spec version. Dry-run unless apply is true; user files are never rewritten.",
    parameters: {
      projectRoot: {
        type: "string",
        required: true,
        description: "Project root relative to the configured Aurifex workspace root.",
      },
      apply: {
        type: "boolean",
        description: "Write the migrated manifest. Defaults to false (dry run).",
      },
    },
    output: { schema: JSON_OUTPUT, render: renderResult },
    execute: async (args, exec) => {
      ensureActive(exec);
      return toJson(
        await operations.upgradeProject({
          projectRoot: args.projectRoot,
          apply: args.apply === true,
        }),
      );
    },
  });

  const upgradePlan = defineTool({
    name: "telegram_bot_upgrade_plan",
    description:
      "List Bot API 10.4 migration actions for an existing bot project, including raw-method escape hatches. Read-only: returns actions without editing files.",
    parameters: {
      projectRoot: {
        type: "string",
        required: true,
        description: "Project root relative to the configured Aurifex workspace root.",
      },
    },
    output: { schema: JSON_OUTPUT, render: renderResult },
    execute: async (args, exec) => {
      ensureActive(exec);
      return toJson(await operations.upgradePlan({ projectRoot: args.projectRoot }));
    },
  });

  return [
    targetResolve,
    scaffold,
    inspect,
    verify,
    addFeature,
    deployPlan,
    testHarness,
    upgrade,
    upgradePlan,
  ] as const;
}

/**
 * Apply the Aurifex tool surface to one Cordis context.
 *
 * @param ctx - Plugin context; every registration is owned by its effects.
 * @param config - Configuration resolved by Cordis from {@link Config}.
 */
export async function apply(ctx: Context, config: AurifexConfig): Promise<void> {
  const root = resolve(process.cwd(), config.root ?? ".");
  const operations = await createCoreOperations({ root });

  for (const tool of await createTools(operations)) {
    const dispose = ctx.tools.register(tool);
    if (typeof dispose === "function") ctx.effect(() => dispose);
  }

  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: "aurifex",
      order: 120,
      text: AURIFEX_GUIDANCE,
      interpolate: false,
    }),
  );
}
