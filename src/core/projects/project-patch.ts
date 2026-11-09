import type { FileRef } from "../results.ts";
import type { PathPolicy } from "../security/path-policy.ts";
import { PathPolicyError, readOptionalFile } from "../security/path-policy.ts";
import type { TemplateFile } from "./templates/shared.ts";

export const CONFIG_TS_MARKERS = {
  start: "// aurifex:config",
  end: "// aurifex:config-end",
} as const;

export const CONFIG_PY_MARKERS = {
  start: "# aurifex:config",
  end: "# aurifex:config-end",
} as const;

export const COMPOSE_SERVICES_MARKER = "# aurifex:services";

export const SCHEMA_MARKERS = [
  "// aurifex:schema",
  "# aurifex:schema",
  "-- aurifex:schema",
] as const;

export interface ProjectPatch {
  files: TemplateFile[];
  packageDependencies?: Record<string, string>;
  pyprojectDependencies?: string[];
  env: Array<{ key: string; value: string }>;
  configTs?: Array<{ key: string; expression: string }>;
  configPy?: Array<{ key: string; expression: string }>;
  schemaSql?: string;
  migrationFiles?: TemplateFile[];
  compose?: { worker: boolean; migrate: boolean };
  runtime?: { queue: "postgres" };
}

const PACKAGE_JSON = "package.json";
const PYPROJECT = "pyproject.toml";
const ENV_FILE = ".env.example";
const CONFIG_TS = "src/config.ts";
const CONFIG_PY = "app/config.py";
const COMPOSE_FILE = "docker-compose.yml";
const SCHEMA_SQL_FILE = "drizzle/0001_schema.sql";

class ProjectPatchError extends Error {
  readonly code: "invalid_request" | "project_unreadable";
  readonly paths: readonly string[];

  constructor(
    code: "invalid_request" | "project_unreadable",
    detail: string,
    paths: readonly string[] = [],
  ) {
    super(detail);
    this.name = "ProjectPatchError";
    this.code = code;
    this.paths = paths;
  }
}

interface Operation {
  readonly path: string;
  readonly content: string;
  readonly overwrite: boolean;
  readonly mode?: number;
  readonly previous: string | null;
}

function validateRelativePath(path: string, label: string): void {
  if (
    path === "" ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new ProjectPatchError("invalid_request", `unsafe ${label}: ${path}`, [path]);
  }
}

function normalizePrefix(prefix: string): string {
  if (prefix === "") return "";
  if (prefix.includes("\0") || prefix.includes("\\") || prefix.startsWith("/")) {
    throw new ProjectPatchError("invalid_request", `unsafe prefix: ${prefix}`, [prefix]);
  }
  const trimmed = prefix.replace(/\/+$/u, "");
  validateRelativePath(trimmed, "prefix");
  return trimmed;
}

function joinPath(prefix: string, path: string): string {
  return prefix === "" ? path : `${prefix}/${path}`;
}

async function readRequired(policy: PathPolicy, path: string): Promise<string> {
  const text = await readOptionalFile(policy, path);
  if (text === null) {
    throw new ProjectPatchError("project_unreadable", `missing required file: ${path}`, [path]);
  }
  return text;
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function envKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line);
    if (match?.[1] !== undefined) keys.add(match[1]);
  }
  return keys;
}

function appendEnv(
  text: string,
  entries: readonly { readonly key: string; readonly value: string }[],
): string {
  const present = envKeys(text);
  const lines: string[] = [];
  for (const entry of entries) {
    if (present.has(entry.key)) continue;
    present.add(entry.key);
    lines.push(`${entry.key}=${entry.value}`);
  }
  if (lines.length === 0) return text;
  const head = text === "" ? "" : withTrailingNewline(text);
  return `${head}${lines.join("\n")}\n`;
}

