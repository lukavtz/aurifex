import { createHash } from "node:crypto";

export const BOT_SPEC_VERSION = "bot-spec-1.0.0" as const;

export const BOT_FEATURES = [
  "commands",
  "llm",
  "inline",
  "payments",
  "miniapps",
  "moderation",
  "broadcast",
  "widgets",
  "rich",
] as const;

export type BotFeature = (typeof BOT_FEATURES)[number];
export type BotStack = "grammy" | "aiogram";

export interface BotSpec {
  readonly schemaVersion: typeof BOT_SPEC_VERSION;
  readonly name: string;
  readonly displayName: string;
  readonly stack: BotStack;
  readonly features: readonly BotFeature[];
  readonly deployment: "docker";
  readonly storage: {
    readonly postgres: boolean;
    readonly redis: boolean;
  };
  readonly i18n: {
    readonly defaultLocale: "en" | "ru";
    readonly en: boolean;
    readonly ru: boolean;
  };
  readonly security: {
    readonly webhookSecret: true;
    readonly adminAllowlist: boolean;
    readonly rateLimit: boolean;
    readonly idempotency: boolean;
  };
}

export class BotSpecError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "BotSpecError";
    this.path = path;
  }
}

const NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;
const FEATURE_NAME_RE = /^[a-z][a-z0-9_]{1,31}$/;
const RESERVED_FEATURE_NAMES: Readonly<Record<string, true>> = {
  index: true,
  main: true,
  bot: true,
  config: true,
  admin: true,
  start: true,
  help: true,
};
const FEATURE_SET = Object.fromEntries(BOT_FEATURES.map((feature) => [feature, true])) as Readonly<
  Record<string, true>
>;

export function validateFeatureName(name: string): string {
  if (!FEATURE_NAME_RE.test(name)) {
    throw new BotSpecError("feature.name", "must match ^[a-z][a-z0-9_]{1,31}$");
  }
  if (RESERVED_FEATURE_NAMES[name] === true) {
    throw new BotSpecError("feature.name", "is reserved");
  }
  return name;
}

export function assertFeature(value: string): BotFeature {
  if (FEATURE_SET[value] !== true) {
    throw new BotSpecError("feature", `unknown feature: ${value}`);
  }
  return value as BotFeature;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BotSpecError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new BotSpecError(path, "expected a boolean");
  return value;
}

function string(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BotSpecError(path, "expected a nonempty string");
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BotSpecError(path, `exceeds ${max} characters`);
  if (
    [...trimmed].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  ) {
    throw new BotSpecError(path, "contains control characters");
  }
  return trimmed;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new BotSpecError(`${path}.${key}`, "unknown field");
  }
}

export function validateBotSpec(input: unknown): BotSpec {
  const root = record(input, "spec");
  rejectUnknown(
    root,
    [
      "schemaVersion",
      "name",
      "displayName",
      "stack",
      "features",
      "deployment",
      "storage",
      "i18n",
      "security",
    ],
    "spec",
  );
  if (root.schemaVersion !== BOT_SPEC_VERSION) {
    throw new BotSpecError("spec.schemaVersion", `expected ${BOT_SPEC_VERSION}`);
  }
  const name = string(root.name, "spec.name", 64);
  if (!NAME_RE.test(name)) {
    throw new BotSpecError("spec.name", "must match ^[a-z][a-z0-9_]{1,63}$");
  }
  const displayName = string(root.displayName, "spec.displayName", 128);
  const stack = root.stack;
  if (stack !== "grammy" && stack !== "aiogram") {
    throw new BotSpecError("spec.stack", "expected grammy or aiogram");
  }
  if (!Array.isArray(root.features) || root.features.length === 0) {
    throw new BotSpecError("spec.features", "expected a nonempty array");
  }
  const features: BotFeature[] = [];
  for (const [index, feature] of root.features.entries()) {
    if (typeof feature !== "string" || FEATURE_SET[feature] !== true) {
      throw new BotSpecError(`spec.features[${index}]`, "unknown feature");
    }
    if (features.includes(feature as BotFeature)) {
      throw new BotSpecError(`spec.features[${index}]`, "duplicate feature");
    }
    features.push(feature as BotFeature);
  }
  if (!features.includes("commands")) {
    throw new BotSpecError("spec.features", "commands is mandatory");
  }
  if (root.deployment !== "docker") {
    throw new BotSpecError("spec.deployment", "v0.1.0 supports docker only");
  }
  const storage = record(root.storage, "spec.storage");
  rejectUnknown(storage, ["postgres", "redis"], "spec.storage");
  const postgres = boolean(storage.postgres, "spec.storage.postgres");
  const redis = boolean(storage.redis, "spec.storage.redis");
  const i18n = record(root.i18n, "spec.i18n");
  rejectUnknown(i18n, ["defaultLocale", "en", "ru"], "spec.i18n");
  const defaultLocale = i18n.defaultLocale;
  if (defaultLocale !== "en" && defaultLocale !== "ru") {
    throw new BotSpecError("spec.i18n.defaultLocale", "expected en or ru");
  }
  const en = boolean(i18n.en, "spec.i18n.en");
  const ru = boolean(i18n.ru, "spec.i18n.ru");
  if (!en && !ru) throw new BotSpecError("spec.i18n", "at least one locale is required");
  if (defaultLocale === "en" && !en) {
    throw new BotSpecError("spec.i18n.defaultLocale", "default locale is not enabled");
  }
  if (defaultLocale === "ru" && !ru) {
    throw new BotSpecError("spec.i18n.defaultLocale", "default locale is not enabled");
  }
  const security = record(root.security, "spec.security");
  rejectUnknown(
    security,
    ["webhookSecret", "adminAllowlist", "rateLimit", "idempotency"],
    "spec.security",
  );
  if (security.webhookSecret !== true) {
    throw new BotSpecError("spec.security.webhookSecret", "webhook secret is mandatory");
  }
  return {
    schemaVersion: BOT_SPEC_VERSION,
    name,
    displayName,
    stack,
    features,
    deployment: "docker",
    storage: { postgres, redis },
    i18n: { defaultLocale, en, ru },
    security: {
      webhookSecret: true,
      adminAllowlist: boolean(security.adminAllowlist, "spec.security.adminAllowlist"),
      rateLimit: boolean(security.rateLimit, "spec.security.rateLimit"),
      idempotency: boolean(security.idempotency, "spec.security.idempotency"),
    },
  };
}

export function botSpecHash(spec: BotSpec): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

export function slugToTitle(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

export function pythonModuleName(name: string): string {
  return name.replace(/[^a-z0-9_]/g, "_");
}

export function envPrefix(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}
