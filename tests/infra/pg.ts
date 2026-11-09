// Container-backed test helpers: Docker CLI only, no testcontainers.
//
// Every helper is opt-in: tests pass `{ skip }` unless the matching AURIFEX_*
// gate is set, so the default unit and integration suites never start Docker.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer, connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const DOCKER_SKIP = "AURIFEX_DOCKER=1 not set; skipping Docker image test";
export const INFRA_SKIP = "AURIFEX_INFRA=1 not set; skipping container-backed infra test";
export const LOAD_SKIP = "AURIFEX_LOAD=1 not set; skipping load test";

export const POSTGRES_IMAGE = "postgres:18-alpine";
export const REDIS_IMAGE = "redis:8-alpine";

const COMMAND_TIMEOUT_MS = 120_000;
const READY_TIMEOUT_MS = 90_000;

export interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function run(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
    stdin?: string;
  } = {},
): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {
    // The child may exit before the whole script is piped; the exit code wins.
  });
  child.stdin.end(options.stdin ?? "");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    reject(
      new Error(
        `${command} ${args.join(" ")} timed out after ${options.timeoutMs ?? COMMAND_TIMEOUT_MS}ms`,
      ),
    );
  }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("close", (code) => {
    clearTimeout(timer);
    resolve({ code, stdout, stderr });
  });
  return promise;
}

async function docker(args: readonly string[]): Promise<string> {
  const result = await run("docker", args);
  if (result.code !== 0) {
    throw new Error(`docker ${args.join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    await docker(["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

export interface Container {
  readonly name: string;
  readonly port: number;
  stop(): Promise<void>;
}

interface StartOptions {
  readonly image: string;
  readonly containerPort: number;
  readonly env?: readonly string[];
}

export async function freePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    server.close(() => resolve(port));
  });
  return promise;
}

async function startContainer(label: string, options: StartOptions): Promise<Container> {
  const name = `aurifex-${label}-${process.pid}-${Date.now().toString(36)}`;
  const hostPort = await freePort();
  const envArgs = (options.env ?? []).flatMap((entry) => ["-e", entry]);
  try {
    await docker([
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "-p",
      `127.0.0.1:${hostPort}:${options.containerPort}`,
      ...envArgs,
      options.image,
    ]);
  } catch (error) {
    throw new Error(
      `cannot start ${options.image}; Docker is required when this test is enabled: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  return {
    name,
    port: hostPort,
    async stop() {
      await run("docker", ["rm", "-f", name]);
    },
  };
}

async function waitFor(
  label: string,
  check: () => Promise<boolean>,
  { attempts = 180, intervalMs = 500, consecutive = 2 } = {},
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let streak = 0;
  while (Date.now() < deadline && attempts > 0) {
    attempts -= 1;
    try {
      if (await check()) {
        streak += 1;
        if (streak >= consecutive) return;
      } else {
        streak = 0;
      }
    } catch {
      streak = 0;
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, intervalMs);
    await promise;
  }
  throw new Error(`${label} did not become ready within ${READY_TIMEOUT_MS}ms`);
}

export interface Postgres extends Container {
  /** Runs one statement and returns its rows. */
  unsafe(query: string, params?: readonly unknown[]): Promise<SqlRows>;
  /** Runs a multi-statement script (migrations). */
  exec(sql: string): Promise<void>;
}

export type SqlRows = Array<Record<string, unknown>> & { readonly count: number };

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`non-finite SQL parameter: ${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}

function bind(query: string, params: readonly unknown[]): string {
  return query.replaceAll(/\$(\d+)/g, (match, index: string) => {
    const position = Number(index) - 1;
    if (position < 0 || position >= params.length) {
      throw new Error(`missing SQL parameter ${match}`);
    }
    return literal(params[position]);
  });
}

function stripStatement(query: string): string {
  const trimmed = query.trim().replace(/;+$/, "");
  if (trimmed.includes(";")) {
    throw new Error("unsafe() accepts a single statement; use exec() for scripts");
  }
  return trimmed;
}

async function psql(container: string, sql: string, quiet = true): Promise<string> {
  const result = await run("docker", [
    "exec",
    "-i",
    container,
    "psql",
    "-X",
    ...(quiet ? ["-q"] : []),
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    sql,
  ]);
  if (result.code !== 0) {
    throw new Error(
      `psql failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout;
}

export async function startPostgres(): Promise<Postgres> {
  const container = await startContainer("pg", {
    image: POSTGRES_IMAGE,
    containerPort: 5432,
    env: ["POSTGRES_PASSWORD=aurifex_test", "POSTGRES_USER=postgres", "POSTGRES_DB=postgres"],
  });
  const query = async (sql: string, quiet = true): Promise<string> =>
    psql(container.name, sql, quiet);

  try {
    // The entrypoint starts a temporary server for initdb. Wait for it to log
    // completion before probing, otherwise the temporary server answers first.
    await waitFor("postgres init", async () => {
      const logs = await run("docker", ["logs", container.name]);
      return logs.stdout.includes("PostgreSQL init process complete");
    });
    await waitFor("postgres", async () => (await query("SELECT 1")).trim() === "1");
  } catch (error) {
    await container.stop();
    throw error;
  }

  const postgres: Postgres = {
    name: container.name,
    port: container.port,
    async stop() {
      await container.stop();
    },
    async exec(sql: string) {
      const result = await run(
        "docker",
        [
          "exec",
          "-i",
          container.name,
          "psql",
          "-X",
          "-q",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
        ],
        { timeoutMs: COMMAND_TIMEOUT_MS, stdin: sql },
      );
      if (result.code !== 0) {
        throw new Error(`psql failed (${result.code}): ${result.stderr.trim()}`);
      }
    },
    async unsafe(source: string, params: readonly unknown[] = []) {
      const statement = bind(stripStatement(source), params);
      // Data-modifying statements can only be read through a CTE when they
      // RETURN rows. Plain UPDATE/DELETE run directly; their command tag gives
      // the affected count, matching postgres.js `result.count`.
      const wrapped =
        /\bRETURNING\b/i.test(statement) || /^(select|values|show|explain)\b/i.test(statement);
      if (!wrapped) {
        const tag = (await query(statement, false)).trim().split("\n").at(-1) ?? "";
        const match = /^(?:INSERT(?: \d+)?|UPDATE|DELETE|COPY) (\d+)$/.exec(tag);
        return Object.assign([], { count: Number(match?.[1] ?? 0) }) as SqlRows;
      }
      const output = await query(
        `WITH __aurifex_q AS (${statement}) SELECT coalesce(json_agg(__aurifex_q), '[]'::json) FROM __aurifex_q`,
      );
      const text = output.trim();
      const parsed: unknown = text === "" ? [] : JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error(`unexpected psql output: ${text}`);
      const rows = parsed as Array<Record<string, unknown>>;
      return Object.assign(rows, { count: rows.length }) as SqlRows;
    },
  };
  return postgres;
}

/** Fake postgres.js handle used by rendered runtime modules. */
export function createSql(postgres: Postgres): {
  unsafe(query: string, params?: readonly unknown[]): Promise<SqlRows>;
  begin<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
} {
  return {
    unsafe: (query, params = []) => postgres.unsafe(query, params),
    // ponytail: no real transaction; tests assert final state. Add a persistent
    // session (pg.Client) if a test ever needs rollback semantics.
    begin: (fn) => fn(createSql(postgres)),
  };
}

// --- Redis over RESP ---------------------------------------------------------

type Reply = string | number | null | Reply[];

function encodeCommand(args: readonly string[]): Buffer {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) parts.push(`$${Buffer.byteLength(arg)}\r\n${arg}\r\n`);
  return Buffer.from(parts.join(""), "utf8");
}

