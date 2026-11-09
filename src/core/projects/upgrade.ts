import type { DomainResult } from "../results.ts";
import { domainFailure, domainSuccess } from "../results.ts";
import { PathPolicyError, type PathPolicy } from "../security/path-policy.ts";
import { BOT_API_VERSION, resolveStack } from "../targets/catalog.ts";
import { detectProjectStack, normalizeProjectRoot } from "./deploy.ts";

export interface UpgradeResult {
  readonly currentBotApi: string;
  readonly targetBotApi: "10.4";
  readonly actions: readonly string[];
}

export async function upgradePlan(
  projectRoot: string,
  policy: PathPolicy,
): Promise<DomainResult<UpgradeResult>> {
  const root = normalizeProjectRoot(projectRoot);
  try {
    if (root !== "") policy.resolve(root);
    const stack = await detectProjectStack(policy, root);
    if (stack === null) {
      return domainFailure({
        code: "project_unreadable",
        detail: "project has no grammY package.json or aiogram pyproject.toml",
        retryable: false,
        details: { path: "projectRoot" },
      });
    }

    const target = resolveStack(stack).target;
    const rawCall =
      stack === "grammy"
        ? "bot.api.raw.<method>(payload)"
        : "await bot(<TelegramMethod subclass instance>)";
    const sendWidget =
      stack === "grammy" ? "bot.api.raw.sendWidget(payload)" : "await bot(SendWidget(...))";
    const answerWidgetQuery =
      stack === "grammy"
        ? "bot.api.raw.answerWidgetQuery(payload)"
        : "await bot(AnswerWidgetQuery(...))";
    const answerCallbackQuery =
      stack === "grammy"
        ? "bot.api.raw.answerCallbackQuery(payload)"
        : "await bot(AnswerWidgetQuery(...))";

    return domainSuccess({
      currentBotApi: target.testedBotApi,
      targetBotApi: BOT_API_VERSION,
      actions: [
        `Keep ${target.framework} ${target.frameworkVersion}; call ${rawCall} for Bot API ${BOT_API_VERSION} methods that the framework types do not include yet.`,
        `sendWidget: call ${sendWidget} and keep the widget payload typed locally; do not patch framework internals.`,
        `answerWidgetQuery: call ${answerWidgetQuery} and answer every widget query exactly once.`,
        `Ephemeral callback replies: pass the ephemeral flag through ${answerCallbackQuery}; do not rely on the typed answerCallbackQuery shortcut.`,
        `Rich-message quotes: send the quote fields through ${rawCall}; strip unknown fields before logging.`,
        `TON wallet cards: send the wallet-card payload through ${rawCall}; validate amounts as integer nanoTON before sending.`,
        `Add one regression test per raw method and re-check after each framework upgrade; switch back to typed helpers when the framework declares Bot API ${BOT_API_VERSION}.`,
      ],
    });
  } catch (error) {
    if (error instanceof PathPolicyError) {
      return domainFailure({ code: error.code, detail: error.message, retryable: false });
    }
    return domainFailure({
      code: "internal_error",
      detail: error instanceof Error ? error.message : "unexpected upgrade planning failure",
      retryable: false,
    });
  }
}
