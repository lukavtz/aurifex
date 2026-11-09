import { z } from "zod";
import { readSecret, requireSecrets } from "./runtime/secrets.js";

const tokenSchema = z
  .string()
  .regex(/^\d{6,}:[A-Za-z0-9_-]{30,}$/, "BOT_TOKEN must be a Telegram bot token");
const secretSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{1,256}$/,
    "WEBHOOK_SECRET must be 1-256 characters of A-Z, a-z, 0-9, _ or -",
  );

const envSchema = z.object({
  BOT_TOKEN: tokenSchema,
  WEBHOOK_SECRET: secretSchema,
  WEBHOOK_URL: z
    .string()
    .default("")
    .refine(
      (value) => value === "" || /^https:\/\/[^\s]+$/.test(value),
      "WEBHOOK_URL must be an https URL or empty",
    ),
  BOT_MODE: z.enum(["webhook", "polling"]).default("polling"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  ADMIN_IDS: z
    .string()
    .default("")
    .transform((value) =>
      value === ""
        ? []
        : value
            .split(",")
            .map((part) => Number(part.trim()))
            .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  DATABASE_URL: z.string().default(""),
  REDIS_URL: z.string().default(""),
  LLM_BASE_URL: z.string().default(""),
  LLM_MODEL: z.string().default(""),
  LLM_API_KEY: z.string().default(""),
  QUEUE_POLL_MS: z.coerce.number().int().min(1).default(500),
  QUEUE_BATCH: z.coerce.number().int().min(1).max(100).default(10),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  QUEUE_VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(60),
  WORKER_ID: z.string().default(""),
  MINIAPP_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2592000).default(86400),
  MINIAPP_ALLOWED_ORIGINS: z.string().default(""),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(""),
  OTEL_SERVICE_NAME: z.string().default(""),
  SENTRY_DSN: z.string().default(""),
  METRICS_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value === "true" || value === "1"),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof envSchema>;

const FILE_BACKED_SECRETS = [
  "BOT_TOKEN",
  "WEBHOOK_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "LLM_API_KEY",
] as const;

const REQUIRED_SECRETS: readonly string[] = ["BOT_TOKEN", "WEBHOOK_SECRET"];

// aurifex:config
// aurifex:config-end

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  requireSecrets(REQUIRED_SECRETS, env);
  const resolved: NodeJS.ProcessEnv = { ...env };
  for (const name of FILE_BACKED_SECRETS) {
    const value = readSecret(name, env);
    if (value !== undefined) {
      resolved[name] = value;
    }
  }
  return envSchema.parse(resolved);
}

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached === undefined) {
    cached = loadConfig();
  }
  return cached;
}
