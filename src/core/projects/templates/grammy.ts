import type { BotSpec } from "../../spec/bot-spec.ts";
import type { StackTarget } from "../../targets/catalog.ts";
import { renderGrammyFeature } from "../features/grammy.ts";
import { renderApi104TypesTs } from "./api104-types.ts";
import { renderI18nFiles } from "./i18n.ts";
import { renderUserSyncTs } from "./jobs.ts";
import { QUEUE_MIGRATION_FILE, renderMigrateTs } from "./migrate.ts";
import { renderQueueTs, renderWorkerTs } from "./queue.ts";
import { renderDrizzleMigration, renderSchemaTs } from "./runtime-schema.ts";
import { renderConfigTs, renderSecretsTestTs } from "./runtime-config.ts";
import { renderSecretsTs } from "./runtime-secrets.ts";
import { renderHealthTs, renderTelemetryTs } from "./telemetry.ts";
import { renderJobsIndexTs, renderWorkerEntryTs } from "./worker-entry.ts";
import { assertNoTokenLiteral, baseFiles, type TemplateFile } from "./shared.ts";

// Generated projects are standalone: every import below is emitted with a .js
// suffix because the generated tsconfig uses NodeNext module resolution.

// The mini app backend module is optional: it exists only after
// `aurifex add <root> --feature miniapps --name miniapp`. server.ts always
// mounts the route when the runtime module is present.
const MINIAPP_HELPERS = `
interface MiniAppRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string | null;
  readonly headers: {
    readonly cookie?: string;
    readonly origin?: string;
    readonly host?: string;
    readonly csrfToken?: string;
  };
  readonly secure: boolean;
  readonly botToken: string;
  readonly redis: unknown;
  readonly config: unknown;
}

interface MiniAppRouteResult {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

interface MiniAppRoute {
  readonly method: string;
  readonly path: string;
  handler(request: MiniAppRouteRequest): Promise<MiniAppRouteResult>;
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isMiniAppRoute(value: unknown): value is MiniAppRoute {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.method === "string" &&
    typeof candidate.path === "string" &&
    typeof candidate.handler === "function"
  );
}

async function loadMiniAppRoute(): Promise<readonly MiniAppRoute[]> {
  // Runtime plugin registry: the module is added after scaffolding, so the
  // specifier cannot be a static import.
  const name = "miniapp";
  try {
    const mod: unknown = await import("./features/" + name + ".js");
    if (typeof mod !== "object" || mod === null) return [];
    const record = mod as Record<string, unknown>;
    const routes = record.routes;
    if (!Array.isArray(routes)) return [];
    return routes.filter(isMiniAppRoute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") return [];
    throw error;
  }
}
`;

const MINIAPP_ROUTE = `    const miniAppRoute = miniAppRoutes.find(
      (candidate) => candidate.method === req.method && candidate.path === req.url,
    );
    if (
      miniAppRoute !== undefined &&
      miniAppRoute.method === req.method &&
      miniAppRoute.path === req.url &&
      miniAppConfig !== undefined
    ) {
      const reading =
        req.method === "GET" || req.method === "HEAD" ? Promise.resolve(null) : readBody(req);
      void reading
        .then((body) => {
          if (body === null && req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(413, { "content-type": "application/json" });
            res.end('{"error":"payload_too_large"}');
            return;
          }
          return miniAppRoute
            .handler({
              method: req.method ?? "GET",
              path: req.url ?? "",
              body,
              headers: {
                ...(typeof req.headers.cookie === "string" ? { cookie: req.headers.cookie } : {}),
                ...(typeof req.headers.origin === "string" ? { origin: req.headers.origin } : {}),
                ...(typeof req.headers.host === "string" ? { host: req.headers.host } : {}),
                ...(typeof req.headers["x-csrf-token"] === "string"
                  ? { csrfToken: req.headers["x-csrf-token"] }
                  : {}),
              },
              secure:
                req.headers["x-forwarded-proto"] === "https" ||
                (req.socket as { readonly encrypted?: boolean }).encrypted === true,
              botToken,
              redis,
              config: miniAppConfig,
            })
            .then((result) => {
              res.writeHead(result.status, {
                "content-type": "application/json",
                ...result.headers,
              });
              res.end(JSON.stringify(result.body));
            });
        })
        .catch(() => {
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end('{"error":"internal_error"}');
          }
        });
      return;
    }
`;

