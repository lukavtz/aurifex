import { createCoreOperations, type CoreOperations } from "../core/operations.ts";

export const DISCOVERY_GUIDANCE =
  "Before writing any Telegram bot code, read skills/telegram-bot, skills/telegram-bot-stack-choice, and skills/telegram-bot-sources. Run the discovery questions in skills/telegram-bot-discovery, propose a BotSpec, and get it confirmed; never infer the stack, features, storage, locales, or payment products for the user. Build exactly the confirmed features and nothing else. Never ask for or print bot tokens, webhook secrets, API keys, or passwords. Confirm facts against the installed SDK or the official docs instead of memory, and finish every change with telegram_bot_verify.";

export function createHostCoreOperations(root: string): Promise<CoreOperations> {
  return createCoreOperations({ root });
}
