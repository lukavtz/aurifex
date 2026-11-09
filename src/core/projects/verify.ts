import { relative, sep } from "node:path";

import type { Check, CheckStatus, DomainFailure, DomainResult } from "../results.ts";
import { domainFailure, domainSuccess } from "../results.ts";
import { PathPolicyError } from "../security/path-policy.ts";
import type { PathPolicy } from "../security/path-policy.ts";
import { findTelegramTokens } from "../security/secrets.ts";

export interface VerifyResult {
  readonly ok: boolean;
  readonly checks: readonly Check[];
  readonly summary: { readonly pass: number; readonly warn: number; readonly fail: number };
}

interface ProjectFile {
  readonly path: string;
  readonly content: string;
}

interface WebhookUrl {
  readonly path: string;
  readonly line: number;
  readonly value: string;
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

const WEBHOOK_PORTS: Readonly<Record<string, true>> = {
  "": true,
  "443": true,
  "80": true,
  "88": true,
  "8443": true,
};

function clip(text: string): string {
  return text.length <= MAX_DETAIL ? text : `${text.slice(0, MAX_DETAIL - 1)}…`;
}

function isBinary(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXTENSIONS[extension] === true;
}

function make(
  id: string,
  status: CheckStatus,
  detail: string,
  evidence?: { readonly path: string; readonly line?: number },
): Check {
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

const MAX_TOTAL_BYTES = 64 * 1_048_576;

interface ProjectSnapshot {
  readonly prefix: string;
  readonly files: readonly ProjectFile[];
  readonly oversized: readonly string[];
  readonly truncated: boolean;
}

async function projectFiles(policy: PathPolicy, projectRoot: string): Promise<ProjectSnapshot> {
  const normalized = projectRoot === "." || projectRoot === "" ? undefined : projectRoot;
  const rel =
    normalized === undefined
      ? ""
      : relative(policy.root, await policy.resolveExisting(normalized))
          .split(sep)
          .join("/");
  const listed = normalized === undefined ? await policy.listFiles() : await policy.listFiles(rel);
  const prefix = rel === "" ? "" : `${rel}/`;
  const files: ProjectFile[] = [];
  const oversized: string[] = [];
  let totalBytes = 0;
  let truncated = false;
  for (const path of listed) {
    if (isBinary(path)) continue;
    try {
      const content = await policy.readText(path);
      totalBytes += Buffer.byteLength(content, "utf8");
      if (totalBytes > MAX_TOTAL_BYTES) {
        truncated = true;
        break;
      }
      files.push({ path, content });
    } catch (error) {
      if (error instanceof PathPolicyError && error.code === "file_too_large") {
        oversized.push(path);
        continue;
      }
      if (error instanceof PathPolicyError && error.code === "not_a_file") continue;
      throw error;
    }
  }
  return { prefix, files, oversized, truncated };
}

function checkTokenLiteral(snapshot: ProjectSnapshot): Check {
  if (snapshot.oversized.length > 0) {
    return make(
      "token.literal",
      "fail",
      `cannot scan oversized file(s) for tokens: ${snapshot.oversized.slice(0, 3).join(", ")}`,
      { path: snapshot.oversized[0] ?? "unknown" },
    );
  }
  const hits: Array<{ path: string; line: number; redacted: string }> = [];
  for (const file of snapshot.files) {
    for (const hit of findTelegramTokens(file.content)) {
      hits.push({ path: file.path, line: hit.line, redacted: hit.redacted });
    }
  }
  if (hits.length === 0) {
    return make("token.literal", "pass", "no Telegram bot token literal found");
  }
  const first = hits[0];
  const shown = hits
    .slice(0, 5)
    .map((hit) => `${hit.path}:${hit.line} (${hit.redacted})`)
    .join(", ");
  const more = hits.length > 5 ? ` and ${hits.length - 5} more` : "";
  return make(
    "token.literal",
    "fail",
    `found ${hits.length} token literal(s): ${shown}${more}`,
    first === undefined ? undefined : { path: first.path, line: first.line },
  );
}

function checkEnvIgnored(files: readonly ProjectFile[], prefix: string): Check {
  const envPath = `${prefix}.env`;
  const envFile = files.find((file) => file.path === envPath);
  if (envFile !== undefined) {
    return make("env.ignored", "fail", ".env file present; secrets must not be committed", {
      path: envFile.path,
    });
  }
  const gitignore = files.find((file) => file.path === `${prefix}.gitignore`);
  if (gitignore === undefined) {
    return make("env.ignored", "fail", ".gitignore is missing; .env is not ignored");
  }
  const ignoresEnv = gitignore.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === ".env" || line === "/.env" || line === ".env.*" || line === ".env*");
  return ignoresEnv
    ? make("env.ignored", "pass", ".env is not present and .gitignore covers it", {
        path: gitignore.path,
      })
    : make("env.ignored", "fail", ".gitignore does not list .env", { path: gitignore.path });
}

function checkWebhookSecret(files: readonly ProjectFile[]): Check {
  const marker = files.find(
    (file) =>
      !/\.md$/i.test(file.path) &&
      (file.content.includes("secretToken") ||
        /\bsecret_token\s*=/.test(file.content) ||
        file.content.includes("X-Telegram-Bot-Api-Secret-Token")),
  );
  return marker === undefined
    ? make(
        "webhook.secret",
        "fail",
        "no webhook secret wiring found (secretToken, secret_token=, or secret header)",
      )
    : make("webhook.secret", "pass", "webhook secret token is wired", { path: marker.path });
}

function scanWebhookUrls(files: readonly ProjectFile[]): {
  readonly urls: readonly WebhookUrl[];
  readonly assignments: readonly WebhookUrl[];
} {
  const urls: WebhookUrl[] = [];
  const assignments: WebhookUrl[] = [];
  for (const file of files) {
    if (/(^|\/)tests?\//.test(file.path) || /(^|\/)test_[^/]+\.py$/.test(file.path)) continue;
    const lines = file.content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (/webhook/i.test(line)) {
        for (const match of line.match(/https?:\/\/[^\s"'<>`]+/g) ?? []) {
          urls.push({ path: file.path, line: index + 1, value: match });
        }
      }
      const base = file.path.split("/").at(-1) ?? "";
      const deployConfig =
        base.startsWith(".env") ||
        /\.ya?ml$/i.test(base) ||
        base === "Dockerfile" ||
        base === "Caddyfile";
      if (deployConfig) {
        const assigned = /(?:WEBHOOK_URL|webhook_url|webhookUrl)\s*[=:]\s*["']?([^\s"'#]+)/.exec(
          line,
        );
        const value = assigned?.[1];
        if (value !== undefined && value !== "") {
          if (!value.startsWith("$") && !value.startsWith("process.")) {
            assignments.push({ path: file.path, line: index + 1, value });
          }
        }
      }
    }
  }
  return { urls, assignments };
}

function checkWebhookHttps(files: readonly ProjectFile[]): Check {
  const { urls, assignments } = scanWebhookUrls(files);
  const insecureUrl = urls.find((url) => url.value.startsWith("http://"));
  if (insecureUrl !== undefined) {
    return make("webhook.https", "fail", "webhook URL uses http:// instead of https://", {
      path: insecureUrl.path,
      line: insecureUrl.line,
    });
  }
  const insecureAssignment = assignments.find(
    (entry) => !entry.value.startsWith("https://") && !entry.value.startsWith("http://"),
  );
  if (insecureAssignment !== undefined) {
    return make(
      "webhook.https",
      "fail",
      `WEBHOOK_URL is not an https URL: ${insecureAssignment.value}`,
      { path: insecureAssignment.path, line: insecureAssignment.line },
    );
  }
  return make("webhook.https", "pass", "webhook URLs use https or are unset");
}

function checkWebhookPort(files: readonly ProjectFile[]): Check {
  const { urls, assignments } = scanWebhookUrls(files);
  const candidates = [...urls, ...assignments.filter((entry) => entry.value.startsWith("http"))];
  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate.value);
    } catch {
      continue;
    }
    if (WEBHOOK_PORTS[parsed.port] !== true) {
      return make("webhook.port", "fail", `webhook URL port ${parsed.port} is not allowed`, {
        path: candidate.path,
        line: candidate.line,
      });
    }
  }
  return make("webhook.port", "pass", "webhook URLs use an allowed port");
}

