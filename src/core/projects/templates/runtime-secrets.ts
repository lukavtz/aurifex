// Generated secret loader. `NAME_FILE` wins over `NAME` so Docker secrets and
// Kubernetes-style file mounts work without extra configuration.
export function renderSecretsTs(): string {
  return `import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

type Env = NodeJS.ProcessEnv;

const MAX_SECRET_BYTES = 65_536;
const warned = new Set<string>();

function warnFileMode(name: string, mode: number, env: Env): void {
  if (process.platform === "win32" || env.NODE_ENV === "test") {
    return;
  }
  if ((mode & 0o077) === 0 || warned.has(name)) {
    return;
  }
  warned.add(name);
  console.warn(
    \`warning: secret file for \${name} is readable by group or others (mode \${(mode & 0o777).toString(8)})\`,
  );
}

export function readSecret(name: string, env: Env = process.env): string | undefined {
  const filePath = env[\`\${name}_FILE\`];
  if (filePath !== undefined && filePath !== "") {
    let fd: number;
    try {
      const noFollow = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
      fd = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK | noFollow);
    } catch {
      throw new Error(\`cannot read secret file for \${name}: \${filePath}\`);
    }
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) {
        throw new Error(\`secret file for \${name} is not a regular file\`);
      }
      if (info.size > MAX_SECRET_BYTES) {
        throw new Error(\`secret file for \${name} is too large\`);
      }
      warnFileMode(name, info.mode, env);
      const buffer = Buffer.alloc(MAX_SECRET_BYTES + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const chunk = readSync(fd, buffer, bytes, buffer.length - bytes, null);
        if (chunk === 0) break;
        bytes += chunk;
      }
      if (bytes > MAX_SECRET_BYTES) {
        throw new Error(\`secret file for \${name} is too large\`);
      }
      const value = buffer.subarray(0, bytes).toString("utf8").replace(/\\r?\\n$/, "");
      if (value === "") {
        throw new Error(\`secret file for \${name} is empty\`);
      }
      return value;
    } finally {
      closeSync(fd);
    }
  }
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

export function requiredSecret(name: string, env: Env = process.env): string {
  const value = readSecret(name, env);
  if (value === undefined) {
    throw new Error(\`missing required configuration: \${name}\`);
  }
  return value;
}

export function requireSecrets(names: readonly string[], env: Env = process.env): void {
  const missing = names.filter((name) => readSecret(name, env) === undefined);
  if (missing.length > 0) {
    throw new Error(\`missing required configuration: \${missing.join(", ")}\`);
  }
}
`;
}

// Generated Python equivalent. Uses pathlib/stat so it works on POSIX hosts
// and Windows without platform branching beyond the mode advisory.
export function renderSecretsPy(): string {
  return `from __future__ import annotations

import os
import stat
import sys
from typing import Mapping

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
        value = raw[:-1] if raw.endswith("\\n") else raw
        value = value[:-1] if value.endswith("\\r") else value
        if not value:
            raise RuntimeError(f"secret file for {name} is empty")
        return value
    value = env.get(name)
    if not value:
        return None
    return value


def required_secret(name: str, env: Mapping[str, str] | None = None) -> str:
    value = read_secret(name, env)
    if value is None:
        raise RuntimeError(f"missing required configuration: {name}")
    return value


def require_secrets(names: list[str], env: Mapping[str, str] | None = None) -> None:
    missing = [name for name in names if read_secret(name, env) is None]
    if missing:
        raise RuntimeError(f"missing required configuration: {', '.join(missing)}")
`;
}