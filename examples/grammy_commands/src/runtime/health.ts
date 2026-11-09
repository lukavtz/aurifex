import "./telemetry.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { register } from "prom-client";

export const HEALTH_PATH = "/healthz";
export const READY_PATH = "/readyz";
export const METRICS_PATH = "/metrics";
export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4";

export interface ReadinessProbes {
  readonly postgres?: (() => Promise<void>) | undefined;
  readonly redis?: (() => Promise<void>) | undefined;
  readonly metricsEnabled?: boolean | undefined;
}

export type CheckStatus = "ok" | "fail" | "skip";

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

export function healthHandler(_req: IncomingMessage, res: ServerResponse): void {
  send(res, 200, "application/json", '{"ok":true}');
}

async function probe(check: (() => Promise<void>) | undefined): Promise<CheckStatus> {
  if (check === undefined) {
    return "skip";
  }
  try {
    await check();
    return "ok";
  } catch {
    return "fail";
  }
}

export async function readyHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  probes: ReadinessProbes = {},
): Promise<void> {
  const postgres = await probe(probes.postgres);
  const redis = await probe(probes.redis);
  const ok = postgres !== "fail" && redis !== "fail";
  send(
    res,
    ok ? 200 : 503,
    "application/json",
    JSON.stringify({ ok, checks: { postgres, redis } }),
  );
}

export async function metricsHandler(res: ServerResponse): Promise<void> {
  send(res, 200, METRICS_CONTENT_TYPE, await register.metrics());
}

// Server wiring: returns false for any non-health request so the caller keeps
// its own routing and 404 handling.
export async function handleHealthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  probes: ReadinessProbes = {},
): Promise<boolean> {
  if (req.method !== "GET") {
    return false;
  }
  if (req.url === HEALTH_PATH) {
    healthHandler(req, res);
    return true;
  }
  if (req.url === READY_PATH) {
    await readyHandler(req, res, probes);
    return true;
  }
  if (req.url === METRICS_PATH && probes.metricsEnabled !== false) {
    await metricsHandler(res);
    return true;
  }
  return false;
}
