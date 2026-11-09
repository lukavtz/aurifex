import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Sql } from "postgres";
import { webhookCallback, type Bot } from "grammy";
import type { Config } from "./config.js";
import { handleHealthRequest } from "./runtime/health.js";
import { getRedis } from "./security/dedupe.js";

const MAX_BODY_BYTES = 1_048_576;

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
    const miniAppRoute = miniAppRoutes.find(
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
    // Route handlers own the 401/403 responses; the server only dispatches.
    // /healthz, /readyz, and /metrics are served by the readiness runtime.
    const handled = await handleHealthRequest(req, res, {
      postgres:
        sql === null
          ? undefined
          : async () => {
              await sql`SELECT 1`;
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