function patchPackageJson(text: string, dependencies: Record<string, string>): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectPatchError("project_unreadable", `${PACKAGE_JSON} is not valid JSON`, [
      PACKAGE_JSON,
    ]);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProjectPatchError("project_unreadable", `${PACKAGE_JSON} is not an object`, [
      PACKAGE_JSON,
    ]);
  }
  const manifest = parsed as Record<string, unknown>;
  const current = manifest.dependencies ?? {};
  if (typeof current !== "object" || current === null || Array.isArray(current)) {
    throw new ProjectPatchError("project_unreadable", `${PACKAGE_JSON} dependencies is invalid`, [
      PACKAGE_JSON,
    ]);
  }
  const merged = new Map<string, string>();
  for (const [key, value] of Object.entries(current)) {
    if (typeof value !== "string") {
      throw new ProjectPatchError(
        "project_unreadable",
        `${PACKAGE_JSON} dependency ${key} is not a string`,
        [PACKAGE_JSON],
      );
    }
    merged.set(key, value);
  }
  for (const [key, value] of Object.entries(dependencies)) merged.set(key, value);
  manifest.dependencies = Object.fromEntries(
    [...merged.entries()].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function patchPyproject(text: string, dependencies: readonly string[]): string {
  const lines = text.split("\n");
  const projectStart = lines.findIndex((line) => line.trim() === "[project]");
  if (projectStart === -1) {
    throw new ProjectPatchError("project_unreadable", `${PYPROJECT} has no [project] section`, [
      PYPROJECT,
    ]);
  }
  let dependenciesStart = -1;
  for (let index = projectStart + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*\[/u.test(line)) break;
    if (/^\s*dependencies\s*=\s*\[/u.test(line)) {
      dependenciesStart = index;
      break;
    }
  }
  if (dependenciesStart === -1) {
    throw new ProjectPatchError(
      "project_unreadable",
      `${PYPROJECT} has no [project] dependencies list`,
      [PYPROJECT],
    );
  }
  let close = -1;
  for (let index = dependenciesStart; index < lines.length; index += 1) {
    if ((lines[index] ?? "").includes("]")) {
      close = index;
      break;
    }
  }
  if (close === -1) {
    throw new ProjectPatchError(
      "project_unreadable",
      `${PYPROJECT} dependencies list is not terminated`,
      [PYPROJECT],
    );
  }
  const existing = new Set<string>();
  for (let index = dependenciesStart; index < close; index += 1) {
    for (const match of (lines[index] ?? "").matchAll(/"([^"]+)"/gu)) {
      const name = match[1];
      if (name !== undefined) existing.add(name.replace(/[[<>=!~;].*$/u, "").trim());
    }
  }
  const additions: string[] = [];
  for (const dependency of [...dependencies].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const name = dependency.replace(/[[<>=!~;].*$/u, "").trim();
    if (name === "" || existing.has(name)) continue;
    existing.add(name);
    additions.push(`  "${dependency}",`);
  }
  if (additions.length === 0) return text;
  lines.splice(close, 0, ...additions);
  return lines.join("\n");
}

function insertBeforeMarker(
  text: string,
  startMarker: string,
  endMarker: string,
  entries: readonly { readonly key: string; readonly line: string }[],
  path: string,
): string {
  if (!text.includes(startMarker) || !text.includes(endMarker)) {
    throw new ProjectPatchError(
      "project_unreadable",
      `${path} is missing the aurifex config markers`,
      [path],
    );
  }
  const all = text.split("\n");
  const end = all.findIndex((line) => line.trim() === endMarker);
  if (end === -1) {
    throw new ProjectPatchError(
      "project_unreadable",
      `${path} is missing the aurifex config end marker`,
      [path],
    );
  }
  const existing = new Set(
    [...text.matchAll(/^(?:export const\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gmu)].map(
      (match) => match[1],
    ),
  );
  const additions: string[] = [];
  for (const entry of entries) {
    if (existing.has(entry.key)) continue;
    existing.add(entry.key);
    additions.push(entry.line);
  }
  all.splice(end, 0, ...additions);
  return all.join("\n");
}

function appendSchemaSql(text: string, sql: string): string {
  const marker = SCHEMA_MARKERS.find((candidate) => text.includes(candidate));
  if (marker === undefined) return `${withTrailingNewline(text)}${withTrailingNewline(sql)}`;
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.includes(marker));
  if (index === -1) return `${withTrailingNewline(text)}${withTrailingNewline(sql)}`;
  lines.splice(index, 0, ...sql.split("\n"));
  return lines.join("\n");
}

function composeServiceBlock(service: "worker" | "migrate", python: boolean): string {
  const command =
    service === "worker"
      ? python
        ? `    command: ["uv", "run", "python", "-m", "app.worker"]`
        : `    command: ["node", "dist/worker.js"]`
      : python
        ? `    command: ["uv", "run", "alembic", "upgrade", "head"]`
        : `    command: ["node", "dist/migrate.js"]`;
  const extra =
    service === "worker"
      ? `    depends_on:
      migrate:
        condition: service_completed_successfully
    stop_grace_period: 35s`
      : `    restart: "no"`;
  return `  ${service}:
    build: .
    env_file: .env
${command}
${extra}
`;
}

function patchCompose(
  text: string,
  compose: { readonly worker: boolean; readonly migrate: boolean },
  python: boolean,
): string {
  if (!text.includes(COMPOSE_SERVICES_MARKER)) {
    throw new ProjectPatchError(
      "project_unreadable",
      `${COMPOSE_FILE} is missing the ${COMPOSE_SERVICES_MARKER} marker`,
      [COMPOSE_FILE],
    );
  }
  const blocks: string[] = [];
  if (compose.migrate && !/^\s{2}migrate:/mu.test(text)) {
    blocks.push(composeServiceBlock("migrate", python));
  }
  if (compose.worker && !/^\s{2}worker:/mu.test(text)) {
    blocks.push(composeServiceBlock("worker", python));
  }
  if (blocks.length === 0) return text;
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.trim() === COMPOSE_SERVICES_MARKER);
  lines.splice(index, 0, ...blocks.join("").replace(/\n$/u, "").split("\n"));
  return lines.join("\n");
}

async function rollback(
  policy: PathPolicy,
  written: readonly { readonly path: string; readonly previous: string | null }[],
): Promise<void> {
  for (const entry of [...written].toReversed()) {
    try {
      if (entry.previous === null) await policy.removeFile(entry.path);
      else await policy.writeFile(entry.path, entry.previous, { overwrite: true });
    } catch {
      // Best-effort restore; the original failure is reported to the caller.
    }
  }
}

export async function applyPatch(
  policy: PathPolicy,
  prefix: string,
  patch: ProjectPatch,
  manifest: { files: Record<string, string> },
): Promise<FileRef[]> {
  void manifest; // Read-only in this module; the caller owns manifest updates.
  const base = normalizePrefix(prefix);

  const operations: Array<Omit<Operation, "previous">> = [];
  const seen = new Set<string>();
  const stage = (path: string, content: string, overwrite: boolean, mode?: number): void => {
    validateRelativePath(path, "patch path");
    if (seen.has(path)) {
      throw new ProjectPatchError("project_unreadable", `duplicate patch path: ${path}`, [path]);
    }
    seen.add(path);
    operations.push(
      mode === undefined ? { path, content, overwrite } : { path, content, overwrite, mode },
    );
  };

  for (const file of patch.files) {
    stage(joinPath(base, file.path), file.content, false, file.mode);
  }
  for (const file of patch.migrationFiles ?? []) {
    stage(joinPath(base, file.path), file.content, false, file.mode);
  }

  if (
    patch.packageDependencies !== undefined &&
    Object.keys(patch.packageDependencies).length > 0
  ) {
    const path = joinPath(base, PACKAGE_JSON);
    const content = patchPackageJson(await readRequired(policy, path), patch.packageDependencies);
    stage(path, content, true);
  }

  if (patch.pyprojectDependencies !== undefined && patch.pyprojectDependencies.length > 0) {
    const path = joinPath(base, PYPROJECT);
    const content = patchPyproject(await readRequired(policy, path), patch.pyprojectDependencies);
    stage(path, content, true);
  }

  if (patch.env.length > 0) {
    const path = joinPath(base, ENV_FILE);
    const text = await readOptionalFile(policy, path);
    stage(path, appendEnv(text ?? "", patch.env), text !== null);
  }

  if (patch.configTs !== undefined && patch.configTs.length > 0) {
    const path = joinPath(base, CONFIG_TS);
    const text = await readRequired(policy, path);
    stage(
      path,
      insertBeforeMarker(
        text,
        CONFIG_TS_MARKERS.start,
        CONFIG_TS_MARKERS.end,
        patch.configTs.map((entry) => ({
          key: entry.key,
          line: `export const ${entry.key} = ${entry.expression};`,
        })),
        path,
      ),
      true,
    );
  }

  if (patch.configPy !== undefined && patch.configPy.length > 0) {
    const path = joinPath(base, CONFIG_PY);
    const text = await readRequired(policy, path);
    stage(
      path,
      insertBeforeMarker(
        text,
        CONFIG_PY_MARKERS.start,
        CONFIG_PY_MARKERS.end,
        patch.configPy.map((entry) => ({
          key: entry.key,
          line: `${entry.key} = ${entry.expression}`,
        })),
        path,
      ),
      true,
    );
  }

  if (patch.schemaSql !== undefined && patch.schemaSql.length > 0) {
    const path = joinPath(base, SCHEMA_SQL_FILE);
    const text = await readOptionalFile(policy, path);
    stage(
      path,
      text === null ? withTrailingNewline(patch.schemaSql) : appendSchemaSql(text, patch.schemaSql),
      text !== null,
    );
  }

  if (patch.compose !== undefined) {
    const path = joinPath(base, COMPOSE_FILE);
    const text = await readRequired(policy, path);
    const python = (await readOptionalFile(policy, joinPath(base, "app/worker.py"))) !== null;
    stage(path, patchCompose(text, patch.compose, python), true);
  }

  const snapshots: Operation[] = [];
  for (const operation of operations) {
    snapshots.push({ ...operation, previous: await readOptionalFile(policy, operation.path) });
  }

  const written: Array<{ readonly path: string; readonly previous: string | null }> = [];
  const refs: FileRef[] = [];
  for (const operation of snapshots) {
    try {
      const ref = await policy.writeFile(
        operation.path,
        operation.content,
        operation.mode === undefined
          ? { overwrite: operation.overwrite }
          : { overwrite: operation.overwrite, mode: operation.mode },
      );
      written.push({
        path: operation.path,
        previous: operation.overwrite ? operation.previous : null,
      });
      refs.push(ref);
    } catch (error) {
      await rollback(policy, written);
      if (error instanceof PathPolicyError) {
        throw new ProjectPatchError(
          error.code === "invalid_path" ? "invalid_request" : "project_unreadable",
          `patch failed at ${operation.path}: ${error.message}`,
          [operation.path],
        );
      }
      throw error;
    }
  }

  return refs;
}