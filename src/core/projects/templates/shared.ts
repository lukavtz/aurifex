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
        "db:migrate": "drizzle-kit migrate",
      },
      dependencies: {
        "drizzle-orm": "0.45.4",
        grammy: "1.46.0",
        ioredis: "6.0.0",
        pino: "10.4.0",
        postgres: "4.1.0",
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
  "sqlalchemy==2.1.8",
  "redis==8.1.0",
  "alembic==1.20.1",
  "httpx==0.28.1",
  "structlog==26.1.0",
]

[dependency-groups]
dev = [
  "pytest==9.2.0",
  "pytest-asyncio==1.4.1.post1",
  "ruff==0.17.4",
  "mypy==2.4.1",
  "aiohttp==3.13.3",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["."]

[tool.ruff]
target-version = "py311"
line-length = 100

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

export function renderEnvExample(spec: BotSpec): string {
  return `BOT_TOKEN=
WEBHOOK_SECRET=
WEBHOOK_URL=
BOT_MODE=polling
PORT=8080
ADMIN_IDS=
POSTGRES_USER=bot
POSTGRES_PASSWORD=
POSTGRES_DB=bot
DATABASE_URL=${spec.storage.postgres ? "postgres://bot:CHANGE_ME@postgres:5432/bot" : ""}
REDIS_PASSWORD=
REDIS_URL=${spec.storage.redis ? "redis://:CHANGE_ME@redis:6379/0" : ""}
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=
LLM_API_KEY=
LOG_LEVEL=info
`;
}

export function renderDockerfile(_spec: BotSpec): string {
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
CMD ["uv", "run", "python", "-m", "app.main"]
`;
}

export function renderCompose(spec: BotSpec): string {
  const depends: string[] = [];
  if (spec.storage.postgres) depends.push("postgres");
  if (spec.storage.redis) depends.push("redis");
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
  return `services:
${services.join("\n")}

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