function grammyFiles(spec: BotSpec): TemplateFile[] {
  const displayName = JSON.stringify(spec.displayName);
  const hasIdempotency = spec.security.idempotency;
  const hasRateLimit = spec.security.rateLimit;
  const expectedMiddleware = Number(hasIdempotency) + Number(hasRateLimit);
  const hasPostgres = spec.storage.postgres;
  const hasQueue = spec.runtime.queue === "postgres";
  const hasPayments = spec.features.includes("payments");
  const needsDb = hasPostgres || hasQueue;
  return [
    {
      path: "drizzle.config.ts",
      content: `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/storage/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
`,
    },
    {
      path: "src/runtime/secrets.ts",
      content: renderSecretsTs(),
    },
    {
      path: "src/runtime/telemetry.ts",
      content: renderTelemetryTs(),
    },
    {
      path: "src/runtime/health.ts",
      content: renderHealthTs(),
    },
    {
      path: "src/config.ts",
      content: renderConfigTs(spec),
    },
    {
      path: "tests/secrets.test.ts",
      content: renderSecretsTestTs(spec),
    },
    {
      path: "src/logger.ts",
      content: `import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["BOT_TOKEN", "WEBHOOK_SECRET", "LLM_API_KEY", "req.headers.authorization"],
});
`,
    },
    {
      path: "src/bot.ts",
      content: `import { Bot, type Context, type MiddlewareFn } from "grammy";
import { getConfig, type Config } from "./config.js";
import { logger } from "./logger.js";
${hasIdempotency ? 'import { dedupeMiddleware } from "./security/dedupe.js";\n' : ""}${hasRateLimit ? 'import { rateLimitMiddleware } from "./security/rate-limit.js";\n' : ""}import { retryAfterMs } from "./security/retry.js";

export interface BotWithSecurity extends Bot {
  readonly securityMiddleware: readonly MiddlewareFn<Context>[];
}

export function createBot(config: Config = getConfig()): BotWithSecurity {
  const bot = new Bot(config.BOT_TOKEN) as BotWithSecurity;
  const security: MiddlewareFn<Context>[] = [];
${hasIdempotency ? "  security.push(dedupeMiddleware(config.REDIS_URL));\n" : ""}${hasRateLimit ? "  security.push(rateLimitMiddleware(config.REDIS_URL));\n" : ""}  for (const middleware of security) {
    bot.use(middleware);
  }
  bot.catch((error) => {
    const cause = error.error;
    logger.error(
      {
        updateId: error.ctx.update.update_id,
        message: cause instanceof Error ? cause.message : "unknown error",
        retryAfterMs: retryAfterMs(cause),
      },
      "bot update failed",
    );
  });
  return Object.assign(bot, { securityMiddleware: security });
}
`,
    },
    {
      path: "src/main.ts",
      content: `import { createBot } from "./bot.js";
import { getConfig } from "./config.js";
import { registerFeatures } from "./features/index.js";
import { logger } from "./logger.js";
${hasQueue ? 'import { createQueue } from "./runtime/queue.js";\n' : ""}import { initTelemetry, shutdownTelemetry } from "./runtime/telemetry.js";
${hasPostgres ? 'import { userSyncMiddleware } from "./security/user-sync.js";\n' : ""}import { createServer } from "./server.js";
${needsDb ? 'import { closeDb, getDb } from "./storage/db.js";\n' : ""}
const ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "inline_query",
  "pre_checkout_query",
  "shipping_query",
  "my_chat_member",
  "chat_member",
] as const;

async function main(): Promise<void> {
  const config = getConfig();
  await initTelemetry({
    serviceName: config.OTEL_SERVICE_NAME || ${displayName},
    otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
    sentryDsn: config.SENTRY_DSN,
  });
  const bot = createBot();
${
  needsDb
    ? `  const database = getDb(config.DATABASE_URL);
  if (database === null) {
    throw new Error(${JSON.stringify(
      hasQueue
        ? "DATABASE_URL is required when runtime.queue is postgres"
        : "DATABASE_URL is required when storage.postgres is enabled",
    )});
  }
`
    : ""
}${hasPostgres && needsDb ? "  bot.use(userSyncMiddleware(database.client));\n" : ""}${
        hasQueue
          ? `  const queue = createQueue(database.client, {
    visibilityTimeoutSeconds: config.QUEUE_VISIBILITY_TIMEOUT_SECONDS,
  });
${
  hasPayments
    ? `  // One bootstrap run; the handler reschedules itself every six hours.
  await queue.enqueue("payment.reconcile", {}, {
    runAt: new Date(Date.now() + 60_000),
    idempotencyKey: "reconcile:bootstrap",
  });
`
    : ""
}`
          : ""
      }  await registerFeatures({
    bot,
    sql: ${needsDb ? "database.client" : "null"},
    queue: ${hasQueue ? "queue" : "null"},
    config,
  });
  await bot.api.setMyCommands([
    { command: "start", description: "Start the bot" },
    { command: "help", description: "Show available commands" },
  ]);

  const server =
    config.BOT_MODE === "webhook"
      ? await createServer(bot, config.WEBHOOK_SECRET, config.BOT_TOKEN, {
          config,
          sql: ${needsDb ? "database.client" : "null"},
        })
      : undefined;
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    if (server !== undefined) {
      const { promise, resolve } = Promise.withResolvers<void>();
      server.close(() => resolve());
      await promise;
    }
    await bot.stop();
${needsDb ? "    await closeDb();\n" : ""}    await shutdownTelemetry();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  if (config.BOT_MODE === "webhook") {
    if (config.WEBHOOK_URL === "") {
      throw new Error("WEBHOOK_URL is required in webhook mode");
    }
    await bot.init();
    server?.listen(config.PORT, () => logger.info({ port: config.PORT }, "webhook server listening"));
    await bot.api.setWebhook(config.WEBHOOK_URL, {
      secret_token: config.WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
      max_connections: 40,
      drop_pending_updates: false,
    });
    return;
  }

  await bot.api.deleteWebhook({ drop_pending_updates: false });
  await bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
}

main().catch((error: unknown) => {
  logger.error({ message: error instanceof Error ? error.message : "unknown" }, "startup failed");
  process.exitCode = 1;
});
`,
    },
    {
      path: "src/server.ts",
      content: `import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Sql } from "postgres";
import { webhookCallback, type Bot } from "grammy";
import type { Config } from "./config.js";
import { handleHealthRequest } from "./runtime/health.js";
import { getRedis } from "./security/dedupe.js";

const MAX_BODY_BYTES = 1_048_576;
${MINIAPP_HELPERS}
export interface ServerOptions {
  readonly sql?: Sql | null | undefined;
  readonly config?: Config | undefined;
}

export async function createServer(
  bot: Bot,
  secretToken: string,
  botToken = "",
  options: ServerOptions = {},
): Promise<Server> {
  const miniAppRoutes = await loadMiniAppRoute();
  const miniAppConfig = options.config;
  const sql = options.sql ?? null;
  const redis =
    miniAppConfig === undefined || miniAppConfig.REDIS_URL === ""
      ? null
      : getRedis(miniAppConfig.REDIS_URL);
  const handleUpdate = webhookCallback(bot, "http", {
    secretToken,
    timeoutMilliseconds: 9000,
    onTimeout: "return",
  });

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
${MINIAPP_ROUTE}    // Route handlers own the 401/403 responses; the server only dispatches.
    // /healthz, /readyz, and /metrics are served by the readiness runtime.
    const handled = await handleHealthRequest(req, res, {
      postgres:
        sql === null
          ? undefined
          : async () => {
              await sql\`SELECT 1\`;
            },
      redis: redis === null ? undefined : () => redis.ping().then(() => undefined),
      metricsEnabled: miniAppConfig?.METRICS_ENABLED ?? true,
    });
    if (handled) return;
    if (req.method !== "POST" || req.url !== "/telegram/webhook") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"not_found"}');
      return;
    }
    const declared = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end('{"error":"payload_too_large"}');
      return;
    }
    let received = 0;
    let rejected = false;
    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      if (!rejected && received > MAX_BODY_BYTES) {
        rejected = true;
        // Destroy, do not respond: a chunked body must not keep buffering.
        req.destroy();
      }
    };
    req.on("data", onData);
    await handleUpdate(req, res)
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end('{"error":"internal_error"}');
        }
      })
      .finally(() => {
        req.off("data", onData);
      });
  };

  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end('{"error":"internal_error"}');
      }
    });
  });
}
`,
    },
    {
      path: "src/telegram/api104-types.ts",
      content: renderApi104TypesTs(),
    },
    {
      path: "src/telegram/api104.ts",
      content: `import type { Bot } from "grammy";
import type { Message } from "grammy/types";

// Bot API 10.4 methods are newer than the grammY 1.46.0 types, so every call
// goes through bot.api.raw behind one narrow cast. Native framework support is
// never claimed; update this adapter when grammY ships the same methods.
export type MessageEntity = Record<string, unknown>;
export type ReplyMarkup = Record<string, unknown>;
export type ReplyParameters = Record<string, unknown>;
export type SuggestedPostParameters = Record<string, unknown>;
export type InputRichBlock = Record<string, unknown>;
export type InputRichMessageMedia = Record<string, unknown>;

export interface EphemeralMessageParameters {
  /** Identifier of the user who will receive the message. */
  receiver_user_id?: number;
  /** Identifier of the callback query, when the message answers one. */
  callback_query_id?: string;
  /** Show the ephemeral message in place of the original message. */
  replace_callback_query_message?: boolean;
}

/** Exactly one of html, markdown, or blocks must be set. */
export interface InputRichMessage {
  blocks?: readonly InputRichBlock[];
  html?: string;
  markdown?: string;
  media?: readonly InputRichMessageMedia[];
  is_rtl?: boolean;
  skip_entity_detection?: boolean;
}

export interface SendWidgetParams {
  chat_id: number | string;
  message_thread_id?: number;
  /** HTML widget source, 1-32768 bytes; at most 4096 bytes after zlib compression. */
  html: string;
  /** Widget width in logical pixels; clamped to 200..bubble width. */
  width?: number;
  /** Widget height in logical pixels; clamped to 50..600. */
  height?: number;
  /** Public widget data, 0-1024 bytes. */
  public_data?: string;
  /** Message-specific widget data, 0-1024 bytes. */
  chat_data?: string;
  /** Caption, 0-1024 characters after entity parsing. */
  caption?: string;
  parse_mode?: string;
  caption_entities?: readonly MessageEntity[];
  show_caption_above_media?: boolean;
  allow_queries?: boolean;
  is_shared?: boolean;
  disable_notification?: boolean;
  protect_content?: boolean;
  allow_paid_broadcast?: boolean;
  message_effect_id?: string;
  reply_parameters?: ReplyParameters;
  reply_markup?: ReplyMarkup;
}

export interface SendSharedWidgetParams {
  chat_id: number | string;
  message_thread_id?: number;
  widget_id: string;
  /** Message-specific widget data, 0-1024 bytes. */
  chat_data?: string;
  /** Caption, 0-1024 characters after entity parsing. */
  caption?: string;
  parse_mode?: string;
  caption_entities?: readonly MessageEntity[];
  show_caption_above_media?: boolean;
  disable_notification?: boolean;
  protect_content?: boolean;
  allow_paid_broadcast?: boolean;
  message_effect_id?: string;
  reply_parameters?: ReplyParameters;
  reply_markup?: ReplyMarkup;
}

export interface AnswerWidgetQueryParams {
  /** Identifier of the widget query; the query must be answered within 15 seconds. */
  widget_query_id: string;
  /** Data returned to the widget, 0-1024 bytes. */
  data?: string;
}

export interface EditMessageWidgetDataParams {
  chat_id?: number | string;
  message_id?: number;
  inline_message_id?: string;
  /** New public widget data, 0-1024 bytes; empty string clears it. */
  public_data?: string;
  /** New message-specific widget data, 0-1024 bytes; empty string clears it. */
  chat_data?: string;
}

export interface EditSharedWidgetDataParams {
  widget_id: string;
  /** New public widget data, 0-1024 bytes; empty string clears it. */
  public_data: string;
  /** Client-side cache time in seconds, 5-3600. */
  cache_time?: number;
}

export interface SendRichMessageParams {
  business_connection_id?: string;
  chat_id?: number | string;
  message_thread_id?: number;
  direct_messages_topic_id?: number;
  ephemeral_message_parameters?: EphemeralMessageParameters;
  rich_message: InputRichMessage;
  disable_notification?: boolean;
  protect_content?: boolean;
  allow_paid_broadcast?: boolean;
  message_effect_id?: string;
  suggested_post_parameters?: SuggestedPostParameters;
  reply_parameters?: ReplyParameters;
  reply_markup?: ReplyMarkup;
}

export interface SendRichMessageDraftParams {
  /** Private chat identifier. */
  chat_id: number;
  message_thread_id?: number;
  /** Non-zero draft identifier; updates with the same id animate. */
  draft_id: number;
  rich_message: InputRichMessage;
  can_stop?: boolean;
  keep_on_stop?: boolean;
}

export interface SendMessageEphemeralParams {
  chat_id?: number | string;
  message_thread_id?: number;
  text: string;
  parse_mode?: string;
  entities?: readonly MessageEntity[];
  ephemeral_message_parameters: EphemeralMessageParameters;
  reply_parameters?: ReplyParameters;
  reply_markup?: ReplyMarkup;
}


export interface GetUniqueGiftParams { gift_id: string; }
export interface GetChatShareThemeBackdropsParams { chat_id: number | string; }
export interface DeleteBusinessAccountGiftParams {
  business_connection_id: string;
  gift_id: string;
}
export interface VerifyUserParams {
  user_id: number;
  custom_description?: string;
  custom_description_parse_mode?: string;
  custom_description_entities?: readonly MessageEntity[];
}
export interface VerifyChatParams {
  chat_id: number | string;
  custom_description?: string;
  custom_description_parse_mode?: string;
  custom_description_entities?: readonly MessageEntity[];
}

interface RawApi104 {
  sendWidget(payload: SendWidgetParams): Promise<Message>;
  sendSharedWidget(payload: SendSharedWidgetParams): Promise<Message>;
  answerWidgetQuery(payload: AnswerWidgetQueryParams): Promise<true>;
  editMessageWidgetData(payload: EditMessageWidgetDataParams): Promise<true>;
  editSharedWidgetData(payload: EditSharedWidgetDataParams): Promise<true>;
  sendRichMessage(payload: SendRichMessageParams): Promise<Message>;
  sendRichMessageDraft(payload: SendRichMessageDraftParams): Promise<true>;
  sendMessage(payload: SendMessageEphemeralParams): Promise<Message>;
  getUniqueGift(payload: GetUniqueGiftParams): Promise<unknown>;
  getChatShareThemeBackdrops(payload: GetChatShareThemeBackdropsParams): Promise<unknown>;
  deleteBusinessAccountGift(payload: DeleteBusinessAccountGiftParams): Promise<true>;
  verifyUser(payload: VerifyUserParams): Promise<true>;
  verifyChat(payload: VerifyChatParams): Promise<true>;
}

export interface Api104 {
  sendWidget(payload: SendWidgetParams): Promise<Message>;
  sendSharedWidget(payload: SendSharedWidgetParams): Promise<Message>;
  answerWidgetQuery(payload: AnswerWidgetQueryParams): Promise<true>;
  editMessageWidgetData(payload: EditMessageWidgetDataParams): Promise<true>;
  editSharedWidgetData(payload: EditSharedWidgetDataParams): Promise<true>;
  sendRichMessage(payload: SendRichMessageParams): Promise<Message>;
  sendRichMessageDraft(payload: SendRichMessageDraftParams): Promise<true>;
  sendMessageEphemeral(payload: SendMessageEphemeralParams): Promise<Message>;
  getUniqueGift(payload: GetUniqueGiftParams): Promise<unknown>;
  getChatShareThemeBackdrops(payload: GetChatShareThemeBackdropsParams): Promise<unknown>;
  deleteBusinessAccountGift(payload: DeleteBusinessAccountGiftParams): Promise<true>;
  verifyUser(payload: VerifyUserParams): Promise<true>;
  verifyChat(payload: VerifyChatParams): Promise<true>;
}

export function api104(bot: Bot): Api104 {
  const raw = bot.api.raw as unknown as RawApi104;
  return {
    sendWidget: (payload) => raw.sendWidget(payload),
    sendSharedWidget: (payload) => raw.sendSharedWidget(payload),
    answerWidgetQuery: (payload) => raw.answerWidgetQuery(payload),
    editMessageWidgetData: (payload) => raw.editMessageWidgetData(payload),
    editSharedWidgetData: (payload) => raw.editSharedWidgetData(payload),
    sendRichMessage: (payload) => raw.sendRichMessage(payload),
    sendRichMessageDraft: (payload) => raw.sendRichMessageDraft(payload),
    // Bot API 10.4 has no sendMessageEphemeral method: ephemeral delivery is
    // sendMessage with ephemeral_message_parameters.
    sendMessageEphemeral: (payload) => raw.sendMessage(payload),
    getUniqueGift: (payload) => raw.getUniqueGift(payload),
    getChatShareThemeBackdrops: (payload) => raw.getChatShareThemeBackdrops(payload),
    deleteBusinessAccountGift: (payload) => raw.deleteBusinessAccountGift(payload),
    verifyUser: (payload) => raw.verifyUser(payload),
    verifyChat: (payload) => raw.verifyChat(payload),
  };
}
`,
    },
    {
      path: "src/security/retry.ts",
      content: `interface TelegramErrorLike {
  parameters?: { retry_after?: unknown };
}

/** Reads the Telegram retry_after hint (seconds) from a grammY error. */
export function retryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const parameters = (error as TelegramErrorLike).parameters;
  if (typeof parameters !== "object" || parameters === null) return undefined;
  const seconds = parameters.retry_after;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.ceil(seconds * 1000);
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Retries a send exactly once when Telegram answers 429 with retry_after. */
export async function sendWithRetry<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    const delay = retryAfterMs(error);
    if (delay === undefined) throw error;
    await sleep(delay);
    return send();
  }
}
`,
    },
    {
      path: "src/features/index.ts",
      content: `import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Bot } from "grammy";
import type { Redis } from "ioredis";
${needsDb ? 'import type { Sql } from "postgres";\n' : ""}import type { Config } from "../config.js";
import { logger } from "../logger.js";
${hasQueue ? 'import type { Queue } from "../runtime/queue.js";\n' : ""}
export interface FeatureDeps {
  readonly bot: Bot;
  readonly sql: ${needsDb ? "Sql" : "null"};
  readonly queue: ${hasQueue ? "Queue" : "null"};
  readonly config: Config;
  readonly redis?: Redis;
}

export interface FeatureModule {
  register(bot: Bot, deps: FeatureDeps): void | Promise<void>;
}

const FEATURE_FILE_RE = /^[a-z][a-z0-9_-]*\\.(?:js|ts)$/;
const SKIPPED: Record<string, true> = { "index.js": true, "index.ts": true };

export async function registerFeatures(deps: FeatureDeps): Promise<void> {
  const directory = dirname(fileURLToPath(import.meta.url));
  const entries = (await readdir(directory)).filter(
    (entry) => FEATURE_FILE_RE.test(entry) && SKIPPED[entry] === undefined && !entry.endsWith(".d.ts"),
  );
  entries.toSorted();
  for (const entry of entries) {
    // Feature modules are a runtime registry, so the specifier is selected at run time.
    const loaded = (await import(pathToFileURL(join(directory, entry)).href)) as Partial<FeatureModule>;
    if (typeof loaded.register !== "function") {
      logger.warn({ entry }, "feature module has no register export");
      continue;
    }
    // Most features take the full deps object; the LLM module only needs the queue.
    const register = loaded.register as (bot: Bot, argument: unknown) => void | Promise<void>;
    await register(deps.bot, entry === "llm.js" || entry === "llm.ts" ? deps.queue : deps);
  }
}
`,
    },
    {
      path: "src/features/start.ts",
      content: `import type { Bot } from "grammy";
import { t } from "../i18n/index.js";

export function register(bot: Bot): void {
  bot.command("start", async (ctx) => {
    await ctx.reply(t(ctx.from?.language_code, "start.welcome", { bot: ${displayName} }));
  });
}
`,
    },
    {
      path: "src/features/help.ts",
      content: `import type { Bot } from "grammy";
import { t } from "../i18n/index.js";

export function register(bot: Bot): void {
  bot.command("help", async (ctx) => {
    const locale = ctx.from?.language_code;
    await ctx.reply(t(locale, "help.title") + "\\n" + t(locale, "help.commands"));
  });
}
`,
    },
    {
      path: "src/features/admin.ts",
      content: `import type { Bot } from "grammy";
import { isAdmin } from "../security/allowlist.js";

export function register(bot: Bot): void {
  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied.");
      return;
    }
    await ctx.reply("Admin area ready.");
  });
}
`,
    },
    {
      path: "src/security/allowlist.ts",
      content: `export function parseAdminIds(value: string | undefined = process.env.ADMIN_IDS): number[] {
  if (value === undefined || value === "") return [];
  const ids: number[] = [];
  for (const part of value.split(",")) {
    const id = Number(part.trim());
    if (Number.isSafeInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

export function isAdmin(
  userId: number | undefined,
  value: string | undefined = process.env.ADMIN_IDS,
): boolean {
  if (userId === undefined || !Number.isSafeInteger(userId)) return false;
  return parseAdminIds(value).includes(userId);
}
`,
    },
    {
      path: "src/security/dedupe.ts",
      content: `import { Redis } from "ioredis";
import type { Context, MiddlewareFn } from "grammy";
import { logger } from "../logger.js";

let client: Redis | undefined;

export function getRedis(redisUrl: string | undefined = process.env.REDIS_URL): Redis | null {
  if (redisUrl === undefined || redisUrl === "") return null;
  if (client === undefined) {
    client = new Redis(redisUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
  }
  return client;
}

export async function claimUpdate(
  updateId: number,
  redisUrl: string | undefined = process.env.REDIS_URL,
): Promise<boolean> {
  const connection = getRedis(redisUrl);
  if (connection === null) {
    logger.warn("REDIS_URL is not set; update deduplication is disabled");
    return true;
  }
  try {
    const result = await connection.set("update:" + String(updateId), "1", "EX", 86400, "NX");
    return result === "OK";
  } catch (error) {
    logger.error(
      { message: error instanceof Error ? error.message : "redis error" },
      "dedupe check failed; stopping update",
    );
    return false;
  }
}

export function dedupeMiddleware(
  redisUrl: string | undefined = process.env.REDIS_URL,
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (await claimUpdate(ctx.update.update_id, redisUrl)) {
      await next();
    }
  };
}
`,
    },
    {
      path: "src/security/rate-limit.ts",
      content: `import type { Context, MiddlewareFn } from "grammy";
import { logger } from "../logger.js";
import { getRedis } from "./dedupe.js";

export async function allowChat(
  chatId: number,
  isGroup: boolean,
  redisUrl: string | undefined = process.env.REDIS_URL,
): Promise<boolean> {
  const connection = getRedis(redisUrl);
  if (connection === null) {
    logger.warn("REDIS_URL is not set; rate limiting is disabled");
    return true;
  }
  const windowMs = isGroup ? 60_000 : 1_000;
  const limit = isGroup ? 20 : 1;
  const bucket = Math.floor(Date.now() / windowMs);
  const key = "rate:" + String(chatId) + ":" + String(windowMs) + ":" + String(bucket);
  try {
    const count = await connection.incr(key);
    if (count === 1) {
      await connection.pexpire(key, windowMs);
    }
    return count <= limit;
  } catch (error) {
    logger.error(
      { message: error instanceof Error ? error.message : "redis error" },
      "rate limit check failed; allowing message",
    );
    return true;
  }
}

export function rateLimitMiddleware(
  redisUrl: string | undefined = process.env.REDIS_URL,
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const chat = ctx.chat;
    if (chat === undefined || (await allowChat(chat.id, chat.type !== "private", redisUrl))) {
      await next();
    }
  };
}
`,
    },
    {
      path: "src/storage/db.ts",
      content: `import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema.js";

export interface Database {
  readonly client: Sql;
  readonly db: PostgresJsDatabase<typeof schema>;
}

let database: Database | null | undefined;

export function getDb(url: string | undefined = process.env.DATABASE_URL): Database | null {
  if (database !== undefined) return database;
  if (url === undefined || url === "") {
    database = null;
    return database;
  }
  const client = postgres(url, { max: 10 });
  database = { client, db: drizzle(client, { schema }) };
  return database;
}

export async function closeDb(): Promise<void> {
  if (database !== null && database !== undefined) {
    await database.client.end();
  }
  database = undefined;
}
`,
    },
    {
      path: "src/storage/schema.ts",
      content: renderSchemaTs(spec),
    },
    {
      path: "tests/features.test.ts",
      content: `import { expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  BOT_TOKEN: "123456:" + "a".repeat(30),
  WEBHOOK_SECRET: "test_secret_value",
  DATABASE_URL: "postgres://user:pass@localhost:5432/bot",
  REDIS_URL: "redis://localhost:6379/0",
};

test("rejects a malformed bot token", () => {
  expect(() => loadConfig({ ...baseEnv, BOT_TOKEN: "not-a-token" })).toThrow();
});

test("accepts a polling configuration without a webhook url", () => {
  const config = loadConfig({ ...baseEnv, BOT_MODE: "polling" });
  expect(config.BOT_MODE).toBe("polling");
  expect(config.PORT).toBe(8080);
});

test("rejects a non-https webhook url", () => {
  expect(() =>
    loadConfig({ ...baseEnv, WEBHOOK_URL: "http://bot.example.com" }),
  ).toThrow();
});

test("parses admin ids and drops invalid entries", () => {
  expect(loadConfig({ ...baseEnv, ADMIN_IDS: "1, 2,oops,0" }).ADMIN_IDS).toEqual([1, 2]);
});
`,
    },
    {
      path: "tests/security.test.ts",
      content: `import { expect, test } from "bun:test";
import { isAdmin, parseAdminIds } from "../src/security/allowlist.js";
import { claimUpdate } from "../src/security/dedupe.js";
import { allowChat } from "../src/security/rate-limit.js";

test("parseAdminIds keeps only positive safe integers", () => {
  expect(parseAdminIds("10, 20,bad,-3")).toEqual([10, 20]);
  expect(parseAdminIds("")).toEqual([]);
  expect(parseAdminIds(undefined)).toEqual([]);
});

test("isAdmin matches numeric ids only", () => {
  expect(isAdmin(10, "10,20")).toBe(true);
  expect(isAdmin(30, "10,20")).toBe(false);
  expect(isAdmin(undefined, "10,20")).toBe(false);
});

test("dedupe without redis claims the update", async () => {
  expect(await claimUpdate(1, "")).toBe(true);
});

test("rate limit without redis allows the message", async () => {
  expect(await allowChat(1, false, "")).toBe(true);
});
`,
    },
    {
      path: "tests/webhook-secret.test.ts",
      content: `import { expect, test } from "bun:test";
import type { Bot } from "grammy";
import { createServer } from "../src/server.js";

function fakeBot(): Bot {
  return {
    isRunning: () => false,
    init: async () => undefined,
    handleUpdate: async () => undefined,
  } as unknown as Bot;
}

test("rejects webhook requests without the secret header", async () => {
  const server = await createServer(fakeBot(), "expected_secret");
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", onListening);
  await listening;
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    const response = await fetch("http://127.0.0.1:" + String(address.port) + "/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(response.status).toBe(401);
  } finally {
    const { promise, resolve } = Promise.withResolvers<void>();
    server.close(() => resolve());
    await promise;
  }
});
`,
    },
    {
      path: "tests/api104.test.ts",
      content: `import { expect, test } from "bun:test";
import type { Bot } from "grammy";
import type { Message } from "grammy/types";
import { api104 } from "../src/telegram/api104.js";

interface Call {
  readonly method: string;
  readonly payload: unknown;
}

function fakeBot(calls: Call[]): Bot {
  const raw = new Proxy(
    {},
    {
      get: (_target, property) => async (payload: unknown) => {
        calls.push({ method: String(property), payload });
        return property === "sendWidget" || property === "sendRichMessage"
          ? ({ message_id: 1 } as Message)
          : true;
      },
    },
  );
  return { api: { raw } } as unknown as Bot;
}

test("sendWidget forwards the payload through the raw client", async () => {
  const calls: Call[] = [];
  const api = api104(fakeBot(calls));
  await api.sendWidget({ chat_id: 1, html: "<b>hi</b>" });
  expect(calls).toEqual([
    { method: "sendWidget", payload: { chat_id: 1, html: "<b>hi</b>" } },
  ]);
});

test("answerWidgetQuery forwards the query id", async () => {
  const calls: Call[] = [];
  const api = api104(fakeBot(calls));
  await api.answerWidgetQuery({ widget_query_id: "q1", data: "ok" });
  expect(calls).toEqual([
    { method: "answerWidgetQuery", payload: { widget_query_id: "q1", data: "ok" } },
  ]);
});

test("sendMessageEphemeral uses the raw sendMessage method", async () => {
  const calls: Call[] = [];
  const api = api104(fakeBot(calls));
  await api.sendMessageEphemeral({
    text: "hello",
    ephemeral_message_parameters: { receiver_user_id: 7 },
  });
  expect(calls[0]?.method).toBe("sendMessage");
});

test("sendRichMessageDraft forwards the draft id", async () => {
  const calls: Call[] = [];
  const api = api104(fakeBot(calls));
  await api.sendRichMessageDraft({
    chat_id: 1,
    draft_id: 42,
    rich_message: { markdown: "Generating..." },
  });
  expect(calls[0]?.payload).toMatchObject({ chat_id: 1, draft_id: 42 });
});
`,
    },
    {
      path: "tests/retry.test.ts",
      content: `import { expect, test } from "bun:test";
import { retryAfterMs, sendWithRetry } from "../src/security/retry.js";

test("reads retry_after seconds and converts to milliseconds", () => {
  expect(retryAfterMs({ parameters: { retry_after: 3 } })).toBe(3000);
  expect(retryAfterMs({ parameters: { retry_after: 0.5 } })).toBe(500);
});

test("ignores errors without a retry_after hint", () => {
  expect(retryAfterMs(new Error("plain"))).toBeUndefined();
  expect(retryAfterMs({ parameters: {} })).toBeUndefined();
});

test("sendWithRetry retries exactly once after a 429", async () => {
  let attempts = 0;
  const result = await sendWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw { parameters: { retry_after: 0.001 } };
    return "ok";
  });
  expect(result).toBe("ok");
  expect(attempts).toBe(2);
});
`,
    },
    {
      path: "tests/middleware.test.ts",
      content: `import { expect, test } from "bun:test";
import { createBot } from "../src/bot.js";
import { loadConfig } from "../src/config.js";

const EXPECTED_SECURITY_MIDDLEWARE = ${expectedMiddleware};

const config = loadConfig({
  BOT_TOKEN: "123456:" + "a".repeat(30),
  WEBHOOK_SECRET: "test_secret_value",
  DATABASE_URL: "postgres://user:pass@localhost:5432/bot",
  REDIS_URL: "redis://localhost:6379/0",
});

test("createBot installs the configured security middleware", () => {
  const bot = createBot(config);
  expect(bot.securityMiddleware.length).toBe(EXPECTED_SECURITY_MIDDLEWARE);
});

test("security middleware is installed before update handling", () => {
  const bot = createBot({ ...config, REDIS_URL: "" });
  expect(bot.securityMiddleware.length).toBe(EXPECTED_SECURITY_MIDDLEWARE);
  expect(typeof bot.middleware()).toBe("function");
});
`,
    },
    {
      path: "tests/body-cap.test.ts",
      content: `import { expect, test } from "bun:test";
import { request } from "node:http";
import type { Bot } from "grammy";
import { createServer } from "../src/server.js";

function fakeBot(): Bot {
  return {
    isRunning: () => false,
    init: async () => undefined,
    handleUpdate: async () => undefined,
  } as unknown as Bot;
}

function postChunked(port: number): Promise<"rejected" | "responded"> {
  const { promise, resolve, reject } = Promise.withResolvers<"rejected" | "responded">();
  const req = request(
    {
      host: "127.0.0.1",
      port,
      path: "/telegram/webhook",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "expected_secret",
      },
    },
    (res) => {
      res.resume();
      reject(new Error("server responded with " + String(res.statusCode)));
    },
  );
  req.on("error", () => resolve("rejected"));
  req.write(Buffer.alloc(600_000, 0x61));
  req.write(Buffer.alloc(600_000, 0x61));
  req.end();
  return promise;
}

test("destroys the connection on a chunked body over 1 MiB", async () => {
  const server = await createServer(fakeBot(), "expected_secret", "");
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", resolve);
  await promise;
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    expect(await postChunked(address.port)).toBe("rejected");
  } finally {
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    server.close(() => onClosed());
    await closed;
  }
});
`,
    },
  ];
}

