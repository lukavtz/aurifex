import type { Bot } from "grammy";
import { t } from "../i18n/index.js";

export function register(bot: Bot): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(t(ctx.from?.language_code, "start.welcome", { bot: "grammY Payments" }));
  });
}
