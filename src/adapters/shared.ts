import { createCoreOperations, type CoreOperations } from "../core/operations.ts";

export const DISCOVERY_GUIDANCE =
  "Before telegram_bot_scaffold or telegram_bot_add_feature, run the discovery questions in skills/telegram-bot-discovery and confirm the proposed BotSpec; never infer the stack, features, storage, locales, or payment products for the user. Never ask for or print bot tokens, webhook secrets, API keys, or passwords. Own generated projects through the aurifex tools, and run telegram_bot_verify after changing a generated bot.";

export function createHostCoreOperations(root: string): Promise<CoreOperations> {
  return createCoreOperations({ root });
}