const WIDGETS_FEATURE: TemplateFile = {
  path: "src/features/widgets.ts",
  content: `import type { Bot, Context } from "grammy";
import { logger } from "../logger.js";
import { api104 } from "../telegram/api104.js";

interface WidgetQueryLike {
  readonly id: string;
  readonly data?: string;
  readonly type?: unknown;
}

// grammY 1.46.0 predates Bot API 10.4, so widget updates are read through one
// named boundary type instead of a per-access assertion.
interface Api104Update {
  readonly widget_query?: unknown;
  readonly shared_widget_query?: unknown;
}

function isWidgetQuery(value: unknown): value is WidgetQueryLike {
  if (typeof value !== "object" || value === null) return false;
  const query = value as { id?: unknown };
  return typeof query.id === "string" && query.id.length > 0;
}

// A widget query must be answered within 15 seconds.
export function register(bot: Bot): void {
  const api = api104(bot);
  const answer = async (query: WidgetQueryLike, kind: string): Promise<void> => {
    if (query.type !== undefined && (typeof query.type !== "object" || query.type === null)) {
      logger.warn({ kind }, "unknown widget query type; not answered");
      return;
    }
    const raw = query.data;
    const safe = typeof raw === "string" && Buffer.byteLength(raw, "utf8") <= 1024;
    try {
      await api.answerWidgetQuery({
        widget_query_id: query.id,
        ...(safe ? { data: raw } : {}),
      });
    } catch (error) {
      logger.error(
        { kind, message: error instanceof Error ? error.message : "unknown" },
        "answerWidgetQuery failed",
      );
    }
  };
  // Bot API 10.4 carries widget_query / shared_widget_query at the top level of
  // Update. grammY 1.46.0 predates those fields, so the filter is narrowed here.
  const onUpdate = bot.on as unknown as (
    filter: string,
    handler: (ctx: Context) => Promise<void>,
  ) => void;
  onUpdate("widget_query", async (ctx) => {
    const update = ctx.update as unknown as Api104Update;
    if (!isWidgetQuery(update.widget_query)) {
      logger.warn("malformed widget_query update");
      return;
    }
    await answer(update.widget_query, "widget_query");
  });
  onUpdate("shared_widget_query", async (ctx) => {
    const update = ctx.update as unknown as Api104Update;
    if (!isWidgetQuery(update.shared_widget_query)) {
      logger.warn("malformed shared_widget_query update");
      return;
    }
    await answer(update.shared_widget_query, "shared_widget_query");
  });
}
`,
};

