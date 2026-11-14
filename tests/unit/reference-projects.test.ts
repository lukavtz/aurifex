import assert from "node:assert/strict";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { LAYOUT } from "../../src/core/layout.ts";
import { verifyBot } from "../../src/core/projects/verify.ts";
import { createPathPolicy } from "../../src/core/security/path-policy.ts";
import { findTelegramTokens } from "../../src/core/security/secrets.ts";
import {
  EXAMPLES,
  copyReference,
  listFiles,
  readProjectFile,
} from "../fixtures/reference-project.ts";

const EXPECTED_CHECKS = [
  "allowlist.present",
  "botapi.104",
  "botapi.104.types",
  "container.non_root",
  "dedupe.fail_closed",
  "deps.lockfile",
  "docker.healthcheck",
  "env.ignored",
  "logs.redaction",
  "miniapp.csp",
  "miniapp.session",
  "payments.schema",
  "payments.validation",
  "queue.schema",
  "queue.worker",
  "retry.retry_after",
  "scan.bounded",
  "secrets.file",
  "telemetry.metrics",
  "telemetry.readiness",
  "tests.infrastructure",
  "tests.present",
  "token.literal",
  "updates.allowed",
  "updates.dedupe",
  "webhook.constant_time",
  "webhook.https",
  "webhook.port",
  "webhook.secret",
];

const PROJECTS = [
  { stack: "grammy", dir: "grammy_commands" },
  { stack: "aiogram", dir: "aiogram_commands" },
] as const;

type Project = (typeof PROJECTS)[number];

function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(line);
    if (match === null) continue;
    values.set(match[1]!, match[2]!.trim().replace(/^['"]|['"]$/g, ""));
  }
  return values;
}

interface DeclaredFeatures {
  readonly queue: boolean;
  readonly payments: boolean;
  readonly miniapp: boolean;
  readonly userSync: boolean;
  readonly migration: boolean;
}

/**
 * A feature is configured only when the project sets a value or starts the
 * service it needs. Tuning keys (`QUEUE_POLL_MS`, `MINIAPP_SESSION_TTL_SECONDS`)
 * ship in every `.env.example` and prove nothing on their own.
 */
async function declaredFeatures(project: Project): Promise<DeclaredFeatures> {
  const root = join(EXAMPLES, project.dir);
  const env = parseEnv(await readProjectFile(root, ".env.example"));
  const compose = (
    await Promise.all(
      ["docker-compose.yml", "compose.yml"].map((path) => readProjectFile(root, path)),
    )
  ).join("\n");
  const set = (...names: readonly string[]): boolean =>
    names.some((name) => (env.get(name) ?? "") !== "");
  return {
    queue: set("QUEUE_ENABLED", "WORKER_ID") || /^\s+worker\w*:/im.test(compose),
    payments: set("PAYMENTS_ENABLED", "STARS_ENABLED", "PROVIDER_TOKEN"),
    miniapp: set("MINIAPP_URL", "MINIAPP_ALLOWED_ORIGINS", "WEBAPP_URL"),
    userSync: set("OWNER_ID", "ADMIN_IDS", "USER_SYNC_ENABLED"),
    migration: set("DATABASE_URL", "DATABASE_URL_FILE"),
  };
}

async function directoryNames(root: string, prefix = ""): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (["node_modules", ".venv", "__pycache__", ".git"].includes(entry.name)) continue;
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    names.push(path);
    names.push(...(await directoryNames(root, path)));
  }
  return names;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

