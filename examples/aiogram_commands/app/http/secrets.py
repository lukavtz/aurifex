from __future__ import annotations

import os
import stat
import sys
from collections.abc import Mapping

MAX_SECRET_BYTES = 65_536
_WARNED: set[str] = set()


def _warn_file_mode(name: str, mode: int, env: Mapping[str, str]) -> None:
    if os.name != "posix" or "PYTEST_CURRENT_TEST" in env:
        return
    if not mode & 0o077 or name in _WARNED:
        return
    _WARNED.add(name)
    print(
        f"warning: secret file for {name} is readable by group or others (mode {stat.S_IMODE(mode):o})",
        file=sys.stderr,
    )


def read_secret(name: str, env: Mapping[str, str] | None = None) -> str | None:
    if env is None:
        env = os.environ
    file_path = env.get(f"{name}_FILE")
    if file_path:
        flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            fd = os.open(file_path, flags)
        except OSError as error:
            raise RuntimeError(f"cannot read secret file for {name}: {file_path}") from error
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise RuntimeError(f"secret file for {name} is not a regular file")
            if info.st_size > MAX_SECRET_BYTES:
                raise RuntimeError(f"secret file for {name} is too large")
            _warn_file_mode(name, info.st_mode, env)
            chunks: list[bytes] = []
            size = 0
            while size <= MAX_SECRET_BYTES:
                chunk = os.read(fd, MAX_SECRET_BYTES + 1 - size)
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
            if size > MAX_SECRET_BYTES:
                raise RuntimeError(f"secret file for {name} is too large")
            raw = b"".join(chunks).decode("utf-8")
        finally:
            os.close(fd)
        value = raw[:-1] if raw.endswith("\n") else raw
        value = value[:-1] if value.endswith("\r") else value
        if not value:
            raise RuntimeError(f"secret file for {name} is empty")
        return value
    env_value = env.get(name)
    if not env_value:
        return None
    return env_value


def required_secret(name: str, env: Mapping[str, str] | None = None) -> str:
    value = read_secret(name, env)
    if value is None:
        raise RuntimeError(f"missing required configuration: {name}")
    return value


def require_secrets(names: list[str], env: Mapping[str, str] | None = None) -> None:
    missing = [name for name in names if read_secret(name, env) is None]
    if missing:
        raise RuntimeError(f"missing required configuration: {', '.join(missing)}")