const WIDGETS_TEST: TemplateFile = {
  path: "tests/widgets.test.ts",
  content: `import { expect, test } from "bun:test";
import type { Bot } from "grammy";
import { register } from "../src/features/widgets.js";

interface Registered {
  readonly filter: string;
  readonly handler: (ctx: unknown) => Promise<void> | void;
}

function fakeBot(answers: unknown[]): { bot: Bot; handlers: Registered[] } {
  const handlers: Registered[] = [];
  const raw = {
    answerWidgetQuery: async (payload: unknown) => {
      answers.push(payload);
      return true;
    },
  };
  const bot = {
    api: { raw },
    on: (filter: string, handler: (ctx: unknown) => Promise<void> | void) => {
      handlers.push({ filter, handler });
    },
  } as unknown as Bot;
  return { bot, handlers };
}

function handlerFor(handlers: Registered[], filter: string): Registered["handler"] {
  const entry = handlers.find((candidate) => candidate.filter === filter);
  if (entry === undefined) throw new Error("missing handler " + filter);
  return entry.handler;
}

test("answers widget queries with the query id and data", async () => {
  const answers: unknown[] = [];
  const { bot, handlers } = fakeBot(answers);
  register(bot);
  const handler = handlerFor(handlers, "widget_query");
  await handler({
    update: { widget_query: { id: "q1", data: "hello", type: { type: "data" } } },
  });
  expect(answers).toEqual([{ widget_query_id: "q1", data: "hello" }]);
});

test("answers shared widget queries", async () => {
  const answers: unknown[] = [];
  const { bot, handlers } = fakeBot(answers);
  register(bot);
  const handler = handlerFor(handlers, "shared_widget_query");
  await handler({ update: { shared_widget_query: { id: "q2", type: {} } } });
  expect(answers).toEqual([{ widget_query_id: "q2" }]);
});

test("guards malformed queries and unknown types", async () => {
  const answers: unknown[] = [];
  const { bot, handlers } = fakeBot(answers);
  register(bot);
  const handler = handlerFor(handlers, "widget_query");
  await handler({ update: { widget_query: { data: "no id" } } });
  await handler({ update: { widget_query: { id: "q3", type: "bogus" } } });
  expect(answers).toEqual([]);
});
`,
};

