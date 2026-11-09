from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_LOCALE = "en"
ENABLED_LOCALES = ["en"]
LOCALES = ["en","ru","zh"]
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
