import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { BROADCAST_SQL, renderBroadcastJobTs } from "../../src/core/projects/templates/jobs.ts";
import { PAYMENTS_SQL } from "../../src/core/projects/templates/payments.ts";
import {
  createRedisFacade,
  createSandbox,
  createSql,
  INFRA_SKIP,
  startPostgres,
  startRedis,
  type Postgres,
  type Redis,
  type Sandbox,
} from "./pg.ts";

const ENABLED = process.env.AURIFEX_INFRA === "1";
const USERS = 250;

interface BroadcastModule {
  handle(job: { id: string; kind: string; payload: unknown }, ctx: unknown): Promise<void>;
}

interface FakeBot {
  readonly sent: number[];
  readonly api: { sendMessage(chatId: number, text: string): Promise<unknown> };
}

let postgres: Postgres | undefined;
let redis: Redis | undefined;
let sandbox: Sandbox | undefined;
let broadcast: BroadcastModule | undefined;

function database(): Postgres {
  assert.ok(postgres, "postgres must be started");
  assert.ok(redis, "redis must be started");
  return postgres;
}

function module(): BroadcastModule {
  assert.ok(broadcast, "broadcast module must be loaded");
  return broadcast;
}

function fakeBot(): FakeBot {
  const sent: number[] = [];
  return {
    sent,
    api: {
      async sendMessage(chatId: number) {
        sent.push(chatId);
        return true;
      },
    },
  };
}

function context(bot: FakeBot): unknown {
  assert.ok(redis, "redis must be started");
  return {
    bot,
    sql: createSql(database()),
    queue: {},
    config: { QUEUE_VISIBILITY_TIMEOUT_SECONDS: 60 },
    redis: createRedisFacade(redis),
  };
}

async function seed(users: number): Promise<void> {
  const db = database();
  await db.exec(PAYMENTS_SQL);
  await db.exec(BROADCAST_SQL);
  await db.exec(
    `INSERT INTO users (id, display_name) SELECT value, 'user' || value
     FROM generate_series(1, ${users}) AS value;`,
  );
}

async function createBroadcast(
  options: { lastUserId?: number; sent?: number } = {},
): Promise<string> {
  const rows = await database().unsafe(
    "INSERT INTO broadcasts (text, created_by, status, last_user_id, sent) VALUES ('hello', 1, 'running', $1, $2) RETURNING id",
    [options.lastUserId ?? 0, options.sent ?? 0],
  );
  const row = rows[0];
  assert.ok(row, "broadcast row must be inserted");
  return String(row.id);
}

const GRAMMY_STUB = `export class GrammyError extends Error {
  constructor(message, errorCode, parameters) {
    super(message);
    this.error_code = errorCode;
    this.parameters = parameters;
  }
}
`;

before(async () => {
  if (!ENABLED) return;
  postgres = await startPostgres();
  redis = await startRedis();
  sandbox = await createSandbox(
    { "broadcast.ts": renderBroadcastJobTs() },
    { grammy: GRAMMY_STUB },
  );
  broadcast = (await sandbox.import("broadcast.ts")) as unknown as BroadcastModule;
});

after(async () => {
  await sandbox?.dispose();
  await redis?.stop();
  await postgres?.stop();
});

beforeEach(async () => {
  if (!ENABLED) return;
  const db = database();
  await db.exec(
    "DROP TABLE IF EXISTS broadcast_deliveries; DROP TABLE IF EXISTS broadcasts; DROP TABLE IF EXISTS subscriptions; DROP TABLE IF EXISTS refunds; DROP TABLE IF EXISTS payments; DROP TABLE IF EXISTS users;",
  );
});

test(
  "two workers deliver to 250 users exactly once at 30 messages per second",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 120_000 },
  async () => {
    await seed(USERS);
    const broadcastId = await createBroadcast();
    const payload = { broadcastId, text: "hello", createdBy: 1 };
    const job = { id: "job-1", kind: "broadcast.send", payload };
    const first = fakeBot();
    const second = fakeBot();

    const started = Date.now();
    await Promise.all([
      module().handle(job, context(first)),
      module().handle(job, context(second)),
    ]);
    const elapsed = Date.now() - started;

    const delivered = await database().unsafe(
      "SELECT count(*) AS total, count(DISTINCT chat_id) AS distinct_chat FROM broadcast_deliveries WHERE broadcast_id = $1 AND status = 'sent'",
      [broadcastId],
    );
    assert.equal(Number(delivered[0]?.total), USERS);
    assert.equal(Number(delivered[0]?.distinct_chat), USERS);

    const sent = [...first.sent, ...second.sent];
    assert.equal(sent.length, USERS);
    assert.equal(new Set(sent).size, USERS);

    // 250 messages at 30/s cannot finish faster than ~8 s even across workers.
    assert.ok(elapsed >= 7_000, `delivery finished in ${elapsed}ms, pacing not applied`);

    assert.ok(redis);
    const keys = await redis.keys("broadcast:rate:*");
    assert.ok(keys.length > 0, "broadcast rate keys must exist in Redis");
    for (const key of keys) {
      assert.ok(Number(await redis.get(key)) <= 30, `rate key ${key} exceeded 30`);
    }

    // Broadcast counters are updated optimistically per worker and can be
    // overwritten by a peer; delivery rows are the source of truth above.
    const status = await database().unsafe("SELECT status FROM broadcasts WHERE id = $1", [
      broadcastId,
    ]);
    assert.equal(status[0]?.status, "done");

    // A completed broadcast is a no-op: nothing is delivered twice.
    const beforeRerun = first.sent.length + second.sent.length;
    await module().handle(job, context(first));
    assert.equal(first.sent.length + second.sent.length, beforeRerun);
  },
);

test(
  "delivery resumes from the stored cursor after a crash",
  { skip: ENABLED ? false : INFRA_SKIP, timeout: 120_000 },
  async () => {
    await seed(USERS);
    const done = 150;
    const broadcastId = await createBroadcast({ lastUserId: done, sent: done });
    await database().exec(
      `INSERT INTO broadcast_deliveries (broadcast_id, chat_id, status)
       SELECT '${broadcastId}', value, 'sent' FROM generate_series(1, ${done}) AS value;`,
    );

    const bot = fakeBot();
    await module().handle(
      {
        id: "job-resume",
        kind: "broadcast.send",
        payload: { broadcastId, text: "hello", createdBy: 1 },
      },
      context(bot),
    );

    assert.equal(bot.sent.length, USERS - done);
    assert.equal(new Set(bot.sent).size, USERS - done);
    assert.ok(bot.sent.every((id) => id > done));

    const delivered = await database().unsafe(
      "SELECT count(*) AS total FROM broadcast_deliveries WHERE broadcast_id = $1 AND status = 'sent'",
      [broadcastId],
    );
    assert.equal(Number(delivered[0]?.total), USERS);
  },
);
