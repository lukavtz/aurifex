import type { Bot } from "grammy";
import { t } from "../i18n/index.js";

export function register(bot: Bot): void {
  bot.command("help", async (ctx) => {
    const locale = ctx.from?.language_code;
    await ctx.reply(t(locale, "help.title") + "\n" + t(locale, "help.commands"));
  });
}
