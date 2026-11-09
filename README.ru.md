<p align="center">
  <img src="./assets/readme/aurifex-avatar.webp" width="80" alt="Золотая монограмма Aurifex">
</p>

<h1 align="center">Aurifex</h1>

<p align="center"><strong>Продакшен-боты Telegram из одного запроса агента.<br/>Созданы, защищены, протестированы и готовы к деплою.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-c9a227?style=flat-square" alt="Лицензия MIT">
  <img src="https://img.shields.io/badge/node-%E2%89%A524.9-c9a227?style=flat-square" alt="Node.js 24.9 или новее">
  <img src="https://img.shields.io/badge/Bot%20API-10.4-c9a227?style=flat-square" alt="Telegram Bot API 10.4">
  <img src="https://img.shields.io/badge/grammY-1.46.0-2f8f83?style=flat-square" alt="grammY 1.46.0">
  <img src="https://img.shields.io/badge/aiogram-3.31.0-2f8f83?style=flat-square" alt="aiogram 3.31.0">
</p>

<p align="center">
  <a href="https://lukavtz.github.io/aurifex/"><strong>Сайт</strong></a>
  ·
  <a href="./docs/SPEC.md">Спецификация</a>
  ·
  <a href="./docs/ARCHITECTURE.md">Архитектура</a>
  ·
  <a href="./docs/TEST_PLAN.md">План тестов</a>
</p>

<p align="center">
  <img src="./assets/readme/aurifex-banner.webp" width="100%" alt="Расплавленный золотой бумажный самолётик Telegram поднимается с чёрной наковальни на фоне тонкой технической сетки и холодной бирюзовой подсветки">
</p>

Aurifex даёт кодирующему агенту продакшен-путь для ботов Telegram. Он работает в OMP,
DeepSeek Harness, Claude Code и любом MCP-клиенте. TypeScript + grammY и Python +
aiogram поддерживаются полноценно. Одно доменное ядро отвечает за генерацию, политику
безопасности, проверку и план деплоя; тонкие адаптеры проецируют одни и те же девять
инструментов в каждого агента.

## Одна команда

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/lukavtz/aurifex/main/install.sh | sh
```

```powershell
# Windows PowerShell
powershell -c "irm https://raw.githubusercontent.com/lukavtz/aurifex/main/install.ps1 | iex"
```

Скрипт хранит постоянный checkout в `~/.aurifex/src`
(`%LOCALAPPDATA%\Aurifex\src` в Windows), один раз собирает его и запускает
`aurifex install --host all`. Повторный запуск обновляет checkout.
`AURIFEX_DRY_RUN=1` печатает команды без выполнения.

## Что делает

|                |                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Генерирует** | Самодостаточный проект из строгой `BotSpec`: webhook или polling, Docker, Caddy, Redis/Postgres, тесты и CI.                    |
| **Добавляет**  | Девять функций: команды, LLM-чат, inline, платежи Stars, Mini Apps, модерацию, рассылки, виджеты Bot API 10.4 и rich-сообщения. |
| **Проверяет**  | 29 детерминированных проверок по ограниченному снимку. Токен-литерал или отсутствующий секрет webhook — это `fail`.             |
| **Деплоит**    | Рендерит compose, Dockerfile, Caddyfile и скрипт `setWebhook`. Telegram не вызывает.                                            |

```console
$ aurifex target --stack grammy
grammy 1.46.0 (Bot API 10.4)

