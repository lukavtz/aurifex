from __future__ import annotations

import json

import pytest

from app.config import load_settings
from app.runtime.secrets import read_secret, require_secrets

VALID_TOKEN = "123456:" + "A" * 30
REQUIRED = ["BOT_TOKEN","WEBHOOK_SECRET"]


def secret_file(tmp_path, name: str, value: str):
    path = tmp_path / name
    path.write_text(value + "\n", encoding="utf-8")
    path.chmod(0o600)
    return path


def file_env(tmp_path):
    return {
        "BOT_TOKEN_FILE": str(secret_file(tmp_path, "bot_token", VALID_TOKEN)),
        "WEBHOOK_SECRET_FILE": str(secret_file(tmp_path, "webhook_secret", "webhook_secret_value")),
        "DATABASE_URL_FILE": str(
            secret_file(tmp_path, "database_url", "postgres://user:pass@postgres:5432/bot")
        ),
        "REDIS_URL_FILE": str(secret_file(tmp_path, "redis_url", "redis://redis:6379/0")),
        "LLM_API_KEY_FILE": str(secret_file(tmp_path, "llm_api_key", "sk-test")),
    }


def test_file_wins_over_plain_value(tmp_path) -> None:
    token_file = secret_file(tmp_path, "token", VALID_TOKEN)
    env = {"BOT_TOKEN": "wrong", "BOT_TOKEN_FILE": str(token_file)}
    assert read_secret("BOT_TOKEN", env) == VALID_TOKEN


def test_settings_resolve_files_before_validation(tmp_path) -> None:
    env = file_env(tmp_path)
    settings = load_settings(env)
    assert settings.bot_token == VALID_TOKEN
    assert settings.llm_api_key == "sk-test"
    serialized = json.dumps(settings.model_dump(mode="json"))
    assert str(tmp_path) not in serialized


def test_missing_configuration_lists_names_only() -> None:
    with pytest.raises(RuntimeError) as excinfo:
        load_settings({})
    assert str(excinfo.value) == "missing required configuration: " + ", ".join(REQUIRED)


def test_require_secrets_reports_every_missing_name() -> None:
    with pytest.raises(RuntimeError) as excinfo:
        require_secrets(["DATABASE_URL", "REDIS_URL"], {})
    message = str(excinfo.value)
    assert message == "missing required configuration: DATABASE_URL, REDIS_URL"
    assert "://" not in message