function checkConstantTime(files: readonly ProjectFile[]): Check {
  for (const file of files) {
    if (/(^|\/)tests?\//.test(file.path) || /(^|\/)test_[^/]+\.py$/.test(file.path)) continue;
    const lines = file.content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (
        /(?:X-Telegram-Bot-Api-Secret-Token|secret[_-]?token)[^\n]{0,160}(?:===|==|!==|!=)/i.test(
          line,
        )
      ) {
        return make(
          "webhook.constant_time",
          "fail",
          "custom secret header comparison must be constant-time",
          { path: file.path, line: index + 1 },
        );
      }
    }
  }
  const framework = files.find(
    (file) =>
      (file.content.includes("webhookCallback") && file.content.includes("secretToken")) ||
      (file.content.includes("SimpleRequestHandler") && file.content.includes("secret_token")),
  );
  if (framework !== undefined) {
    return make(
      "webhook.constant_time",
      "pass",
      "framework webhook callback validates the secret header",
      { path: framework.path },
    );
  }
  return make("webhook.constant_time", "pass", "no non-constant-time secret comparison found");
}

function checkContainerNonRoot(files: readonly ProjectFile[], prefix: string): Check {
  const dockerfile = files.find((file) => file.path === `${prefix}Dockerfile`);
  if (dockerfile === undefined) {
    return make("container.non_root", "fail", "Dockerfile is missing");
  }
  const users = [...dockerfile.content.matchAll(/^\s*USER\s+(\S+)/gim)].map((match) => match[1]);
  const user = users.at(-1);
  if (user === undefined) {
    return make("container.non_root", "fail", "Dockerfile has no USER line", {
      path: dockerfile.path,
    });
  }
  return user === "root" || user === "0"
    ? make("container.non_root", "fail", "container runs as root", { path: dockerfile.path })
    : make("container.non_root", "pass", `container runs as ${user}`, { path: dockerfile.path });
}

