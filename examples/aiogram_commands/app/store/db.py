from __future__ import annotations

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

SessionFactory = async_sessionmaker[AsyncSession]


def normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        return "postgresql+asyncpg://" + database_url[len("postgres://") :]
    if database_url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + database_url[len("postgresql://") :]
    return database_url


def create_engine(database_url: str) -> AsyncEngine | None:
    if not database_url:
        return None
    return create_async_engine(normalize_database_url(database_url), pool_pre_ping=True)


def create_session_factory(database_url: str) -> SessionFactory | None:
    engine = create_engine(database_url)
    if engine is None:
        return None
    return async_sessionmaker(engine, expire_on_commit=False)
