import { lstat } from "node:fs/promises";

import type { BotStack } from "../spec/bot-spec.ts";
import type { DomainResult, FileRef } from "../results.ts";
import { domainFailure, domainSuccess } from "../results.ts";
import { PathPolicyError, readOptionalFile, type PathPolicy } from "../security/path-policy.ts";
import { WEBHOOK_SECRET_RE } from "../security/secrets.ts";
import { assertNoTokenLiteral, renderCaddyfile, type TemplateFile } from "./templates/shared.ts";

export interface StorageProfile {
  readonly postgres: boolean;
  readonly redis: boolean;
}

export interface DeployResult {
  readonly files: readonly FileRef[];
  readonly env: readonly string[];
  readonly setWebhook: {
    readonly url: string;
    readonly secretToken: "WEBHOOK_SECRET";
    readonly allowedUpdates: readonly string[];
    readonly maxConnections: 40;
    readonly dropPendingUpdates: false;
  };
  readonly checklist: readonly string[];
}

export interface DeployRequest {
  readonly projectRoot: string;
  readonly domain: string;
  readonly mode?: "webhook" | "polling";
  readonly overwrite?: boolean;
}

export const DEPLOY_WEBHOOK_PATH = "/telegram/webhook";

export const DEPLOY_ALLOWED_UPDATES: readonly string[] = [
  "message",
  "edited_message",
  "callback_query",
  "inline_query",
  "chosen_inline_result",
  "pre_checkout_query",
  "shipping_query",
  "poll_answer",
  "chat_member",
  "message_reaction",
];

const ALLOWED_WEBHOOK_PORTS: readonly string[] = ["", "443", "80", "88", "8443"];
const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function validateDeployDomain(domain: string): string | null {
  if (typeof domain !== "string" || domain.length === 0) return "domain is required";
  if (domain.length > 253) return "domain must be at most 253 characters";
  if (domain !== domain.toLowerCase()) return "domain must be lowercase";
  if (/[\s/:@?#\\]/.test(domain)) {
    return "domain must not contain a scheme, path, port, query, or credentials";
  }
  const labels = domain.split(".");
  if (labels.length < 2) return "domain must contain at least two DNS labels";
  for (const label of labels) {
    if (label.length === 0) return "domain must not contain empty DNS labels";
    if (label.length > 63) return "domain labels must be at most 63 characters";
    if (!DOMAIN_LABEL_RE.test(label)) return `invalid DNS label: ${label}`;
  }
  return null;
}

export function validateWebhookUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "WEBHOOK_URL is not a valid absolute URL";
  }
  if (parsed.protocol !== "https:") return "WEBHOOK_URL must use https";
  if (parsed.username !== "" || parsed.password !== "") {
    return "WEBHOOK_URL must not contain credentials";
  }
  if (!ALLOWED_WEBHOOK_PORTS.includes(parsed.port)) {
    return "WEBHOOK_URL port must be 443, 80, 88, or 8443";
  }
  if (parsed.hostname === "") return "WEBHOOK_URL must include a host";
  return null;
}

export function validateWebhookSecretValue(value: string): string | null {
  return WEBHOOK_SECRET_RE.test(value)
    ? null
    : "WEBHOOK_SECRET must be 1-256 characters of A-Z, a-z, 0-9, _ or -";
}

export function normalizeProjectRoot(projectRoot: string): string {
  const trimmed = projectRoot.replace(/\/+$/, "");
  return trimmed === "." ? "" : trimmed;
}

export function joinProjectPath(projectRoot: string, path: string): string {
  const root = normalizeProjectRoot(projectRoot);
  return root === "" ? path : `${root}/${path}`;
}

export async function detectProjectStack(
  policy: PathPolicy,
  projectRoot: string,
): Promise<BotStack | null> {
  const manifest = await readOptionalFile(policy, joinProjectPath(projectRoot, "package.json"));
  if (manifest !== null) {
    try {
      const parsed = JSON.parse(manifest) as {
        readonly dependencies?: Record<string, unknown>;
        readonly devDependencies?: Record<string, unknown>;
      };
      const dependencies = { ...parsed.dependencies, ...parsed.devDependencies };
      if (typeof dependencies.grammy === "string") return "grammy";
    } catch {
      // A malformed manifest is not a stack marker; fall through to Python.
    }
  }
  const pyproject = await readOptionalFile(policy, joinProjectPath(projectRoot, "pyproject.toml"));
  if (pyproject !== null && /\baiogram\b/.test(pyproject)) return "aiogram";
  return null;
}

