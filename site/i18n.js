/* Aurifex site copy. One flat dictionary per locale, identical keys by contract.
   scripts/check-site.mjs asserts parity, so keep the three objects in step. */
window.AURIFEX_I18N = {
  en: {
    "meta.title": "Aurifex · production Telegram bots from one agent request",
    "meta.description":
      "Scaffold, verify, and deploy production Telegram bots from your coding agent. grammY and aiogram, Bot API 10.4, 16 security checks, four hosts.",

    "nav.skip": "Skip to content",
    "nav.home": "Aurifex home",
    "nav.language": "Language",
    "nav.what": "What it does",
    "nav.architecture": "Architecture",
    "nav.security": "Security",
    "nav.cli": "CLI",
    "nav.install": "Install",
    "nav.faq": "FAQ",

    "hero.titleA": "From one request",
    "hero.titleB": "to a hardened bot.",
    "hero.lede":
      "Aurifex gives your coding agent one path from a bot spec to a standalone Telegram project, with security gates that stop a release before it ships.",
    "hero.cta": "Install Aurifex",
    "hero.ctaAlt": "See a generated project",
    "hero.installLabel": "One installer for macOS, Linux, and Windows",
    "hero.copy": "Copy",
    "hero.copied": "Copied",
    "hero.copyUnix": "Copy the macOS and Linux command",
    "hero.copyWindows": "Copy the Windows PowerShell command",
    "hero.hosts": "OMP, DeepSeek Harness, Claude Code, MCP",
    "hero.artAlt":
      "A molten gold Telegram paper plane rising from an anvil on a dark atelier grid, with a cool teal rim light",
    "hero.markAlt": "Aurifex gold monogram",

    "demo.title": "The whole loop, in one terminal",
    "demo.lede":
      "Scaffold, test, verify, deploy. Every command returns a stable DomainResult and accepts --json.",
    "demo.note":
      "A fresh scaffold reports 28 passes and one warning: commit the lockfile after the first install.",
    "demo.replay": "Replay the session",

    "features.title": "What Aurifex does",
    "features.lede":
      "Four hosts, one implementation. Everything that touches your filesystem exists exactly once.",
    "features.core.title": "One core, four projections",
    "features.core.body":
      "The OMP extension, DSH bundle, Claude Code plugin, and MCP server only translate schemas. Every write goes through the same CoreOperations and PathPolicy.",
    "features.standalone.title": "Standalone by design",
    "features.standalone.body":
      "A generated bot never imports Aurifex. It owns its source, lockfile, Dockerfile, Caddyfile, and webhook registration script.",
    "features.botapi.title": "Bot API 10.4, explicit",
    "features.botapi.body":
      "grammY 1.46 and aiogram 3.31 stop at typed 10.3. Every project ships a typed raw adapter for widgets, rich messages, and ephemeral replies.",
    "features.gate.title": "Verification is a gate",
    "features.gate.body":
      "Sixteen static checks run over a bounded snapshot. A token literal, a missing secret, or a root container makes verify return ok: false.",
    "features.hosts.title": "Four hosts, nine tools",
    "features.hosts.body":
      "OMP, DeepSeek Harness, Claude Code through MCP, and any MCP client expose the same eight telegram_bot tools.",
    "features.skills.title": "Domain knowledge included",
    "features.skills.body":
      "Skills for the Bot API, grammY, aiogram, security, testing, deploy, payments, and Mini Apps, plus three review subagents.",

    "arch.title": "One core, thin hosts",
    "arch.lede": "Hosts translate schemas. The core owns every path, template, and check.",
    "arch.hostsLabel": "Agent hosts",
    "arch.coreLabel": "Domain core",
    "arch.outLabel": "Output",
    "arch.nodeOmp": "OMP extension",
    "arch.nodeDsh": "DSH bundle",
    "arch.nodeClaude": "Claude Code",
    "arch.nodeMcp": "MCP stdio",
    "arch.nodeCore": "CoreOperations",
    "arch.nodePolicy": "PathPolicy",
    "arch.nodeTemplates": "Templates",
    "arch.nodeVerify": "Verify",
    "arch.policyNote": "authorized root",
    "arch.templatesNote": "grammY, aiogram",
    "arch.verifyNote": "29 checks",
    "arch.nodeBot": "Standalone bot",
    "arch.botNote": "no Aurifex import",
    "arch.caption":
      "No host writes files directly. PathPolicy bounds every read and write to an authorized root.",

    "show.title": "What lands in your working tree",
    "show.lede": "A scaffold is a complete project you can read, run, and ship without Aurifex.",
    "show.featuresLabel": "Features, added one at a time",
    "show.verifyLabel": "Verification output",
    "show.f.commands": "commands",
    "show.f.llm": "llm",
    "show.f.inline": "inline",
    "show.f.payments": "payments",
    "show.f.miniapps": "miniapps",
    "show.f.moderation": "moderation",
    "show.f.broadcast": "broadcast",
    "show.f.widgets": "widgets",
    "show.f.rich": "rich",
    "show.note": "Deploy writes files and a setWebhook script. It never calls Telegram.",

    "sec.title": "Sixteen checks before anything ships",
    "sec.lede":
      "The gate is static and deterministic. It never runs your project and never calls Telegram.",
    "sec.token.title": "No secrets in the tree",
    "sec.token.body":
      ".env.example holds empty placeholders. Any token-shaped literal fails the build, and the checker never echoes it.",
    "sec.webhook.title": "Webhook hardening",
    "sec.webhook.body":
      "A secret header, HTTPS, an allowed port, and a framework callback that compares the secret. Custom equality checks fail.",
    "sec.dedupe.title": "One consumer, one update",
    "sec.dedupe.body":
      "update_id claims a 24-hour Redis key with SET NX EX 86400, so a redelivered update never runs twice.",
    "sec.retry.title": "Retries that respect limits",
    "sec.retry.body":
      "allowed_updates is explicit and retry_after is honoured instead of hammering the API.",
    "sec.container.title": "Non-root container",
    "sec.container.body":
      "The Dockerfile ends on a named USER. Running as root fails verification.",
    "sec.admin.title": "Server-side authority",
    "sec.admin.body":
      "ADMIN_IDS is checked on the server. Mini App initData is validated with HMAC-SHA256 and an auth_date freshness limit.",
    "sec.idsLabel": "Check identifiers",

    "cli.title": "Nine commands, one result shape",
    "cli.lede": "A human summary by default, a DomainResult with --json.",
    "cli.note": "Exit codes: 0 for success, 1 for a domain error, 2 for invalid usage.",
    "cli.target": "Resolve the framework, runtime, Bot API, and feature support for a stack.",
    "cli.new": "Scaffold a standalone project from a strict BotSpec.",
    "cli.inspect": "Detect stack and mode without writing anything.",
    "cli.verify": "Run the static gate and return evidence per check.",
    "cli.add": "Add one feature module without touching unrelated files.",
    "cli.deploy": "Write deploy files and a setWebhook script. No API call.",
    "cli.harness": "Write update fixtures, a fake transport, and a tgfake compose profile.",
    "cli.upgrade": "List the Bot API 10.4 migration actions for a project.",
    "cli.install": "Install into OMP, DSH, and Claude Code in one pass.",

    "install.title": "Install once, reach every host",
    "install.lede":
      "One command installs into OMP, DSH, and Claude Code. v0.1 ships from the repository; the npm package is not published yet.",
    "install.unix": "macOS and Linux",
    "install.windows": "Windows PowerShell",
    "install.step1": "Run the installer",
    "install.note":
      "The installer detects OMP, DSH, and Claude Code, prints every command it runs, and skips hosts that are not on PATH.",
    "install.omp.title": "OMP",
    "install.omp.body": "Registers the extension declared by the omp field in package.json.",
    "install.dsh.title": "DeepSeek Harness",
    "install.dsh.body": "Adds the bundle to a named profile through cordis.patch.yml.",
    "install.claude.title": "Claude Code",
    "install.claude.body":
      "Installs the plugin that points Claude Code at the bundled MCP server through .mcp.json.",
    "install.mcp.title": "MCP client",
    "install.mcp.body":
      "Any other MCP client connects to the built stdio server and receives the same nine tools.",
    "install.rootNote":
      "AURIFEX_ROOT bounds every read and write. It defaults to the working directory.",

    "faq.title": "Before you install",
    "faq.q1": "Does a generated bot depend on Aurifex?",
    "faq.a1":
      "No. A scaffolded project does not import the package or a shared runtime. It owns its source, tests, container, and deploy files.",
    "faq.q2": "Which Bot API version is supported?",
    "faq.a2":
      "10.4, through a typed raw adapter. grammY 1.46 and aiogram 3.31 declarations cover 10.3, so Aurifex never claims native 10.4 types.",
    "faq.q3": "Does verify run my bot?",
    "faq.a3":
      "No. Verification is static over a bounded snapshot: 64 MiB total, 1 MiB per file. Runtime proof comes from the generated tests and the gated E2E runs.",
    "faq.q4": "Does deploy call Telegram?",
    "faq.a4":
      "No. Deploy writes the Docker, Caddy, and setWebhook files. Registering the webhook stays an explicit operator action.",
    "faq.q5": "Is Docker required?",
    "faq.a5":
      "No. Docker is not in the default gate. The tgfake compose profile and image builds are optional.",
    "faq.q6": "What is out of scope for v0.1?",
    "faq.a6":
      "MTProto and userbot automation. Aurifex targets the Bot API only, and it is not a sandbox: the host extension process is trusted code.",
    "faq.q7": "Can I install from a source checkout?",
    "faq.a7":
      "Yes. Clone the repository, run pnpm install and pnpm build, then node dist/cli.js install --host all. Per-host commands are listed in the README.",

    "footer.tagline": "Production Telegram bots from one agent request.",
    "footer.built": "Built for OMP, DeepSeek Harness, Claude Code, and MCP.",
    "footer.repo": "Repository",
    "footer.prs": "Pull requests",
    "footer.license": "MIT license",
    "footer.spec": "Specification",
    "footer.architecture": "Architecture",
    "footer.testPlan": "Test plan",
    "footer.rights": "MIT licensed. Third-party attributions are listed in the repository.",
    "footer.markAlt": "Aurifex monogram",
  },

  ru: {
    "meta.title": "Aurifex · production-боты Telegram из одного запроса агенту",
    "meta.description":
      "Скаффолд, проверка и деплой production-ботов Telegram прямо из кодинг-агента. grammY и aiogram, Bot API 10.4, 29 проверок безопасности, четыре хоста.",

    "nav.skip": "Перейти к содержимому",
    "nav.home": "Главная Aurifex",
    "nav.language": "Язык",
    "nav.what": "Возможности",
    "nav.architecture": "Архитектура",
    "nav.security": "Безопасность",
    "nav.cli": "CLI",
    "nav.install": "Установка",
    "nav.faq": "Вопросы",

    "hero.titleA": "Один запрос —",
    "hero.titleB": "и защищённый бот.",
    "hero.lede":
      "Aurifex даёт кодинг-агенту один путь от спецификации бота до самостоятельного проекта Telegram, с проверками безопасности, которые не пропускают релиз.",
    "hero.cta": "Установить Aurifex",
    "hero.ctaAlt": "Посмотреть сгенерированный проект",
    "hero.installLabel": "Один установщик для macOS, Linux и Windows",
    "hero.copy": "Копировать",
    "hero.copied": "Скопировано",
    "hero.copyUnix": "Копировать команду для macOS и Linux",
    "hero.copyWindows": "Копировать команду для Windows PowerShell",
    "hero.hosts": "OMP, DeepSeek Harness, Claude Code, MCP",
    "hero.artAlt":
      "Расплавленная золотая бумажная плоскость Telegram поднимается с наковальни на тёмной сетке мастерской, по краю холодный бирюзовый свет",
    "hero.markAlt": "Золотой монограмм Aurifex",

    "demo.title": "Весь цикл в одном терминале",
    "demo.lede":
      "Скаффолд, тесты, проверка, деплой. Каждая команда возвращает стабильный DomainResult и принимает --json.",
    "demo.note":
      "Свежий скаффолд даёт 15 успешных проверок и одно предупреждение: закоммитьте lockfile после первой установки.",
    "demo.replay": "Повторить сессию",

    "features.title": "Что делает Aurifex",
    "features.lede":
      "Четыре хоста, одна реализация. Всё, что трогает файловую систему, существует ровно в одном месте.",
    "features.core.title": "Одно ядро, четыре проекции",
    "features.core.body":
      "Расширение OMP, бандл DSH, плагин Claude Code и MCP-сервер только переводят схемы. Любая запись идёт через общие CoreOperations и PathPolicy.",
    "features.standalone.title": "Самостоятельность по умолчанию",
    "features.standalone.body":
      "Сгенерированный бот не импортирует Aurifex. У него свой исходный код, lockfile, Dockerfile, Caddyfile и скрипт регистрации вебхука.",
    "features.botapi.title": "Bot API 10.4 без догадок",
    "features.botapi.body":
      "Типы grammY 1.46 и aiogram 3.31 заканчиваются на 10.3. В каждом проекте есть типизированный raw-адаптер для виджетов, rich-сообщений и эфемерных ответов.",
    "features.gate.title": "Проверка как гейт",
    "features.gate.body":
      "Шестнадцать статических проверок по ограниченному снимку. Токен в коде, отсутствующий секрет или root-контейнер дают ok: false.",
    "features.hosts.title": "Четыре хоста, девять инструментов",
    "features.hosts.body":
      "OMP, DeepSeek Harness, Claude Code через MCP и любой MCP-клиент получают одни и те же восемь инструментов telegram_bot.",
    "features.skills.title": "Знание предметной области",
    "features.skills.body":
      "Навыки по Bot API, grammY, aiogram, безопасности, тестированию, деплою, платежам и Mini Apps, плюс три субагента для ревью.",

    "arch.title": "Одно ядро, тонкие хосты",
    "arch.lede": "Хосты переводят схемы. Ядро владеет путями, шаблонами и проверками.",
    "arch.hostsLabel": "Хосты-агенты",
    "arch.coreLabel": "Доменное ядро",
    "arch.outLabel": "Результат",
    "arch.nodeOmp": "Расширение OMP",
    "arch.nodeDsh": "Бандл DSH",
    "arch.nodeClaude": "Claude Code",
    "arch.nodeMcp": "MCP stdio",
    "arch.nodeCore": "CoreOperations",
    "arch.nodePolicy": "PathPolicy",
    "arch.nodeTemplates": "Шаблоны",
    "arch.nodeVerify": "Verify",
    "arch.policyNote": "авторизованный корень",
    "arch.templatesNote": "grammY, aiogram",
    "arch.verifyNote": "29 проверок",
    "arch.nodeBot": "Самостоятельный бот",
    "arch.botNote": "без импорта Aurifex",
    "arch.caption":
      "Ни один хост не пишет файлы напрямую. PathPolicy ограничивает чтение и запись авторизованным корнем.",

    "show.title": "Что появляется в проекте",
    "show.lede":
      "Скаффолд — это законченный проект, который можно читать, запускать и выкатывать без Aurifex.",
    "show.featuresLabel": "Фичи, добавляемые по одной",
    "show.verifyLabel": "Вывод проверки",
    "show.f.commands": "commands",
    "show.f.llm": "llm",
    "show.f.inline": "inline",
    "show.f.payments": "payments",
    "show.f.miniapps": "miniapps",
    "show.f.moderation": "moderation",
    "show.f.broadcast": "broadcast",
    "show.f.widgets": "widgets",
    "show.f.rich": "rich",
    "show.note": "Deploy пишет файлы и скрипт setWebhook. Telegram он не вызывает.",

    "sec.title": "Шестнадцать проверок до релиза",
    "sec.lede":
      "Гейт статический и детерминированный. Он не запускает проект и не обращается к Telegram.",
    "sec.token.title": "Никаких секретов в дереве",
    "sec.token.body":
      ".env.example содержит пустые заглушки. Любой похожий на токен литерал валит сборку, а проверка никогда его не печатает.",
    "sec.webhook.title": "Укрепление вебхука",
    "sec.webhook.body":
      "Секретный заголовок, HTTPS, разрешённый порт и callback фреймворка, который сравнивает секрет. Самописное сравнение не проходит.",
    "sec.dedupe.title": "Один потребитель, один апдейт",
    "sec.dedupe.body":
      "update_id занимает 24-часовой ключ Redis через SET NX EX 86400, поэтому повторная доставка не выполнится дважды.",
    "sec.retry.title": "Ретраи с уважением к лимитам",
    "sec.retry.body": "allowed_updates задан явно, а retry_after соблюдается вместо долбёжки API.",
    "sec.container.title": "Контейнер без root",
    "sec.container.body":
      "Dockerfile заканчивается именованным USER. Запуск от root не проходит проверку.",
    "sec.admin.title": "Авторитет на сервере",
    "sec.admin.body":
      "ADMIN_IDS проверяется на сервере. initData Mini App валидируется через HMAC-SHA256 с ограничением свежести auth_date.",
    "sec.idsLabel": "Идентификаторы проверок",

    "cli.title": "Девять команд, одна форма результата",
    "cli.lede": "По умолчанию человекочитаемая сводка, с --json — DomainResult.",
    "cli.note": "Коды выхода: 0 — успех, 1 — доменная ошибка, 2 — неверное использование.",
    "cli.target": "Определяет фреймворк, рантайм, Bot API и поддержку фич для стека.",
    "cli.new": "Создаёт самостоятельный проект из строгого BotSpec.",
    "cli.inspect": "Определяет стек и режим, ничего не записывая.",
    "cli.verify": "Запускает статический гейт и возвращает улики по каждой проверке.",
    "cli.add": "Добавляет один модуль фичи, не трогая остальные файлы.",
    "cli.deploy": "Пишет файлы деплоя и скрипт setWebhook. Без вызова API.",
    "cli.harness": "Пишет фикстуры апдейтов, фейковый транспорт и compose-профиль tgfake.",
    "cli.upgrade": "Перечисляет шаги миграции на Bot API 10.4 для проекта.",
    "cli.install": "Ставит пакет в OMP, DSH и Claude Code за один проход.",

    "install.title": "Одна установка, все хосты",
    "install.lede":
      "Одна команда ставит пакет в OMP, DSH и Claude Code. В v0.1 установка идёт из репозитория: пакет в npm ещё не опубликован.",
    "install.unix": "macOS и Linux",
    "install.windows": "Windows PowerShell",
    "install.step1": "Запустите установщик",
    "install.note":
      "Установщик находит OMP, DSH и Claude Code, печатает каждую выполняемую команду и пропускает хосты, которых нет в PATH.",
    "install.omp.title": "OMP",
    "install.omp.body": "Регистрирует расширение, объявленное в поле omp файла package.json.",
    "install.dsh.title": "DeepSeek Harness",
    "install.dsh.body": "Добавляет бандл в именованный профиль через cordis.patch.yml.",
    "install.claude.title": "Claude Code",
    "install.claude.body":
      "Ставит плагин, который через .mcp.json направляет Claude Code на встроенный MCP-сервер.",
    "install.mcp.title": "MCP-клиент",
    "install.mcp.body":
      "Любой другой MCP-клиент подключается к собранному stdio-серверу и получает те же восемь инструментов.",
    "install.rootNote":
      "AURIFEX_ROOT ограничивает чтение и запись. По умолчанию равен рабочей директории.",

    "faq.title": "Перед установкой",
    "faq.q1": "Сгенерированный бот зависит от Aurifex?",
    "faq.a1":
      "Нет. Проект не импортирует пакет и не тянет общий рантайм. У него свой код, тесты, контейнер и файлы деплоя.",
    "faq.q2": "Какая версия Bot API поддерживается?",
    "faq.a2":
      "10.4 через типизированный raw-адаптер. Объявления grammY 1.46 и aiogram 3.31 покрывают 10.3, поэтому Aurifex не заявляет нативные типы 10.4.",
    "faq.q3": "verify запускает моего бота?",
    "faq.a3":
      "Нет. Проверка статическая по ограниченному снимку: 64 МиБ всего, 1 МиБ на файл. Доказательство работы дают сгенерированные тесты и E2E под флагом.",
    "faq.q4": "deploy вызывает Telegram?",
    "faq.a4":
      "Нет. Deploy пишет файлы Docker, Caddy и setWebhook. Регистрация вебхука остаётся явным действием оператора.",
    "faq.q5": "Docker обязателен?",
    "faq.a5":
      "Нет. Docker не входит в стандартный гейт. Compose-профиль tgfake и сборка образов опциональны.",
    "faq.q6": "Что не входит в v0.1?",
    "faq.a6":
      "MTProto и автоматизация юзерботов. Aurifex работает только с Bot API и не является песочницей: процесс расширения хоста — доверенный код.",
    "faq.q7": "Можно установить из исходников?",
    "faq.a7":
      "Да. Склонируйте репозиторий, выполните pnpm install и pnpm build, затем node dist/cli.js install --host all. Команды по каждому хосту есть в README.",

    "footer.tagline": "Production-боты Telegram из одного запроса агенту.",
    "footer.built": "Сделано для OMP, DeepSeek Harness, Claude Code и MCP.",
    "footer.repo": "Репозиторий",
    "footer.prs": "Pull requests",
    "footer.license": "Лицензия MIT",
    "footer.spec": "Спецификация",
    "footer.architecture": "Архитектура",
    "footer.testPlan": "План тестов",
    "footer.rights": "Лицензия MIT. Сторонние материалы перечислены в репозитории.",
    "footer.markAlt": "Монограмм Aurifex",
  },

  zh: {
    "meta.title": "Aurifex · 一句请求生成生产级 Telegram 机器人",
    "meta.description":
      "在编码智能体中直接生成、校验并部署生产级 Telegram 机器人。支持 grammY 与 aiogram、Bot API 10.4、16 项安全检查、四类宿主。",

    "nav.skip": "跳到正文",
    "nav.home": "Aurifex 首页",
    "nav.language": "语言",
    "nav.what": "功能",
    "nav.architecture": "架构",
    "nav.security": "安全",
    "nav.cli": "CLI",
    "nav.install": "安装",
    "nav.faq": "常见问题",

    "hero.titleA": "一句请求，",
    "hero.titleB": "换来生产级机器人。",
    "hero.lede":
      "Aurifex 让编码智能体沿一条路径完成从机器人规格到独立 Telegram 项目的全部工作，发布前由安全门禁把关。",
    "hero.cta": "安装 Aurifex",
    "hero.ctaAlt": "查看生成的项目",
    "hero.installLabel": "一个安装器，覆盖 macOS、Linux 与 Windows",
    "hero.copy": "复制",
    "hero.copied": "已复制",
    "hero.copyUnix": "复制 macOS 与 Linux 命令",
    "hero.copyWindows": "复制 Windows PowerShell 命令",
    "hero.hosts": "OMP、DeepSeek Harness、Claude Code、MCP",
    "hero.artAlt": "深色的工坊网格上，熔金打造的 Telegram 纸飞机从铁砧上升起，边缘泛着青色冷光",
    "hero.markAlt": "Aurifex 金色字母标记",

    "demo.title": "一个终端跑完整个流程",
    "demo.lede": "脚手架、测试、校验、部署。每条命令都返回稳定的 DomainResult，并支持 --json。",
    "demo.note": "全新脚手架给出 28 项通过、1 项警告：首次安装后请提交 lockfile。",
    "demo.replay": "重播会话",

    "features.title": "Aurifex 做什么",
    "features.lede": "四个宿主，一套实现。所有触及文件系统的逻辑只存在一份。",
    "features.core.title": "一个内核，四个投影",
    "features.core.body":
      "OMP 扩展、DSH 打包、Claude Code 插件与 MCP 服务器只负责转换 schema，所有写入都经过同一套 CoreOperations 与 PathPolicy。",
    "features.standalone.title": "默认独立",
    "features.standalone.body":
      "生成的机器人不会导入 Aurifex。源码、lockfile、Dockerfile、Caddyfile 与 webhook 注册脚本都归项目自己所有。",
    "features.botapi.title": "Bot API 10.4 说得明白",
    "features.botapi.body":
      "grammY 1.46 与 aiogram 3.31 的类型停在 10.3。每个项目都带一层带类型的 raw 适配器，覆盖组件、富消息与临时回复。",
    "features.gate.title": "校验即门禁",
    "features.gate.body":
      "16 项静态检查跑在受控快照上。代码里的令牌、缺失的密钥或 root 容器，都会让 verify 返回 ok: false。",
    "features.hosts.title": "四个宿主，九个工具",
    "features.hosts.body":
      "OMP、DeepSeek Harness、经 MCP 接入的 Claude Code，以及任意 MCP 客户端，都拿到同样的八个 telegram_bot 工具。",
    "features.skills.title": "内置领域知识",
    "features.skills.body":
      "覆盖 Bot API、grammY、aiogram、安全、测试、部署、支付与 Mini Apps 的技能，另加三个评审子代理。",

    "arch.title": "内核厚，宿主薄",
    "arch.lede": "宿主只转换 schema，路径、模板与检查都由内核掌握。",
    "arch.hostsLabel": "智能体宿主",
    "arch.coreLabel": "领域内核",
    "arch.outLabel": "产出",
    "arch.nodeOmp": "OMP 扩展",
    "arch.nodeDsh": "DSH 打包",
    "arch.nodeClaude": "Claude Code",
    "arch.nodeMcp": "MCP stdio",
    "arch.nodeCore": "CoreOperations",
    "arch.nodePolicy": "PathPolicy",
    "arch.nodeTemplates": "模板渲染",
    "arch.nodeVerify": "Verify",
    "arch.policyNote": "授权根目录",
    "arch.templatesNote": "grammY, aiogram",
    "arch.verifyNote": "29 项检查",
    "arch.nodeBot": "独立机器人项目",
    "arch.botNote": "不导入 Aurifex",
    "arch.caption": "宿主不直接写文件。PathPolicy 把每次读取和写入都限制在授权根目录之内。",

    "show.title": "生成后的项目结构",
    "show.lede": "脚手架是一个完整项目，脱离 Aurifex 也能阅读、运行和上线。",
    "show.featuresLabel": "功能可按需逐个加入",
    "show.verifyLabel": "校验输出",
    "show.f.commands": "commands",
    "show.f.llm": "llm",
    "show.f.inline": "inline",
    "show.f.payments": "payments",
    "show.f.miniapps": "miniapps",
    "show.f.moderation": "moderation",
    "show.f.broadcast": "broadcast",
    "show.f.widgets": "widgets",
    "show.f.rich": "rich",
    "show.note": "deploy 只写部署文件与 setWebhook 脚本，从不调用 Telegram。",

    "sec.title": "上线前的十六项检查",
    "sec.lede": "门禁是静态且确定的：不运行项目代码，也不访问 Telegram。",
    "sec.token.title": "仓库里没有密钥",
    "sec.token.body":
      ".env.example 只放空占位符。任何形似令牌的字面量都会让构建失败，检查器从不回显它。",
    "sec.webhook.title": "Webhook 加固",
    "sec.webhook.body":
      "密钥请求头、HTTPS、允许的端口，以及由框架 callback 完成的密钥比较。自写的相等比较无法通过。",
    "sec.dedupe.title": "一个消费者，一条更新",
    "sec.dedupe.body":
      "update_id 通过 SET NX EX 86400 占用一个 24 小时的 Redis 键，重复投递不会执行两次。",
    "sec.retry.title": "尊重限流的重试",
    "sec.retry.body": "allowed_updates 显式声明，retry_after 会被遵守，而不是反复冲击 API。",
    "sec.container.title": "非 root 容器",
    "sec.container.body": "Dockerfile 以具名 USER 结尾。以 root 运行无法通过校验。",
    "sec.admin.title": "权限在服务端",
    "sec.admin.body":
      "ADMIN_IDS 在服务端校验。Mini App 的 initData 用 HMAC-SHA256 验证，并限制 auth_date 的新鲜度。",
    "sec.idsLabel": "检查标识",

    "cli.title": "九条命令，一种结果结构",
    "cli.lede": "默认输出人类可读摘要，加 --json 输出 DomainResult。",
    "cli.note": "退出码：0 表示成功，1 表示领域错误，2 表示用法错误。",
    "cli.target": "解析某个栈的框架、运行时、Bot API 与功能支持。",
    "cli.new": "按严格的 BotSpec 生成独立项目。",
    "cli.inspect": "识别栈与运行模式，不写入任何文件。",
    "cli.verify": "运行静态门禁，并返回每项检查的证据。",
    "cli.add": "添加一个功能模块，不碰无关文件。",
    "cli.deploy": "写入部署文件与 setWebhook 脚本，不调用 API。",
    "cli.harness": "写入更新固件、假传输层与 tgfake compose 配置。",
    "cli.upgrade": "列出项目适用的 Bot API 10.4 迁移动作。",
    "cli.install": "一次安装到 OMP、DSH 与 Claude Code。",

    "install.title": "安装一次，覆盖所有宿主",
    "install.lede": "一条命令安装到 OMP、DSH 与 Claude Code。v0.1 从仓库分发，npm 包尚未发布。",
    "install.unix": "macOS 与 Linux",
    "install.windows": "Windows PowerShell",
    "install.step1": "运行安装器",
    "install.note":
      "安装器会检测 OMP、DSH 与 Claude Code，打印每条要执行的命令，并跳过 PATH 中不存在的宿主。",
    "install.omp.title": "OMP",
    "install.omp.body": "通过 package.json 中的 omp 字段注册扩展。",
    "install.dsh.title": "DeepSeek Harness",
    "install.dsh.body": "通过 cordis.patch.yml 把打包加入具名配置档。",
    "install.claude.title": "Claude Code",
    "install.claude.body": "安装插件，通过 .mcp.json 让 Claude Code 使用内置的 MCP 服务器。",
    "install.mcp.title": "MCP 客户端",
    "install.mcp.body": "其他 MCP 客户端直接连接构建好的 stdio 服务器，获得同样的八个工具。",
    "install.rootNote": "AURIFEX_ROOT 限制所有读取与写入，默认取工作目录。",

    "faq.title": "安装之前",
    "faq.q1": "生成的机器人依赖 Aurifex 吗？",
    "faq.a1":
      "不依赖。项目不会导入这个包，也不带共享运行时。源码、测试、容器与部署文件都属于它自己。",
    "faq.q2": "支持哪个版本的 Bot API？",
    "faq.a2":
      "10.4，通过带类型的 raw 适配器。grammY 1.46 与 aiogram 3.31 的声明只到 10.3，所以 Aurifex 从不声称原生支持 10.4 类型。",
    "faq.q3": "verify 会运行我的机器人吗？",
    "faq.a3":
      "不会。校验是对受控快照的静态检查：总计 64 MiB，单文件 1 MiB。运行时的证据来自生成的测试与受开关控制的 E2E。",
    "faq.q4": "deploy 会调用 Telegram 吗？",
    "faq.a4":
      "不会。deploy 只写 Docker、Caddy 与 setWebhook 文件。注册 webhook 始终是操作者的显式动作。",
    "faq.q5": "必须用 Docker 吗？",
    "faq.a5": "不是。Docker 不在默认门禁里。tgfake compose 配置与镜像构建都是可选项。",
    "faq.q6": "v0.1 不覆盖什么？",
    "faq.a6":
      "MTProto 与 userbot 自动化。Aurifex 只面向 Bot API，而且它不是沙箱：宿主扩展进程属于可信代码。",
    "faq.q7": "可以从源码检出安装吗？",
    "faq.a7":
      "可以。克隆仓库，运行 pnpm install 与 pnpm build，再执行 node dist/cli.js install --host all。每个宿主的单独命令写在 README 中。",

    "footer.tagline": "一句请求，生成生产级 Telegram 机器人。",
    "footer.built": "为 OMP、DeepSeek Harness、Claude Code 与 MCP 而做。",
    "footer.repo": "代码仓库",
    "footer.prs": "Pull requests",
    "footer.license": "MIT 许可证",
    "footer.spec": "规格说明",
    "footer.architecture": "架构说明",
    "footer.testPlan": "测试计划",
    "footer.rights": "MIT 许可证。第三方素材归属列在仓库中。",
    "footer.markAlt": "Aurifex 字母标记",
  },
};
