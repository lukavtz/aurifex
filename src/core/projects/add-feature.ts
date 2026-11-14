import { join, relative, sep } from "node:path";

import type { DomainFailure, DomainResult, FileRef, JsonValue } from "../results.ts";
import { domainFailure, domainSuccess, sha256Hex } from "../results.ts";
import type { PathPolicy } from "../security/path-policy.ts";
import { PathPolicyError, readOptionalFile } from "../security/path-policy.ts";
import type { BotFeature, BotSpec, BotStack } from "../spec/bot-spec.ts";
import {
  assertFeature,
  BOT_SPEC_VERSION,
  BotSpecError,
  slugToTitle,
  validateFeatureName,
} from "../spec/bot-spec.ts";
import { renderAiogramFeature } from "./features/aiogram.ts";
import { renderGrammyFeature } from "./features/grammy.ts";
import type { AurifexManifest } from "./manifest.ts";
import { MANIFEST_PATH, readManifest, writeManifest } from "./manifest.ts";
import type { ProjectPatch } from "./project-patch.ts";
import { CONFIG_PY_MARKERS, CONFIG_TS_MARKERS, applyPatch, preparePatch } from "./project-patch.ts";
import { appBotModule, renderQueueInfrastructurePy } from "./templates/aiogram.ts";
import { renderFeatureIndexTs, renderMainTs, renderQueueInfrastructure } from "./templates/grammy.ts";
import { renderLegacyLlmEnqueueTs, renderLlmEnqueueTs } from "./templates/jobs.ts";
import type { TemplateFile } from "./templates/shared.ts";
import { assertNoTokenLiteral, renderCompose } from "./templates/shared.ts";

export interface FeatureResult {
  readonly root: string;
  readonly feature: BotFeature;
  readonly files: readonly FileRef[];
}

export interface AddFeatureRequest {
  readonly projectRoot: string;
  readonly feature: BotFeature;
  readonly name: string;
  readonly overwrite?: boolean;
}

export interface AddFeatureOptions {
  readonly policy: PathPolicy;
}

function fail(code: string, detail: string, details?: JsonValue): DomainFailure {
  return domainFailure({
    code,
    detail,
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
}

function specFailure(error: unknown): DomainFailure | null {
  if (!(error instanceof BotSpecError)) return null;
  return fail("invalid_request", error.message, { path: error.path, message: error.message });
}

function pathFailure(error: unknown): DomainFailure {
  if (error instanceof PathPolicyError) {
    const code =
      error.code === "not_a_directory" || error.code === "not_a_file"
        ? "project_unreadable"
        : error.code;
    return fail(code, error.message);
  }
  return fail(
    "internal_error",
    error instanceof Error ? error.message : "feature generation failed",
  );
}

function normalizeName(candidate: string): string {
  const stripped = candidate
    .trim()
    .toLowerCase()
    .replace(/[_-]bot$/, "")
    .replace(/[^a-z0-9_]/g, "_");
  return /^[a-z][a-z0-9_]{1,63}$/.test(stripped) ? stripped : `${stripped || "aurifex"}x`;
}

function projectPath(prefix: string, name: string): string {
  return prefix === "" ? name : `${prefix}/${name}`;
}

async function optionalText(policy: PathPolicy, path: string): Promise<string | null> {
  try {
    return await readOptionalFile(policy, path);
  } catch (error) {
    if (error instanceof PathPolicyError && error.code === "not_a_file") return null;
    throw error;
  }
}

async function detectStack(policy: PathPolicy, prefix: string): Promise<BotStack | null> {
  const manifest = await optionalText(policy, projectPath(prefix, "package.json"));
  if (manifest !== null) {
    try {
      const parsed: unknown = JSON.parse(manifest);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const field of ["dependencies", "devDependencies"] as const) {
          const deps = (parsed as { dependencies?: unknown; devDependencies?: unknown })[field];
          if (
            typeof deps === "object" &&
            deps !== null &&
            typeof (deps as Record<string, unknown>).grammy === "string"
          ) {
            return "grammy";
          }
        }
      }
    } catch {
      // A malformed manifest cannot prove the stack; fall through to pyproject.toml.
    }
  }
  const pyproject = await optionalText(policy, projectPath(prefix, "pyproject.toml"));
  if (pyproject !== null && pyproject.includes("aiogram")) return "aiogram";
  return null;
}

