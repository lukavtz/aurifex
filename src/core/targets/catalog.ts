import type { BotFeature, BotStack } from "../spec/bot-spec.ts";

export const BOT_API_VERSION = "10.4" as const;
export const BOT_API_RELEASED = "2026-11-09" as const;

export type FeatureSupport = "native" | "raw" | "unsupported";

export interface StackTarget {
  readonly stack: BotStack;
  readonly label: string;
  readonly framework: string;
  readonly frameworkVersion: string;
  readonly frameworkLicense: "MIT";
  readonly runtime: string;
  readonly runtimeConstraint: string;
  readonly testedBotApi: string;
  readonly supportedBotApi: typeof BOT_API_VERSION;
  readonly typedRawMethods: readonly string[];
  readonly docs: string;
  readonly rawApiHint: string;
  readonly packageManager: string;
  readonly testRunner: string;
  readonly features: Readonly<Record<BotFeature, FeatureSupport>>;
}

export interface TargetResolution {
  readonly schemaVersion: "aurifex-target-1.0.0";
  readonly stack: BotStack;
  readonly target: StackTarget;
  readonly botApi: {
    readonly version: typeof BOT_API_VERSION;
    readonly released: typeof BOT_API_RELEASED;
  };
  readonly warnings: readonly string[];
}

const targets: Record<BotStack, StackTarget> = {
  grammy: {
    stack: "grammy",
    label: "TypeScript + grammY",
    framework: "grammy",
    frameworkVersion: "1.46.0",
    frameworkLicense: "MIT",
    runtime: "node",
    runtimeConstraint: ">=24.9.0",
    testedBotApi: "10.3",
    supportedBotApi: BOT_API_VERSION,
    typedRawMethods: [
      "sendWidget",
      "sendSharedWidget",
      "answerWidgetQuery",
      "editMessageWidgetData",
      "editSharedWidgetData",
      "sendRichMessage",
      "sendRichMessageDraft",
    ],
    docs: "https://grammy.dev/",
    rawApiHint: "bot.api.raw.<method>(payload) for methods newer than the framework types",
    packageManager: "bun",
    testRunner: "node:test",
    features: {
      commands: "native",
      llm: "native",
      inline: "native",
      payments: "native",
      miniapps: "native",
      moderation: "native",
      broadcast: "native",
      widgets: "raw",
      rich: "raw",
    },
  },
  aiogram: {
    stack: "aiogram",
    label: "Python + aiogram 3",
    framework: "aiogram",
    frameworkVersion: "3.31.0",
    frameworkLicense: "MIT",
    runtime: "python",
    runtimeConstraint: ">=3.11,<3.15",
    testedBotApi: "10.3",
    supportedBotApi: BOT_API_VERSION,
    typedRawMethods: [
      "sendWidget",
      "sendSharedWidget",
      "answerWidgetQuery",
      "editMessageWidgetData",
      "editSharedWidgetData",
      "sendRichMessage",
      "sendRichMessageDraft",
    ],
    docs: "https://docs.aiogram.dev/",
    rawApiHint: "bot.session.make_request(BotMethod) for methods newer than aiogram types",
    packageManager: "uv",
    testRunner: "pytest",
    features: {
      commands: "native",
      llm: "native",
      inline: "native",
      payments: "native",
      miniapps: "native",
      moderation: "native",
      broadcast: "native",
      widgets: "raw",
      rich: "raw",
    },
  },
};

export function isBotStack(value: unknown): value is BotStack {
  return value === "grammy" || value === "aiogram";
}

export function resolveStack(stack: BotStack): TargetResolution {
  const target = targets[stack];
  const warnings: string[] = [];
  if (target.testedBotApi !== BOT_API_VERSION) {
    warnings.push(
      `${target.framework} ${target.frameworkVersion} types cover Bot API ${target.testedBotApi}; ` +
        `Bot API ${BOT_API_VERSION} is supported through the typed raw adapter included in generated projects.`,
    );
  }
  warnings.push(
    "Telegram retains updates for at most 24 hours; persist an update_id deduplication key for at least 24 hours.",
  );
  warnings.push(
    "Webhook and getUpdates are mutually exclusive. Run exactly one consumer per bot token.",
  );
  return {
    schemaVersion: "aurifex-target-1.0.0",
    stack,
    target,
    botApi: { version: BOT_API_VERSION, released: BOT_API_RELEASED },
    warnings,
  };
}

export function listStacks(): readonly BotStack[] {
  return ["grammy", "aiogram"];
}

export function featureLabel(feature: BotFeature): string {
  const labels: Record<BotFeature, string> = {
    commands: "Commands and menus",
    llm: "LLM chat",
    inline: "Inline mode",
    payments: "Telegram Stars payments",
    miniapps: "Mini Apps",
    moderation: "Moderation and antispam",
    broadcast: "Broadcasts and notifications",
    widgets: "HTML widgets (Bot API 10.4)",
    rich: "Rich messages and drafts",
  };
  return labels[feature];
}
