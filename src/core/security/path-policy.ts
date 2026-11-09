import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";

import type { FileRef } from "../results.ts";
import { sha256Hex } from "../results.ts";

export type PathPolicyErrorCode =
  | "invalid_path"
  | "unauthorized_path"
  | "file_too_large"
  | "file_exists"
  | "not_a_file"
  | "not_a_directory";

export class PathPolicyError extends Error {
  readonly code: PathPolicyErrorCode;

  constructor(code: PathPolicyErrorCode, message: string) {
    super(message);
    this.name = "PathPolicyError";
    this.code = code;
  }
}

export interface PathPolicy {
  readonly root: string;
  resolve(relativeOrAbsolute: string): string;
  resolveExisting(relativeOrAbsolute: string): Promise<string>;
  readText(relativePath: string, maxBytes?: number): Promise<string>;
  writeFile(
    relativePath: string,
    content: string,
    options?: { readonly overwrite?: boolean; readonly mode?: number },
  ): Promise<FileRef>;
  ensureDir(relativePath: string): Promise<string>;
  listFiles(relativePath?: string): Promise<string[]>;
  removeFile(relativePath: string): Promise<void>;
}

const IGNORED_DIRECTORIES: Readonly<Record<string, true>> = {
  ".git": true,
  node_modules: true,
  dist: true,
  raw: true,
  coverage: true,
  ".venv": true,
  __pycache__: true,
};

const DEFAULT_MAX_BYTES = 1_048_576;