for (const project of PROJECTS) {
  test(`${project.dir}: ships no .aurifex manifest directory`, async () => {
    const root = join(EXAMPLES, project.dir);
    const directories = await directoryNames(root);
    assert.deepEqual(
      directories.filter((path) => path.split("/").includes(".aurifex")),
      [],
    );
    const files = await listFiles(root);
    assert.deepEqual(
      files.filter((path) => path.split("/").includes(".aurifex")),
      [],
    );
    assert.equal(await exists(join(root, ".aurifex")), false);
  });

  test(`${project.dir}: files follow the layout contract for enabled features`, async (t) => {
    const root = join(EXAMPLES, project.dir);
    const files = await listFiles(root);
    const layout = LAYOUT[project.stack];
    const features = await declaredFeatures(project);

    const conditional = [
      ["queue", layout.queue, features.queue],
      ["worker", layout.worker, features.queue],
      ["payments", layout.payments, features.payments],
      ["miniapp", layout.miniapp, features.miniapp],
      ["migration", layout.migration, features.migration],
      ["userSync", layout.userSync, features.userSync],
    ] as const;
    for (const [name, path, enabled] of conditional) {
      if (!enabled) {
        t.diagnostic(`${project.dir}: ${name} is not configured; ${path} not required`);
        continue;
      }
      assert.ok(files.includes(path), `${project.dir}: missing ${name} module ${path}`);
    }

    assert.ok(files.includes(layout.api104), `${project.dir}: missing ${layout.api104}`);
    assert.ok(
      files.some((path) => path.startsWith(layout.tests)),
      `${project.dir}: missing ${layout.tests}`,
    );
    assert.ok(files.includes(layout.lockfile), `${project.dir}: missing ${layout.lockfile}`);
  });

  test(`${project.dir}: README says reference implementation and points at verify`, async () => {
    const root = join(EXAMPLES, project.dir);
    const readme = await readProjectFile(root, "README.md");
    assert.ok(readme.length > 0, "README.md is missing");
    assert.match(readme, /reference implementation/i);
    assert.match(readme, /hand-written/i);
    assert.doesNotMatch(readme, /\bGenerated\b/);
    assert.match(readme, /verify/);
  });

  test(`${project.dir}: deployment and secret hygiene files are present`, async () => {
    const root = join(EXAMPLES, project.dir);
    const files = await listFiles(root);
    for (const path of [".env.example", ".gitignore", "Dockerfile", "docker-compose.yml"]) {
      assert.ok(files.includes(path), `${project.dir}: missing ${path}`);
    }

    const envExample = await readProjectFile(root, ".env.example");
    assert.match(envExample, /^BOT_TOKEN=/m);

    const gitignore = await readProjectFile(root, ".gitignore");
    assert.match(gitignore, /^\.env$/m);

    const dockerfile = await readProjectFile(root, "Dockerfile");
    const user = /^\s*USER\s+(\S+)/m.exec(dockerfile);
    assert.ok(user !== null, `${project.dir}: Dockerfile has no USER line`);
    assert.ok(
      !["root", "0", "0:0"].includes(user[1]!),
      `${project.dir}: container runs as ${user[1]}`,
    );
    assert.match(dockerfile, /^\s*HEALTHCHECK\b/m);

    const compose = await readProjectFile(root, "docker-compose.yml");
    assert.match(compose, /^services:/m);
  });

  test(`${project.dir}: aurifex verify is green with all 29 checks`, async () => {
    const root = join(EXAMPLES, project.dir);
    const policy = await createPathPolicy(root);
    const result = await verifyBot(".", policy);
    assert.ok(result.status === "ok", JSON.stringify(result));
    assert.equal(result.value.ok, true, JSON.stringify(result.value.checks));
    assert.equal(result.value.summary.fail, 0);
    assert.deepEqual(
      result.value.checks.map((check) => check.id),
      EXPECTED_CHECKS,
    );
    assert.equal(result.value.checks.length, 29);
  });

  test(`${project.dir}: no file contains a Telegram bot token literal`, async () => {
    const root = join(EXAMPLES, project.dir);
    const hits: string[] = [];
    for (const path of await listFiles(root)) {
      const text = await readProjectFile(root, path);
      for (const hit of findTelegramTokens(text)) hits.push(`${path}:${hit.line}`);
    }
    assert.deepEqual(hits, []);
  });
}

test("the token scanner detects a runtime-built token in a copied project", async () => {
  const token = ["1234567890", "Ab3".repeat(12)].join(":");
  assert.equal(findTelegramTokens(`const t = "${token}";`).length, 1);

  const reference = await copyReference("grammy");
  try {
    const target = join(reference.root, "src", "config.ts");
    const config = await readProjectFile(reference.root, "src/config.ts");
    await writeFile(target, `${config}\n${token}\n`);
    const planted: string[] = [];
    for (const path of await listFiles(reference.root)) {
      const text = await readProjectFile(reference.root, path);
      if (findTelegramTokens(text).length > 0) planted.push(path);
    }
    assert.deepEqual(planted, ["src/config.ts"]);
  } finally {
    await reference.cleanup();
  }
});