async function detectStorage(policy: PathPolicy, projectRoot: string): Promise<StorageProfile> {
  const envExample = await readOptionalFile(policy, joinProjectPath(projectRoot, ".env.example"));
  if (envExample === null) return { postgres: false, redis: false };
  const values = new Map<string, string>();
  for (const line of envExample.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return {
    postgres: (values.get("DATABASE_URL") ?? "") !== "",
    redis: (values.get("REDIS_URL") ?? "") !== "",
  };
}

function renderDockerfile(stack: BotStack): string {
  if (stack === "grammy") {
    return `FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN bun run build && bun pm prune --production

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
`;
  }
  return `FROM python:3.14-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN pip install --no-cache-dir uv==0.12.23
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev
COPY app ./app
COPY alembic.ini ./
COPY migrations ./migrations
RUN useradd --create-home --uid 10001 bot
USER bot
EXPOSE 8080
CMD ["uv", "run", "python", "-m", "app.main"]
`;
}

function renderCompose(storage: StorageProfile): string {
  const depends: string[] = [];
  if (storage.postgres) depends.push("postgres");
  if (storage.redis) depends.push("redis");
  const botDepends =
    depends.length === 0
      ? ""
      : `\n    depends_on:\n${depends.map((service) => `      - ${service}`).join("\n")}`;
  const services = [
    `  bot:
    build: .
    env_file: .env
    restart: unless-stopped
    expose:
      - "8080"${botDepends}`,
    `  caddy:
    image: caddy:2.10-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - bot`,
  ];
  const volumes = ["  caddy-data:", "  caddy-config:"];
  if (storage.postgres) {
    services.push(`  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-bot}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: \${POSTGRES_DB:-bot}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-bot}"]
      interval: 5s
      timeout: 3s
      retries: 10`);
    volumes.push("  postgres-data:");
  }
  if (storage.redis) {
    services.push(`  redis:
    image: redis:8-alpine
    environment:
      REDIS_PASSWORD: \${REDIS_PASSWORD:?set REDIS_PASSWORD in .env}
    command: ["redis-server", "--requirepass", "\${REDIS_PASSWORD}"]
    healthcheck:
      test: ["CMD-SHELL", 'redis-cli -a "$$REDIS_PASSWORD" ping']
      interval: 5s
      timeout: 3s
      retries: 10`);
  }
  return `services:
${services.join("\n")}

volumes:
${volumes.join("\n")}
`;
}

function renderDockerignore(stack: BotStack): string {
  const python =
    stack === "aiogram" ? ".venv\n__pycache__\n.pytest_cache\n.ruff_cache\n.mypy_cache\n" : "";
  return `.git
.env
.env.*
node_modules
dist
coverage
tests
${python}*.log
`;
}

function renderGrammySetWebhook(): string {
  const allowedUpdates = JSON.stringify(DEPLOY_ALLOWED_UPDATES);
  return `#!/usr/bin/env bun
import { Bot } from "grammy";

const ALLOWED_PORTS = ["", "443", "80", "88", "8443"];
const ALLOWED_UPDATES = ${allowedUpdates} as const;

function fail(message: string): never {
  console.error(\`set-webhook: \${message}\`);
  process.exit(1);
}

const token = process.env.BOT_TOKEN?.trim() ?? "";
const url = process.env.WEBHOOK_URL?.trim() ?? "";
const secret = process.env.WEBHOOK_SECRET?.trim() ?? "";

if (token === "") fail("BOT_TOKEN is required");
if (url === "") fail("WEBHOOK_URL is required");
if (secret === "") fail("WEBHOOK_SECRET is required");
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  fail("WEBHOOK_SECRET must be 1-256 characters of A-Z, a-z, 0-9, _ or -");
}

let parsed: URL;
try {
  parsed = new URL(url);
} catch {
  fail("WEBHOOK_URL is not a valid absolute URL");
}
if (parsed.protocol !== "https:") fail("WEBHOOK_URL must use https");
if (parsed.username !== "" || parsed.password !== "") {
  fail("WEBHOOK_URL must not contain credentials");
}
if (!ALLOWED_PORTS.includes(parsed.port)) {
  fail("WEBHOOK_URL port must be 443, 80, 88, or 8443");
}

const bot = new Bot(token);
try {
  const result = await bot.api.setWebhook(url, {
    secret_token: secret,
    allowed_updates: [...ALLOWED_UPDATES],
    max_connections: 40,
    drop_pending_updates: false,
  });
  console.log(JSON.stringify({ ok: true, url, result }));
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(JSON.stringify({ ok: false, url, error: message.replaceAll(token, "<redacted>") }));
  process.exit(1);
}
`;
}

function renderAiogramSetWebhook(): string {
  const allowedUpdates = DEPLOY_ALLOWED_UPDATES.map((update) => `    "${update}",`).join("\n");
  return `#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from urllib.parse import urlparse

from aiogram import Bot

ALLOWED_PORTS = {"", "443", "80", "88", "8443"}
ALLOWED_UPDATES = [
${allowedUpdates}
]
SECRET_RE = re.compile(r"^[A-Za-z0-9_-]{1,256}$")


def fail(message: str) -> None:
    print(f"set-webhook: {message}", file=sys.stderr)
    raise SystemExit(1)


async def run(token: str, url: str, secret: str) -> None:
    bot = Bot(token=token)
    try:
        result = await bot.set_webhook(
            url=url,
            secret_token=secret,
            allowed_updates=list(ALLOWED_UPDATES),
            max_connections=40,
            drop_pending_updates=False,
        )
        print(json.dumps({"ok": True, "url": url, "result": result}))
    except Exception as error:  # noqa: BLE001 - a CLI must report any transport failure
        message = str(error).replace(token, "<redacted>")
        print(json.dumps({"ok": False, "url": url, "error": message}), file=sys.stderr)
        raise SystemExit(1) from error
    finally:
        await bot.session.close()


def main() -> None:
    token = os.environ.get("BOT_TOKEN", "").strip()
    url = os.environ.get("WEBHOOK_URL", "").strip()
    secret = os.environ.get("WEBHOOK_SECRET", "").strip()

    if not token:
        fail("BOT_TOKEN is required")
    if not url:
        fail("WEBHOOK_URL is required")
    if not secret:
        fail("WEBHOOK_SECRET is required")
    if not SECRET_RE.fullmatch(secret):
        fail("WEBHOOK_SECRET must be 1-256 characters of A-Z, a-z, 0-9, _ or -")

    parsed = urlparse(url)
    if parsed.scheme != "https":
        fail("WEBHOOK_URL must use https")
    if parsed.username or parsed.password:
        fail("WEBHOOK_URL must not contain credentials")
    port = ""
    try:
        port = "" if parsed.port is None else str(parsed.port)
    except ValueError:
        fail("WEBHOOK_URL has an invalid port")
    if port not in ALLOWED_PORTS:
        fail("WEBHOOK_URL port must be 443, 80, 88, or 8443")

    asyncio.run(run(token, url, secret))


if __name__ == "__main__":
    main()
`;
}

async function fileExists(policy: PathPolicy, path: string): Promise<boolean> {
  try {
    const info = await lstat(policy.resolve(path));
    if (info.isSymbolicLink()) {
      throw new PathPolicyError("unauthorized_path", `symlink is not allowed: ${path}`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function failureFrom(error: unknown): DomainResult<never> {
  if (error instanceof PathPolicyError) {
    return domainFailure({
      code: error.code,
      detail: error.message,
      retryable: false,
    });
  }
  return domainFailure({
    code: "internal_error",
    detail: error instanceof Error ? error.message : "unexpected deployment failure",
    retryable: false,
  });
}

export async function planDeploy(
  request: DeployRequest,
  options: { readonly policy: PathPolicy },
): Promise<DomainResult<DeployResult>> {
  const { policy } = options;
  const mode = request.mode ?? "webhook";
  if (mode !== "webhook" && mode !== "polling") {
    return domainFailure({
      code: "invalid_request",
      detail: "mode must be webhook or polling",
      retryable: false,
    });
  }
  const domainError = validateDeployDomain(request.domain);
  if (domainError !== null) {
    return domainFailure({
      code: "invalid_request",
      detail: domainError,
      retryable: false,
      details: { path: "domain" },
    });
  }

  const projectRoot = normalizeProjectRoot(request.projectRoot);
  try {
    if (projectRoot !== "") policy.resolve(projectRoot);
    const stack = await detectProjectStack(policy, projectRoot);
    if (stack === null) {
      return domainFailure({
        code: "project_unreadable",
        detail: "project has no grammY package.json or aiogram pyproject.toml",
        retryable: false,
        details: { path: "projectRoot" },
      });
    }

    const storage = await detectStorage(policy, projectRoot);
    const webhookUrl = `https://${request.domain}${DEPLOY_WEBHOOK_PATH}`;
    const files: TemplateFile[] = [
      { path: "Dockerfile", content: renderDockerfile(stack) },
      { path: "docker-compose.yml", content: renderCompose(storage) },
      { path: ".dockerignore", content: renderDockerignore(stack) },
      { path: "Caddyfile", content: renderCaddyfile(request.domain) },
      stack === "grammy"
        ? { path: "scripts/set-webhook.ts", content: renderGrammySetWebhook(), mode: 0o755 }
        : { path: "scripts/set_webhook.py", content: renderAiogramSetWebhook(), mode: 0o755 },
    ];
    assertNoTokenLiteral(files);

    const targets = await Promise.all(
      files.map(async (file) => ({
        file,
        target: joinProjectPath(projectRoot, file.path),
        existed: await fileExists(policy, joinProjectPath(projectRoot, file.path)),
      })),
    );
    if (request.overwrite !== true) {
      const existing = targets.filter((entry) => entry.existed).map((entry) => entry.target);
      if (existing.length > 0) {
        return domainFailure({
          code: "destination_exists",
          detail: `deployment files already exist: ${existing.join(", ")}`,
          retryable: false,
          details: { paths: existing },
        });
      }
    }

    const refs: FileRef[] = [];
    const created: string[] = [];
    try {
      for (const entry of targets) {
        const written = await policy.writeFile(entry.target, entry.file.content, {
          overwrite: true,
          ...(entry.file.mode === undefined ? {} : { mode: entry.file.mode }),
        });
        refs.push(written);
        if (!entry.existed) created.push(entry.target);
      }
    } catch (error) {
      for (const path of created) await policy.removeFile(path).catch(() => undefined);
      throw error;
    }

    const env = [
      "BOT_TOKEN",
      "WEBHOOK_SECRET",
      "WEBHOOK_URL",
      "BOT_MODE",
      "PORT",
      "ADMIN_IDS",
      "LOG_LEVEL",
      ...(storage.postgres ? ["DATABASE_URL"] : []),
      ...(storage.redis ? ["REDIS_URL"] : []),
    ];
    const runScript =
      stack === "grammy"
        ? "bun run scripts/set-webhook.ts"
        : "uv run python scripts/set_webhook.py";
    const checklist: string[] = [
      "Set BOT_TOKEN and WEBHOOK_SECRET in .env",
      `Set WEBHOOK_URL=${webhookUrl} in .env`,
      mode === "webhook"
        ? "Set BOT_MODE=webhook in .env"
        : "Set BOT_MODE=polling in .env and delete any existing webhook",
      "docker compose up -d --build",
      ...(mode === "webhook" ? [runScript] : []),
      `Check https://${request.domain}/healthz after the stack is healthy`,
    ];

    return domainSuccess({
      files: refs,
      env,
      setWebhook: {
        url: webhookUrl,
        secretToken: "WEBHOOK_SECRET",
        allowedUpdates: DEPLOY_ALLOWED_UPDATES,
        maxConnections: 40,
        dropPendingUpdates: false,
      },
      checklist,
    });
  } catch (error) {
    return failureFrom(error);
  }
}