function contains(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function validateInput(input: string): void {
  if (typeof input !== "string" || input.length === 0) {
    throw new PathPolicyError("invalid_path", "path must be a nonempty string");
  }
  if (input.includes("\0")) throw new PathPolicyError("invalid_path", "path contains NUL");
  if (input.includes("\\"))
    throw new PathPolicyError("invalid_path", "backslashes are not allowed");
}

function validateRelativeComponents(input: string): void {
  for (const part of input.split("/")) {
    if (part === "" || part === "." || part === "..") {
      throw new PathPolicyError("invalid_path", `invalid path component: ${part || "empty"}`);
    }
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function ensureDirectoryPath(root: string, target: string): Promise<void> {
  const rel = relative(root, target);
  if (rel === "") return;
  validateRelativeComponents(rel.split(sep).join("/"));
  let current = root;
  for (const component of rel.split(sep)) {
    current = join(current, component);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { recursive: false });
      info = await lstat(current);
    }
    if (info.isSymbolicLink()) {
      throw new PathPolicyError("unauthorized_path", `symlink is not allowed: ${current}`);
    }
    if (!info.isDirectory()) {
      throw new PathPolicyError("not_a_directory", `not a directory: ${current}`);
    }
  }
  const canonical = await realpath(target);
  if (!contains(root, canonical)) {
    throw new PathPolicyError("unauthorized_path", `path escapes root: ${target}`);
  }
}

export async function createPathPolicy(rootInput: string): Promise<PathPolicy> {
  const root = await realpath(resolvePath(rootInput));
  if (!(await isDirectory(root))) {
    throw new PathPolicyError("not_a_directory", `not a directory: ${rootInput}`);
  }

  function resolve(relativeOrAbsolute: string): string {
    validateInput(relativeOrAbsolute);
    const absolute = isAbsolute(relativeOrAbsolute);
    const candidate = absolute
      ? resolvePath(relativeOrAbsolute)
      : resolvePath(join(root, relativeOrAbsolute));
    if (!contains(root, candidate)) {
      throw new PathPolicyError("unauthorized_path", `path escapes root: ${relativeOrAbsolute}`);
    }
    if (!absolute) validateRelativeComponents(relativeOrAbsolute);
    return candidate;
  }

  async function resolveExisting(relativeOrAbsolute: string): Promise<string> {
    validateInput(relativeOrAbsolute);
    const candidate = isAbsolute(relativeOrAbsolute)
      ? resolvePath(relativeOrAbsolute)
      : resolve(relativeOrAbsolute);
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (!contains(root, candidate)) {
          throw new PathPolicyError(
            "unauthorized_path",
            `path escapes root: ${relativeOrAbsolute}`,
          );
        }
        throw new PathPolicyError("not_a_file", `path not found: ${relativeOrAbsolute}`);
      }
      throw error;
    }
    if (!contains(root, canonical)) {
      throw new PathPolicyError("unauthorized_path", `path escapes root: ${relativeOrAbsolute}`);
    }
    return canonical;
  }

  async function ensureDir(relativePath: string): Promise<string> {
    const target = resolve(relativePath);
    await ensureDirectoryPath(root, target);
    return target;
  }

  async function readText(relativePath: string, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
    const target = resolve(relativePath);
    let info;
    try {
      info = await lstat(target);
    } catch {
      throw new PathPolicyError("not_a_file", `file not found: ${relativePath}`);
    }
    if (info.isSymbolicLink()) {
      throw new PathPolicyError("unauthorized_path", `symlink is not allowed: ${relativePath}`);
    }
    if (!info.isFile()) throw new PathPolicyError("not_a_file", `not a file: ${relativePath}`);
    if (info.size > maxBytes) {
      throw new PathPolicyError(
        "file_too_large",
        `file exceeds ${maxBytes} bytes: ${relativePath}`,
      );
    }
    const canonical = await realpath(target);
    if (!contains(root, canonical)) {
      throw new PathPolicyError("unauthorized_path", `path escapes root: ${relativePath}`);
    }
    return readFile(canonical, "utf8");
  }

  async function writeFile(
    relativePath: string,
    content: string,
    options: { readonly overwrite?: boolean; readonly mode?: number } = {},
  ): Promise<FileRef> {
    const target = resolve(relativePath);
    const parent = resolvePath(target, "..");
    if (parent === target) throw new PathPolicyError("invalid_path", "cannot write to root");
    await ensureDirectoryPath(root, parent);

    let existing;
    try {
      existing = await lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing) {
      if (existing.isSymbolicLink()) {
        throw new PathPolicyError("unauthorized_path", `symlink is not allowed: ${relativePath}`);
      }
      if (existing.isDirectory()) {
        throw new PathPolicyError("not_a_file", `is a directory: ${relativePath}`);
      }
      if (options.overwrite !== true) {
        throw new PathPolicyError("file_exists", `file exists: ${relativePath}`);
      }
    }

    const mode = options.mode ?? 0o644;
    if (existing) {
      const tempPath = join(
        parent,
        `.${target.split(sep).at(-1)}.tmp-${process.pid}-${Date.now()}`,
      );
      const handle = await open(tempPath, "wx", mode);
      try {
        await handle.writeFile(content, "utf8");
      } finally {
        await handle.close();
      }
      try {
        await rename(tempPath, target);
      } catch (error) {
        await unlink(tempPath).catch(() => undefined);
        throw error;
      }
    } else {
      const handle = await open(target, "wx", mode);
      try {
        await handle.writeFile(content, "utf8");
      } finally {
        await handle.close();
      }
    }

    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new PathPolicyError("unauthorized_path", `unsafe write target: ${relativePath}`);
    }
    return {
      path: relative(root, target).split(sep).join("/"),
      bytes: info.size,
      sha256: sha256Hex(content),
    };
  }

  async function listFiles(relativePath?: string): Promise<string[]> {
    const start = relativePath === undefined ? root : resolve(relativePath);
    const canonicalStart = await realpath(start);
    if (!contains(root, canonicalStart)) {
      throw new PathPolicyError("unauthorized_path", `path escapes root: ${relativePath ?? "."}`);
    }
    const startInfo = await lstat(start);
    if (startInfo.isSymbolicLink()) {
      throw new PathPolicyError("unauthorized_path", `symlink is not allowed: ${relativePath}`);
    }
    if (!startInfo.isDirectory()) {
      throw new PathPolicyError("not_a_directory", `not a directory: ${relativePath}`);
    }
    const result: string[] = [];
    async function walk(directory: string): Promise<void> {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORIES[entry.name] === true) continue;
          await walk(full);
          continue;
        }
        if (entry.isFile()) result.push(relative(root, full).split(sep).join("/"));
      }
    }
    await walk(start);
    return result.toSorted();
  }

  async function removeFile(relativePath: string): Promise<void> {
    const target = resolve(relativePath);
    let canonicalTarget: string;
    try {
      canonicalTarget = await realpath(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!contains(root, canonicalTarget)) {
      throw new PathPolicyError("unauthorized_path", `path escapes root: ${relativePath}`);
    }
    let info;
    try {
      info = await lstat(target);
    } catch {
      return;
    }
    if (info.isSymbolicLink()) {
      throw new PathPolicyError("unauthorized_path", `symlink is not allowed: ${relativePath}`);
    }
    if (!info.isFile()) throw new PathPolicyError("not_a_file", `not a file: ${relativePath}`);
    await unlink(target);
  }

  return {
    root,
    resolve,
    resolveExisting,
    readText,
    writeFile,
    ensureDir,
    listFiles,
    removeFile,
  };
}

export async function readOptionalFile(policy: PathPolicy, path: string): Promise<string | null> {
  try {
    return await policy.readText(path);
  } catch (error) {
    if (error instanceof PathPolicyError && error.code === "not_a_file") return null;
    throw error;
  }
}

export async function safeRemoveEmptyDir(policy: PathPolicy, path: string): Promise<void> {
  try {
    await rm(policy.resolve(path), { recursive: false });
  } catch {
    // Directory is not empty or already gone; leave it in place.
  }
}

export { DEFAULT_MAX_BYTES };
