import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";

const REPO = resolve(import.meta.dirname, "..");
const installedSchema = z.object({
  version: z.literal(2),
  plugins: z.object({ "aurifex@aurifex": z.array(z.object({ installPath: z.string() })).min(1) }),
});

export async function installedClaudeRoot(configDir: string): Promise<string> {
  let parsed: z.infer<typeof installedSchema>;
  try {
    parsed = installedSchema.parse(JSON.parse(await readFile(join(configDir, "plugins", "installed_plugins.json"), "utf8")));
  } catch {
    throw new Error("cannot determine installed plugin root");
  }
  const root = parsed.plugins["aurifex@aurifex"][0]?.installPath;
  if (root === undefined || !isAbsolute(root)) throw new Error("cannot determine installed plugin root");
  return realpath(root);
}

export async function listInstalledTools(root: string, env: NodeJS.ProcessEnv): Promise<readonly string[]> {
  const config = z.object({ aurifex: z.object({ command: z.literal("node"), args: z.array(z.string()) }) }).parse(JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")));
  const args = config.aurifex.args.map((arg) => arg.replaceAll("${CLAUDE_PLUGIN_ROOT}", root));
  const child = spawn(process.execPath, args, { cwd: root, env: { ...env, CLAUDE_PLUGIN_ROOT: root, AURIFEX_ROOT: root }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const response = z.object({ id: z.number(), result: z.unknown().optional(), error: z.unknown().optional() }).parse(JSON.parse(line));
      const request = pending.get(response.id);
      pending.delete(response.id);
      if (response.error !== undefined) request?.reject(new Error(JSON.stringify(response.error)));
      else request?.resolve(response.result);
    } catch (error) {
      for (const request of pending.values()) request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  child.on("error", (error) => { for (const request of pending.values()) request.reject(error); });
  child.on("exit", (code) => { for (const request of pending.values()) request.reject(new Error(`MCP exited ${code}: ${stderr}`)); });
  const request = async (id: number, method: string, params: Record<string, unknown>) => {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    pending.set(id, { resolve, reject });
    const timer = setTimeout(() => reject(new Error(`MCP ${method} timeout: ${stderr}`)), 30_000);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    try { return await promise; } finally { clearTimeout(timer); pending.delete(id); }
  };
  try {
    await request(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "aurifex-host-smoke", version: "0.2.0" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const result = z.object({ tools: z.array(z.object({ name: z.string() })) }).parse(await request(2, "tools/list", {}));
    assert.equal(result.tools.length, 9, "installed MCP must expose exactly nine tools");
    return result.tools.map((tool) => tool.name).toSorted();
  } finally {
    lines.close(); child.stdin.end(); child.kill();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { host: { type: "string" }, package: { type: "string" } }, strict: true });
  const host = z.enum(["omp", "dsh", "claude"]).parse(values.host);
  const artifacts = process.env.AURIFEX_ARTIFACT_DIR ?? join(process.env.RUNNER_TEMP ?? tmpdir(), "aurifex-artifacts");
  await mkdir(artifacts, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), "aurifex-host-smoke-"));
  const home = join(root, "home"); const checkout = join(root, "aurifex");
  await mkdir(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), XDG_CONFIG_HOME: join(home, ".config"), PI_CODING_AGENT_DIR: join(home, ".omp"), DSH_HOME: join(home, ".dsh") };
  const evidence: { host: string; status: string; commands: Array<{ command: string[]; code: number | null; stdout: string; stderr: string }>; installPath?: string; tools?: readonly string[]; error?: string } = { host, status: "running", commands: [] };
  async function run(bin: string, args: string[], cwd = checkout) {
    const { promise, resolve: done, reject } = Promise.withResolvers<{ code: number | null; stdout: string; stderr: string }>();
    const child = spawn(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("error", (error) => { clearTimeout(timer); evidence.commands.push({ command: [bin, ...args], code: null, stdout, stderr: error.message }); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
    const result = await promise;
    evidence.commands.push({ command: [bin, ...args], ...result });
    assert.equal(result.code, 0, `${bin} ${args.join(" ")}: ${result.stdout}${result.stderr}`);
    return result.stdout;
  }
  try {
    await cp(REPO, checkout, { recursive: true, filter: (path) => ![".git", "raw", "node_modules"].some((name) => path === join(REPO, name)) });
    await run("npm", ["install", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--no-progress", "--package-lock=false"], checkout);
    const version = await run(host, ["--version"]);
    const pinned = { omp: "18.18.3", dsh: "0.2.2-rc.1", claude: "2.1.308" }[host];
    assert.ok(version.includes(pinned), `expected pinned ${host} ${pinned}, got ${version.trim()}`);
    if (host === "omp") {
      await run(host, ["plugin", "link", "."]);
      await run(host, ["plugin", "doctor"]);
    } else if (host === "dsh") {
      assert.ok(values.package, "--package is required for DSH");
      const tarball = values.package.endsWith(".tgz") ? resolve(values.package) : values.package;
      await run(host, ["plugin", "--profile", "aurifex-ci", "add", tarball]);
      await run(host, ["--profile", "aurifex-ci", "--dump-config"]);
    } else {
      await run(host, ["plugin", "validate", "--strict", "."]);
      await run(host, ["plugin", "marketplace", "add", checkout]);
      await run(host, ["plugin", "install", "aurifex@aurifex"]);
      await run(host, ["plugin", "details", "aurifex"]);
      evidence.installPath = await installedClaudeRoot(env.CLAUDE_CONFIG_DIR);
      // A marketplace cache is a plain file copy: nothing runs npm install in it.
      await rm(join(evidence.installPath, "node_modules"), { recursive: true, force: true });
      evidence.tools = await listInstalledTools(evidence.installPath, env);
    }
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed"; evidence.error = error instanceof Error ? error.message : String(error);
    process.stderr.write(`::error::${evidence.error}\n`); process.exitCode = 1;
  } finally {
    await writeFile(join(artifacts, `host-${host}.json`), JSON.stringify(evidence, null, 2) + "\n");
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) await main();