$ aurifex verify my-bot
ok: 28 pass, 1 warn, 0 fail
```

Единственное предупреждение свежего проекта — `deps.lockfile`: установите зависимости
один раз и закоммитьте lock-файл.

## Чем отличается

- **Одно ядро, а не четыре реализации.** OMP, DSH, Claude Code и MCP только переводят
  схемы. Каждая запись проходит через общие `CoreOperations` и `PathPolicy`.
- **Сгенерированные боты самостоятельны.** Проект не импортирует `aurifex`. У него есть
  собственный код, lock-файл, Dockerfile, Caddyfile и скрипт регистрации webhook.
- **Bot API 10.4 указан явно.** Типы фреймворков заканчиваются на 10.3; каждый проект
  получает типизированный raw-адаптер для виджетов, widget-запросов, эфемерных ответов
  и rich-сообщений.
- **Проверка — это шлюз.** Токен-литерал, контейнер под root, отсутствие дедупликации
  `update_id`, обработки `retry_after` или удалённый адаптер 10.4 дают `fail`.

## Как работает

```mermaid
flowchart LR
  OMP[Расширение OMP] --> CORE[CoreOperations]
  DSH[Бандл DSH] --> CORE
  MCP[MCP stdio] --> CORE
  CC[Плагин Claude Code] --> MCP
  CORE --> POLICY[PathPolicy<br/>доверенный корень]
  CORE --> TPL[Генераторы шаблонов<br/>grammY · aiogram]
  CORE --> CHECK[Статическая проверка<br/>29 проверок]
  TPL --> BOT[Самостоятельный проект бота]
```

Каждый хост предоставляет одни и те же инструменты: `telegram_bot_target_resolve`,
`telegram_bot_scaffold`, `telegram_bot_inspect`, `telegram_bot_verify`,
`telegram_bot_add_feature`, `telegram_bot_deploy_plan`, `telegram_bot_test_harness`, `telegram_bot_upgrade_plan` и
`telegram_bot_upgrade`.

## Быстрый старт

```json
{
  "schemaVersion": "bot-spec-1.1.0",
  "name": "my_bot",
  "displayName": "My Bot",
  "stack": "grammy",
  "features": ["commands"],
  "deployment": "docker",
  "storage": { "postgres": true, "redis": true },
  "i18n": { "defaultLocale": "en", "en": true, "ru": false, "zh": false },
  "security": {
    "webhookSecret": true,
    "adminAllowlist": true,
    "rateLimit": true,
    "idempotency": true
  },
  "runtime": {
    "queue": "none",
    "telemetry": { "otlp": false, "prometheus": false, "sentry": false }
  }
}
```

```sh
aurifex new my-bot --spec bot.json
cd my-bot
cp .env.example .env        # укажите BOT_TOKEN и WEBHOOK_SECRET
bun install
bun run typecheck && bun test