const RICH_FEATURE: TemplateFile = {
  path: "src/features/rich.ts",
  content: `import type { Bot } from "grammy";
import { logger } from "../logger.js";
import { api104 } from "../telegram/api104.js";

export function register(bot: Bot): void {
  const api = api104(bot);
  bot.command("rich", async (ctx) => {
    try {
      await api.sendRichMessage({
        chat_id: ctx.chat.id,
        rich_message: {
          markdown: "**Aurifex**\\n\\nThis message uses the Bot API 10.4 rich message format.",
        },
      });
    } catch (error) {
      logger.error(
        { message: error instanceof Error ? error.message : "unknown" },
        "sendRichMessage failed",
      );
      await ctx.reply("Rich messages are unavailable in this chat.");
    }
  });
  bot.command("rich_stream", async (ctx) => {
    if (ctx.chat.type !== "private") {
      await ctx.reply("Streaming drafts are available in private chats only.");
      return;
    }
    const draftId = (Date.now() % 2_147_483_646) + 1;
    try {
      await api.sendRichMessageDraft({
        chat_id: ctx.chat.id,
        draft_id: draftId,
        rich_message: { markdown: "Generating rich message..." },
      });
      // A draft is a 30-second preview; the final message must be sent explicitly.
      await api.sendRichMessage({
        chat_id: ctx.chat.id,
        rich_message: { markdown: "**Done.** Streamed draft finalized." },
      });
    } catch (error) {
      logger.error(
        { message: error instanceof Error ? error.message : "unknown" },
        "rich message streaming failed",
      );
      await ctx.reply("Streaming failed.");
    }
  });
}
`,
};

