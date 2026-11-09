import { createHash } from "node:crypto";

export const BOT_SPEC_VERSION = "bot-spec-1.1.0" as const;

export const BOT_LOCALES = ["en", "ru", "zh"] as const;
export type BotLocale = (typeof BOT_LOCALES)[number];

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
    readonly defaultLocale: BotLocale;
    readonly en: boolean;
    readonly ru: boolean;
    readonly zh: boolean;
  };
  readonly security: {
    readonly webhookSecret: true;
    readonly adminAllowlist: boolean;
    readonly rateLimit: boolean;
    readonly idempotency: boolean;
  };
  readonly runtime: {
    readonly queue: "postgres" | "none";
    readonly telemetry: {
      readonly otlp: boolean;
      readonly prometheus: boolean;
      readonly sentry: boolean;
    };
  };
  readonly miniapps?: {
    readonly sessionTtlSeconds: number;
    readonly allowedOrigins: readonly string[];
  };
  readonly payments?: {
    readonly products: readonly {
      readonly id: string;
      readonly title: string;
      readonly description: string;
      readonly stars: number;
      readonly subscription: boolean;
    }[];
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

const LEGACY_SPEC_VERSION = "bot-spec-1.0.0" as const;
const MIGRATION_HINT = "run aurifex upgrade --apply";
const PAYMENT_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const QUEUE_FEATURES: Readonly<Record<string, true>> = {
  llm: true,
  broadcast: true,
  payments: true,
};
const MINIAPP_TTL_DEFAULT = 86_400;
const MINIAPP_TTL_MIN = 300;
const MINIAPP_TTL_MAX = 2_592_000;

function integer(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new BotSpecError(path, `expected an integer between ${min} and ${max}`);
  }
  return value;
}

function httpsOrigin(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BotSpecError(path, "expected an https origin");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BotSpecError(path, "expected an https origin");
  }
  if (url.protocol !== "https:" || url.hostname === "") {
    throw new BotSpecError(path, "expected an https origin");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new BotSpecError(path, "must not include a path, query, or fragment");
  }
  if (value !== url.origin) {
    throw new BotSpecError(path, "expected a canonical https origin");
  }
  return url.origin;
}

function withMigrationHint(error: unknown): unknown {
  if (!(error instanceof BotSpecError)) return error;
  const prefix = `${error.path}: `;
  const detail = error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : error.message;
  return new BotSpecError(error.path, `${detail} (${MIGRATION_HINT})`);
}

export function validateBotSpec(input: unknown): BotSpec {
  const root = record(input, "spec");
  if (root.schemaVersion === LEGACY_SPEC_VERSION) {
    try {
      return parseSpec(root, true);
    } catch (error) {
      throw withMigrationHint(error);
    }
  }
  return parseSpec(root, false);
}

