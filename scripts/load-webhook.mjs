#!/usr/bin/env node
// Load test for a generated webhook: 100 connections for 30 s with the real secret header.
// autocannon is imported lazily so config errors are reported before the dependency is needed.
import process from "node:process";

const CONNECTIONS = 100;
const DURATION_SECONDS = 30;
const P95_LIMIT_MS = 250;
// 0.1% of requests.
const ERROR_RATE_LIMIT = 0.001;

const BODY = JSON.stringify({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "private" },
    from: { id: 1, is_bot: false, first_name: "load" },
    text: "/start",
  },
});

class ConfigError extends Error {}

function readConfig() {
  const rawUrl = process.env.WEBHOOK_URL ?? "";
  const secret = process.env.WEBHOOK_SECRET ?? "";
  if (!rawUrl) throw new ConfigError("WEBHOOK_URL is required");
  if (!secret) throw new ConfigError("WEBHOOK_SECRET is required");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError("WEBHOOK_URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("WEBHOOK_URL must be http or https");
  }
  url.username = "";
  url.password = "";
  return { url: url.toString(), secret };
}

async function main() {
  const { url, secret } = readConfig();

  // Dynamic import is intentional: autocannon is an optional load-test dependency, and a
  // static import would make the script unusable when it is not installed.
  let autocannon;
  try {
    ({ default: autocannon } = await import("autocannon"));
  } catch {
    throw new ConfigError("autocannon is not installed; add autocannon@9.0.0 as a dev dependency");
  }

  const result = await new Promise((resolve, reject) => {
    autocannon(
      {
        url,
        connections: CONNECTIONS,
        duration: DURATION_SECONDS,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": secret,
        },
        body: BODY,
        timeout: 10,
      },
      (error, benchmarkResult) => (error ? reject(error) : resolve(benchmarkResult)),
    );
  });

  const requests = Number(result.totalRequests ?? result.requests?.total ?? 0);
  const non2xx = Number(result.non2xx ?? 0);
  const errors = Number(result.errors ?? 0);
  const p95Ms = Number(result.latency?.p95 ?? 0);
  const errorRate = requests === 0 ? 1 : errors / requests;

  const summary = {
    url,
    connections: CONNECTIONS,
    durationSeconds: DURATION_SECONDS,
    requests,
    requestsPerSecond: Number(result.requests?.average ?? 0),
    p95Ms,
    non2xx,
    errors,
    errorRate: Number(errorRate.toFixed(6)),
    limits: { p95Ms: P95_LIMIT_MS, errorRate: ERROR_RATE_LIMIT },
    ok: requests > 0 && non2xx === 0 && p95Ms <= P95_LIMIT_MS && errorRate <= ERROR_RATE_LIMIT,
  };

  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exitCode = summary.ok ? 0 : 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`load-webhook: ${message}\n`);
  process.exitCode = error instanceof ConfigError ? 2 : 1;
});
