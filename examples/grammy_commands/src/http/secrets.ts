import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

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
    `warning: secret file for ${name} is readable by group or others (mode ${(mode & 0o777).toString(8)})`,
  );
}

export function readSecret(name: string, env: Env = process.env): string | undefined {
  const filePath = env[`${name}_FILE`];
  if (filePath !== undefined && filePath !== "") {
    let fd: number;
    try {
      const noFollow = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
      fd = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK | noFollow);
    } catch {
      throw new Error(`cannot read secret file for ${name}: ${filePath}`);
    }
    try {
      const info = fstatSync(fd);
      if (!info.isFile()) {
        throw new Error(`secret file for ${name} is not a regular file`);
      }
      if (info.size > MAX_SECRET_BYTES) {
        throw new Error(`secret file for ${name} is too large`);
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
        throw new Error(`secret file for ${name} is too large`);
      }
      const value = buffer
        .subarray(0, bytes)
        .toString("utf8")
        .replace(/\r?\n$/, "");
      if (value === "") {
        throw new Error(`secret file for ${name} is empty`);
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
    throw new Error(`missing required configuration: ${name}`);
  }
  return value;
}

export function requireSecrets(names: readonly string[], env: Env = process.env): void {
  const missing = names.filter((name) => readSecret(name, env) === undefined);
  if (missing.length > 0) {
    throw new Error(`missing required configuration: ${missing.join(", ")}`);
  }
}
