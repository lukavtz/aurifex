import { relative, sep } from "node:path";

import type { BotStack } from "../spec/bot-spec.ts";
import type { CheckStatus, DomainFailure, DomainResult } from "../results.ts";
import { domainFailure, domainSuccess } from "../results.ts";
import { PathPolicyError } from "../security/path-policy.ts";
import type { PathPolicy } from "../security/path-policy.ts";

export interface Finding {
  readonly id: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly evidence?: { readonly path: string; readonly line?: number };
}

export interface InspectResult {
  readonly stack: BotStack | "unknown";
  readonly frameworkVersion?: string;
  readonly mode: "webhook" | "polling" | "unknown";
  readonly botApi: "10.4";
  readonly rawGap: "10.3";
  readonly findings: readonly Finding[];
}

interface SourceFile {
  readonly path: string;
  readonly content: string;
}

const MAX_DETAIL = 480;

const BINARY_EXTENSIONS: Readonly<Record<string, true>> = {
  png: true,
  jpg: true,
  jpeg: true,
  gif: true,
  webp: true,
  avif: true,
  ico: true,
  pdf: true,
  zip: true,
  gz: true,
  tgz: true,
  br: true,
  woff: true,
  woff2: true,
  ttf: true,
  eot: true,
  otf: true,
  mp3: true,
  mp4: true,
  webm: true,
  ogg: true,
  wav: true,
  wasm: true,
  so: true,
  dylib: true,
  node: true,
  exe: true,
  dll: true,
  bin: true,
  db: true,
  sqlite: true,
  sqlite3: true,
  pyc: true,
  class: true,
  jar: true,
  glb: true,
  gltf: true,
};

function clip(text: string): string {
  return text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL - 1)}…`;
}

function finding(
  id: string,
  status: CheckStatus,
  detail: string,
  evidence?: { readonly path: string; readonly line?: number },
): Finding {
  return evidence === undefined
    ? { id, status, detail: clip(detail) }
    : { id, status, detail: clip(detail), evidence };
}

function toFailure(error: unknown, policy: PathPolicy): DomainFailure {
  if (error instanceof PathPolicyError) {
    return domainFailure({
      code: error.code,
      detail: clip(error.message.split(policy.root).join("<root>")),
      retryable: false,
    });
  }
  if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    return domainFailure({
      code: "project_unreadable",
      detail: "project root does not exist",
      retryable: false,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return domainFailure({
    code: "internal_error",
    detail: clip(message.split(policy.root).join("<root>")),
    retryable: false,
  });
}

async function projectSources(
  policy: PathPolicy,
  projectRoot: string,
): Promise<{ readonly prefix: string; readonly files: readonly SourceFile[] }> {
  const normalized = projectRoot === "." || projectRoot === "" ? undefined : projectRoot;
  const rel =
    normalized === undefined
      ? ""
      : relative(policy.root, await policy.resolveExisting(normalized))
          .split(sep)
          .join("/");
  const listed = normalized === undefined ? await policy.listFiles() : await policy.listFiles(rel);
  const files: SourceFile[] = [];
  for (const path of listed) {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    if (BINARY_EXTENSIONS[extension] === true) continue;
    try {
      files.push({ path, content: await policy.readText(path) });
    } catch (error) {
      if (
        error instanceof PathPolicyError &&
        (error.code === "file_too_large" || error.code === "not_a_file")
      ) {
        continue;
      }
      throw error;
    }
  }
  return { prefix: rel === "" ? "" : `${rel}/`, files };
}

interface StackDetection {
  readonly stack: BotStack | "unknown";
  readonly version?: string;
  readonly path?: string;
}

function detectManifest(files: readonly SourceFile[], prefix: string): StackDetection {
  const manifest = files.find((file) => file.path === `${prefix}package.json`);
  if (manifest !== undefined) {
    try {
      const parsed = JSON.parse(manifest.content) as {
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      const version = parsed.dependencies?.grammy ?? parsed.devDependencies?.grammy;
      if (typeof version === "string") {
        return { stack: "grammy", version, path: manifest.path };
      }
    } catch {
      // Malformed manifest is reported as an unknown stack below; never throw here.
    }
  }
  const pyproject = files.find((file) => file.path === `${prefix}pyproject.toml`);
  if (pyproject !== undefined) {
    const match =
      /\baiogram\s*==\s*([0-9][^"'\s,\]]*)/.exec(pyproject.content) ??
      /\baiogram\s*=\s*"([^"]+)"/.exec(pyproject.content);
    if (match?.[1] !== undefined) {
      return { stack: "aiogram", version: match[1], path: pyproject.path };
    }
  }
  return { stack: "unknown" };
}

function detectMode(files: readonly SourceFile[]): {
  readonly mode: "webhook" | "polling" | "unknown";
  readonly path?: string;
  readonly line?: number;
} {
  let polling: { path: string; line: number } | undefined;
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (/webhookCallback|SimpleRequestHandler/.test(line)) {
        return { mode: "webhook", path: file.path, line: index + 1 };
      }
      if (polling === undefined && /start_polling|bot\.start\s*\(/.test(line)) {
        polling = { path: file.path, line: index + 1 };
      }
    }
  }
  return polling === undefined ? { mode: "unknown" } : { mode: "polling", ...polling };
}

/**
 * Static inspection only: manifests and source text are read through the path policy,
 * project code is never executed.
 */
export async function inspectBot(
  projectRoot: string,
  policy: PathPolicy,
): Promise<DomainResult<InspectResult>> {
  try {
    const { prefix, files } = await projectSources(policy, projectRoot);
    const detection = detectManifest(files, prefix);
    const mode = detectMode(files);
    const findings: Finding[] = [
      detection.stack === "unknown"
        ? finding("stack.detected", "warn", "no grammy or aiogram manifest found")
        : finding(
            "stack.detected",
            "pass",
            `${detection.stack} detected`,
            detection.path === undefined ? undefined : { path: detection.path },
          ),
      detection.version === undefined
        ? finding("framework.version", "warn", "framework version not declared")
        : finding(
            "framework.version",
            "pass",
            `framework version ${detection.version}`,
            detection.path === undefined ? undefined : { path: detection.path },
          ),
      mode.mode === "unknown"
        ? finding("mode.detected", "warn", "webhook or polling mode not detected")
        : finding(
            "mode.detected",
            "pass",
            `${mode.mode} mode detected`,
            mode.path === undefined
              ? undefined
              : mode.line === undefined
                ? { path: mode.path }
                : { path: mode.path, line: mode.line },
          ),
      finding("files.scanned", "pass", `${files.length} text file(s) scanned`),
    ];
    const result: InspectResult =
      detection.version === undefined
        ? { stack: detection.stack, mode: mode.mode, botApi: "10.4", rawGap: "10.3", findings }
        : {
            stack: detection.stack,
            frameworkVersion: detection.version,
            mode: mode.mode,
            botApi: "10.4",
            rawGap: "10.3",
            findings,
          };
    return domainSuccess(result);
  } catch (error) {
    return toFailure(error, policy);
  }
}