function checkMarker(
  files: readonly ProjectFile[],
  id: string,
  patterns: readonly RegExp[],
  failDetail: string,
  passDetail: string,
): Check {
  const found = files.find((file) => patterns.some((pattern) => pattern.test(file.content)));
  return found === undefined
    ? make(id, "fail", failDetail)
    : make(id, "pass", passDetail, { path: found.path });
}

function checkWarnMarker(
  files: readonly ProjectFile[],
  id: string,
  patterns: readonly RegExp[],
  passDetail: string,
  warnDetail: string,
): Check {
  const found = files.find((file) => patterns.some((pattern) => pattern.test(file.content)));
  return found === undefined
    ? make(id, "warn", warnDetail)
    : make(id, "pass", passDetail, { path: found.path });
}

function checkTestsPresent(files: readonly ProjectFile[], prefix: string): Check {
  const found = files.find(
    (file) => file.path.startsWith(`${prefix}tests/`) || /(^|\/)test_[^/]+\.py$/.test(file.path),
  );
  return found === undefined
    ? make("tests.present", "fail", "no tests directory or test_*.py file found")
    : make("tests.present", "pass", "tests are present", { path: found.path });
}

function checkBotApi104(files: readonly ProjectFile[]): Check {
  const adapter = files.find(
    (file) =>
      file.path.endsWith("src/telegram/api104.ts") || file.path.endsWith("app/services/api104.py"),
  );
  const detail =
    "framework types cover Bot API 10.3; Bot API 10.4 is supported through the typed raw adapter";
  if (adapter === undefined) {
    return make("botapi.104", "fail", `${detail} (adapter file is missing)`);
  }
  const required = adapter.path.endsWith(".py")
    ? ["SendWidget", "AnswerWidgetQuery", "SendRichMessage"]
    : ["sendWidget", "answerWidgetQuery", "sendRichMessage"];
  const missing = required.filter((symbol) => !adapter.content.includes(symbol));
  return missing.length === 0
    ? make("botapi.104", "pass", detail, { path: adapter.path })
    : make("botapi.104", "fail", `${detail} (adapter is missing ${missing.join(", ")})`, {
        path: adapter.path,
      });
}

