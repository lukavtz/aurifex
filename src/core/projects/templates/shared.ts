import type { BotSpec, BotStack } from "../../spec/bot-spec.ts";
import { slugToTitle } from "../../spec/bot-spec.ts";
import type { StackTarget } from "../../targets/catalog.ts";
import { BOT_API_VERSION } from "../../targets/catalog.ts";
import { TELEGRAM_TOKEN_RE } from "../../security/secrets.ts";

export interface TemplateFile {
  readonly path: string;
  readonly content: string;
  readonly mode?: number;
}

export function assertNoTokenLiteral(files: readonly TemplateFile[]): void {
  for (const file of files) {
    TELEGRAM_TOKEN_RE.lastIndex = 0;
    if (TELEGRAM_TOKEN_RE.test(file.content)) {
      throw new Error(`internal_error: rendered token literal in ${file.path}`);
    }
  }
}

export function renderPackageJson(spec: BotSpec): string {
  return `${JSON.stringify(
    {
      name: `${spec.name}_bot`,
      version: "0.1.0",
      private: true,
      type: "module",
      packageManager: "bun@1.4.2",
      engines: { node: ">=24.9.0" },
      scripts: {
        dev: "bun --watch src/main.ts",
        build: "tsc -p tsconfig.build.json",
        start: "node dist/main.js",
        typecheck: "tsc --noEmit",
        test: "bun test",
        lint: "oxlint src tests",
        "format:check": "prettier --check src tests",
        "db:generate": "drizzle-kit generate",
        "db:migrate":
          spec.runtime.queue === "postgres" ? "node dist/migrate.js" : "drizzle-kit migrate",
        ...(spec.runtime.queue === "postgres" ? { "start:worker": "node dist/worker.js" } : {}),
      },
      dependencies: {
        "@opentelemetry/api": "1.10.0",
        "@opentelemetry/auto-instrumentations-node": "0.83.0",
        "@opentelemetry/exporter-trace-otlp-http": "0.301.0",
        "@opentelemetry/sdk-node": "0.301.0",
        "@sentry/node": "11.11.0",
        "drizzle-orm": "0.45.4",
        grammy: "1.46.0",
        ioredis: "6.0.0",
        pino: "10.4.0",
        postgres: "4.1.0",
        "prom-client": "15.1.3",
        zod: "4.6.7",
      },
      devDependencies: {
        "@types/bun": "1.4.4",
        "@types/node": "^24.10.0",
        "drizzle-kit": "0.31.11",
        oxlint: "^1.93.0",
        prettier: "^3.9.10",
        typescript: "5.9.3",
      },
    },
    null,
    2,
  )}\n`;
}

export function renderTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2024",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        noEmit: true,
        types: ["node", "bun"],
      },
      include: ["src/**/*.ts", "tests/**/*.ts", "drizzle.config.ts"],
    },
    null,
    2,
  )}\n`;
}

export function renderTsconfigBuild(): string {
  return `${JSON.stringify(
    {
      extends: "./tsconfig.json",
      compilerOptions: {
        rootDir: "src",
        outDir: "dist",
        noEmit: false,
        allowImportingTsExtensions: false,
        rewriteRelativeImportExtensions: true,
      },
      include: ["src/**/*.ts"],
    },
    null,
    2,
  )}\n`;
}

export function renderPyproject(spec: BotSpec): string {
  return `[project]
name = "${spec.name}-bot"
version = "0.1.0"
description = "${slugToTitle(spec.name)} Telegram bot"
requires-python = ">=3.11,<3.15"
dependencies = [
  "aiogram==3.31.0",
  "pydantic-settings==2.16.2",
  "asyncpg==0.32.0",
  "sqlalchemy[asyncio]==2.1.8",
  "redis==8.1.0",
  "alembic==1.20.1",
  "httpx==0.28.1",
  "structlog==26.1.0",
  "opentelemetry-sdk==1.45.2",
  "opentelemetry-exporter-otlp-proto-http==1.45.2",
  "opentelemetry-instrumentation-aiohttp-server==0.66b2",
  "opentelemetry-instrumentation-sqlalchemy==0.66b2",
  "opentelemetry-instrumentation-redis==0.66b2",
  "prometheus-client==0.26.0",
  "sentry-sdk==2.74.0",
]

[dependency-groups]
dev = [
  "pytest==9.2.0",
  "pytest-asyncio==1.4.1.post1",
  "ruff==0.17.4",
  "mypy==2.4.1",
  "aiohttp==3.13.3",
  "hypothesis==6.170.15",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["."]

[tool.ruff]
target-version = "py311"
line-length = 120

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "ASYNC"]