function parseSpec(root: Record<string, unknown>, legacy: boolean): BotSpec {
  if (root.schemaVersion !== BOT_SPEC_VERSION && root.schemaVersion !== LEGACY_SPEC_VERSION) {
    throw new BotSpecError("spec.schemaVersion", `expected ${BOT_SPEC_VERSION}`);
  }
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
      "runtime",
      "miniapps",
      "payments",
    ],
    "spec",
  );
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
  rejectUnknown(i18n, ["defaultLocale", "en", "ru", "zh"], "spec.i18n");
  const defaultLocale = i18n.defaultLocale;
  if (defaultLocale !== "en" && defaultLocale !== "ru" && defaultLocale !== "zh") {
    throw new BotSpecError("spec.i18n.defaultLocale", "expected en, ru, or zh");
  }
  const en = boolean(i18n.en, "spec.i18n.en");
  const ru = boolean(i18n.ru, "spec.i18n.ru");
  const zh = i18n.zh === undefined ? false : boolean(i18n.zh, "spec.i18n.zh");
  const locales: Record<BotLocale, boolean> = { en, ru, zh };
  if (!en && !ru && !zh) throw new BotSpecError("spec.i18n", "at least one locale is required");
  if (!locales[defaultLocale]) {
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
  const adminAllowlist = boolean(security.adminAllowlist, "spec.security.adminAllowlist");
  const rateLimit = boolean(security.rateLimit, "spec.security.rateLimit");
  const idempotency = boolean(security.idempotency, "spec.security.idempotency");

  let payments: BotSpec["payments"];
  if (root.payments !== undefined) {
    if (!features.includes("payments")) {
      throw new BotSpecError("spec.payments", 'requires the "payments" feature');
    }
    const input = record(root.payments, "spec.payments");
    rejectUnknown(input, ["products"], "spec.payments");
    if (!Array.isArray(input.products) || input.products.length === 0) {
      throw new BotSpecError("spec.payments.products", "expected a nonempty array");
    }
    const products: Array<{
      id: string;
      title: string;
      description: string;
      stars: number;
      subscription: boolean;
    }> = [];
    const seen = new Set<string>();
    for (const [index, entry] of input.products.entries()) {
      const productPath = `spec.payments.products[${index}]`;
      const product = record(entry, productPath);
      rejectUnknown(product, ["id", "title", "description", "stars", "subscription"], productPath);
      const id = string(product.id, `${productPath}.id`, 32);
      if (!PAYMENT_ID_RE.test(id)) {
        throw new BotSpecError(`${productPath}.id`, "must match ^[a-z][a-z0-9_]{1,31}$");
      }
      if (seen.has(id)) {
        throw new BotSpecError(`${productPath}.id`, "duplicate product id");
      }
      seen.add(id);
      products.push({
        id,
        title: string(product.title, `${productPath}.title`, 32),
        description: string(product.description, `${productPath}.description`, 255),
        stars: integer(product.stars, `${productPath}.stars`, 1, 10_000),
        subscription: boolean(product.subscription, `${productPath}.subscription`),
      });
    }
    payments = { products };
  }

  let miniapps: BotSpec["miniapps"];
  if (root.miniapps !== undefined) {
    const input = record(root.miniapps, "spec.miniapps");
    rejectUnknown(input, ["sessionTtlSeconds", "allowedOrigins"], "spec.miniapps");
    const sessionTtlSeconds =
      input.sessionTtlSeconds === undefined
        ? MINIAPP_TTL_DEFAULT
        : integer(
            input.sessionTtlSeconds,
            "spec.miniapps.sessionTtlSeconds",
            MINIAPP_TTL_MIN,
            MINIAPP_TTL_MAX,
          );
    const rawOrigins = input.allowedOrigins === undefined ? [] : input.allowedOrigins;
    if (!Array.isArray(rawOrigins)) {
      throw new BotSpecError("spec.miniapps.allowedOrigins", "expected an array");
    }
    const allowedOrigins = rawOrigins.map((origin, index) =>
      httpsOrigin(origin, `spec.miniapps.allowedOrigins[${index}]`),
    );
    miniapps = { sessionTtlSeconds, allowedOrigins };
  }

  const queued = features.some((feature) => QUEUE_FEATURES[feature] === true);
  let runtime: BotSpec["runtime"];
  if (root.runtime === undefined) {
    if (!legacy) {
      throw new BotSpecError("spec.runtime", `runtime is required for ${BOT_SPEC_VERSION}`);
    }
    runtime = {
      queue: queued && postgres ? "postgres" : "none",
      telemetry: { otlp: false, prometheus: false, sentry: false },
    };
  } else {
    const input = record(root.runtime, "spec.runtime");
    rejectUnknown(input, ["queue", "telemetry"], "spec.runtime");
    if (input.queue !== "postgres" && input.queue !== "none") {
      throw new BotSpecError("spec.runtime.queue", "expected postgres or none");
    }
    const telemetry = record(input.telemetry, "spec.runtime.telemetry");
    rejectUnknown(telemetry, ["otlp", "prometheus", "sentry"], "spec.runtime.telemetry");
    runtime = {
      queue: input.queue,
      telemetry: {
        otlp: boolean(telemetry.otlp, "spec.runtime.telemetry.otlp"),
        prometheus: boolean(telemetry.prometheus, "spec.runtime.telemetry.prometheus"),
        sentry: boolean(telemetry.sentry, "spec.runtime.telemetry.sentry"),
      },
    };
  }

  if (queued) {
    if (!postgres) {
      throw new BotSpecError(
        "spec.storage.postgres",
        "llm, broadcast, and payments require postgres",
      );
    }
    if (runtime.queue !== "postgres") {
      throw new BotSpecError(
        "spec.runtime.queue",
        'must be "postgres" when llm, broadcast, or payments is enabled',
      );
    }
  } else if (runtime.queue !== "none") {
    throw new BotSpecError(
      "spec.runtime.queue",
      'must be "none" without llm, broadcast, or payments',
    );
  }
  if ((idempotency || rateLimit) && !redis) {
    throw new BotSpecError("spec.storage.redis", "idempotency and rate limiting require redis");
  }
  if (miniapps !== undefined && !redis) {
    throw new BotSpecError("spec.storage.redis", "miniapps require redis for session storage");
  }

  return {
    schemaVersion: BOT_SPEC_VERSION,
    name,
    displayName,
    stack,
    features,
    deployment: "docker",
    storage: { postgres, redis },
    i18n: { defaultLocale, en, ru, zh },
    security: { webhookSecret: true, adminAllowlist, rateLimit, idempotency },
    runtime,
    ...(miniapps === undefined ? {} : { miniapps }),
    ...(payments === undefined ? {} : { payments }),
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