const README_API104 = `
## Bot API 10.4 (typed raw adapter)

grammY 1.46.0 advertises Bot API 10.3. Bot API 10.4 methods go through
\`src/telegram/api104.ts\`, a typed adapter over \`bot.api.raw\`:

- \`sendWidget\` / \`sendSharedWidget\` — HTML widgets, 1-32768 bytes, at most 4096 compressed.
- \`answerWidgetQuery\` — answer widget requests within 15 seconds.
- \`editMessageWidgetData\` / \`editSharedWidgetData\` — update widget state.
- \`sendRichMessage\` / \`sendRichMessageDraft\` — rich messages and streaming drafts.
- \`sendMessageEphemeral\` — ephemeral messages via \`ephemeral_message_parameters\`.

Widgets and rich messages are enabled by the \`widgets\` and \`rich\` features.
`;

const MINIAPP_SESSION_TEST: TemplateFile = {
  path: "tests/miniapp-session.test.ts",
  content: `import { expect, test } from "bun:test";
import type { Bot } from "grammy";
import type { Sql } from "postgres";
import { createServer, type ServerOptions } from "../src/server.js";

async function hasMiniAppRoute(): Promise<boolean> {
  // Runtime plugin registry: the module exists only after the feature is added.
  const name = "miniapp";
  try {
    const mod: unknown = await import("../src/features/" + name + ".js");
    return typeof mod === "object" && mod !== null && "routes" in mod;
  } catch {
    return false;
  }
}

const available = await hasMiniAppRoute();

function fakeBot(): Bot {
  return {
    isRunning: () => false,
    init: async () => undefined,
    handleUpdate: async () => undefined,
  } as unknown as Bot;
}

const serverOptions: ServerOptions = {
  config: {
    MINIAPP_SESSION_TTL_SECONDS: 86_400,
    MINIAPP_ALLOWED_ORIGINS: "",
  } as unknown as ServerOptions["config"],
};

async function fetchServer(
  path: string,
  init: RequestInit = {},
  options: ServerOptions = serverOptions,
): Promise<Response> {
  const server = await createServer(fakeBot(), "expected_secret", "", options);
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", resolve);
  await promise;
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    return await fetch("http://127.0.0.1:" + String(address.port) + path, init);
  } finally {
    const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
    server.close(() => onClosed());
    await closed;
  }
}

test("healthz returns ok without dependencies", async () => {
  const response = await fetchServer("/healthz");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

test("readyz returns the 503 shape when postgres fails", async () => {
  const failingSql = (() => {
    throw new Error("postgres down");
  }) as unknown as Sql;
  const response = await fetchServer("/readyz", {}, { ...serverOptions, sql: failingSql });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    ok: false,
    checks: { postgres: "fail", redis: "skip" },
  });
});

test("metrics exposes the bounded metric names", async () => {
  const response = await fetchServer("/metrics");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/plain");
  const body = await response.text();
  expect(body).toContain("bot_updates_total");
  expect(body).toContain("job_failures_total");
});

test.skipIf(!available)("rejects malformed initData with 401 and security headers", async () => {
  const response = await fetchServer("/api/miniapp/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: "not-signed" }),
  });
  expect(response.status).toBe(401);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
});
`,
};