[tool.mypy]
python_version = "3.11"
strict = false
disallow_untyped_defs = true
check_untyped_defs = true
ignore_missing_imports = true
plugins = ["pydantic.mypy"]
`;
}

export function renderEnvExample(_spec: BotSpec): string {
  return `BOT_TOKEN=
BOT_TOKEN_FILE=
WEBHOOK_SECRET=
WEBHOOK_SECRET_FILE=
WEBHOOK_URL=
BOT_MODE=polling
PORT=8080
ADMIN_IDS=
POSTGRES_USER=bot
POSTGRES_PASSWORD=
POSTGRES_DB=bot
# Compose derives these from the passwords above; set them for non-compose runs.
DATABASE_URL=
DATABASE_URL_FILE=
REDIS_PASSWORD=
REDIS_URL=
REDIS_URL_FILE=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=
LLM_API_KEY=
LLM_API_KEY_FILE=
QUEUE_POLL_MS=500
QUEUE_BATCH=10
QUEUE_MAX_ATTEMPTS=5
QUEUE_VISIBILITY_TIMEOUT_SECONDS=60
WORKER_ID=
MINIAPP_SESSION_TTL_SECONDS=86400
MINIAPP_ALLOWED_ORIGINS=
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_SERVICE_NAME=
SENTRY_DSN=
METRICS_ENABLED=true
LOG_LEVEL=info
`;
}

export function renderDockerfile(spec: BotSpec): string {
  const migrationCopy = spec.runtime.queue === "postgres" ? "COPY drizzle ./drizzle\n" : "";
  return `FROM oven/bun:1.4.2 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN bun run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
${migrationCopy}USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
`;
}

export function renderPythonDockerfile(_spec: BotSpec): string {
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
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)"
CMD ["uv", "run", "python", "-m", "app.main"]
`;
}

function composeSecretNames(spec: BotSpec): string[] {
  const names = ["bot_token", "webhook_secret"];
  if (spec.storage.postgres) names.push("database_url");
  if (spec.storage.redis) names.push("redis_url");
  if (spec.features.includes("llm")) names.push("llm_api_key");
  return names;
}

function composeSecretBlocks(names: readonly string[]): {
  list: string;
  env: string;
} {
  return {
    list: names.map((name) => `      - ${name}`).join("\n"),
    env: names.map((name) => `      ${name.toUpperCase()}_FILE: /run/secrets/${name}`).join("\n"),
  };
}

