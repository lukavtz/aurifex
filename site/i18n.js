/* Aurifex site copy. One flat dictionary per locale, identical keys by contract.
   tools/check-site.mjs asserts parity, so keep the three objects in step. */
window.AURIFEX_I18N = {
  en: {
    "meta.title": "Aurifex · the knowledge an agent needs to build a Telegram bot",
    "meta.description":
      "Aurifex teaches a coding agent to interview you, build exactly the Telegram bot you asked for, and prove it with 29 static checks. grammY and aiogram, Bot API 10.4.",

    "nav.skip": "Skip to content",
    "nav.home": "Aurifex home",
    "nav.language": "Language",
    "nav.what": "What it does",
    "nav.how": "How it works",
    "nav.skills": "Skills",
    "nav.security": "Security",
    "nav.cli": "CLI",
    "nav.install": "Install",
    "nav.faq": "FAQ",

    "hero.titleA": "From one request",
    "hero.titleB": "to a bot that fits.",
    "hero.lede":
      "Aurifex is a knowledge plugin for coding agents. It teaches the agent to interview you, build exactly the bot you asked for, and prove the result with a static check.",
    "hero.cta": "Install Aurifex",
    "hero.ctaAlt": "See how it works",
    "hero.installLabel": "One installer for macOS, Linux, and Windows",
    "hero.copy": "Copy",
    "hero.copied": "Copied",
    "hero.copyUnix": "Copy the macOS and Linux command",
    "hero.copyWindows": "Copy the Windows PowerShell command",
    "hero.hosts": "OMP, DeepSeek Harness, Claude Code, MCP",
    "hero.artAlt":
      "A molten gold Telegram paper plane rising from an anvil on a dark atelier grid, with a cool teal rim light",
    "hero.markAlt": "Aurifex gold monogram",

    "demo.title": "From questions to a verified bot",
    "demo.lede":
      "The agent asks, then writes, then checks. Every command returns a stable DomainResult and accepts --json.",
    "demo.note":
      "verify exits 1 on a failed check, so an agent cannot claim success without evidence.",
    "demo.replay": "Replay the session",

    "features.title": "What the plugin actually is",
    "features.lede":
      "Knowledge, three tools, and one deterministic check. No generator, no templates, no hidden writes.",
    "features.knowledge.title": "Knowledge, not scaffolding",
    "features.knowledge.body":
      "Fifteen skills carry the procedure: discovery, stack choice, feature recipes, framework details, security, testing, delivery. The agent reads them and writes the code itself.",
    "features.interview.title": "Interview first",
    "features.interview.body":
      "The agent asks three to seven questions in one block, each with options and a recommended default. Every answer maps to a BotSpec field, and nothing is coded before you confirm it.",
    "features.exact.title": "Exactly what you asked for",
    "features.exact.body":
      "Ask for inline buttons and you get inline buttons. The recipes skill builds one vertical slice at a time, so the agent never adds scenes, payments, or a Mini App you did not request.",
    "features.verify.title": "Evidence, not claims",
    "features.verify.body":
      "verify reads file contents inside a bounded snapshot and returns 29 check identifiers. A failed check exits 1, so the agent has to fix the bot instead of asserting success.",
    "features.hosts.title": "3 tools, 4 hosts",
    "features.hosts.body":
      "OMP, DeepSeek Harness, Claude Code through MCP, and any MCP client expose the same three tools: resolve the pinned stack, inspect a project, run the gate.",

    "flow.title": "How the agent builds a bot",
    "flow.lede":
      "Four steps, in this order. Skipping one is how a bot ends up with features nobody asked for.",
    "flow.stepsLabel": "Procedure",
    "flow.step1": "Questions",
    "flow.step1Note": "3–7, with defaults",
    "flow.step2": "BotSpec",
    "flow.step2Note": "confirmed by you",
    "flow.step3": "Recipes",
    "flow.step3Note": "one vertical slice",
    "flow.step4": "Verify",
    "flow.step4Note": "29 static checks",
    "flow.outLabel": "Result",
    "flow.nodeBot": "The bot you asked for",
    "flow.botNote": "runs without Aurifex",
    "flow.caption":
      "The plugin never writes the project. It supplies the procedure and the proof; the agent owns every file.",

    "skills.title": "15 skills, loaded on demand",
    "skills.lede":
      "Each skill is a short procedure with gotchas and primary sources. The agent opens only the ones the request needs, so its context stays small.",
    "skills.note":
      "Start with telegram-bot: it routes every other skill and states the hard rules. Read project-layout and the reference files only when the task reaches them.",

    "show.title": "What the agent writes",
    "show.lede":
      "A project built from the recipes, in the canonical layout. It never imports Aurifex.",
    "show.featuresLabel": "Only the features you asked for",
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
    "show.note":
      "The layout reference in telegram-bot-recipes lists these paths, and a test keeps it in sync with the verifier.",

    "sec.title": "29 checks before anything ships",
    "sec.lede":
      "The gate checks textual markers over a bounded snapshot. It never runs your project or calls Telegram; runtime behavior needs separate tests.",
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

    "cli.title": "4 commands, one result shape",
    "cli.lede": "A human summary by default, a DomainResult with --json.",
    "cli.target": "Resolve the pinned framework, runtime, and Bot API baseline for a stack.",
    "cli.inspect": "Detect a project's stack, mode, and storage without writing anything.",
    "cli.verify": "Run the static file-content gate and return evidence per check identifier.",
    "cli.install": "Install into OMP, DSH, and Claude Code in one interactive pass.",
    "cli.note": "Exit codes: 0 for success, 1 for a domain error, 2 for invalid usage.",

    "install.title": "Install once, reach every host",
    "install.lede":
      "v0.3.1 installs from the repository. The installer asks which harnesses and which scope, then exits on its own.",
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
      "Any other MCP client connects to the built stdio server and gets the same three tools.",
    "install.rootNote":
      "AURIFEX_ROOT bounds every read and write. It defaults to the working directory.",

    "faq.title": "Before you install",
    "faq.q1": "What does Aurifex ship?",
    "faq.a1":
      "Fifteen skills, three MCP tools, four CLI commands, and one static verifier. No project generator and no templates.",
    "faq.q2": "Is there a project generator?",
    "faq.a2":
      "No. Version 0.3 removed it. The agent writes the bot from the recipe skills, and the plugin only checks the result.",
    "faq.q3": "Does the agent ask before writing code?",
    "faq.a3":
      "Yes. Discovery produces three to seven questions with recommended defaults, every answer maps to a BotSpec field, and nothing is built until you confirm the spec.",
    "faq.q4": "Which Bot API version is supported?",
    "faq.a4":
      "10.4, through a typed raw adapter. grammY 1.46 and aiogram 3.31 declarations cover 10.3, so the knowledge never claims native 10.4 types.",
    "faq.q5": "Does verify run my bot?",
    "faq.a5":
      "No. It reads file contents inside a bounded snapshot: 64 MiB total, 1 MiB per file. No network and no Telegram call; runtime behavior belongs to the testing skill.",
    "faq.q6": "What is out of scope for v0.3.1?",
    "faq.a6":
      "MTProto and userbot automation. Aurifex targets the Bot API only, and it is not a sandbox: the host extension process is trusted code.",
    "faq.q7": "Can I install from a source checkout?",
    "faq.a7":
      "Yes. Clone the repository, run pnpm install and pnpm build, then node dist/cli.js install --host all. Per-host commands are listed in the README.",

    "footer.tagline": "The knowledge an agent needs to build a Telegram bot.",
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
    "meta.title": "Aurifex · знание, которое нужно агенту для бота в Telegram",
    "meta.description":
      "Aurifex учит кодинг-агента расспросить вас, собрать ровно того бота Telegram, о котором вы просили, и доказать результат 29 статическими проверками. grammY и aiogram, Bot API 10.4.",

    "nav.skip": "Перейти к содержимому",
    "nav.home": "Главная Aurifex",
    "nav.language": "Язык",
    "nav.what": "Возможности",
    "nav.how": "Как это работает",
    "nav.skills": "Навыки",
    "nav.security": "Безопасность",
    "nav.cli": "CLI",
    "nav.install": "Установка",
    "nav.faq": "Вопросы",

    "hero.titleA": "Один запрос —",
    "hero.titleB": "и бот, который подходит.",
    "hero.lede":
      "Aurifex — плагин знаний для кодинг-агентов. Он учит агента расспросить вас, собрать ровно запрошенного бота и доказать результат статической проверкой.",
    "hero.cta": "Установить Aurifex",
    "hero.ctaAlt": "Как это работает",
    "hero.installLabel": "Один установщик для macOS, Linux и Windows",
    "hero.copy": "Копировать",
    "hero.copied": "Скопировано",
    "hero.copyUnix": "Копировать команду для macOS и Linux",
    "hero.copyWindows": "Копировать команду для Windows PowerShell",
    "hero.hosts": "OMP, DeepSeek Harness, Claude Code, MCP",
    "hero.artAlt":
      "Расплавленная золотая бумажная плоскость Telegram поднимается с наковальни на тёмной сетке мастерской, по краю холодный бирюзовый свет",
    "hero.markAlt": "Золотой монограмм Aurifex",

    "demo.title": "От вопросов до проверенного бота",
    "demo.lede":
      "Агент спрашивает, затем пишет, затем проверяет. Каждая команда возвращает стабильный DomainResult и принимает --json.",
    "demo.note":
      "verify завершается с кодом 1 при провале проверки, поэтому агент не может объявить успех без улик.",
    "demo.replay": "Повторить сессию",

    "features.title": "Что плагин на самом деле даёт",
    "features.lede":
      "Знание, три инструмента и одна детерминированная проверка. Ни генератора, ни шаблонов, ни скрытых записей.",
    "features.knowledge.title": "Знание, а не каркас",
    "features.knowledge.body":
      "Пятнадцать навыков несут процедуру: опрос, выбор стека, рецепты функций, детали фреймворков, безопасность, тесты, доставку. Агент читает их и пишет код сам.",
    "features.interview.title": "Сначала вопросы",
    "features.interview.body":
      "Агент задаёт от трёх до семи вопросов одним блоком, у каждого варианты и рекомендованное значение. Каждый ответ отображается в поле BotSpec, и код не пишется до вашего подтверждения.",
    "features.exact.title": "Ровно то, что просили",
    "features.exact.body":
      "Просили инлайн-кнопки — получаете инлайн-кнопки. Навык рецептов строит по одному вертикальному срезу, поэтому агент не добавляет сцены, платежи или Mini App, которых вы не просили.",
    "features.verify.title": "Улики, а не заявления",
    "features.verify.body":
      "verify читает содержимое файлов в ограниченном снимке и возвращает 29 идентификаторов проверок. Провал даёт код 1, поэтому агенту приходится исправлять бота, а не утверждать успех.",
    "features.hosts.title": "3 инструмента, 4 хоста",
    "features.hosts.body":
      "OMP, DeepSeek Harness, Claude Code через MCP и любой MCP-клиент видят одни и те же три инструмента: определить закреплённый стек, осмотреть проект, запустить гейт.",

    "flow.title": "Как агент строит бота",
    "flow.lede":
      "Четыре шага именно в этом порядке. Пропуск одного — так у бота появляются функции, которых никто не просил.",
    "flow.stepsLabel": "Процедура",
    "flow.step1": "Вопросы",
    "flow.step1Note": "3–7, со значениями по умолчанию",
    "flow.step2": "BotSpec",
    "flow.step2Note": "подтверждён вами",
    "flow.step3": "Рецепты",
    "flow.step3Note": "один вертикальный срез",
    "flow.step4": "Verify",
    "flow.step4Note": "29 статических проверок",
    "flow.outLabel": "Результат",
    "flow.nodeBot": "Бот, которого вы просили",
    "flow.botNote": "работает без Aurifex",
    "flow.caption":
      "Плагин не пишет проект. Он даёт процедуру и доказательство; каждый файл принадлежит агенту.",

    "skills.title": "15 навыков, загружаются по требованию",
    "skills.lede":
      "Каждый навык — короткая процедура с подводными камнями и первоисточниками. Агент открывает только нужные, поэтому контекст остаётся небольшим.",
    "skills.note":
      "Начинайте с telegram-bot: он направляет к остальным навыкам и задаёт жёсткие правила. Файлы project-layout и references читаются только тогда, когда задача до них доходит.",

    "show.title": "Что пишет агент",
    "show.lede":
      "Проект, собранный по рецептам, в канонической раскладке. Aurifex он не импортирует.",
    "show.featuresLabel": "Только запрошенные функции",
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
    "show.note":
      "Справочник раскладки в telegram-bot-recipes перечисляет эти пути, а тест держит его в синхроне с проверкой.",

    "sec.title": "29 проверок до релиза",
    "sec.lede":
      "Гейт проверяет текстовые маркеры по ограниченному снимку. Он не запускает проект и не обращается к Telegram; поведение проверяют отдельные тесты.",
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

    "cli.title": "4 команды, одна форма результата",
    "cli.lede": "По умолчанию человекочитаемая сводка, с --json — DomainResult.",
    "cli.target": "Определяет закреплённые фреймворк, рантайм и базовый Bot API для стека.",
    "cli.inspect": "Определяет стек, режим и хранилище проекта, ничего не записывая.",
    "cli.verify":
      "Запускает статический гейт по содержимому файлов и возвращает улики по каждому идентификатору.",
    "cli.install": "Ставит пакет в OMP, DSH и Claude Code за один интерактивный проход.",
    "cli.note": "Коды выхода: 0 — успех, 1 — доменная ошибка, 2 — неверное использование.",

    "install.title": "Одна установка, все хосты",
    "install.lede":
      "v0.3.1 ставится из репозитория. Установщик спрашивает хосты и область, а затем завершается сам.",
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
      "Любой другой MCP-клиент подключается к собранному stdio-серверу и получает те же три инструмента.",
    "install.rootNote":
      "AURIFEX_ROOT ограничивает чтение и запись. По умолчанию равен рабочей директории.",

    "faq.title": "Перед установкой",
    "faq.q1": "Что поставляется в Aurifex?",
    "faq.a1":
      "Пятнадцать навыков, три MCP-инструмента, четыре команды CLI и один статический проверяльщик. Генератора проектов и шаблонов нет.",
    "faq.q2": "Генератор проектов есть?",
    "faq.a2":
      "Нет. Версия 0.3 его удалила. Бота пишет агент по навыкам-рецептам, а плагин только проверяет результат.",
    "faq.q3": "Агент спрашивает до того, как писать код?",
    "faq.a3":
      "Да. Опрос даёт от трёх до семи вопросов с рекомендованными значениями, каждый ответ отображается в поле BotSpec, и ничего не собирается до подтверждения спецификации.",
    "faq.q4": "Какая версия Bot API поддерживается?",
    "faq.a4":
      "10.4 через типизированный raw-адаптер. Объявления grammY 1.46 и aiogram 3.31 покрывают 10.3, поэтому знание не заявляет нативные типы 10.4.",
    "faq.q5": "verify запускает моего бота?",
    "faq.a5":
      "Нет. Он читает содержимое файлов в ограниченном снимке: 64 МиБ всего, 1 МиБ на файл. Без сети и без вызовов Telegram; поведение проверяет навык тестирования.",
    "faq.q6": "Что не входит в v0.3.1?",
    "faq.a6":
      "MTProto и автоматизация юзерботов. Aurifex работает только с Bot API и не является песочницей: процесс расширения хоста — доверенный код.",
    "faq.q7": "Можно установить из исходников?",
    "faq.a7":
      "Да. Склонируйте репозиторий, выполните pnpm install и pnpm build, затем node dist/cli.js install --host all. Команды по каждому хосту есть в README.",

    "footer.tagline": "Знание, которое нужно агенту для бота в Telegram.",
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
    "meta.title": "Aurifex · 智能体构建 Telegram 机器人所需的知识",
    "meta.description":
      "Aurifex 教会编码智能体先向用户提问，再构建你真正想要的 Telegram 机器人，并用 29 项静态检查给出证明。支持 grammY 与 aiogram、Bot API 10.4。",

    "nav.skip": "跳到正文",
    "nav.home": "Aurifex 首页",
    "nav.language": "语言",
    "nav.what": "功能",
    "nav.how": "工作方式",
    "nav.skills": "技能",
    "nav.security": "安全",
    "nav.cli": "CLI",
    "nav.install": "安装",
    "nav.faq": "常见问题",

    "hero.titleA": "一句请求，",
    "hero.titleB": "换来合适的机器人。",
    "hero.lede":
      "Aurifex 是面向编码智能体的知识插件。它教智能体先向你提问，再构建你真正要求的机器人，并用静态检查给出证明。",
    "hero.cta": "安装 Aurifex",
    "hero.ctaAlt": "了解工作方式",
    "hero.installLabel": "一个安装器，覆盖 macOS、Linux 与 Windows",
    "hero.copy": "复制",
    "hero.copied": "已复制",
    "hero.copyUnix": "复制 macOS 与 Linux 命令",
    "hero.copyWindows": "复制 Windows PowerShell 命令",
    "hero.hosts": "OMP、DeepSeek Harness、Claude Code、MCP",
    "hero.artAlt": "深色的工坊网格上，熔金打造的 Telegram 纸飞机从铁砧上升起，边缘泛着青色冷光",
    "hero.markAlt": "Aurifex 金色字母标记",

    "demo.title": "从提问到通过校验的机器人",
    "demo.lede":
      "智能体先提问，再写代码，最后校验。每条命令都返回稳定的 DomainResult，并支持 --json。",
    "demo.note": "校验失败时 verify 以退出码 1 结束，智能体无法在缺少证据时宣称成功。",
    "demo.replay": "重播会话",

    "features.title": "这个插件到底是什么",
    "features.lede": "知识、三个工具、一项确定性检查。没有生成器，没有模板，也没有隐式写入。",
    "features.knowledge.title": "给的是知识，不是脚手架",
    "features.knowledge.body":
      "十五个技能承载完整流程：需求确认、技术栈选择、功能配方、框架细节、安全、测试、交付。智能体读完后自己写代码。",
    "features.interview.title": "先提问",
    "features.interview.body":
      "智能体在一块里提出三到七个问题，每个都带选项与推荐值。每个回答都对应 BotSpec 字段，你确认之前不会写任何代码。",
    "features.exact.title": "只做你要求的部分",
    "features.exact.body":
      "要行内按钮就只做行内按钮。配方技能一次只做一个纵向切片，智能体不会加上你没要求的场景、支付或 Mini App。",
    "features.verify.title": "要证据，不要口号",
    "features.verify.body":
      "verify 在受控快照内读取文件内容，返回 29 个检查标识。任何失败都以退出码 1 结束，智能体只能去修机器人，不能宣告成功。",
    "features.hosts.title": "3 个工具，4 类宿主",
    "features.hosts.body":
      "OMP、DeepSeek Harness、经 MCP 接入的 Claude Code 与其他 MCP 客户端共享同样三个工具：解析固定版本栈、检查项目、运行门禁。",

    "flow.title": "智能体如何构建机器人",
    "flow.lede": "四个步骤，顺序固定。跳过其中一步，机器人就会长出没人要求的功能。",
    "flow.stepsLabel": "流程",
    "flow.step1": "提问",
    "flow.step1Note": "3–7 个，带默认值",
    "flow.step2": "BotSpec",
    "flow.step2Note": "由你确认",
    "flow.step3": "配方",
    "flow.step3Note": "一次一个纵向切片",
    "flow.step4": "校验",
    "flow.step4Note": "29 项静态检查",
    "flow.outLabel": "结果",
    "flow.nodeBot": "你要求的那个机器人",
    "flow.botNote": "脱离 Aurifex 也能运行",
    "flow.caption": "插件从不写项目。它提供流程与证明，每个文件都归智能体所有。",

    "skills.title": "15 个技能，按需加载",
    "skills.lede":
      "每个技能都是一段简短流程，包含易错点与一手来源。智能体只打开当前任务需要的技能，因此上下文保持精简。",
    "skills.note":
      "从 telegram-bot 开始：它负责分派其他技能并给出硬性规则。只有任务走到那一步时才读 project-layout 与 references 文件。",

    "show.title": "智能体写出的东西",
    "show.lede": "按配方构建的项目，采用规范目录结构，从不导入 Aurifex。",
    "show.featuresLabel": "只有你要求的功能",
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
    "show.note": "telegram-bot-recipes 中的目录规范列出这些路径，并由测试与校验器保持同步。",

    "sec.title": "上线前 29 项检查",
    "sec.lede":
      "门禁检查受控快照中的文本标记，不运行项目代码，也不访问 Telegram；运行时行为由独立测试验证。",
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

    "cli.title": "4 条命令，一种结果结构",
    "cli.lede": "默认输出人类可读摘要，加 --json 输出 DomainResult。",
    "cli.target": "解析某个技术栈固定的框架、运行时与 Bot API 基线。",
    "cli.inspect": "识别项目的技术栈、运行模式与存储，不写入任何文件。",
    "cli.verify": "运行静态文件内容门禁，并按检查标识返回证据。",
    "cli.install": "一次交互安装到 OMP、DSH 与 Claude Code。",
    "cli.note": "退出码：0 表示成功，1 表示领域错误，2 表示用法错误。",

    "install.title": "安装一次，覆盖所有宿主",
    "install.lede": "v0.3.1 从仓库安装。安装器会询问要装到哪些宿主、哪个范围，然后自行结束。",
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
    "install.mcp.body": "其他 MCP 客户端连接构建好的 stdio 服务器，拿到同样三个工具。",
    "install.rootNote": "AURIFEX_ROOT 限制所有读取与写入，默认取工作目录。",

    "faq.title": "安装之前",
    "faq.q1": "Aurifex 到底提供什么？",
    "faq.a1":
      "十五个技能、三个 MCP 工具、四条 CLI 命令，以及一个静态校验器。没有项目生成器，也没有模板。",
    "faq.q2": "还有项目生成器吗？",
    "faq.a2": "没有了。0.3 版本已删除。机器人由智能体按配方技能编写，插件只校验结果。",
    "faq.q3": "智能体会在写代码前提问吗？",
    "faq.a3":
      "会。需求确认会给出三到七个带推荐值的问题，每个回答都对应 BotSpec 字段，规格确认之前不会构建任何东西。",
    "faq.q4": "支持哪个版本的 Bot API？",
    "faq.a4":
      "10.4，通过带类型的 raw 适配器。grammY 1.46 与 aiogram 3.31 的声明只到 10.3，所以知识内容从不声称原生支持 10.4 类型。",
    "faq.q5": "verify 会运行我的机器人吗？",
    "faq.a5":
      "不会。它在受控快照内读取文件内容：总计 64 MiB，单文件 1 MiB。不联网，也不调用 Telegram；运行时行为属于测试技能的范围。",
    "faq.q6": "v0.3.1 不覆盖什么？",
    "faq.a6":
      "MTProto 与 userbot 自动化。Aurifex 只面向 Bot API，而且它不是沙箱：宿主扩展进程属于可信代码。",
    "faq.q7": "可以从源码检出安装吗？",
    "faq.a7":
      "可以。克隆仓库，运行 pnpm install 与 pnpm build，再执行 node dist/cli.js install --host all。每个宿主的单独命令写在 README 中。",

    "footer.tagline": "智能体构建 Telegram 机器人所需的知识。",
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
