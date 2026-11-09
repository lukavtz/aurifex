from __future__ import annotations

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