export function renderCompose(spec: BotSpec): string {
  const secretNames = composeSecretNames(spec);
  const { list: secretList, env: secretFileEnv } = composeSecretBlocks(secretNames);
  const hasQueue = spec.runtime.queue === "postgres";
  const depends: string[] = [];
  if (spec.storage.postgres) depends.push("postgres");
  if (spec.storage.redis) depends.push("redis");
  // Long form so a queued bot starts only after postgres is healthy and the
  // one-shot migration has finished.
  const healthDepends = (withMigrate: boolean): string => {
    const entries = depends.map(
      (service) => `      ${service}:\n        condition: service_healthy`,
    );
    if (withMigrate) {
      entries.push("      migrate:\n        condition: service_completed_successfully");
    }
    return entries.length === 0 ? "" : `\n    depends_on:\n${entries.join("\n")}`;
  };
  const botDepends = healthDepends(hasQueue);
  const botEnvironment = [
    spec.storage.postgres
      ? `      DATABASE_URL: postgres://\${POSTGRES_USER:-bot}:\${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}@postgres:5432/\${POSTGRES_DB:-bot}`
      : "",
    spec.storage.redis
      ? `      REDIS_URL: redis://:\${REDIS_PASSWORD:?set REDIS_PASSWORD in .env}@redis:6379/0`
      : "",
    secretFileEnv,
  ].filter(Boolean);
  const botEnv = `\n    environment:\n${botEnvironment.join("\n")}`;
  const botSecrets = `\n    secrets:\n${secretList}`;
  const services = [
    `  bot:
    build: .
    env_file: .env
    restart: unless-stopped
    expose:
      - "8080"${botDepends}${botSecrets}${botEnv}`,
  ];
  if (hasQueue) {
    const workerCommand =
      spec.stack === "grammy"
        ? '    command: ["node", "dist/worker.js"]'
        : '    command: ["uv", "run", "python", "-m", "app.worker"]';
    services.push(`  worker:
    build: .
    env_file: .env
    restart: unless-stopped
${workerCommand}${healthDepends(true)}
    stop_grace_period: 35s${botSecrets}${botEnv}`);
  }
  services.push(`  caddy:
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
      - bot`);
  const volumes = ["  caddy-data:", "  caddy-config:"];
  if (spec.storage.postgres) {
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
  if (spec.storage.redis) {
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
  if (hasQueue) {
    const migrateCommand =
      spec.stack === "grammy"
        ? '    command: ["node", "dist/migrate.js"]'
        : '    command: ["uv", "run", "alembic", "upgrade", "head"]';
    services.push(`  migrate:
    build: .
    env_file: .env
${migrateCommand}
    restart: "no"${healthDepends(false)}${botSecrets}${botEnv}`);
  }
  const secrets = secretNames.map((name) => `  ${name}:\n    file: ./secrets/${name}`).join("\n");
  return `services:
${services.join("\n")}
  # aurifex:services

secrets:
${secrets}

volumes:
${volumes.join("\n")}
`;
}

export function renderCaddyfile(domain: string): string {
  return `${domain} {
  encode zstd gzip
  reverse_proxy bot:8080
}
`;
}

export function renderGitHubActions(spec: BotSpec): string {
  if (spec.stack === "aiogram") {
    return `name: ci
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
        with:
          python-version: "3.14"
      - run: uv lock --check
      - run: uv sync --frozen
      - run: uv run ruff check .
      - run: uv run mypy app
      - run: uv run pytest
`;
  }
  return `name: ci
on:
  push:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.4.2"
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun test
      - run: bun run lint
      - run: bun run format:check
`;
}

export function renderReadme(spec: BotSpec, target: StackTarget): string {
  const title = slugToTitle(spec.name);
  const run =
    spec.stack === "grammy" ? "bun install\nbun run typecheck\nbun test" : "uv sync\nuv run pytest";
  return `# ${title} Telegram bot

Generated by [Aurifex](https://github.com/lukavtz/aurifex) for **${target.label}**.

Bot API target: ${BOT_API_VERSION}. The framework advertises ${target.testedBotApi};
methods added after that version use ${target.rawApiHint}.

## Quick start

\`\`\`bash
cp .env.example .env
# set BOT_TOKEN and WEBHOOK_SECRET
${run}
\`\`\`

## Features

${spec.features.map((feature) => `- ${feature}`).join("\n")}

## Security

- \`.env\` is ignored; never commit a bot token.
- Webhook requests require the \`X-Telegram-Bot-Api-Secret-Token\` header.
- Admin commands use a server-side numeric ID allowlist.
- Update IDs are deduplicated for 24 hours.
- Logs redact tokens, secrets, and authorization headers.

## Deployment

\`\`\`bash
docker compose up -d --build
\`\`\`

Terminate TLS at Caddy and call \`setWebhook\` with the secret from \`WEBHOOK_SECRET\`.
`;
}

export function renderGitignore(spec: BotSpec): string {
  return `.env
.env.*
!.env.example
secrets/
node_modules/
dist/
${spec.stack === "aiogram" ? ".venv/\n__pycache__/\n.pytest_cache/\n.ruff_cache/\n.mypy_cache/\n" : "coverage/\n"}
*.log
.DS_Store
`;
}

export function renderDockerignore(): string {
  return `.git
.env
.env.*
node_modules
dist
coverage
tests
*.log
`;
}

export function baseFiles(spec: BotSpec, target: StackTarget): TemplateFile[] {
  if (spec.stack === "grammy") {
    return [
      { path: ".env.example", content: renderEnvExample(spec) },
      { path: ".gitignore", content: renderGitignore(spec) },
      { path: ".dockerignore", content: renderDockerignore() },
      { path: "Dockerfile", content: renderDockerfile(spec) },
      { path: "docker-compose.yml", content: renderCompose(spec) },
      { path: "Caddyfile", content: renderCaddyfile("bot.example.com") },
      { path: "package.json", content: renderPackageJson(spec) },
      { path: "tsconfig.json", content: renderTsconfig() },
      { path: "tsconfig.build.json", content: renderTsconfigBuild() },
      { path: "README.md", content: renderReadme(spec, target) },
      { path: ".github/workflows/ci.yml", content: renderGitHubActions(spec) },
    ];
  }
  return [
    { path: ".env.example", content: renderEnvExample(spec) },
    { path: ".gitignore", content: renderGitignore(spec) },
    { path: ".dockerignore", content: renderDockerignore() },
    { path: "Dockerfile", content: renderPythonDockerfile(spec) },
    { path: "docker-compose.yml", content: renderCompose(spec) },
    { path: "Caddyfile", content: renderCaddyfile("bot.example.com") },
    { path: "pyproject.toml", content: renderPyproject(spec) },
    { path: "README.md", content: renderReadme(spec, target) },
    { path: ".github/workflows/ci.yml", content: renderGitHubActions(spec) },
  ];
}

export function stackLabel(stack: BotStack): string {
  return stack === "grammy" ? "TypeScript + grammY" : "Python + aiogram";
}