function checkLockfile(files: readonly ProjectFile[], prefix: string): Check {
  const names = ["bun.lock", "package-lock.json", "uv.lock"];
  const found = files.find((file) => names.some((name) => file.path === `${prefix}${name}`));
  return found === undefined
    ? make("deps.lockfile", "warn", "no bun.lock, package-lock.json, or uv.lock found")
    : make("deps.lockfile", "pass", "dependency lockfile is committed", { path: found.path });
}

const QUEUE_MODULES = ["src/runtime/queue.ts", "app/runtime/queue.py"] as const;
const PAYMENTS_MODULES = ["src/runtime/payments.ts", "app/runtime/payments.py"] as const;
const MINIAPP_MODULES = [
  "src/runtime/miniapp-session.ts",
  "app/runtime/miniapp_session.py",
] as const;
const WORKER_MODULES = ["src/worker.ts", "app/worker.py"] as const;

function isTestPath(path: string): boolean {
  return /(^|\/)tests?\//.test(path) || /(^|\/)test_[^/]+\.py$/.test(path);
}

function findModule(
  files: readonly ProjectFile[],
  suffixes: readonly string[],
): ProjectFile | undefined {
  return files.find(
    (file) =>
      !isTestPath(file.path) &&
      suffixes.some((suffix) => file.path === suffix || file.path.endsWith(`/${suffix}`)),
  );
}

function checkQueueWorker(files: readonly ProjectFile[]): Check {
  const configured = files.some(
    (file) =>
      findModule([file], QUEUE_MODULES) !== undefined ||
      (!isTestPath(file.path) && file.content.includes("QUEUE_POLL_MS")),
  );
  if (!configured) return make("queue.worker", "pass", "no queue configured");
  const worker = findModule(files, WORKER_MODULES);
  return worker === undefined
    ? make(
        "queue.worker",
        "fail",
        "queue is configured but no src/worker.ts or app/worker.py entrypoint exists",
        { path: findModule(files, QUEUE_MODULES)?.path ?? "unknown" },
      )
    : make("queue.worker", "pass", "queue worker entrypoint is present", { path: worker.path });
}

function checkQueueSchema(files: readonly ProjectFile[]): Check {
  const configured = files.some(
    (file) =>
      findModule([file], QUEUE_MODULES) !== undefined ||
      (!isTestPath(file.path) && file.content.includes("QUEUE_POLL_MS")),
  );
  if (!configured) return make("queue.schema", "pass", "no queue configured");
  const text = files.map((file) => file.content).join("\n");
  const missing = [
    ["jobs table", /\bjobs\b/],
    ["idempotency_key", /idempotency_key/],
    ["FOR UPDATE SKIP LOCKED", /FOR UPDATE SKIP LOCKED/],
  ]
    .filter(([, pattern]) => !(pattern as RegExp).test(text))
    .map(([label]) => label);
  return missing.length === 0
    ? make("queue.schema", "pass", "jobs table, idempotency_key, and SKIP LOCKED claim query found")
    : make("queue.schema", "fail", `queue schema is missing ${missing.join(", ")}`);
}

function checkPaymentsSchema(files: readonly ProjectFile[]): Check {
  const runtime = findModule(files, PAYMENTS_MODULES);
  if (runtime === undefined) return make("payments.schema", "pass", "payments are not enabled");
  const text = files.map((file) => file.content).join("\n");
  const missing = ["charge_id", "refunds", "subscriptions"].filter(
    (needle) => !text.includes(needle),
  );
  return missing.length === 0
    ? make("payments.schema", "pass", "payments, refunds, and subscriptions schema found", {
        path: runtime.path,
      })
    : make("payments.schema", "fail", `payments schema is missing ${missing.join(", ")}`, {
        path: runtime.path,
      });
}

function checkPaymentsValidation(files: readonly ProjectFile[]): Check {
  const runtime = findModule(files, PAYMENTS_MODULES);
  if (runtime === undefined) return make("payments.validation", "pass", "payments are not enabled");
  const text = files.map((file) => file.content).join("\n");
  const missing = ["invoice_payload", "currency", "total_amount"].filter(
    (needle) => !text.includes(needle),
  );
  return missing.length === 0
    ? make("payments.validation", "pass", "successful payment validates payload, currency, and amount", {
        path: runtime.path,
      })
    : make("payments.validation", "fail", `successful payment validation is missing ${missing.join(", ")}`, {
        path: runtime.path,
      });
}

