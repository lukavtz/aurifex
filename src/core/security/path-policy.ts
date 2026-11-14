import { constants } from "node:fs";
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
import type { FileHandle } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";

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
  if (process.platform !== "win32" && input.includes("\\")) {
    throw new PathPolicyError("invalid_path", "backslashes are not allowed");
  }
}

function validateRelativeComponents(input: string): void {
  const parts = process.platform === "win32" ? input.split(/[\\/]/) : input.split("/");
  for (const part of parts) {
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

const WRITE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

// O_EXCL refuses an existing entry and O_NOFOLLOW refuses a symlink, so the
// final path component can never be followed. EEXIST/ELOOP is translated to the
// policy's own codes so callers see the reason instead of a raw errno.
async function openExclusive(path: string, mode: number, label: string): Promise<FileHandle> {
  try {
    return await open(path, WRITE_FLAGS, mode);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "ELOOP") throw error;
    const info = await lstat(path).catch(() => undefined);
    if (info?.isSymbolicLink() === true) {
      throw new PathPolicyError("unauthorized_path", `symlink is not allowed: ${label}`);
    }
    if (code === "EEXIST") {
      if (info?.isDirectory() === true) {
        throw new PathPolicyError("not_a_file", `is a directory: ${label}`);
      }
      throw new PathPolicyError("file_exists", `file exists: ${label}`);
    }
    throw error;
  }
}

async function writeExclusive(
  target: string,
  bytes: Buffer,
  mode: number,
  label: string,
): Promise<FileIdentity> {
  const handle = await openExclusive(target, mode, label);
  try {
    await handle.writeFile(bytes);
    const info = await handle.stat();
    return { dev: info.dev, ino: info.ino };
  } finally {
    await handle.close();
  }
}

// The check-then-use window is closed by comparing the committed directory
// entry with the inode this call actually wrote; a swapped or symlinked entry
// fails closed instead of reporting a digest for bytes nobody wrote.
async function assertCommitted(
  target: string,
  label: string,
  identity: FileIdentity,
  expectedBytes: number,
): Promise<void> {
  let info;
  try {
    info = await lstat(target);
  } catch {
    throw new PathPolicyError("not_a_file", `file missing after write: ${label}`);
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new PathPolicyError("unauthorized_path", `unsafe write target: ${label}`);
  }
  if (info.ino !== identity.ino || info.dev !== identity.dev) {
    throw new PathPolicyError("unauthorized_path", `write target was swapped: ${label}`);
  }
  if (info.size !== expectedBytes) {
    throw new PathPolicyError("unauthorized_path", `write target changed size: ${label}`);
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
    const parent = dirname(target);
    if (parent === target) throw new PathPolicyError("invalid_path", "cannot write to root");
    await ensureDirectoryPath(root, parent);

    const bytes = Buffer.from(content, "utf8");
    const mode = options.mode ?? 0o644;
    let identity: FileIdentity;
    if (options.overwrite !== true) {
      identity = await writeExclusive(target, bytes, mode, relativePath);
    } else {
      let existing;
      try {
        existing = await lstat(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (existing?.isSymbolicLink() === true) {
        throw new PathPolicyError("unauthorized_path", `symlink is not allowed: ${relativePath}`);
      }
      if (existing?.isDirectory() === true) {
        throw new PathPolicyError("not_a_file", `is a directory: ${relativePath}`);
      }
      const tempPath = join(parent, `.${basename(target)}.tmp-${process.pid}-${Date.now()}`);
      identity = await writeExclusive(tempPath, bytes, mode, relativePath);
      try {
        // Re-check immediately before committing: rename replaces a directory
        // entry without following it, but a symlink that appeared after the
        // first check is refused rather than replaced.
        await ensureDirectoryPath(root, parent);
        let current;
        try {
          current = await lstat(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (current?.isSymbolicLink() === true) {
          throw new PathPolicyError("unauthorized_path", `symlink is not allowed: ${relativePath}`);
        }
        if (current?.isDirectory() === true) {
          throw new PathPolicyError("not_a_file", `is a directory: ${relativePath}`);
        }
        await rename(tempPath, target);
      } catch (error) {
        await unlink(tempPath).catch(() => undefined);
        throw error;
      }
    }

    await assertCommitted(target, relativePath, identity, bytes.byteLength);
    return {
      path: relative(root, target).split(sep).join("/"),
      bytes: bytes.byteLength,
      sha256: sha256Hex(bytes),
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
