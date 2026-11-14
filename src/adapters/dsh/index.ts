/** DeepSeek Harness projection for Aurifex. @module */

import { resolve } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import { defineTool, type ToolRunContext } from "@deepseek-ai/dsh-tools";
import schema from "@deepseek-ai/schemastery";

import { createCoreOperations, type CoreOperations } from "../../core/operations.ts";
import { serializeDomainResult, type DomainResult } from "../../core/results.ts";
import type { BotStack } from "../../core/spec/bot-spec.ts";
import { DISCOVERY_GUIDANCE } from "../shared.ts";

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
      "Run static file-content checks; no project code execution, network, or Telegram calls.",
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

  return [targetResolve, inspect, verify] as const;
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
      text: DISCOVERY_GUIDANCE,
      interpolate: false,
    }),
  );
}
