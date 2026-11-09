import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const BACKUP = join(REPO, "scripts", "backup-postgres.sh");
const RESTORE = join(REPO, "scripts", "restore-postgres.sh");
const LOAD = join(REPO, "scripts", "load-webhook.mjs");
const POSIX = process.platform !== "win32";
const TOKEN_RE = /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/;
const DATABASE_URL = "postgres://aurifex:secret@db:5432/aurifex";

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  child.on("error", reject);
  child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  return promise;
}

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

// Stubs stand in for pg_dump/pg_restore/psql so the shell logic is exercised without Docker.
const STUBS: Readonly<Record<string, string>> = {
  pg_dump: `#!/usr/bin/env bash
set -eu
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-f" ]; then out="$arg"; fi
  case "$arg" in
    --dbname=*) printf '%s\\n' "\${arg#--dbname=}" > "$STUB_DIR/pg_dump.pgdatabase" ;;
  esac
  prev="$arg"
done
printf '%s\\n' "\${PGPASSWORD:-}" > "$STUB_DIR/pg_dump.pgpassword"
printf '%s\\n' "$*" > "$STUB_DIR/pg_dump.args"
[ -n "$out" ] || { echo "stub pg_dump: missing -f" >&2; exit 1; }
printf 'PGDMP' > "$out"
`,
  pg_restore: `#!/usr/bin/env bash
set -eu
for arg in "$@"; do
  case "$arg" in
    --dbname=*) printf '%s\\n' "\${arg#--dbname=}" > "$STUB_DIR/pg_restore.pgdatabase" ;;
  esac
done
printf '%s\\n' "$*" > "$STUB_DIR/pg_restore.args"
`,
  psql: `#!/usr/bin/env bash
set -eu
sql=""
for arg in "$@"; do sql="$arg"; done
printf '%s\\n' "$sql" >> "$STUB_DIR/psql.sql"
if [ -n "\${FAIL_TABLE:-}" ]; then
  case "$sql" in
    *"FROM $FAIL_TABLE"*) echo "ERROR: relation \\"$FAIL_TABLE\\" does not exist" >&2; exit 1 ;;
  esac
fi
case "$sql" in
  *"FROM users"*) echo 7 ;;
  *"FROM payments"*) echo 3 ;;
  *"FROM jobs"*) echo 2 ;;
  *) echo "stub psql: unexpected query: $sql" >&2; exit 1 ;;
esac
`,
};

async function makeStubBin(root: string): Promise<string> {
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  for (const [name, source] of Object.entries(STUBS)) {
    const file = join(bin, name);
    await writeFile(file, source, { mode: 0o755 });
    await chmod(file, 0o755);
  }
  return bin;
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aurifex-ops-"));
}

test("backup-postgres.sh uses safe shell defaults and bounded retention", async () => {
  const source = await readFile(BACKUP, "utf8");
  assert.equal(source.split("\n")[0], "#!/usr/bin/env bash");
  assert.ok(source.includes("set -euo pipefail"));
  assert.ok(source.includes("date -u +%Y%m%dT%H%M%SZ"));
  assert.ok(source.includes("pg_dump -Fc"));
  assert.ok(source.includes("chmod 600"));
  assert.ok(source.includes("umask 077"));
  assert.ok(source.includes("RETENTION_DAYS:-14"));
  assert.ok(source.includes("DATABASE_URL is set but empty"));
  assert.ok(source.includes("POSTGRES_PASSWORD is set but empty"));
  assert.doesNotMatch(source, /echo[^\n]*POSTGRES_PASSWORD/);
  assert.doesNotMatch(source, TOKEN_RE);
});

test("restore-postgres.sh requires --confirm and verifies core tables", async () => {
  const source = await readFile(RESTORE, "utf8");
  assert.equal(source.split("\n")[0], "#!/usr/bin/env bash");
  for (const fragment of [
    "set -euo pipefail",
    "--confirm",
    "pg_restore --clean --if-exists --no-owner",
    'psql --dbname="$DATABASE_URL" -v ON_ERROR_STOP=1',
    "count_rows users",
    "count_rows payments",
    "count_rows jobs",
  ]) {
    assert.ok(source.includes(fragment), `restore script missing: ${fragment}`);
  }
  assert.doesNotMatch(source, /echo[^\n]*DATABASE_URL/);
  assert.doesNotMatch(source, TOKEN_RE);
});

test("load-webhook.mjs pins the load limits and imports autocannon lazily", async () => {
  const source = await readFile(LOAD, "utf8");
  for (const fragment of [
    "const CONNECTIONS = 100",
    "const DURATION_SECONDS = 30",
    "const P95_LIMIT_MS = 250",
    "const ERROR_RATE_LIMIT = 0.001",
    '"x-telegram-bot-api-secret-token"',
    'await import("autocannon")',
    "non2xx === 0",
    "p95Ms <= P95_LIMIT_MS",
    "errorRate <= ERROR_RATE_LIMIT",
  ]) {
    assert.ok(source.includes(fragment), `load script missing: ${fragment}`);
  }
  assert.doesNotMatch(source, /^import\s+[^;]*autocannon/m);
  assert.doesNotMatch(source, TOKEN_RE);
});

