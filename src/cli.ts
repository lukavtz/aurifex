#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { ReadStream } from "node:tty";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createCoreOperations, type CoreOperations } from "./core/operations.ts";
import {
  domainFailure,
  domainSuccess,
  serializeDomainResult,
  type DomainResult,
} from "./core/results.ts";
import { redactSecrets } from "./core/security/secrets.ts";
import { assertFeature, type BotFeature } from "./core/spec/bot-spec.ts";
import { isBotStack } from "./core/targets/catalog.ts";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");

const USAGE = `Usage:
  aurifex target --stack <grammy|aiogram> [--json]
  aurifex new <destination> --spec <file|-> [--overwrite] [--json]
  aurifex inspect <root> [--json]
  aurifex verify <root> [--json]
  aurifex add <root> --feature <feature> --name <name> [--overwrite] [--json]
  aurifex deploy <root> --domain <domain> [--mode webhook|polling] [--overwrite] [--json]
  aurifex harness <root> [--overwrite] [--json]
  aurifex upgrade <root> [--apply] [--json]
  aurifex upgrade-plan <root> [--json]
  aurifex install [--host omp|dsh|claude|all] [--profile <name>] [--scope user|project]
                  [--source <path>] [--dry-run] [--json] [--yes]

Global options:
  --root <dir>   workspace root (default: current directory)
  --json         machine-readable output`;

const OPTIONS = {
  root: { type: "string" },
  stack: { type: "string" },
  json: { type: "boolean" },
  spec: { type: "string" },
  overwrite: { type: "boolean" },
  apply: { type: "boolean" },
  feature: { type: "string" },
  name: { type: "string" },
  domain: { type: "string" },
  mode: { type: "string" },
  host: { type: "string" },
  profile: { type: "string" },
  scope: { type: "string" },
  "dry-run": { type: "boolean" },
  yes: { type: "boolean" },
  source: { type: "string" },
} as const;

type Command =
  | "target"
  | "new"
  | "inspect"
  | "verify"
  | "add"
  | "deploy"
  | "harness"
  | "upgrade"
  | "upgrade-plan"
  | "install";

type CoreCommand = Exclude<Command, "install">;

const COMMANDS: Readonly<Record<string, Command>> = {
  target: "target",
  new: "new",
  inspect: "inspect",
  verify: "verify",
  add: "add",
  deploy: "deploy",
  harness: "harness",
  upgrade: "upgrade",
  "upgrade-plan": "upgrade-plan",
  install: "install",
};

class UsageError extends Error {}

interface OptionValues {
  readonly root?: string | boolean | undefined;
  readonly stack?: string | boolean | undefined;
  readonly json?: string | boolean | undefined;
  readonly spec?: string | boolean | undefined;
  readonly overwrite?: string | boolean | undefined;
  readonly apply?: string | boolean | undefined;
  readonly feature?: string | boolean | undefined;
  readonly name?: string | boolean | undefined;
  readonly domain?: string | boolean | undefined;
  readonly mode?: string | boolean | undefined;
  readonly host?: string | boolean | undefined;
  readonly profile?: string | boolean | undefined;
  readonly scope?: string | boolean | undefined;
  readonly "dry-run"?: string | boolean | undefined;
  readonly yes?: string | boolean | undefined;
  readonly source?: string | boolean | undefined;
}

interface Parsed {
  readonly command: Command;
  readonly positionals: readonly string[];
  readonly values: OptionValues;
  readonly root: string;
  readonly json: boolean;
}

function parse(argv: readonly string[]): Parsed {
  let positionals: string[];
  let values: OptionValues;
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    positionals = parsed.positionals;
    values = parsed.values as OptionValues;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : "invalid arguments");
  }
  const [name, ...rest] = positionals;
  const command = name === undefined ? undefined : COMMANDS[name];
  if (command === undefined) {
    throw new UsageError(name === undefined ? "missing command" : `unknown command: ${name}`);
  }
  const root = resolve(process.cwd(), stringValue(values.root) ?? ".");
  return { command, positionals: rest, values, root, json: values.json === true };
}

function stringValue(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function required(values: Parsed["values"], key: keyof typeof OPTIONS): string {
  const value = stringValue(values[key]);
  if (value === undefined || value.length === 0) throw new UsageError(`--${key} is required`);
  return value;
}

function featureValue(raw: string): BotFeature {
  try {
    return assertFeature(raw);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : "unknown feature");
  }
}

