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
  return {
    schemaVersion: BOT_SPEC_VERSION,
    name,
    displayName: slugToTitle(name),
    stack,
    features,
    deployment: "docker",
    storage: { postgres: true, redis: true },
    i18n: { defaultLocale: "en", en: true, ru: true },
    security: {
      webhookSecret: true,
      adminAllowlist: true,
      rateLimit: true,
      idempotency: true,
    },
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

  let stack: BotStack | null;
  let spec: BotSpec;
  let templates: TemplateFile[];
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

  return domainSuccess({
    root: join(policy.root, prefix),
    feature,
    files,
  });
}