async function inferSpec(
  policy: PathPolicy,
  prefix: string,
  stack: BotStack,
  feature: BotFeature,
): Promise<BotSpec> {
  let candidate = "";
  const manifest = await optionalText(policy, projectPath(prefix, "package.json"));
  if (manifest !== null) {
    try {
      const parsed: unknown = JSON.parse(manifest);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const packageName = (parsed as { name?: unknown }).name;
        if (typeof packageName === "string") candidate = packageName;
      }
    } catch {
      candidate = "";
    }
  }
  if (candidate === "") {
    const pyproject = await optionalText(policy, projectPath(prefix, "pyproject.toml"));
    const match = pyproject === null ? null : /^\s*name\s*=\s*"([^"]+)"/m.exec(pyproject);
    if (match?.[1] !== undefined) candidate = match[1];
  }
  const name = normalizeName(candidate);
  const features = feature === "commands" ? (["commands"] as const) : ([feature] as const);
  return {
    schemaVersion: BOT_SPEC_VERSION,
    name,
    displayName: slugToTitle(name),
    stack,
    features,
    deployment: "docker",
    storage: { postgres: false, redis: true },
    i18n: { defaultLocale: "en", en: true, ru: true, zh: false },
    security: {
      webhookSecret: true,
      adminAllowlist: true,
      rateLimit: true,
      idempotency: true,
    },
    runtime: {
      queue: "none",
      telemetry: { otlp: false, prometheus: false, sentry: false },
    },
  };
}

function render(stack: BotStack, feature: BotFeature, name: string, spec: BotSpec): TemplateFile[] {
  return stack === "grammy"
    ? renderGrammyFeature(feature, name, spec)
    : renderAiogramFeature(feature, name, spec);
}

function assertSafePath(path: string): void {
  if (
    path === "" ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new PathPolicyError("invalid_path", `unsafe feature path: ${path}`);
  }
}

const BROADCAST_CONFIG_TS = [
  { key: "BROADCAST_RATE", expression: "Number(process.env.BROADCAST_RATE ?? 30)" },
];
const BROADCAST_CONFIG_PY = [
  { key: "BROADCAST_RATE", expression: 'int(os.getenv("BROADCAST_RATE", "30"))' },
];

function featureEnv(feature: BotFeature): Array<{ key: string; value: string }> {
  switch (feature) {
    case "llm":
      return [
        { key: "LLM_BASE_URL", value: "https://api.openai.com/v1" },
        { key: "LLM_MODEL", value: "" },
        { key: "LLM_API_KEY", value: "" },
      ];
    case "payments":
      return [{ key: "PAYSUPPORT_TEXT", value: "Contact support for payment issues." }];
    case "broadcast":
      return [{ key: "BROADCAST_RATE", value: "30" }];
    case "miniapps":
      return [
        { key: "MINIAPP_SESSION_TTL_SECONDS", value: "86400" },
        { key: "MINIAPP_ALLOWED_ORIGINS", value: "" },
      ];
    case "moderation":
      return [{ key: "MODERATION_BLOCKED_WORDS", value: "" }];
    default:
      return [];
  }
}

/**
 * Config entries are appended only inside the aurifex markers. Projects that predate
 * the markers keep working: their config is left untouched instead of failing.
 */
