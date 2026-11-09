import { expect, test } from "bun:test";
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
