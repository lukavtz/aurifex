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
  const listed =
    normalized === undefined ? await policy.listFiles() : await policy.listFiles(normalized);
  const rel =
    normalized === undefined
      ? ""
      : relative(policy.root, policy.resolve(normalized)).split(sep).join("/");
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
      checkLockfile(files, prefix),
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