function checkSecretsFile(files: readonly ProjectFile[]): Check {
  const configFiles = files.filter(
    (file) => /(^|\/)(?:config|secrets)[^/]*$/.test(file.path) || /(^|\/)\.env/.test(file.path),
  );
  const text = configFiles.map((file) => file.content).join("\n");
  const missing = ["BOT_TOKEN_FILE", "WEBHOOK_SECRET_FILE"].filter(
    (needle) => !text.includes(needle),
  );
  return missing.length === 0
    ? make("secrets.file", "pass", "config reads BOT_TOKEN_FILE and WEBHOOK_SECRET_FILE")
    : make("secrets.file", "fail", `config is missing ${missing.join(", ")} indirection`);
}

function checkTelemetryReadiness(files: readonly ProjectFile[]): Check {
  const text = files.map((file) => file.content).join("\n");
  const missing = (
    [
      ["/readyz", /\/readyz/],
      ["SELECT 1 or PING", /SELECT 1|\bPING\b/],
    ] as const
  )
    .filter(([, pattern]) => !pattern.test(text))
    .map(([label]) => label);
  return missing.length === 0
    ? make("telemetry.readiness", "pass", "readiness endpoint checks dependencies")
    : make("telemetry.readiness", "fail", `readiness endpoint is missing ${missing.join(", ")}`);
}

function checkTelemetryMetrics(files: readonly ProjectFile[]): Check {
  const found = files.find((file) => file.content.includes("/metrics"));
  return found === undefined
    ? make("telemetry.metrics", "warn", "metrics disabled: no /metrics route")
    : make("telemetry.metrics", "pass", "/metrics route is exposed", { path: found.path });
}

function checkMiniappSession(files: readonly ProjectFile[]): Check {
  const module = findModule(files, MINIAPP_MODULES);
  if (module === undefined) return make("miniapp.session", "pass", "miniapp is not enabled");
  const text = files.map((file) => file.content).join("\n");
  const missing = (
    [
      ["HttpOnly cookie", "HttpOnly"],
      ["server-side session key", "miniapp:session"],
    ] as const
  )
    .filter(([, needle]) => !text.includes(needle))
    .map(([label]) => label);
  return missing.length === 0
    ? make("miniapp.session", "pass", "miniapp session uses an HttpOnly cookie stored server-side", {
        path: module.path,
      })
    : make("miniapp.session", "fail", `miniapp session is missing ${missing.join(", ")}`, {
        path: module.path,
      });
}

function checkMiniappCsp(files: readonly ProjectFile[]): Check {
  const module = findModule(files, MINIAPP_MODULES);
  if (module === undefined) return make("miniapp.csp", "pass", "miniapp is not enabled");
  return files
    .map((file) => file.content)
    .join("\n")
    .includes("Content-Security-Policy")
    ? make("miniapp.csp", "pass", "miniapp responses set Content-Security-Policy", {
        path: module.path,
      })
    : make("miniapp.csp", "fail", "miniapp responses are missing Content-Security-Policy", {
        path: module.path,
      });
}

function checkBotApi104Types(files: readonly ProjectFile[]): Check {
  const text = files.map((file) => file.content).join("\n");
  const missing = ["TonWalletCard", "ChatShareTheme", "RichTextTonAddress"].filter(
    (needle) => !text.includes(needle),
  );
  return missing.length === 0
    ? make("botapi.104.types", "pass", "TON wallet, share theme, and rich address types are present")
    : make("botapi.104.types", "fail", `Bot API 10.4 types are missing ${missing.join(", ")}`);
}

function checkDockerHealthcheck(files: readonly ProjectFile[]): Check {
  const dockerfile = files.find((file) => /(^|\/)Dockerfile$/.test(file.path));
  if (dockerfile === undefined) return make("docker.healthcheck", "fail", "Dockerfile is missing");
  return /^\s*HEALTHCHECK\b/im.test(dockerfile.content)
    ? make("docker.healthcheck", "pass", "Dockerfile defines a HEALTHCHECK", {
        path: dockerfile.path,
      })
    : make("docker.healthcheck", "fail", "Dockerfile has no HEALTHCHECK", {
        path: dockerfile.path,
      });
}

