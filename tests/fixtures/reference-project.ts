import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO = resolve(import.meta.dirname, "..", "..");
export const EXAMPLES = join(REPO, "examples");

const SOURCES = { grammy: "grammy_commands", aiogram: "aiogram_commands" } as const;

/** Copies a reference project into a temporary directory so tests can mutate it. */
export async function copyReference(stack: keyof typeof SOURCES = "grammy"): Promise<{
  readonly root: string;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), `aurifex-reference-${stack}-`));
  await cp(join(EXAMPLES, SOURCES[stack]), root, {
    recursive: true,
    filter: (path) => !path.includes("node_modules") && !path.includes(".venv"),
  });
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Every regular file under `dir`, relative to it, skipping build output. */
export async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(dir, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (["node_modules", ".venv", "__pycache__", ".git"].includes(entry.name)) continue;
      files.push(...(await listFiles(dir, path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.toSorted();
}

/** Reads a file from a copied project, or returns an empty string when absent. */
export async function readProjectFile(root: string, path: string): Promise<string> {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    return "";
  }
}