function parseReply(buffer: Buffer, offset: number): { value: Reply; next: number } | null {
  const lineEnd = buffer.indexOf("\r\n", offset);
  if (lineEnd === -1) return null;
  const marker = String.fromCharCode(buffer[offset] ?? 0);
  const line = buffer.subarray(offset + 1, lineEnd).toString("utf8");
  const next = lineEnd + 2;
  if (marker === "+") return { value: line, next };
  if (marker === "-") throw new Error(`redis error: ${line}`);
  if (marker === ":") return { value: Number(line), next };
  if (marker === "$") {
    const length = Number(line);
    if (length === -1) return { value: null, next };
    if (buffer.length < next + length + 2) return null;
    return {
      value: buffer.subarray(next, next + length).toString("utf8"),
      next: next + length + 2,
    };
  }
  if (marker === "*") {
    const count = Number(line);
    if (count === -1) return { value: null, next };
    const items: Reply[] = [];
    let cursor = next;
    for (let index = 0; index < count; index += 1) {
      const item = parseReply(buffer, cursor);
      if (item === null) return null;
      items.push(item.value);
      cursor = item.next;
    }
    return { value: items, next: cursor };
  }
  throw new Error(`unexpected redis reply: ${marker}`);
}

class RespClient {
  private readonly socket: Socket;
  private buffer: Buffer = Buffer.alloc(0);
  private pending: Array<{ resolve: (value: Reply) => void; reject: (error: Error) => void }> = [];
  private ready: Promise<void>;

  constructor(port: number) {
    this.socket = connect({ host: "127.0.0.1", port });
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.ready = promise;
    this.socket.once("connect", () => resolve());
    this.socket.once("error", reject);
    this.socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    void this.ready;
  }

