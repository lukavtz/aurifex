import type { Bot } from "grammy";
import { isAdmin } from "../guard/allowlist.js";

export function register(bot: Bot): void {
  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied.");
      return;
    }
    await ctx.reply("Admin area ready.");
  });
}
