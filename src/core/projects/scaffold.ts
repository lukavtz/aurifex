import { randomBytes } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

import type { DomainResult, FileRef } from "../results.ts";
import { domainFailure, domainSuccess, sha256Hex } from "../results.ts";
import type { PathPolicy } from "../security/path-policy.ts";
import { PathPolicyError } from "../security/path-policy.ts";
import type { BotSpec, BotStack } from "../spec/bot-spec.ts";
import { BotSpecError, botSpecHash, validateBotSpec } from "../spec/bot-spec.ts";
import { resolveStack } from "../targets/catalog.ts";
import { renderAiogramProject } from "./templates/aiogram.ts";
import { renderGrammyProject } from "./templates/grammy.ts";
import type { TemplateFile } from "./templates/shared.ts";
import { assertNoTokenLiteral } from "./templates/shared.ts";

export interface ScaffoldResult {
  /** Destination directory, relative to the path policy root. */
  readonly root: string;
  readonly stack: BotStack;
  readonly specHash: string;
  /** Written files, relative to the path policy root (they include `root`). */
  readonly files: readonly FileRef[];
  readonly nextSteps: readonly string[];
}

export interface ScaffoldRequest {
  readonly destination: string;
  readonly spec: unknown;
  readonly overwrite?: boolean;
}

export interface ScaffoldOptions {
  readonly policy: PathPolicy;
  readonly now: () => Date;
}

interface CommittedFile {
  readonly target: string;
  readonly backup: string | null;
}

// eslint-disable-next-line no-control-regex -- error text must lose control bytes
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;
const STAGING_INFIX = ".aurifex-staging-";
const BACKUP_DIR = ".backup";

// Generated files carry user data; treat any non-ASCII control byte in error
// details as untrusted and strip it before it reaches logs or JSON output.
function controlSafe(value: string): string {
  return value.replace(CONTROL_CHARS_RE, "?");
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function pathInfo(
  path: string,
): Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean } | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function nextSteps(spec: BotSpec): readonly string[] {
  const steps = ["cp .env.example .env", "set BOT_TOKEN and WEBHOOK_SECRET in .env"];
  if (spec.stack === "grammy") {
    steps.push("bun install", "bun run typecheck && bun test");
    if (spec.storage.postgres) steps.push("bun run db:generate && bun run db:migrate");
  } else {
    steps.push("uv sync && uv run pytest");
    if (spec.storage.postgres) steps.push("uv run alembic upgrade head");
  }
  return steps;
}