async function buildPatch(
  policy: PathPolicy,
  prefix: string,
  feature: BotFeature,
  stack: BotStack,
): Promise<ProjectPatch> {
  const patch: ProjectPatch = { files: [], env: featureEnv(feature) };
  if (feature !== "broadcast") return patch;
  const grammy = stack === "grammy";
  const path = projectPath(prefix, grammy ? "src/config.ts" : "app/config.py");
  const start = grammy ? CONFIG_TS_MARKERS.start : CONFIG_PY_MARKERS.start;
  const end = grammy ? CONFIG_TS_MARKERS.end : CONFIG_PY_MARKERS.end;
  const text = await optionalText(policy, path);
  if (text === null || !text.includes(start) || !text.includes(end)) return patch;
  if (grammy) patch.configTs = BROADCAST_CONFIG_TS;
  else patch.configPy = BROADCAST_CONFIG_PY;
  return patch;
}

function patchFailure(error: unknown): DomainFailure {
  let code: string | undefined;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    code = error.code;
  }
  if (code === "project_unreadable" || code === "invalid_request") {
    return fail(code, error instanceof Error ? error.message : "project patch failed");
  }
  return pathFailure(error);
}

function manifestKey(path: string, prefix: string): string {
  const lead = `${prefix}/`;
  return prefix !== "" && path.startsWith(lead) ? path.slice(lead.length) : path;
}

class FeatureConflict extends Error {
  readonly path: string;
  constructor(path: string, detail = `generated file is modified or not manifest-owned: ${path}`) {
    super(detail);
    this.path = path;
  }
}

class MissingProjectFile extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`missing required file: ${path}`);
    this.path = path;
  }
}

async function managedText(policy: PathPolicy, prefix: string, manifest: AurifexManifest, path: string): Promise<string> {
  const full = projectPath(prefix, path);
  const text = await readOptionalFile(policy, full);
  if (text === null) throw new MissingProjectFile(full);
  if (manifest.files[path] !== sha256Hex(text)) throw new FeatureConflict(full);
  return text;
}

/**
 * The generated bootstrap embeds the user's display name verbatim. Recover it
 * instead of re-deriving it from the slug, or byte-identity rejects every project
 * whose displayName was not slugToTitle(name).
 */