const QUEUE_WIRING_TEST: TemplateFile = {
  path: "tests/queue-wiring.test.ts",
  content: `import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string): string =>
  readFileSync(new URL(\`../\${path}\`, import.meta.url), "utf8");

test("worker entry runs jobs without starting long polling", () => {
  const source = read("src/worker.ts");
  expect(source).not.toContain("bot.start");
  expect(source).toContain("SIGINT");
  expect(source).toContain("SIGTERM");
  expect(source).toContain("./runtime/queue.js");
});
`,
};

// Queue, worker, and job loader exist only for a Postgres queue: a
// commands-only bot must not carry the runtime or its dependencies.
function queueFiles(spec: BotSpec): TemplateFile[] {
  if (spec.runtime.queue !== "postgres") {
    return [];
  }
  return [
    { path: "src/runtime/queue.ts", content: renderQueueTs() },
    { path: "src/runtime/worker.ts", content: renderWorkerTs() },
    { path: "src/worker.ts", content: renderWorkerEntryTs(spec) },
    { path: "src/jobs/index.ts", content: renderJobsIndexTs() },
    { path: "src/migrate.ts", content: renderMigrateTs() },
    QUEUE_WIRING_TEST,
  ];
}

// The full runtime schema is one migration: users, payments, jobs, broadcasts.
function migrationFiles(spec: BotSpec): TemplateFile[] {
  if (!spec.storage.postgres && spec.runtime.queue !== "postgres") {
    return [];
  }
  return [{ path: QUEUE_MIGRATION_FILE, content: renderDrizzleMigration() }];
}