test("load-webhook.mjs rejects a missing WEBHOOK_URL before loading autocannon", async () => {
  const result = await run(process.execPath, [LOAD], {
    cwd: REPO,
    env: envWith({ WEBHOOK_URL: "", WEBHOOK_SECRET: "", PATH: process.env.PATH }),
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /WEBHOOK_URL is required/);
});

test("backup-postgres.sh refuses an empty DATABASE_URL", { skip: !POSIX }, async () => {
  const root = await tempRoot();
  try {
    const bin = await makeStubBin(root);
    const result = await run("bash", [BACKUP], {
      cwd: root,
      env: envWith({
        PATH: [bin, process.env.PATH ?? ""].join(delimiter),
        STUB_DIR: root,
        DATABASE_URL: "",
        POSTGRES_PASSWORD: undefined,
      }),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /DATABASE_URL is set but empty/);
    assert.equal(result.stdout, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "backup-postgres.sh writes a private dump, prints only its path, prunes old dumps",
  {
    skip: !POSIX,
  },
  async () => {
    const root = await tempRoot();
    try {
      const bin = await makeStubBin(root);
      const backups = join(root, "backups");
      await mkdir(backups);
      const stale = join(backups, "aurifex-20200101T000000Z.dump");
      await writeFile(stale, "old");
      await run("touch", ["-t", "202001010000", stale], { cwd: root });

      const result = await run("bash", [BACKUP], {
        cwd: root,
        env: envWith({
          PATH: [bin, process.env.PATH ?? ""].join(delimiter),
          STUB_DIR: root,
          DATABASE_URL,
          POSTGRES_PASSWORD: undefined,
        }),
      });

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, "");
      const printed = result.stdout.trim();
      assert.match(printed, /^backups\/aurifex-\d{8}T\d{6}Z\.dump$/);
      assert.equal(result.stdout.trimEnd().split("\n").length, 1);

      const dumpPath = join(root, printed);
      assert.equal(await readFile(dumpPath, "utf8"), "PGDMP");
      assert.equal((await stat(dumpPath)).mode & 0o777, 0o600);
      await assert.rejects(stat(stale));

      const pgdatabase = (await readFile(join(root, "pg_dump.pgdatabase"), "utf8")).trim();
      assert.equal(pgdatabase, DATABASE_URL);
      const args = await readFile(join(root, "pg_dump.args"), "utf8");
      assert.ok(args.includes(`--dbname=${DATABASE_URL}`));
      assert.doesNotMatch(result.stdout + result.stderr, /secret/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("backup-postgres.sh uses POSTGRES_PASSWORD without echoing it", { skip: !POSIX }, async () => {
  const root = await tempRoot();
  try {
    const bin = await makeStubBin(root);
    const result = await run("bash", [BACKUP], {
      cwd: root,
      env: envWith({
        PATH: [bin, process.env.PATH ?? ""].join(delimiter),
        STUB_DIR: root,
        DATABASE_URL: undefined,
        POSTGRES_PASSWORD: "hunter2",
        PGPASSWORD: undefined,
      }),
    });

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /hunter2/);
    const pgpassword = (await readFile(join(root, "pg_dump.pgpassword"), "utf8")).trim();
    assert.equal(pgpassword, "hunter2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore-postgres.sh refuses to run without --confirm", { skip: !POSIX }, async () => {
  const root = await tempRoot();
  try {
    const bin = await makeStubBin(root);
    const result = await run("bash", [RESTORE, join(root, "missing.dump")], {
      cwd: root,
      env: envWith({
        PATH: [bin, process.env.PATH ?? ""].join(delimiter),
        STUB_DIR: root,
        DATABASE_URL,
      }),
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /--confirm is required/);
    await assert.rejects(stat(join(root, "pg_restore.args")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore-postgres.sh restores and prints table counts as JSON", { skip: !POSIX }, async () => {
  const root = await tempRoot();
  try {
    const bin = await makeStubBin(root);
    const dump = join(root, "snapshot.dump");
    await writeFile(dump, "PGDMP");
    const result = await run("bash", [RESTORE, dump, "--confirm"], {
      cwd: root,
      env: envWith({
        PATH: [bin, process.env.PATH ?? ""].join(delimiter),
        STUB_DIR: root,
        DATABASE_URL,
      }),
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { users: 7, payments: 3, jobs: 2 });

    const args = await readFile(join(root, "pg_restore.args"), "utf8");
    assert.ok(args.includes("--clean"));
    assert.ok(args.includes("--if-exists"));
    assert.ok(args.includes("--no-owner"));
    assert.ok(args.includes(`--dbname=${DATABASE_URL}`));
    assert.doesNotMatch(result.stdout + result.stderr, /secret/);
    const pgdatabase = (await readFile(join(root, "pg_restore.pgdatabase"), "utf8")).trim();
    assert.equal(pgdatabase, DATABASE_URL);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore-postgres.sh fails when a core table is missing", { skip: !POSIX }, async () => {
  const root = await tempRoot();
  try {
    const bin = await makeStubBin(root);
    const dump = join(root, "snapshot.dump");
    await writeFile(dump, "PGDMP");
    const result = await run("bash", [RESTORE, dump, "--confirm"], {
      cwd: root,
      env: envWith({
        PATH: [bin, process.env.PATH ?? ""].join(delimiter),
        STUB_DIR: root,
        DATABASE_URL,
        FAIL_TABLE: "jobs",
      }),
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /jobs/);
    assert.equal(result.stdout, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