function checkDedupeFailClosed(files: readonly ProjectFile[]): Check {
  const dedupe = files.find(
    (file) => !isTestPath(file.path) && /(^|\/)dedupe\.(?:ts|js|py)$/.test(file.path),
  );
  if (dedupe === undefined) return make("dedupe.fail_closed", "pass", "dedupe is not enabled");
  const failOpen =
    /catch[\s\S]{0,300}?return\s+true/.test(dedupe.content) ||
    /except[\s\S]{0,300}?return\s+True/.test(dedupe.content);
  return failOpen
    ? make("dedupe.fail_closed", "fail", "dedupe returns true on error instead of failing closed", {
        path: dedupe.path,
      })
    : make("dedupe.fail_closed", "pass", "dedupe does not fail open on errors", {
        path: dedupe.path,
      });
}

function checkTestsInfrastructure(files: readonly ProjectFile[]): Check {
  const tests = files.filter((file) => isTestPath(file.path));
  const found = tests.find((file) =>
    /AURIFEX_INFRA|testcontainers|\bpostgres\b|\bredis\b/i.test(file.content),
  );
  return found === undefined
    ? make("tests.infrastructure", "warn", "no Postgres/Redis integration test found")
    : make("tests.infrastructure", "pass", "infrastructure test is present", {
        path: found.path,
      });
}

/**
 * Verification gate. Every check is evaluated from static file contents only; no project
 * code is executed and no network call is made.
 */
export async function verifyBot(
  projectRoot: string,
  policy: PathPolicy,
): Promise<DomainResult<VerifyResult>> {
  try {
    const snapshot = await projectFiles(policy, projectRoot);
    const { prefix, files } = snapshot;
    const checks: Check[] = [
      checkTokenLiteral(snapshot),
      make(
        "scan.bounded",
        snapshot.truncated ? "fail" : "pass",
        snapshot.truncated
          ? `verification stopped after ${MAX_TOTAL_BYTES} bytes; narrow the project root`
          : "verification scanned every text file within the byte budget",
      ),
      checkEnvIgnored(files, prefix),
      checkWebhookSecret(files),
      checkWebhookHttps(files),
      checkWebhookPort(files),
      checkConstantTime(files),
      checkContainerNonRoot(files, prefix),
      checkMarker(
        files,
        "updates.allowed",
        [/allowed_updates/, /allowedUpdates/],
        "no allowed_updates configuration found",
        "allowed updates are restricted",
      ),
      checkMarker(
        files,
        "updates.dedupe",
        [/update_id/],
        "no update_id deduplication found",
        "update_id deduplication is present",
      ),
      checkMarker(
        files,
        "retry.retry_after",
        [/retry_after/],
        "no retry_after handling found",
        "retry_after handling is present",
      ),
      checkTestsPresent(files, prefix),
      checkBotApi104(files),
      checkBotApi104Types(files),
      checkLockfile(files, prefix),
      checkQueueWorker(files),
      checkQueueSchema(files),
      checkPaymentsSchema(files),
      checkPaymentsValidation(files),
      checkSecretsFile(files),
      checkTelemetryReadiness(files),
      checkTelemetryMetrics(files),
      checkMiniappSession(files),
      checkMiniappCsp(files),
      checkDockerHealthcheck(files),
      checkDedupeFailClosed(files),
      checkTestsInfrastructure(files),
      checkWarnMarker(
        files,
        "logs.redaction",
        [/\bredact\b/, /redact_keys/],
        "logger redacts secrets",
        "logger redaction not detected",
      ),
      checkWarnMarker(
        files,
        "allowlist.present",
        [/ADMIN_IDS/, /\bisAdmin\b/],
        "admin allowlist is present",
        "admin allowlist not detected",
      ),
    ];
    checks.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const summary = { pass: 0, warn: 0, fail: 0 };
    for (const check of checks) summary[check.status] += 1;
    return domainSuccess({ ok: summary.fail === 0, checks, summary });
  } catch (error) {
    return toFailure(error, policy);
  }
}