  private drain(): void {
    for (;;) {
      if (this.pending.length === 0) return;
      let parsed: { value: Reply; next: number } | null;
      try {
        parsed = parseReply(this.buffer, 0);
      } catch (error) {
        const pending = this.pending.shift();
        pending?.reject(error instanceof Error ? error : new Error(String(error)));
        this.buffer = Buffer.alloc(0);
        continue;
      }
      if (parsed === null) return;
      this.buffer = this.buffer.subarray(parsed.next);
      const pending = this.pending.shift();
      pending?.resolve(parsed.value);
    }
  }

  async command(...args: string[]): Promise<Reply> {
    await this.ready;
    const { promise, resolve, reject } = Promise.withResolvers<Reply>();
    this.pending.push({ resolve, reject });
    this.socket.write(encodeCommand(args));
    return promise;
  }

  close(): void {
    this.socket.destroy();
  }
}

export interface Redis extends Container {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  ttl(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  ping(): Promise<string>;
  check(): Promise<void>;
}

export async function startRedis(): Promise<Redis> {
  const container = await startContainer("redis", {
    image: REDIS_IMAGE,
    containerPort: 6379,
  });
  const client = new RespClient(container.port);
  const ping = async (): Promise<string> => {
    const reply = await client.command("PING");
    return typeof reply === "string" ? reply : String(reply);
  };
  try {
    await waitFor("redis", async () => (await ping()) === "PONG");
  } catch (error) {
    client.close();
    await container.stop();
    throw error;
  }
  return {
    name: container.name,
    port: container.port,
    async check() {
      await ping();
    },
    async stop() {
      client.close();
      await container.stop();
    },
    async incr(key) {
      const reply = await client.command("INCR", key);
      return Number(reply);
    },
    async expire(key, seconds) {
      const reply = await client.command("EXPIRE", key, String(seconds));
      return Number(reply);
    },
    async get(key) {
      const reply = await client.command("GET", key);
      return typeof reply === "string" ? reply : null;
    },
    async ttl(key) {
      const reply = await client.command("TTL", key);
      return Number(reply);
    },
    async keys(pattern) {
      const reply = await client.command("KEYS", pattern);
      return Array.isArray(reply) ? reply.map((item) => String(item)) : [];
    },
    async ping() {
      return ping();
    },
  };
}

/** Minimal ioredis surface used by the rendered broadcast job. */
export interface RateLimiterRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export function createRedisFacade(redis: Redis): RateLimiterRedis {
  return {
    incr: (key: string) => redis.incr(key),
    expire: (key: string, seconds: number) => redis.expire(key, seconds),
  };
}

// --- Module sandboxes --------------------------------------------------------

export interface Sandbox {
  readonly dir: string;
  write(path: string, content: string): Promise<string>;
  import(path: string): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
}

/**
 * Materializes generated `.ts` sources plus stub packages and imports them with
 * the running Node strip-types loader. Generated modules only import type-only
 * dependencies at runtime, except for the explicitly stubbed ones.
 */
export async function createSandbox(
  files: Readonly<Record<string, string>>,
  stubs: Readonly<Record<string, string>> = {},
): Promise<Sandbox> {
  const dir = await mkdtemp(join(tmpdir(), "aurifex-sandbox-"));
  await writeFile(join(dir, "package.json"), '{"type":"module","private":true}\n');
  const write = async (path: string, content: string): Promise<string> => {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    return target;
  };
  for (const [name, source] of Object.entries(stubs)) {
    await write(
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, type: "module", main: "index.js" }),
    );
    await write(`node_modules/${name}/index.js`, source);
  }
  for (const [path, content] of Object.entries(files)) await write(path, content);
  let generation = 0;
  return {
    dir,
    write,
    async import(path) {
      generation += 1;
      const url = `${pathToFileURL(join(dir, path)).href}?v=${generation}`;
      return (await import(url)) as Record<string, unknown>;
    },
    async dispose() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// --- HTTP helpers ------------------------------------------------------------

export interface CapturedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** Minimal ServerResponse capturing writeHead/end. */
export function captureResponse(): { res: unknown; done: Promise<CapturedResponse> } {
  const { promise, resolve } = Promise.withResolvers<CapturedResponse>();
  let status = 200;
  let headers: Record<string, string> = {};
  const res = {
    writeHead(nextStatus: number, nextHeaders: Record<string, string> = {}) {
      status = nextStatus;
      headers = nextHeaders;
      return res;
    },
    end(body?: string) {
      resolve({ status, headers, body: body ?? "" });
      return res;
    },
  };
  return { res, done: promise };
}

export async function waitForHttp(url: string, timeoutMs = 30_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      await response.text();
      if (response.status === 200) return response.status;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 250);
    await promise;
  }
  throw new Error(`${url} did not return 200 within ${timeoutMs}ms (${lastError})`);
}