function projectRoot(parsed: Parsed): string {
  if (parsed.positionals.length !== 1) {
    throw new UsageError(`${parsed.command} requires one project root`);
  }
  return resolve(parsed.root, parsed.positionals[0]!);
}

function insideRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

type InstallHost = "omp" | "dsh" | "claude";
type InstallStatus = "installed" | "planned" | "skipped" | "failed";

interface InstallHostResult {
  readonly host: InstallHost;
  readonly status: InstallStatus;
  readonly command: string;
}

interface InstallResult {
  readonly hosts: readonly InstallHostResult[];
  readonly packageRoot: string;
  readonly source: string;
}

interface Captured {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const INSTALL_HOSTS: readonly InstallHost[] = ["omp", "dsh", "claude"];

const HOST_LABEL: Readonly<Record<InstallHost, string>> = {
  omp: "OMP",
  dsh: "DSH",
  claude: "Claude Code",
};

function installSelection(raw: string | undefined): readonly InstallHost[] {
  if (raw === undefined || raw === "all") return INSTALL_HOSTS;
  const values = raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new UsageError("no install host selected");
  for (const value of values) {
    if (value !== "omp" && value !== "dsh" && value !== "claude") {
      throw new UsageError(`unknown host: ${value}`);
    }
  }
  return INSTALL_HOSTS.filter((host) => values.includes(host));
}

function ttyStream(): ReadStream | null {
  try {
    const path = process.platform === "win32" ? "CONIN$" : "/dev/tty";
    // tty.ReadStream can cancel a blocked read and exposes setRawMode, so
    // readline owns the terminal instead of leaving Ctrl-C to the driver.
    return new ReadStream(openSync(path, "r"));
  } catch {
    return null;
  }
}

export async function ask(rl: Interface, prompt: string): Promise<string> {
  const { promise, resolve: finish, reject } = Promise.withResolvers<string>();
  // A final answer followed by EOF must still install; only an empty cancel is a cancel.
  let answered = false;
  const onLine = (): void => {
    answered = true;
  };
  rl.once("line", onLine);
  const cancel = (): void => {
    if (!answered) reject(new UsageError("install cancelled"));
  };
  rl.once("SIGINT", cancel);
  rl.once("close", cancel);
  // Backstop for a terminal that still delivers SIGINT instead of a keypress.
  process.once("SIGINT", cancel);
  try {
    rl.question(prompt).then(finish, reject);
  } catch {
    cancel();
  }
  try {
    return (await promise).trim();
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError("install cancelled");
  } finally {
    rl.off("line", onLine);
    rl.off("SIGINT", cancel);
    rl.off("close", cancel);
    process.off("SIGINT", cancel);
  }
}

export function parseHostAnswer(
  answer: string,
  hosts: readonly InstallHost[],
): readonly InstallHost[] {
  const value = answer.trim();
  if (value === "" || value.toLowerCase() === "all") return hosts;
  const tokens = value.split(/[,\s]+/).filter((token) => token.length > 0);
  if (tokens.length === 0) throw new UsageError("no valid host selected");
  const selected = new Set<InstallHost>();
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      const host = hosts[Number(token) - 1];
      if (host === undefined) throw new UsageError(`unknown host: ${token}`);
      selected.add(host);
      continue;
    }
    if (token !== "omp" && token !== "dsh" && token !== "claude") {
      throw new UsageError(`unknown host: ${token}`);
    }
    if (!hosts.includes(token)) throw new UsageError(`unknown host: ${token}`);
    selected.add(token);
  }
  return hosts.filter((host) => selected.has(host));
}

export function parseScopeAnswer(
  answer: string,
  fallback: "user" | "project",
): "user" | "project" {
  const value = answer.trim() === "" ? fallback : answer.trim();
  if (value !== "user" && value !== "project") throw new UsageError(`unknown scope: ${value}`);
  return value;
}