function bootstrapDisplayName(text: string): string | undefined {
  const match = /serviceName: config\.OTEL_SERVICE_NAME \|\| ("(?:[^"\\]|\\.)*"),/u.exec(text);
  if (match?.[1] === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function replaceAnchor(text: string, before: string, after: string, path: string): string {
  if (text.split(before).length !== 2) throw new FeatureConflict(path, `unrecognized generated region: ${path}`);
  return text.replace(before, after);
}

function transformCompose(currentText: string, preSpec: BotSpec, desired: BotSpec): string {
  if (currentText !== renderCompose(preSpec)) throw new FeatureConflict("docker-compose.yml", "unrecognized generated compose profile");
  return renderCompose(desired);
}

async function queuePatch(policy: PathPolicy, prefix: string, manifest: AurifexManifest, spec: BotSpec, feature: BotFeature, patch: ProjectPatch): Promise<BotSpec> {
  const grammy = spec.stack === "grammy";
  const immutable = grammy ? ["src/storage/db.ts", "src/storage/schema.ts"] : ["app/db/__init__.py", "app/db/session.py", "app/db/models.py"];
  for (const path of immutable) {
    if ((await readOptionalFile(policy, projectPath(prefix, path))) === null) throw new MissingProjectFile(projectPath(prefix, path));
  }
  for (const path of immutable) await managedText(policy, prefix, manifest, path);
  const migrationPath = grammy ? "drizzle/0001_runtime_schema.sql" : "migrations/versions/0001_runtime_schema.py";
  const queuePath = grammy ? "src/runtime/queue.ts" : "app/runtime/queue.py";
  const userSyncPath = grammy ? "src/security/user-sync.ts" : "app/middlewares/user_sync.py";
  const workerPath = grammy ? "src/worker.ts" : "app/worker.py";
  const hasPostgres = (await readOptionalFile(policy, projectPath(prefix, migrationPath))) !== null;
  const hasUserSync = (await readOptionalFile(policy, projectPath(prefix, userSyncPath))) !== null;
  const hasQueue = (await readOptionalFile(policy, projectPath(prefix, queuePath))) !== null;
  const hasWorker = (await readOptionalFile(policy, projectPath(prefix, workerPath))) !== null;
  const hasPayments = (await readOptionalFile(policy, projectPath(prefix, grammy ? "src/runtime/payments.ts" : "app/runtime/payments.py"))) !== null;
  // S4 irregular state: half-promoted postgres/queue pairs are rejected before a
  // single byte is written instead of being patched from an assumption.
  if (hasPostgres !== hasUserSync) throw new FeatureConflict(projectPath(prefix, hasPostgres ? userSyncPath : migrationPath));
  if (hasQueue !== hasWorker) throw new FeatureConflict(projectPath(prefix, hasQueue ? workerPath : queuePath));
  if (hasQueue && !hasPostgres) throw new FeatureConflict(projectPath(prefix, queuePath));
  if (hasPostgres) {
    await managedText(policy, prefix, manifest, migrationPath);
    await managedText(policy, prefix, manifest, userSyncPath);
  }
  if (hasQueue) {
    const runtime = grammy
      ? ["src/runtime/queue.ts", "src/runtime/worker.ts", "src/worker.ts", "src/jobs/index.ts", "tests/queue-wiring.test.ts"]
      : ["app/runtime/queue.py", "app/runtime/worker.py", "app/worker.py", "app/jobs/__init__.py", "tests/test_queue_wiring.py"];
    for (const path of runtime) await managedText(policy, prefix, manifest, path);
  }
  const compose = await managedText(policy, prefix, manifest, "docker-compose.yml");
  const bootstrapPath = grammy ? "src/main.ts" : "app/bot.py";
  let bootstrap = await managedText(policy, prefix, manifest, bootstrapPath);
  const originalBootstrap = bootstrap;
  const features: BotFeature[] = ["commands"];
  if (/^  llm_api_key:$/m.test(compose)) features.push("llm");
  if (hasPayments || (grammy && bootstrap.includes('"reconcile:bootstrap"'))) features.push("payments");
  const displayName = grammy ? bootstrapDisplayName(bootstrap) : spec.displayName;
  if (displayName === undefined) throw new FeatureConflict(bootstrapPath, `unrecognized generated region: ${bootstrapPath}`);
  const preSpec: BotSpec = { ...spec, displayName, features, storage: { postgres: hasPostgres, redis: /^  redis:$/m.test(compose) }, runtime: { ...spec.runtime, queue: hasQueue ? "postgres" : "none" } };
  // The broadcast job hard-requires Redis for its global rate limiter, so the
  // promotion has to provision the service it will talk to. Other features keep
  // the project's actual Redis setting.
  const desired: BotSpec = {
    ...preSpec,
    features: [...new Set([...preSpec.features, feature])],
    storage: { ...preSpec.storage, postgres: true, ...(feature === "broadcast" ? { redis: true } : {}) },
    runtime: { ...preSpec.runtime, queue: "postgres" },
  };
  const nextCompose = transformCompose(compose, preSpec, desired);
  const replacements = patch.replacements ?? [];
  patch.replacements = replacements;
  if (compose !== nextCompose) replacements.push({ path: "docker-compose.yml", content: nextCompose });
  if (!hasQueue) {
    const infrastructure = grammy ? renderQueueInfrastructure(desired, { includeMigration: !hasPostgres }) : renderQueueInfrastructurePy(desired, { includeMigration: !hasPostgres });
    patch.files.push(...infrastructure.filter((file) => !hasPostgres || file.path !== userSyncPath));
    if (grammy) {
      await managedText(policy, prefix, manifest, "src/features/index.ts");
      replacements.push({ path: "src/features/index.ts", content: renderFeatureIndexTs(desired) });
      await managedText(policy, prefix, manifest, "package.json");
      patch.packageJsonScripts = { "db:migrate": "node dist/migrate.js", "start:worker": "node dist/worker.js" };
      const docker = await managedText(policy, prefix, manifest, "Dockerfile");
      if (!docker.includes("COPY drizzle ./drizzle\n")) replacements.push({ path: "Dockerfile", content: replaceAnchor(docker, "USER node\n", "COPY drizzle ./drizzle\nUSER node\n", "Dockerfile") });
    }
  }
  if (grammy) {
    if (!hasQueue && bootstrap !== renderMainTs(preSpec)) throw new FeatureConflict(bootstrapPath, `unrecognized generated region: ${bootstrapPath}`);
    if (!hasQueue) bootstrap = renderMainTs(desired);
    if (feature === "payments" && !bootstrap.includes('"reconcile:bootstrap"')) {
      bootstrap = renderMainTs(desired);
    }
  } else {
    if (!hasQueue && bootstrap !== appBotModule(preSpec)) throw new FeatureConflict(bootstrapPath, `unrecognized generated region: ${bootstrapPath}`);
    if (!hasQueue) bootstrap = appBotModule(desired);
  }
  if (bootstrap !== originalBootstrap) replacements.push({ path: bootstrapPath, content: bootstrap });
  if (!hasPostgres) {
    const path = grammy ? "src/config.ts" : "app/config.py";
    const config = await managedText(policy, prefix, manifest, path);
    const anchor = grammy ? 'const REQUIRED_SECRETS: readonly string[] = [\n' : 'REQUIRED_SECRETS = (\n';
    const addition = grammy ? '  "DATABASE_URL",\n' : '    "DATABASE_URL",\n';
    let content = replaceAnchor(config, anchor, `${anchor}${addition}`, path);
    if (patch.configTs !== undefined) { content = content.replace(CONFIG_TS_MARKERS.end, `${patch.configTs.map((entry) => `export const ${entry.key} = ${entry.expression};\n`).join("")}${CONFIG_TS_MARKERS.end}`); delete patch.configTs; }
    if (patch.configPy !== undefined) { content = content.replace(CONFIG_PY_MARKERS.end, `${patch.configPy.map((entry) => `${entry.key} = ${entry.expression}\n`).join("")}${CONFIG_PY_MARKERS.end}`); delete patch.configPy; }
    replacements.push({ path, content });
  }
  if (grammy) {
    const legacy = renderLegacyLlmEnqueueTs();
    const candidates = (await policy.listFiles(projectPath(prefix, "src/features"))).filter((path) => /(?:^|\/)src\/features\/[^/]+\.ts$/.test(path) && !path.endsWith("/index.ts"));
    const matches: string[] = [];
    for (const path of candidates) {
      const content = await policy.readText(path);
      if (content === legacy) matches.push(path);
      else if (manifest.files[manifestKey(path, prefix)] === sha256Hex(legacy)) throw new FeatureConflict(path);
    }
    if (matches.length > 1) throw new FeatureConflict(matches[0]!);
    if (matches.length === 1) {
      const path = matches[0]!;
      await managedText(policy, prefix, manifest, manifestKey(path, prefix));
      replacements.push({ path: manifestKey(path, prefix), content: renderLlmEnqueueTs() });
      if (!replacements.some((file) => file.path === "src/features/index.ts")) {
        await managedText(policy, prefix, manifest, "src/features/index.ts");
        replacements.push({ path: "src/features/index.ts", content: renderFeatureIndexTs(desired) });
      }
    }
  }
  return desired;
}

interface Backup {
  readonly path: string;
  readonly previous: string | null;
}

async function rollback(policy: PathPolicy, backups: readonly Backup[]): Promise<void> {
  let firstError: unknown;
  for (const backup of [...backups].toReversed()) {
    try {
      if (backup.previous === null) await policy.removeFile(backup.path);
      else await policy.writeFile(backup.path, backup.previous, { overwrite: true });
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) throw firstError;
}

export async function addFeature(
  request: AddFeatureRequest,
  options: AddFeatureOptions,
): Promise<DomainResult<FeatureResult>> {
  let feature: BotFeature;
  try {
    feature = assertFeature(request.feature);
    validateFeatureName(request.name);
  } catch (error) {
    const failure = specFailure(error);
    if (failure !== null) return failure;
    throw error;
  }
  if (feature === "miniapps" && request.name !== "miniapp") {
    return fail("invalid_request", 'the miniapps feature requires name "miniapp"');
  }

  const { policy } = options;
  let projectDir: string;
  try {
    projectDir = await policy.resolveExisting(request.projectRoot);
  } catch (error) {
    return pathFailure(error);
  }
  const prefix = relative(policy.root, projectDir).split(sep).join("/");

  let manifest: AurifexManifest;
  try {
    const existing = await readManifest(policy, prefix);
    if (existing === null) {
      return fail("project_unreadable", "no .aurifex/manifest.json found; restore the original .aurifex/manifest.json from version control, or scaffold a new project in a different directory", {
        path: projectPath(prefix, MANIFEST_PATH),
      });
    }
    manifest = existing;
  } catch (error) {
    if (error instanceof PathPolicyError) return pathFailure(error);
    return fail("project_unreadable", error instanceof Error ? error.message : "invalid manifest", {
      path: projectPath(prefix, MANIFEST_PATH),
    });
  }

  let stack: BotStack | null;
  let spec: BotSpec;
  let templates: TemplateFile[];
  let patch: ProjectPatch;
  try {
    stack = await detectStack(policy, prefix);
    if (stack === null) {
      return fail(
        "project_unreadable",
        "no package.json with grammy or pyproject.toml with aiogram",
      );
    }
    spec = await inferSpec(policy, prefix, stack, feature);
    patch = await buildPatch(policy, prefix, feature, stack);
    const queued = feature === "llm" || feature === "broadcast" || feature === "payments";
    if (queued) spec = await queuePatch(policy, prefix, manifest, spec, feature, patch);
    templates = render(stack, feature, request.name, spec);
    for (const template of templates) {
      assertSafePath(template.path);
      const full = projectPath(prefix, template.path);
      const previous = await readOptionalFile(policy, full);
      if (previous !== null) {
        if (request.overwrite !== true) throw new FeatureConflict(full, `target file already exists: ${full}`);
        if (queued) await managedText(policy, prefix, manifest, template.path);
        patch.replacements = [...(patch.replacements ?? []).filter((file) => file.path !== template.path), { ...template, path: manifestKey(template.path, prefix) }];
      } else patch.files.push(template);
    }
    assertNoTokenLiteral([...patch.files, ...(patch.replacements ?? [])]);
    const snapshots = await preparePatch(policy, prefix, patch);
    const manifestPath = projectPath(prefix, MANIFEST_PATH);
    const backups: Backup[] = [...snapshots.map(({ path, previous }) => ({ path, previous })), { path: manifestPath, previous: await policy.readText(manifestPath) }];
    try {
      const result = await applyPatch(policy, prefix, patch, manifest);
      const nextFiles = { ...manifest.files };
      for (const ref of result.files) nextFiles[manifestKey(ref.path, prefix)] = ref.sha256;
      await writeManifest(policy, prefix, { ...manifest, files: nextFiles });
      return domainSuccess({ root: join(policy.root, prefix), feature, files: result.files });
    } catch (error) {
      await rollback(policy, backups);
      return patchFailure(error);
    }
  } catch (error) {
    if (error instanceof FeatureConflict) return fail("feature_exists", error.message, { path: error.path });
    if (error instanceof MissingProjectFile) return fail("project_unreadable", error.message, { path: error.path });
    return patchFailure(error);
  }
}
