import type { FileRef } from "../results.ts";
import type { PathPolicy } from "../security/path-policy.ts";
import { readOptionalFile } from "../security/path-policy.ts";
import type { BotStack } from "../spec/bot-spec.ts";

export const MANIFEST_PATH = ".aurifex/manifest.json";

export interface AurifexManifest {
  readonly manifestVersion: 1;
  readonly specVersion: string;
  readonly stack: BotStack;
  readonly specHash: string;
  readonly generatedAt: string;
  readonly files: Record<string, string>;
}

export function serializeManifest(manifest: AurifexManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function manifestPath(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, "");
  return trimmed === "" ? MANIFEST_PATH : `${trimmed}/${MANIFEST_PATH}`;
}

function parseManifest(text: string, path: string): AurifexManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`invalid manifest: ${path} is not JSON`);
  }
  const candidate = parsed as Partial<AurifexManifest> | null;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    candidate.manifestVersion !== 1 ||
    typeof candidate.specVersion !== "string" ||
    (candidate.stack !== "grammy" && candidate.stack !== "aiogram") ||
    typeof candidate.specHash !== "string" ||
    typeof candidate.generatedAt !== "string" ||
    typeof candidate.files !== "object" ||
    candidate.files === null ||
    Array.isArray(candidate.files)
  ) {
    throw new Error(`invalid manifest: ${path}`);
  }
  return candidate as AurifexManifest;
}

/** Returns the manifest, or null when the project has none yet. */
export async function readManifest(
  policy: PathPolicy,
  prefix = "",
): Promise<AurifexManifest | null> {
  const path = manifestPath(prefix);
  const text = await readOptionalFile(policy, path);
  return text === null ? null : parseManifest(text, path);
}

export function writeManifest(
  policy: PathPolicy,
  prefix: string,
  manifest: AurifexManifest,
): Promise<FileRef> {
  return policy.writeFile(manifestPath(prefix), serializeManifest(manifest), { overwrite: true });
}