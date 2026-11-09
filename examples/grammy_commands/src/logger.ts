import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["BOT_TOKEN", "WEBHOOK_SECRET", "LLM_API_KEY", "req.headers.authorization"],
});