cd ..
aurifex add my-bot --feature payments --name stars
aurifex verify my-bot
aurifex deploy my-bot --domain bot.example.com
```

Для `"stack": "aiogram"` замените шаги Bun на `uv sync && uv run pytest`. Точные команды
и переменные окружения есть в сгенерированном `README.md`.

## Что генерируется

```text
my-bot/
├── .env.example  .gitignore  .dockerignore
├── Dockerfile  docker-compose.yml  Caddyfile
├── package.json  tsconfig*.json          # или pyproject.toml + alembic.ini
├── src/                                  # app/ для aiogram
│   ├── config.ts  logger.ts  bot.ts  main.ts  server.ts
│   ├── telegram/api104.ts                # app/services/api104.py
│   ├── features/                         # start, help, admin, widgets, rich, ...
│   ├── security/                         # allowlist, dedupe, rate-limit, retry
│   └── storage/                          # база данных и схема
├── miniapp/                              # React + Vite, если включено
├── tests/                                # офлайн; без вызовов Telegram
└── .github/workflows/ci.yml
```

### Инварианты безопасности

| Инвариант               | Исполнение                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| Нет токена в исходниках | `.env.example` пустой; `token.literal` валит проверку.                                         |
| Подлинность webhook     | `X-Telegram-Bot-Api-Secret-Token`, HTTPS, разрешённый порт, constant-time проверка фреймворка. |
| Права администратора    | Числовые `ADMIN_IDS` проверяются на сервере.                                                   |
| Нет дублей обновлений   | `update_id` занимает Redis-ключ на 24 часа (`SET NX EX 86400`).                                |
| Flood control           | `retry_after` обрабатывается; лимиты на чат.                                                   |
| Личность Mini App       | `initData` HMAC-SHA256 и свежесть `auth_date`.                                                 |
| Безопасность контейнера | Не root; Caddy завершает TLS; порт бота не публикуется.                                        |
| Гигиена зависимостей    | Точные версии, предупреждение о lock-файле, `pnpm audit --prod` в CI.                          |

## Проверочный шлюз

`verify` выполняет 29 детерминированных проверок по ограниченному снимку (64 МиБ всего,
1 МиБ на файл). Любой `fail` делает `ok: false`; предупреждения остаются видимыми.

```sh
aurifex verify my-bot           # краткий итог
aurifex verify my-bot --json    # DomainResult с доказательствами
```

## CLI

| Команда                | Что делает                                                  |
| ---------------------- | ----------------------------------------------------------- |
| `aurifex target`       | Определяет фреймворк, runtime, Bot API и поддержку функций. |
| `aurifex new`          | Создаёт самостоятельный проект по строгой `BotSpec`.        |
| `aurifex inspect`      | Только чтение: стек, режим и просканированные файлы.        |
| `aurifex verify`       | Запускает статический шлюз и возвращает доказательства.     |
| `aurifex add`          | Добавляет один модуль функции, не переписывая остальные.    |
| `aurifex deploy`       | Пишет файлы деплоя и скрипт webhook; API не вызывает.       |
| `aurifex harness`      | Пишет фикстуры, фейковый транспорт и tgfake compose.        |
| `aurifex upgrade-plan` | Перечисляет действия миграции на Bot API 10.4.              |
| `aurifex upgrade`      | Проверяет manifest; `--apply` переводит его на 1.1.         |
| `aurifex install`      | Устанавливает в OMP, DSH и Claude Code за один проход.      |

Все команды принимают `--json` и выводят стабильный `DomainResult`. Коды выхода: `0` —
успех, `1` — доменная ошибка, `2` — неверное использование.

## Разработка

```sh
pnpm install
pnpm build
pnpm verify
AURIFEX_E2E=1 pnpm test:e2e
```

`pnpm verify` запускает форматирование, линт, строгий TypeScript, unit-, security-,
integration-, host-, site- и secret-проверки, затем сухой прогон пакета. Детали — в
[`docs/SPEC.md`](./docs/SPEC.md), [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) и
[`docs/RELEASE.md`](./docs/RELEASE.md).

<details>
<summary>Ручная установка хостов и MCP</summary>

```sh
# OMP, из собранного checkout
omp plugin link .

# DeepSeek Harness
dsh plugin --profile aurifex add /absolute/path/to/aurifex

# Claude Code
claude plugin marketplace add /absolute/path/to/aurifex
claude plugin install aurifex@aurifex
```

```json
{
  "mcpServers": {
    "aurifex": {
      "command": "node",
      "args": ["/absolute/path/to/aurifex/dist/adapters/mcp/server.js"],
      "env": { "AURIFEX_ROOT": "/absolute/path/to/workspace" }
    }
  }
}
```

Плагин Claude Code уже указывает на
`${CLAUDE_PLUGIN_ROOT}/dist/adapters/mcp/server.js` через `.mcp.json`.
`AURIFEX_ROOT` ограничивает чтение и запись; по умолчанию — рабочий каталог процесса.

</details>

## Ограничения

- **10.4 через raw-адаптер.** Типы grammY 1.46.0 и aiogram 3.31.0 покрывают Bot API 10.3.
  Aurifex не заявляет нативные типы 10.4; `botapi.104` падает при удалении адаптера.
- **Проверка статическая.** `verify` не исполняет код, не запускает контейнеры и не
  вызывает Telegram. Runtime-доказательства дают тесты и E2E с явным включением.
- **Docker не входит в шлюз по умолчанию.** Сборка образов опциональна; `pnpm verify`
  остаётся офлайн и детерминированным.
- **Живым тестам нужны секреты.** Без `AURIFEX_LIVE=1` набор пропускается. Если переменная
  задана, отсутствие `TELEGRAM_TEST_BOT_TOKEN` или `TELEGRAM_TEST_CHAT_ID` — ошибка.
- **Плагин не песочница.** Он работает в процессе хоста. Доступ к файлам ограничен
  `PathPolicy`, но процесс расширения считается доверенным кодом.
- **Только Bot API.** v0.1 не покрывает MTProto и юзерботов.

## Лицензия

MIT. Заимствованные материалы skills атрибутированы в
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
