from __future__ import annotations

import os
import re
from collections.abc import Mapping
from functools import lru_cache
from typing import Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.runtime.secrets import read_secret, require_secrets

TOKEN_PATTERN = re.compile(r"^\d{6,}:[A-Za-z0-9_-]{30,}$")
SECRET_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,256}$")
HTTPS_URL_PATTERN = re.compile(r"^https://\S+$")

FILE_BACKED_SECRETS = (
    "BOT_TOKEN",
    "WEBHOOK_SECRET",
    "DATABASE_URL",
    "REDIS_URL",
    "LLM_API_KEY",
)

REQUIRED_SECRETS = (
    "BOT_TOKEN",
    "WEBHOOK_SECRET",
)

# aurifex:config
# aurifex:config-end


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    bot_token: str
    webhook_secret: str = ""
    webhook_url: str = ""
    bot_mode: Literal["webhook", "polling"] = "polling"
    port: int = Field(default=8080, ge=1, le=65535)
    admin_ids: str = ""
    database_url: str = ""
    redis_url: str = ""
    llm_base_url: str = ""
    llm_model: str = ""
    llm_api_key: str = ""
    queue_poll_ms: int = Field(default=500, ge=1)
    queue_batch: int = Field(default=10, ge=1, le=100)
    queue_max_attempts: int = Field(default=5, ge=1)
    queue_visibility_timeout_seconds: int = Field(default=60, ge=1)
    worker_id: str = ""
    miniapp_session_ttl_seconds: int = Field(default=86400, ge=300, le=2592000)
    miniapp_allowed_origins: str = ""
    otel_exporter_otlp_endpoint: str = ""
    otel_service_name: str = ""
    sentry_dsn: str = ""
    metrics_enabled: bool = True
    log_level: str = "info"

    @field_validator("bot_token")
    @classmethod
    def _validate_bot_token(cls, value: str) -> str:
        if not TOKEN_PATTERN.match(value):
            raise ValueError("BOT_TOKEN must look like <bot id>:<token>")
        return value

    @field_validator("webhook_secret")
    @classmethod
    def _validate_webhook_secret(cls, value: str) -> str:
        if value and not SECRET_PATTERN.match(value):
            raise ValueError(
                "WEBHOOK_SECRET must be 1-256 characters of A-Z, a-z, 0-9, _ or -"
            )
        return value

    @field_validator("webhook_url")
    @classmethod
    def _validate_webhook_url(cls, value: str) -> str:
        if value and not HTTPS_URL_PATTERN.match(value):
            raise ValueError("WEBHOOK_URL must be an https:// URL or empty")
        return value

    @property
    def admin_id_set(self) -> frozenset[int]:
        return frozenset(
            int(part) for part in self.admin_ids.split(",") if part.strip().isdigit()
        )


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env
    require_secrets(list(REQUIRED_SECRETS), source)
    resolved: dict[str, Any] = {}
    for key, value in source.items():
        field = key.lower()
        if field in Settings.model_fields:
            resolved[field] = value
    for name in FILE_BACKED_SECRETS:
        secret_value = read_secret(name, source)
        if secret_value is not None:
            resolved[name.lower()] = secret_value
    return Settings(**resolved)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()
