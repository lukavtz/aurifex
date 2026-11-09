import { join, relative, sep } from "node:path";

import type { DomainFailure, DomainResult, FileRef, JsonValue } from "../results.ts";
import { domainFailure, domainSuccess } from "../results.ts";
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
import { CONFIG_PY_MARKERS, CONFIG_TS_MARKERS, applyPatch } from "./project-patch.ts";
import type { TemplateFile } from "./templates/shared.ts";
import { assertNoTokenLiteral } from "./templates/shared.ts";

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
  const queued = feature === "llm" || feature === "broadcast" || feature === "payments";
  return {
    schemaVersion: BOT_SPEC_VERSION,
    name,
    displayName: slugToTitle(name),
    stack,
    features,
    deployment: "docker",
    storage: { postgres: queued, redis: true },
    i18n: { defaultLocale: "en", en: true, ru: true, zh: false },
    security: {
      webhookSecret: true,
      adminAllowlist: true,
      rateLimit: true,
      idempotency: true,
    },
    runtime: {
      queue: queued ? "postgres" : "none",
      telemetry: { otlp: false, prometheus: false, sentry: false },
    },
    ...(feature === "payments"
      ? {
          payments: {
            products: [
              {
                id: "support",
                title: "Support",
                description: "Support the bot",
                stars: 1,
                subscription: false,
              },
            ],
          },
        }
      : {}),
  };
}

function render(stack: BotStack, feature: BotFeature, name: string, spec: BotSpec): TemplateFile[] {
  return stack === "grammy"
    ? renderGrammyFeature(feature, name, spec)
    : renderAiogramFeature(feature, name, spec);
}

function prefixed(templates: readonly TemplateFile[], prefix: string): TemplateFile[] {
  if (prefix === "") return [...templates];
  return templates.map((template) => ({ ...template, path: `${prefix}/${template.path}` }));
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

interface Backup {
  readonly path: string;
  readonly previous: string | null;
}

async function rollback(policy: PathPolicy, backups: readonly Backup[]): Promise<void> {
  for (const backup of [...backups].toReversed()) {
    try {
      if (backup.previous === null) await policy.removeFile(backup.path);
      else await policy.writeFile(backup.path, backup.previous, { overwrite: true });
    } catch {
      // Best-effort restore; the original failure is reported to the caller.
    }
  }
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
      return fail("project_unreadable", "run aurifex upgrade --apply first", {
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
    templates = prefixed(render(stack, feature, request.name, spec), prefix);
    for (const template of templates) assertSafePath(template.path);
    assertNoTokenLiteral(templates);
    patch = await buildPatch(policy, prefix, feature, stack);
  } catch (error) {
    return pathFailure(error);
  }

  const backups: Backup[] = [];
  for (const template of templates) {
    let previous: string | null;
    try {
      previous = await readOptionalFile(policy, template.path);
    } catch (error) {
      return pathFailure(error);
    }
    if (previous !== null && request.overwrite !== true) {
      return fail("feature_exists", `target file already exists: ${template.path}`, {
        path: template.path,
      });
    }
    backups.push({ path: template.path, previous });
  }

  const files: FileRef[] = [];
  const written: Backup[] = [];
  try {
    for (const template of templates) {
      const backup = backups.find((item) => item.path === template.path);
      const ref = await policy.writeFile(
        template.path,
        template.content,
        template.mode === undefined
          ? { overwrite: request.overwrite === true }
          : { overwrite: request.overwrite === true, mode: template.mode },
      );
      written.push(backup ?? { path: template.path, previous: null });
      files.push(ref);
    }
  } catch (error) {
    await rollback(policy, written);
    return pathFailure(error);
  }

  const patchFiles: FileRef[] = [];
  if (patch.env.length > 0 || patch.configTs !== undefined || patch.configPy !== undefined) {
    try {
      patchFiles.push(...(await applyPatch(policy, prefix, patch, manifest)));
    } catch (error) {
      await rollback(policy, written);
      return patchFailure(error);
    }
  }

  const nextFiles: Record<string, string> = { ...manifest.files };
  for (const ref of [...files, ...patchFiles]) {
    nextFiles[manifestKey(ref.path, prefix)] = ref.sha256;
  }
  try {
    await writeManifest(policy, prefix, { ...manifest, files: nextFiles });
  } catch (error) {
    await rollback(policy, written);
    return pathFailure(error);
  }

  return domainSuccess({
    root: join(policy.root, prefix),
    feature,
    files,
  });
}