async function chooseInstall(
  hosts: readonly InstallHost[],
  scope: "user" | "project",
): Promise<{
  readonly hosts: readonly InstallHost[];
  readonly scope: "user" | "project";
}> {
  if (!process.stdin.isTTY && !existsSync(process.platform === "win32" ? "CONIN$" : "/dev/tty")) {
    return { hosts, scope };
  }
  const input = ttyStream();
  if (input === null) return { hosts, scope };
  // terminal: true makes readline own the tty: Ctrl-C becomes a SIGINT event
  // (handled in ask) instead of killing the process, and EOF closes cleanly.
  const rl = createInterface({ input, output: process.stdout, terminal: true });
  try {
    process.stdout.write("\n  Aurifex installer\n");
    process.stdout.write("  Choose hosts (comma-separated) or press Enter for all detected:\n");
    for (const [index, host] of hosts.entries()) {
      const found = await hasCommand(host);
      process.stdout.write(`    ${index + 1}) ${HOST_LABEL[host]} ${found ? "" : "(not found)"}\n`);
    }
    const hostAnswer = await ask(rl, `  Hosts [1-${hosts.length}/all] (all): `);
    const selected = parseHostAnswer(hostAnswer, hosts);
    const scopeAnswer = await ask(rl, "  Scope [user/project] (user): ");
    const chosenScope = parseScopeAnswer(scopeAnswer, scope);
    return { hosts: selected, scope: chosenScope };
  } finally {
    rl.close();
    input.destroy();
  }
}

function readPackageName(root: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("name" in parsed)) return undefined;
    return typeof parsed.name === "string" ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

function assertAurifexRoot(root: string): void {
  if (readPackageName(root) !== "aurifex") {
    throw new UsageError(
      `invalid install source: ${root}: expected an Aurifex checkout with package.json "name": "aurifex"`,
    );
  }
}

export function defaultInstallSource(
  packageRoot: string,
  pathExists: (path: string) => boolean,
): string {
  if (!pathExists(join(packageRoot, "package.json"))) {
    throw new UsageError(
      `invalid install source: ${packageRoot}: expected an Aurifex checkout with package.json "name": "aurifex"`,
    );
  }
  assertAurifexRoot(packageRoot);
  return packageRoot;
}

function isLocalSource(source: string): boolean {
  return (
    isAbsolute(source) ||
    source === "." ||
    source === ".." ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith(".\\") ||
    source.startsWith("..\\")
  );
}

function installCliPath(source: string): string {
  return join(source, "dist", "cli.js");
}

function installDistPath(source: string): string {
  return join(source, "dist", "adapters", "mcp", "server.js");
}

export function needsBuild(source: string, distExists: (path: string) => boolean): boolean {
  return !distExists(installCliPath(source)) || !distExists(installDistPath(source));
}

export async function resolveInstallSource(raw: string | undefined): Promise<string> {
  if (raw === undefined) return defaultInstallSource(PACKAGE_ROOT, existsSync);
  if (!isLocalSource(raw)) {
    throw new UsageError(
      `unsupported install source: ${raw}: pass an absolute path or a ./relative path to an Aurifex checkout`,
    );
  }
  const resolved = resolve(raw);
  let source = resolved;
  try {
    source = await realpath(resolved);
  } catch {
    source = resolved;
  }
  assertAurifexRoot(source);
  return source;
}

function installCommands(
  host: InstallHost,
  source: string,
  scope: string,
  profile: string,
): readonly (readonly string[])[] {
  switch (host) {
    case "omp":
      return [["plugin", "install", source, "--scope", scope]];
    case "dsh":
      return [["plugin", "--profile", profile, "add", source]];
    case "claude":
      return [
        ["plugin", "marketplace", "add", source],
        ["plugin", "install", "aurifex@aurifex", "-s", scope],
      ];
  }
}

