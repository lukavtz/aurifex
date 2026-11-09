import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { renderHealthTs, renderTelemetryTs } from "../../src/core/projects/templates/telemetry.ts";
import {
  captureResponse,
  createSandbox,
  INFRA_SKIP,
  startPostgres,
  startRedis,
  type Postgres,
  type Redis,
  type Sandbox,
} from "./pg.ts";

const ENABLED = process.env.AURIFEX_INFRA === "1";

const PROM_STUB = `export const __names = [];
export const __sentry = [];
const metric = (options = {}) => {
  const instance = {
    name: options.name ?? "",
    labelNames: options.labelNames ?? [],
    inc() { return this; },
    observe() { return this; },
    set() { return this; },
    labels() { return this; },
  };
  __names.push(instance.name);
  return instance;
};
export class Counter { constructor(options) { Object.assign(this, metric(options)); } }
export class Gauge { constructor(options) { Object.assign(this, metric(options)); } }
export class Histogram { constructor(options) { Object.assign(this, metric(options)); } }
export const register = { metrics: async () => __names.join("\\n") };
`;

const STUBS: Record<string, string> = {
  "prom-client": PROM_STUB,
  "@opentelemetry/api": "export const trace = { getActiveSpan: () => undefined };\n",
  "@opentelemetry/api/version": "export const VERSION = 'stub';\n",
  "@opentelemetry/exporter-trace-otlp-http":
    "export class OTLPTraceExporter { constructor() {} }\n",
  "@opentelemetry/resources": "export function resourceFromAttributes(value) { return value; }\n",
  "@opentelemetry/sdk-node": `
export const __starts = [];
export class NodeSDK {
  constructor(options) { this.options = options; }
  start() { __starts.push(Object.keys(this.options ?? {})); }
  async shutdown() {}
}
`,
  "@sentry/node": `
export const __inits = [];
export function init(options) { __inits.push(options); }
`,
};

const METRIC_NAMES = [
  "bot_updates_total",
  "telegram_api_duration_seconds",
  "job_duration_seconds",
  "job_failures_total",
  "queue_depth",
  "miniapp_sessions_active",
];

interface HealthModule {
  readyHandler(
    req: unknown,
    res: unknown,
    probes?: {
      postgres?: (() => Promise<void>) | undefined;
      redis?: (() => Promise<void>) | undefined;
      metricsEnabled?: boolean | undefined;
    },
  ): Promise<void>;
  metricsHandler(res: unknown): Promise<void>;
  METRICS_CONTENT_TYPE: string;
}

interface TelemetryModule {
  initTelemetry(config: {
    serviceName: string;
    otlpEndpoint?: string;
    sentryDsn?: string;
  }): Promise<void>;
  metrics: Record<string, { readonly name: string }>;
}

let postgres: Postgres | undefined;
let redis: Redis | undefined;
let sandbox: Sandbox | undefined;
let health: HealthModule | undefined;
let telemetry: TelemetryModule | undefined;

function database(): Postgres {
  assert.ok(postgres, "postgres must be started");
  return postgres;
}

before(async () => {
  if (!ENABLED) return;
  postgres = await startPostgres();
  redis = await startRedis();
  sandbox = await createSandbox(
    {
      "health.ts": renderHealthTs(),
      "telemetry.ts": renderTelemetryTs(),
      "telemetry.js": "export * from './telemetry.ts';\n",
    },
    STUBS,
  );
  health = (await sandbox.import("health.ts")) as unknown as HealthModule;
  telemetry = (await sandbox.import("telemetry.ts")) as unknown as TelemetryModule;
});

after(async () => {
  await sandbox?.dispose();
  await redis?.stop();
  await postgres?.stop();
});

async function healthy(): Promise<void> {
  await database().unsafe("SELECT 1");
}

async function broken(): Promise<void> {
  await database().unsafe("SELECT * FROM missing_table");
}

test(
  "readyz answers 503 when Postgres is unreachable and 200 when it is up",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    assert.ok(health);

    const down = captureResponse();
    await health.readyHandler({}, down.res, { postgres: broken, redis: undefined });
    const downResult = await down.done;
    assert.equal(downResult.status, 503);
    assert.deepEqual(JSON.parse(downResult.body), {
      ok: false,
      checks: { postgres: "fail", redis: "skip" },
    });

    const up = captureResponse();
    await health.readyHandler({}, up.res, {
      postgres: healthy,
      redis: redis?.check,
    });
    const upResult = await up.done;
    assert.equal(upResult.status, 200);
    assert.deepEqual(JSON.parse(upResult.body), {
      ok: true,
      checks: { postgres: "ok", redis: "ok" },
    });
  },
);

test(
  "metrics expose every required metric name",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 60_000 },
  async () => {
    assert.ok(health);
    assert.ok(telemetry);

    const names = Object.values(telemetry.metrics).map((metric) => metric.name);
    for (const name of METRIC_NAMES) assert.ok(names.includes(name), `missing metric ${name}`);

    const metrics = captureResponse();
    await health.metricsHandler(metrics.res);
    const result = await metrics.done;
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], health.METRICS_CONTENT_TYPE);
    for (const name of METRIC_NAMES) assert.ok(result.body.includes(name));

    await telemetry.initTelemetry({ serviceName: "test_bot" });
  },
);
