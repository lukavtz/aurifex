import type { BotSpec } from "../../spec/bot-spec.ts";
import type { TemplateFile } from "./shared.ts";

export type GeneratedLocale = "en" | "ru" | "zh";

const GENERATED_LOCALES: readonly GeneratedLocale[] = ["en", "ru", "zh"];

type Catalog = Readonly<Record<string, string>>;

const CATALOGS: Readonly<Record<GeneratedLocale, Catalog>> = {
  en: {
    "start.welcome": "Welcome to {bot}. Use /help to see available commands.",
    "help.title": "Commands:",
    "help.commands": "/start - start the bot\n/help - show this list\n/admin - admin area",
    "errors.generic": "Something went wrong. Please try again.",
    "payments.precheckout_failed": "Payment could not be confirmed.",
    "payments.thanks": "Thanks for your payment!",
    "subscription.active": "Subscription active.",
    "subscription.canceled": "Subscription canceled.",
  },
  ru: {
    "start.welcome": "Добро пожаловать в {bot}. Используйте /help, чтобы увидеть команды.",
    "help.title": "Команды:",
    "help.commands": "/start - запустить бота\n/help - показать список\n/admin - админ-панель",
    "errors.generic": "Что-то пошло не так. Попробуйте ещё раз.",
    "payments.precheckout_failed": "Платёж не удалось подтвердить.",
    "payments.thanks": "Спасибо за оплату!",
    "subscription.active": "Подписка активна.",
    "subscription.canceled": "Подписка отменена.",
  },
  zh: {
    "start.welcome": "欢迎使用 {bot}。使用 /help 查看可用命令。",
    "help.title": "命令：",
    "help.commands": "/start - 启动机器人\n/help - 显示此列表\n/admin - 管理面板",
    "errors.generic": "出错了，请重试。",
    "payments.precheckout_failed": "无法确认付款。",
    "payments.thanks": "感谢您的付款！",
    "subscription.active": "订阅已激活。",
    "subscription.canceled": "订阅已取消。",
  },
};

function enabledLocales(spec: BotSpec): GeneratedLocale[] {
  const flags = spec.i18n as {
    readonly en: boolean;
    readonly ru: boolean;
    readonly zh?: boolean;
  };
  return GENERATED_LOCALES.filter((locale) => flags[locale] === true);
}

function renderTsCatalog(locale: GeneratedLocale): string {
  const catalog = CATALOGS[locale];
  const entries = Object.entries(catalog)
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
    .join("\n");
  return `const ${locale}: Record<string, string> = {
${entries}
};

export default ${locale};
`;
}

function renderTsIndex(defaultLocale: GeneratedLocale, enabled: readonly GeneratedLocale[]): string {
  return `import en from "./en.js";
import ru from "./ru.js";
import zh from "./zh.js";

export type Locale = "en" | "ru" | "zh";

export const DEFAULT_LOCALE: Locale = ${JSON.stringify(defaultLocale)};
export const ENABLED_LOCALES: readonly Locale[] = ${JSON.stringify(enabled)};

const CATALOGS: Record<Locale, Readonly<Record<string, string>>> = { en, ru, zh };
const WARNED = new Set<string>();

function isLocale(value: string): value is Locale {
  return value === "en" || value === "ru" || value === "zh";
}

export function resolveLocale(locale: string | undefined): Locale {
  if (locale !== undefined) {
    const base = locale.toLowerCase().split("-")[0] ?? "";
    if (isLocale(base) && ENABLED_LOCALES.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export function t(
  locale: string | undefined,
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = CATALOGS[resolveLocale(locale)][key];
  if (template === undefined) {
    if (!WARNED.has(key)) {
      WARNED.add(key);
      console.warn("missing i18n key: " + key);
    }
    return key;
  }
  let text = template;
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split("{" + name + "}").join(String(value));
    }
  }
  return text;
}
`;
}

function renderPythonModule(
  defaultLocale: GeneratedLocale,
  enabled: readonly GeneratedLocale[],
): string {
  return `from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_LOCALE = ${JSON.stringify(defaultLocale)}
ENABLED_LOCALES = ${JSON.stringify(enabled)}
LOCALES = ${JSON.stringify(GENERATED_LOCALES)}
_CATALOGS: dict[str, dict[str, str]] = {}
_WARNED: set[str] = set()


def _catalog(locale: str) -> dict[str, str]:
    cached = _CATALOGS.get(locale)
    if cached is None:
        path = Path(__file__).resolve().parent.parent / "i18n" / (locale + ".json")
        cached = json.loads(path.read_text(encoding="utf-8"))
        _CATALOGS[locale] = cached
    return cached


def resolve_locale(locale: str | None) -> str:
    if locale:
        base = locale.lower().split("-", 1)[0]
        if base in ENABLED_LOCALES:
            return base
    return DEFAULT_LOCALE


def t(locale: str | None, key: str, **params: Any) -> str:
    template = _catalog(resolve_locale(locale)).get(key)
    if template is None:
        if key not in _WARNED:
            _WARNED.add(key)
            logger.warning("missing i18n key: %s", key)
        return key
    for name, value in params.items():
        template = template.replace("{" + name + "}", str(value))
    return template
`;
}

function renderTsTest(): string {
  return `import { expect, test } from "bun:test";
import { DEFAULT_LOCALE, t } from "../src/i18n/index.js";

test("renders every locale", () => {
  for (const locale of ["en", "ru", "zh"]) {
    expect(t(locale, "start.welcome", { bot: "Demo" })).toContain("Demo");
  }
});

test("falls back to the default locale for missing languages", () => {
  expect(t("de", "start.welcome", { bot: "Demo" })).toBe(
    t(DEFAULT_LOCALE, "start.welcome", { bot: "Demo" }),
  );
});

test("returns unknown keys unchanged", () => {
  expect(t("en", "missing.key")).toBe("missing.key");
});
`;
}

function renderPyTest(): string {
  return `from __future__ import annotations

from app.services.i18n import DEFAULT_LOCALE, t


def test_renders_every_locale() -> None:
    for locale in ("en", "ru", "zh"):
        assert "Demo" in t(locale, "start.welcome", bot="Demo")


def test_missing_language_falls_back_to_default() -> None:
    assert t("de", "start.welcome", bot="Demo") == t(
        DEFAULT_LOCALE, "start.welcome", bot="Demo"
    )


def test_unknown_key_returns_key() -> None:
    assert t("en", "missing.key") == "missing.key"
`;
}

export function renderI18nFiles(spec: BotSpec): TemplateFile[] {
  const defaultLocale = spec.i18n.defaultLocale as GeneratedLocale;
  const enabled = enabledLocales(spec);
  const files: TemplateFile[] = [];
  for (const locale of GENERATED_LOCALES) {
    files.push({ path: `src/i18n/${locale}.ts`, content: renderTsCatalog(locale) });
  }
  files.push({ path: "src/i18n/index.ts", content: renderTsIndex(defaultLocale, enabled) });
  for (const locale of GENERATED_LOCALES) {
    files.push({
      path: `app/i18n/${locale}.json`,
      content: JSON.stringify(CATALOGS[locale], null, 2) + "\n",
    });
  }
  files.push({ path: "app/services/i18n.py", content: renderPythonModule(defaultLocale, enabled) });
  files.push(
    spec.stack === "grammy"
      ? { path: "tests/i18n.test.ts", content: renderTsTest() }
      : { path: "tests/test_i18n.py", content: renderPyTest() },
  );
  return files;
}