function quoteArg(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function displayCommand(bin: string, args: readonly string[]): string {
  const quote =
    process.platform === "win32"
      ? (value: string): string => `"${value.replaceAll('"', '""')}"`
      : quoteArg;
  return [bin, ...args].map(quote).join(" ");
}

interface WindowsCommand {
  readonly line: string;
  readonly env: NodeJS.ProcessEnv;
}

function windowsCommand(
  bin: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): WindowsCommand {
  const prefix = `AURIFEX_CMDARG_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const childEnv: NodeJS.ProcessEnv = { ...env };
  const parts = [bin, ...args].map((value, index) => {
    const key = `${prefix}_${index}`;
    childEnv[key] = value;
    return `"%${key}%"`;
  });
  return { line: parts.join(" "), env: childEnv };
}

export async function capture(
  bin: string,
  args: readonly string[],
  cwd?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Captured> {
  const { promise, resolve: finish, reject } = Promise.withResolvers<Captured>();
  const windows = process.platform === "win32";
  const shell = windows && !/\.exe$/i.test(bin);
  let child;
  if (shell) {
    const command = windowsCommand(bin, args, env);
    child = spawn(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/v:off", "/c", `"${command.line}"`],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: command.env,
        windowsVerbatimArguments: true,
        ...(cwd === undefined ? {} : { cwd }),
      },
    );
  } else {
    child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      ...(cwd === undefined ? {} : { cwd }),
    });
  }
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.on("error", reject);
  child.on("close", (code) => finish({ code, stdout, stderr }));
  return promise;
}

const EXECUTABLE_ALLOWLIST: ReadonlySet<string> = new Set(["omp", "dsh", "claude", "npm"]);

function isSafeExecutablePath(candidate: string): boolean {
  if (!isAbsolute(candidate)) return false;
  if (candidate.includes('"') || /[\u0000-\u001f]/.test(candidate)) return false;
  const extension = candidate.slice(candidate.lastIndexOf(".")).toLowerCase();
  return extension === ".exe" || extension === ".cmd" || extension === ".bat";
}

export async function resolveExecutable(bin: string): Promise<string | undefined> {
  if (!EXECUTABLE_ALLOWLIST.has(bin)) return undefined;
  if (process.platform !== "win32") {
    try {
      return (await capture("which", [bin])).code === 0 ? bin : undefined;
    } catch {
      return undefined;
    }
  }
  const where = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe");
  let captured: Captured;
  try {
    captured = await capture(where, [bin]);
  } catch {
    return undefined;
  }
  if (captured.code !== 0) return undefined;
  for (const line of captured.stdout.split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate === "" || !isSafeExecutablePath(candidate)) continue;
    try {
      if (!statSync(candidate).isFile()) continue;
    } catch {
      continue;
    }
    return candidate;
  }
  return undefined;
}

async function hasCommand(bin: string): Promise<boolean> {
  return (await resolveExecutable(bin)) !== undefined;
}

interface Attempt {
  readonly ok: boolean;
  readonly output: string;
}

async function tryCommand(bin: string, args: readonly string[], cwd?: string, env: NodeJS.ProcessEnv = process.env): Promise<Attempt> {
  try {
    const executable = await resolveExecutable(bin);
    if (executable === undefined) {
      return { ok: false, output: `${bin} not found` };
    }
    const captured = await capture(executable, args, cwd, env);
    return {
      ok: captured.code === 0,
      output: redactSecrets(`${captured.stdout}${captured.stderr}`).trim(),
    };
  } catch (error) {
    return {
      ok: false,
      output: redactSecrets(error instanceof Error ? error.message : "spawn failed"),
    };
  }
}

interface BuildOutcome {
  readonly ran: boolean;
  readonly ok: boolean;
  readonly tool: string;
  readonly output: string;
}

const BUILD_TOOL = "npm install --include=dev && npm run build";

async function ensureBuild(source: string): Promise<BuildOutcome> {
  if (!needsBuild(source, existsSync)) return { ran: false, ok: true, tool: "", output: "" };
  const installed = await tryCommand(
    "npm",
    [
      "install",
      "--include=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-progress",
    ],
    source,
    { ...process.env, npm_config_package_lock: "false" },
  );
  if (!installed.ok) {
    return {
      ran: true,
      ok: false,
      tool: "npm install --include=dev",
      output: installed.output,
    };
  }
  const built = await tryCommand("npm", ["run", "build"], source);
  if (!built.ok) {
    return { ran: true, ok: false, tool: "npm run build", output: built.output };
  }
  const missing = [installCliPath(source), installDistPath(source)].filter(
    (path) => !existsSync(path),
  );
  if (missing.length > 0) {
    return {
      ran: true,
      ok: false,
      tool: BUILD_TOOL,
      output: `${missing.join(", ")} still missing after ${BUILD_TOOL}`,
    };
  }
  return { ran: true, ok: true, tool: BUILD_TOOL, output: "" };
}

async function packageVersion(): Promise<string> {
  try {
    const parsed = JSON.parse(
      await readFile(join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as unknown;
    return scalar(field(parsed, "version")) ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function renderInstall(
  version: string,
  source: string,
  buildTool: string | undefined,
  hosts: readonly InstallHostResult[],
  notes: ReadonlyMap<InstallHost, string>,
  dryRun: boolean,
  elapsed: number,
): string {
  const color = process.stdout.isTTY === true;
  const paint = (code: string, text: string): string =>
    color ? `\u001b[${code}m${text}\u001b[0m` : text;
  const title = [`Aurifex v${version}`, dryRun ? "install · dry run" : "install"];
  const width = Math.max(...title.map((line) => line.length)) + 2;
  const box = [
    `┌${"─".repeat(width)}┐`,
    ...title.map((line) => `│ ${line.padEnd(width - 2)} │`),
    `└${"─".repeat(width)}┘`,
  ];
  const marks: Readonly<Record<InstallStatus, string>> = {
    installed: paint("32", "✔"),
    planned: paint("36", "→"),
    skipped: paint("33", "!"),
    failed: paint("31", "✖"),
  };
  const steps = hosts.map((entry) => {
    const note = notes.get(entry.host)?.replaceAll(/\s+/g, " ").slice(0, 200);
    const suffix = note === undefined || note.length === 0 ? "" : ` — ${note}`;
    return `  ${marks[entry.status]} ${HOST_LABEL[entry.host]}: ${entry.status} · ${entry.command}${suffix}`;
  });
  const selected = dryRun
    ? hosts.filter((entry) => entry.status === "planned")
    : hosts.filter((entry) => entry.status === "installed");
  const final = dryRun
    ? `Would install: ${selected.map((entry) => HOST_LABEL[entry.host]).join(", ") || "none"}`
    : `Installed: ${selected.map((entry) => HOST_LABEL[entry.host]).join(", ") || "none"}`;
  const buildLine =
    buildTool === undefined ? [] : [`  ${paint("32", "✔")} Build: ok · ${buildTool}`];
  return [
    ...box,
    "",
    `  Source: ${source}`,
    ...buildLine,
    ...steps,
    "",
    `  Done in ${elapsed} ms`,
    `  ${final}`,
  ].join("\n");
}

async function runInstall(parsed: Parsed): Promise<number> {
  if (parsed.positionals.length > 0) throw new UsageError("install takes no positional arguments");
  const scopeValue = stringValue(parsed.values.scope) ?? "user";
  if (scopeValue !== "user" && scopeValue !== "project") {
    throw new UsageError(`unknown scope: ${scopeValue}`);
  }
  const scope: "user" | "project" = scopeValue;
  const profile = stringValue(parsed.values.profile) ?? "aurifex";
  const source = await resolveInstallSource(stringValue(parsed.values.source));
  const dryRun = parsed.values["dry-run"] === true;
  const requestedHost = stringValue(parsed.values.host);
  const interactive =
    requestedHost === undefined &&
    parsed.values.yes !== true &&
    !parsed.json &&
    !dryRun &&
    process.stdout.isTTY === true;
  let selected = installSelection(requestedHost);
  let chosenScope = scope;
  if (interactive) {
    const choice = await chooseInstall(selected, scope);
    selected = choice.hosts;
    chosenScope = choice.scope;
  }
  const started = performance.now();
  const hosts: InstallHostResult[] = [];
  const notes = new Map<InstallHost, string>();

  let buildTool: string | undefined;
  if (!dryRun) {
    const build = await ensureBuild(source);
    if (!build.ok) {
      const detail = redactSecrets(
        `build failed (${build.tool}): ${build.output.length > 0 ? build.output : "unknown error"}`,
      );
      if (parsed.json) {
        process.stdout.write(
          `${serializeDomainResult(domainFailure({ code: "build_failed", detail, retryable: true }))}\n`,
        );
      } else {
        process.stderr.write(`aurifex: ${detail}\n`);
      }
      return 1;
    }
    if (build.ran) buildTool = build.tool;
    if (build.ran && !parsed.json) process.stdout.write(`  Build: ok · ${build.tool}\n`);
  }

  for (const host of selected) {
    const commands = installCommands(host, source, chosenScope, profile);
    const command = commands.map((args) => displayCommand(host, args)).join(" && ");
    if (dryRun) {
      hosts.push({ host, status: "planned", command });
      continue;
    }
    if (!(await hasCommand(host))) {
      hosts.push({ host, status: "skipped", command });
      process.stderr.write(
        `aurifex: warning: ${host} not found on PATH; skipped ${HOST_LABEL[host]}\n`,
      );
      continue;
    }
    let ok = true;
    let output = "";
    for (const args of commands) {
      let attempt = await tryCommand(host, args);
      if (!attempt.ok && host === "omp" && args[1] === "install") {
        const fallback = await tryCommand(host, ["plugin", "link", source]);
        if (fallback.ok) attempt = fallback;
        else output += fallback.output;
      }
      if (!attempt.ok) {
        ok = false;
        output += attempt.output;
        break;
      }
    }
    hosts.push({ host, status: ok ? "installed" : "failed", command });
    if (!ok) notes.set(host, output.length > 0 ? output : "command failed");
  }

  const elapsed = Math.round(performance.now() - started);
  if (parsed.json) {
    const result: InstallResult = { hosts, packageRoot: PACKAGE_ROOT, source };
    process.stdout.write(`${serializeDomainResult(domainSuccess(result))}\n`);
  } else {
    const version = await packageVersion();
    process.stdout.write(
      `${renderInstall(version, source, buildTool, hosts, notes, dryRun, elapsed)}\n`,
    );
  }
  return hosts.some((entry) => entry.status === "failed") ? 1 : 0;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readSpec(file: string): Promise<unknown> {
  let text: string;
  try {
    text = file === "-" ? await readStdin() : await readFile(file, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read spec: ${error instanceof Error ? error.message : file}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new UsageError("spec is not valid JSON");
  }
}

function rebaseFiles<T extends { readonly path: string }>(
  files: readonly T[],
  base: string,
  policyRoot: string,
): T[] {
  return files.map((file) => ({
    ...file,
    path: relative(base, resolve(policyRoot, file.path)).split(sep).join("/"),
  }));
}

async function dispatch(
  command: CoreCommand,
  parsed: Parsed,
  operations: CoreOperations,
): Promise<DomainResult<unknown>> {
  const { values } = parsed;
  const overwrite = values.overwrite === true ? { overwrite: true } : {};
  switch (command) {
    case "target": {
      if (parsed.positionals.length > 0) throw new UsageError("unexpected argument");
      const stack = required(values, "stack");
      if (!isBotStack(stack)) throw new UsageError(`unknown stack: ${stack}`);
      return operations.resolveTarget({ stack });
    }
    case "new": {
      if (parsed.positionals.length !== 1) throw new UsageError("new requires one destination");
      const destination = resolve(parsed.root, parsed.positionals[0]!);
      if (!insideRoot(parsed.root, destination)) {
        throw new UsageError("destination must be inside --root");
      }
      const spec = await readSpec(required(values, "spec"));
      const result = await operations.scaffoldBot({ destination, spec, ...overwrite });
      if (result.status !== "ok") return result;
      const files = rebaseFiles(result.value.files, destination, parsed.root);
      return domainSuccess(
        {
          ...result.value,
          root: relative(parsed.root, destination).split(sep).join("/"),
          files,
        },
        result.evidence,
      );
    }
    case "inspect":
      return operations.inspectBot({ projectRoot: projectRoot(parsed) });
    case "verify":
      return operations.verifyBot({ projectRoot: projectRoot(parsed) });
    case "add": {
      const project = projectRoot(parsed);
      const result = await operations.addFeature({
        projectRoot: project,
        feature: featureValue(required(values, "feature")),
        name: required(values, "name"),
        ...overwrite,
      });
      if (result.status !== "ok") return result;
      return domainSuccess(
        {
          ...result.value,
          root: parsed.positionals[0] === "." ? "." : relative(parsed.root, project),
          files: rebaseFiles(result.value.files, project, parsed.root),
        },
        result.evidence,
      );
    }
    case "deploy": {
      const mode = stringValue(values.mode);
      if (mode !== undefined && mode !== "webhook" && mode !== "polling") {
        throw new UsageError(`unknown mode: ${mode}`);
      }
      return operations.planDeploy({
        projectRoot: projectRoot(parsed),
        domain: required(values, "domain"),
        ...(mode === undefined ? {} : { mode }),
        ...overwrite,
      });
    }
    case "harness":
      return operations.generateTestHarness({ projectRoot: projectRoot(parsed), ...overwrite });
    case "upgrade":
      return operations.upgradeProject({
        projectRoot: projectRoot(parsed),
        apply: values.apply === true,
      });
    case "upgrade-plan":
      return operations.upgradePlan({ projectRoot: projectRoot(parsed) });
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function scalar(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function filePaths(value: unknown): string[] {
  const files = field(value, "files");
  if (!Array.isArray(files)) return [];
  return files
    .map((file) => scalar(field(file, "path")))
    .filter((path): path is string => path !== undefined);
}

function summarize(command: Command, value: unknown): string {
  const lines: string[] = [];
  switch (command) {
    case "target": {
      const target = field(value, "target");
      const botApi = field(value, "botApi");
      lines.push(
        `${scalar(field(value, "stack")) ?? "unknown"} ${
          scalar(field(target, "frameworkVersion")) ?? "?"
        } (Bot API ${scalar(field(botApi, "version")) ?? "?"})`,
      );
      break;
    }
    case "new":
      lines.push(`scaffolded into ${scalar(field(value, "root")) ?? "?"}`);
      break;
    case "inspect": {
      const findings = field(value, "findings");
      const count = Array.isArray(findings) ? findings.length : 0;
      lines.push(
        `${scalar(field(value, "stack")) ?? "unknown"} / ${scalar(field(value, "mode")) ?? "unknown"}, ${count} findings`,
      );
      break;
    }
    case "verify": {
      const summary = field(value, "summary");
      lines.push(
        `${field(value, "ok") === true ? "ok" : "failed"}: ${scalar(field(summary, "pass")) ?? 0} pass, ${
          scalar(field(summary, "warn")) ?? 0
        } warn, ${scalar(field(summary, "fail")) ?? 0} fail`,
      );
      break;
    }
    case "add":
      lines.push(`added ${scalar(field(value, "feature")) ?? "feature"}`);
      break;
    case "deploy": {
      const webhook = field(value, "setWebhook");
      lines.push(`deploy plan for ${scalar(field(webhook, "url")) ?? "?"}`);
      break;
    }
    case "harness": {
      const commands = field(value, "commands");
      lines.push(
        `wrote test harness${Array.isArray(commands) && commands.length > 0 ? ` (${commands.map(String).join(", ")})` : ""}`,
      );
      break;
    }
    case "upgrade": {
      const changed = field(value, "changed");
      lines.push(
        `spec ${scalar(field(value, "specVersion")) ?? "?"}: ${
          Array.isArray(changed) ? changed.length : 0
        } changed`,
      );
      break;
    }
    case "upgrade-plan": {
      const actions = field(value, "actions");
      lines.push(
        `Bot API ${scalar(field(value, "currentBotApi")) ?? "?"} -> ${scalar(field(value, "targetBotApi")) ?? "?"}, ${
          Array.isArray(actions) ? actions.length : 0
        } actions`,
      );
      break;
    }
  }
  lines.push(...filePaths(value).map((path) => `  ${path}`));
  return lines.join("\n");
}

function printResult(command: Command, json: boolean, result: DomainResult<unknown>): number {
  if (json) {
    process.stdout.write(`${serializeDomainResult(result)}\n`);
  } else if (result.status === "ok") {
    process.stdout.write(`${redactSecrets(summarize(command, result.value))}\n`);
  } else {
    process.stderr.write(`error ${result.error.code}: ${redactSecrets(result.error.detail)}\n`);
  }
  return result.status === "ok" ? 0 : 1;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (argv.includes("--version")) {
    process.stdout.write(`Aurifex ${await packageVersion()}\n`);
    return 0;
  }
  try {
    const parsed = parse(argv);
    if (parsed.command === "install") return await runInstall(parsed);
    const root = await realpath(parsed.root);
    const operations = await createCoreOperations({ root });
    const result = await dispatch(parsed.command, { ...parsed, root }, operations);
    return printResult(parsed.command, parsed.json, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected failure";
    if (error instanceof UsageError) {
      process.stderr.write(`aurifex: ${redactSecrets(message)}\n\n${USAGE}\n`);
      return 2;
    }
    process.stderr.write(`aurifex: ${redactSecrets(message)}\n`);
    return 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await runCli(process.argv.slice(2));
}
