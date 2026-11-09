import en from "./en.js";
import ru from "./ru.js";
import zh from "./zh.js";

export type Locale = "en" | "ru" | "zh";

export const DEFAULT_LOCALE: Locale = "en";
export const ENABLED_LOCALES: readonly Locale[] = ["en"];

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