function render(spec: BotSpec): TemplateFile[] {
  const target = resolveStack(spec.stack).target;
  const files =
    spec.stack === "grammy" ? renderGrammyProject(spec, target) : renderAiogramProject(spec);
  assertNoTokenLiteral(files);
  return files.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Staging writes bypass PathPolicy.writeFile on purpose: they need "wx" plus a
// same-directory atomic rename at commit time, which the policy cannot express.
async function writeStaging(staging: string, files: readonly TemplateFile[]): Promise<void> {
  for (const file of files) {
    const target = join(staging, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, { flag: "wx", mode: file.mode ?? 0o644 });
  }
}

async function rollback(staging: string, committed: readonly CommittedFile[]): Promise<void> {
  for (const entry of committed.toReversed()) {
    try {
      if (entry.backup === null) {
        await rm(entry.target, { force: true });
      } else {
        await copyFile(entry.backup, entry.target);
      }
    } catch {
      // Best effort: keep restoring the remaining originals.
    }
  }
  await rm(staging, { recursive: true, force: true }).catch(() => undefined);
}

async function commitOverwrite(
  destination: string,
  staging: string,
  files: readonly TemplateFile[],
  policy: PathPolicy,
): Promise<void> {
  const committed: CommittedFile[] = [];
  try {
    for (const file of files) {
      const target = join(destination, file.path);
      const parentRelative = relative(policy.root, dirname(target)).split(sep).join("/");
      if (parentRelative !== "") await policy.ensureDir(parentRelative);
      const existing = await pathInfo(target);
      if (existing !== null) {
        if (existing.isSymbolicLink() || !existing.isFile()) {
          throw new Error(`unsafe overwrite target: ${file.path}`);
        }
        const backup = join(staging, BACKUP_DIR, file.path);
        await mkdir(dirname(backup), { recursive: true });
        await copyFile(target, backup);
        committed.push({ target, backup });
      } else {
        committed.push({ target, backup: null });
      }
      await rename(join(staging, file.path), target);
    }
  } catch (error) {
    await rollback(staging, committed);
    throw error;
  }
  await rm(staging, { recursive: true, force: true });
}

function failureFromError(error: unknown): DomainResult<ScaffoldResult> {
  if (error instanceof BotSpecError) {
    return domainFailure({
      code: "invalid_request",
      detail: controlSafe(error.message),
      retryable: false,
      details: { path: controlSafe(error.path), message: controlSafe(error.message) },
    });
  }
  if (error instanceof PathPolicyError) {
    return domainFailure({
      code: error.code === "unauthorized_path" ? "unauthorized_path" : "invalid_request",
      detail: controlSafe(error.message),
      retryable: false,
    });
  }
  return domainFailure({
    code: "internal_error",
    detail: controlSafe(error instanceof Error ? error.message : "scaffold failed"),
    retryable: true,
  });
}

export async function scaffoldBot(
  request: ScaffoldRequest,
  options: ScaffoldOptions,
): Promise<DomainResult<ScaffoldResult>> {
  const { policy } = options;
  let spec: BotSpec;
  try {
    spec = validateBotSpec(request.spec);
  } catch (error) {
    return failureFromError(error);
  }

  const stagingSuffix = `${process.pid}-${randomBytes(8).toString("hex")}`;
  let staging: string | null = null;

  try {
    const destination = policy.resolve(request.destination);
    if (destination === policy.root) {
      return domainFailure({
        code: "invalid_request",
        detail: "destination must be a directory below the policy root",
        retryable: false,
      });
    }
    const parent = dirname(destination);
    if (parent !== policy.root) {
      const parentRelative = relative(policy.root, parent).split(sep).join("/");
      await policy.ensureDir(parentRelative);
    }

    const destinationInfo = await pathInfo(destination);
    if (destinationInfo !== null) {
      if (destinationInfo.isSymbolicLink()) {
        throw new PathPolicyError("unauthorized_path", "destination must not be a symlink");
      }
      if (!destinationInfo.isDirectory()) {
        if (request.overwrite !== true) {
          return domainFailure({
            code: "destination_exists",
            detail: "destination exists and is not a directory; pass overwrite to replace it",
            retryable: false,
          });
        }
        throw new Error("destination is not a directory");
      }
      const entries = await readdir(destination);
      if (entries.length > 0 && request.overwrite !== true) {
        return domainFailure({
          code: "destination_exists",
          detail: "destination is not empty; pass overwrite to write into it",
          retryable: false,
        });
      }
    }

    const files = render(spec);
    const destinationName = basename(destination);
    staging = join(parent, `${destinationName}${STAGING_INFIX}${stagingSuffix}`);
    await mkdir(staging, { recursive: false });
    await writeStaging(staging, files);

    if (destinationInfo === null || (await readdir(destination)).length === 0) {
      if (destinationInfo !== null) await rmdir(destination);
      await rename(staging, destination);
    } else {
      await commitOverwrite(destination, staging, files, policy);
    }

    const fileRefs: FileRef[] = [];
    for (const file of files) {
      const target = join(destination, file.path);
      const canonical = await realpath(target);
      const info = await lstat(canonical);
      if (!info.isFile()) throw new Error(`rendered file missing: ${file.path}`);
      fileRefs.push({
        path: relative(policy.root, target).split(sep).join("/"),
        bytes: info.size,
        sha256: sha256Hex(file.content),
      });
    }

    return domainSuccess<ScaffoldResult>({
      root: relative(policy.root, destination).split(sep).join("/"),
      stack: spec.stack,
      specHash: botSpecHash(spec),
      files: fileRefs.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      nextSteps: nextSteps(spec),
    });
  } catch (error) {
    if (staging !== null)
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    return failureFromError(error);
  }
}