function featureFiles(spec: BotSpec): TemplateFile[] {
  const files: TemplateFile[] = [MINIAPP_SESSION_TEST];
  if (spec.features.includes("llm")) {
    files.push(...renderGrammyFeature("llm", "llm", spec));
  }
  if (spec.features.includes("broadcast")) {
    files.push(...renderGrammyFeature("broadcast", "broadcast", spec));
  }
  if (spec.features.includes("payments")) {
    files.push(...renderGrammyFeature("payments", "payments", spec));
  }
  if (spec.storage.postgres) {
    files.push({ path: "src/security/user-sync.ts", content: renderUserSyncTs() });
  }
  if (spec.features.includes("miniapps")) {
    files.push(...renderGrammyFeature("miniapps", "miniapp", spec));
  }
  if (spec.features.includes("widgets")) {
    files.push(WIDGETS_FEATURE, WIDGETS_TEST);
  }
  if (spec.features.includes("rich")) {
    files.push(RICH_FEATURE);
  }
  return files;
}

// Shared base files predate Bun test types; add them without forking shared.ts.
function withBunSupport(files: TemplateFile[]): TemplateFile[] {
  return files.map((file) => {
    if (file.path === "package.json") {
      const pkg = JSON.parse(file.content) as {
        devDependencies: Record<string, string>;
      };
      pkg.devDependencies["@types/bun"] = "1.4.4";
      return { ...file, content: JSON.stringify(pkg, null, 2) + "\n" };
    }
    if (file.path === "tsconfig.json") {
      const tsconfig = JSON.parse(file.content) as {
        compilerOptions: { types: string[] };
      };
      tsconfig.compilerOptions.types = ["node", "bun"];
      return { ...file, content: JSON.stringify(tsconfig, null, 2) + "\n" };
    }
    if (file.path === "README.md") {
      return { ...file, content: file.content + README_API104 };
    }
    return file;
  });
}

export function renderGrammyProject(spec: BotSpec, target: StackTarget): TemplateFile[] {
  if (spec.stack !== "grammy") {
    throw new Error("internal_error: grammy renderer requires a grammy spec");
  }
  const files = withBunSupport([
    ...baseFiles(spec, target),
    ...renderI18nFiles(spec),
    ...grammyFiles(spec),
    ...migrationFiles(spec),
    ...queueFiles(spec),
    ...featureFiles(spec),
  ]);
  assertNoTokenLiteral(files);
  return files;
}
