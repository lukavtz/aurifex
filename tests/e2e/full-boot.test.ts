import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { addFeature } from "../../src/core/projects/add-feature.ts";
import { scaffoldBot } from "../../src/core/projects/scaffold.ts";
import { createPathPolicy } from "../../src/core/security/path-policy.ts";
import { BOT_SPEC_VERSION, type BotStack } from "../../src/core/spec/bot-spec.ts";
import { run, startPostgres, startRedis, type Postgres, type Redis } from "../infra/pg.ts";

const ENABLED = process.env.AURIFEX_E2E === "1";
const ARTIFACTS = process.env.AURIFEX_ARTIFACT_DIR ?? join(process.env.RUNNER_TEMP ?? tmpdir(), "aurifex-artifacts");
const TOKEN = ["123456", "A".repeat(32)].join(":");
const PRODUCT = { id: "support", title: "Support", description: "Support the bot", stars: 1, subscription: false };
const FEATURES = ["llm", "broadcast", "payments"] as const;
const CUSTOM = { llm: "assistant", broadcast: "announcer", payments: "store" };
let postgres: Postgres;
let redis: Redis;
let llmUrl = "";
let requests = 0;
const llm = createServer((request, response) => {
  assert.equal(request.url, "/chat/completions");
  assert.equal(request.method, "POST");
  requests++;
  request.resume();
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: "Full boot answer" } }] }));
});

before(async () => {
  if (!ENABLED) return;
  await mkdir(ARTIFACTS, { recursive: true });
  postgres = await startPostgres();
  redis = await startRedis();
  const listening = Promise.withResolvers<void>();
  llm.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = llm.address();
  assert.ok(address && typeof address !== "string");
  llmUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (llm.listening) {
    const closed = Promise.withResolvers<void>();
    llm.close((error) => error ? closed.reject(error) : closed.resolve());
    await closed.promise;
  }
  await redis?.stop();
  await postgres?.stop();
});

function spec(stack: BotStack) {
  return {
    schemaVersion: BOT_SPEC_VERSION,
    name: `docker_${stack}_bot`, displayName: `Docker ${stack} Bot`, stack,
    features: ["commands"], deployment: "docker",
    storage: { postgres: false, redis: false },
    i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
    security: { webhookSecret: true, adminAllowlist: false, rateLimit: false, idempotency: false },
    runtime: { queue: "none", telemetry: { otlp: false, prometheus: false, sentry: false } },
  };
}

const GRAMMY_PROBE = `import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Redis } from "ioredis";
import { createBot } from "./dist/bot.js";
import { loadConfig } from "./dist/config.js";
import { registerFeatures } from "./dist/features/index.js";
const phase = process.env.PHASE;
const feature = process.env.FEATURE;
const config = loadConfig();
const redis = config.REDIS_URL ? new Redis(config.REDIS_URL) : undefined;
const bot = createBot(config);
const info = { id:123456,is_bot:true,first_name:"T",username:"test_bot",can_join_groups:true,can_read_all_group_messages:false,supports_inline_queries:false,can_connect_to_business:false,has_main_web_app:false };
const calls = [];
bot.api.config.use(async (_prev,method,payload,_signal) => {
  calls.push({method,payload});
  const result = method === "getMe" ? info : method === "getStarTransactions" ? {transactions:[]} : method === "createInvoiceLink" ? "https://example.test/invoice" : method === "sendMessage" || method === "sendInvoice" ? {message_id:1,date:0,chat:{id:7,type:"private"},text:payload.text ?? "invoice"} : true;
  return {ok:true,result};
});
await bot.init();
let sql = null, queue = null, client = null;
// Queue modules do not exist before promotion; exercise that import boundary here.
if (phase !== "baseline") {
  const {getDb} = await import("./dist/storage/db.js");
  const {createQueue} = await import("./dist/runtime/queue.js");
  client = getDb(config.DATABASE_URL);
  assert.ok(client);
  sql = client.client;
  queue = createQueue(sql);
}
await registerFeatures({bot,sql,queue,config,redis});
const USER_ID = Number(process.env.USER_ID);
const user = {id:USER_ID,is_bot:false,first_name:"T",language_code:"en"};
let nextId = Number(process.env.UPDATE_BASE);
const message = (text,extra={}) => ({update_id:nextId++,message:{message_id:nextId,date:0,chat:{id:USER_ID,type:"private"},from:user,text,entities:text?.startsWith("/")?[{type:"bot_command",offset:0,length:text.split(" ")[0].length}]:[],...extra}});
await bot.handleUpdate(message("/start"));
assert.ok(calls.some(c=>c.method === "sendMessage" && Number(c.payload.chat_id) === USER_ID), JSON.stringify(calls));
const evidence = {phase,feature,calls,rows:[],zeroProducts:false};
try {
  if (phase !== "baseline") {
    await sql.unsafe("INSERT INTO users (id, username, display_name) VALUES ($1,'test','T') ON CONFLICT (id) DO NOTHING", [USER_ID]);
    if (feature === "payments") {
      const runtime = await import("./dist/runtime/payments.js");
      assert.equal(runtime.PRODUCTS.length,0);
      const count = calls.length;
      await bot.handleUpdate(message("/buy support"));
      assert.equal(calls.slice(count).filter(c=>c.method === "createInvoiceLink" || c.method === "sendInvoice").length,0);
      await bot.handleUpdate({update_id:nextId++,pre_checkout_query:{id:"empty",from:user,currency:"XTR",total_amount:1,invoice_payload:"product:support:user:"+USER_ID+":nonce:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}});
      assert.ok(calls.some(c=>c.method === "answerPreCheckoutQuery" && c.payload.ok === false));
      evidence.zeroProducts = true;
      // Product editing is the public generated-project configuration boundary.
      runtime.PRODUCTS.push(JSON.parse(process.env.PRODUCT));
      await bot.handleUpdate(message("/buy support"));
      assert.ok(calls.some(c=>c.method === "sendInvoice"));
      await bot.handleUpdate(message(undefined,{successful_payment:{currency:"XTR",total_amount:1,invoice_payload:"product:support:user:"+USER_ID+":nonce:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",telegram_payment_charge_id:process.env.CHARGE_ID,provider_payment_charge_id:"provider"}}));
    } else await bot.handleUpdate(message(feature === "llm" ? "/llm hello" : "/broadcast hello"));
    const kind = feature === "llm" ? "llm.request" : feature === "broadcast" ? "broadcast.send" : "payment.fulfill";
    let rows = await sql.unsafe("SELECT id,kind,status FROM jobs WHERE kind=$1",[kind]);
    assert.equal(rows.length,1,JSON.stringify({rows,calls}));
    const {loadJobHandlers} = await import("./dist/jobs/index.js");
    const {runWorker} = await import("./dist/runtime/worker.js");
    const handlers = await loadJobHandlers({bot,sql,queue,config,redis});
    const stop = new AbortController();
    const worker = runWorker(queue,handlers,stop.signal);
    try {
      const deadline = Date.now()+15000;
      do {
        rows = await sql.unsafe("SELECT id,kind,status,last_error FROM jobs WHERE kind=$1",[kind]);
        if (rows[0]?.status === "done" || rows[0]?.last_error) break;
        const tick = Promise.withResolvers();
        setImmediate(tick.resolve);
        await tick.promise;
      } while (Date.now()<deadline);
      assert.equal(rows[0]?.status,"done",JSON.stringify(rows));
      if (feature === "llm") assert.ok(calls.some(c=>c.payload.text === "Full boot answer"));
      if (feature === "broadcast") assert.equal((await sql.unsafe("SELECT status FROM broadcasts"))[0]?.status,"done");
      if (feature === "payments") assert.equal((await sql.unsafe("SELECT status FROM payments"))[0]?.status,"paid");
      evidence.rows = rows;
    } finally { stop.abort(); await worker; }
  }
  await writeFile(process.env.EVIDENCE,JSON.stringify(evidence,null,2));
} finally { if (client) { const {closeDb}=await import("./dist/storage/db.js"); await closeDb(); } await redis?.quit(); }
`;

const AIOGRAM_PROBE = `import asyncio
import importlib
import json
import os
from pathlib import Path
from aiogram.client.session.base import BaseSession
from redis.asyncio import Redis as AsyncRedis
from aiogram.types import Message, Update, User
from sqlalchemy import text
from app.bot import create_bot, create_dispatcher
from app.config import load_settings

class Session(BaseSession):
    def __init__(self):
        super().__init__()
        self.calls = []
    async def close(self):
        pass
    async def stream_content(self, *args, **kwargs):
        if False:
            yield b""
    async def make_request(self, bot, method, timeout=None):
        payload = method.model_dump(exclude_none=True)
        self.calls.append({"method": method.__api_method__, "payload": payload})
        if method.__api_method__ == "getMe":
            return User(id=123456,is_bot=True,first_name="T",username="test_bot")
        if method.__api_method__ == "getStarTransactions":
            from aiogram.types import StarTransactions
            return StarTransactions(transactions=[])
        if method.__api_method__ == "createInvoiceLink":
            return "https://example.test/invoice"
        if method.__api_method__ in ("sendMessage", "sendInvoice"):
            return Message.model_validate({"message_id":1,"date":0,"chat":{"id":7,"type":"private"},"text":payload.get("text","invoice")},context={"bot":bot})
        return True

async def main():
    user_id = int(os.environ["USER_ID"])
    phase = os.environ["PHASE"]
    feature = os.environ["FEATURE"]
    settings = load_settings()
    redis = AsyncRedis.from_url(settings.redis_url, decode_responses=True) if settings.redis_url else None
    bot = create_bot(settings)
    original_session = bot.session
    bot.session = Session()
    await original_session.close()
    dp = create_dispatcher(settings,bot,redis)
    session_factory = dp.workflow_data.get("session_factory")
    queue = dp.workflow_data.get("queue")
    calls = bot.session.calls
    seq = int(os.environ["UPDATE_BASE"])
    async def feed(command=None, **extra):
        # The generated private-chat rate limiter allows one message per second
        # and drops excess updates silently; real users cannot outpace it either.
        await asyncio.sleep(1.1)
        nonlocal seq
        seq += 1
        payload = {"message_id":seq,"date":0,"chat":{"id":user_id,"type":"private"},"from":{"id":user_id,"is_bot":False,"first_name":"T","language_code":"en"},**extra}
        if command is not None:
            payload["text"] = command
            payload["entities"] = [{"type":"bot_command","offset":0,"length":len(command.split()[0])}]
        await dp.feed_update(bot,Update.model_validate({"update_id":seq,"message":payload},context={"bot":bot}))
    await feed("/start")
    assert any(c["method"] == "sendMessage" and int(c["payload"].get("chat_id", 0)) == user_id for c in calls), calls
    evidence = {"phase":phase,"feature":feature,"calls":calls,"rows":[],"zeroProducts":False}
    try:
        if phase != "baseline":
            assert session_factory is not None and queue is not None
            async def query(sql, params=None):
                async with session_factory() as session:
                    async with session.begin():
                        result = await session.execute(text(sql),params or {})
                        return [dict(row) for row in result.mappings()] if result.returns_rows else []
            await query("INSERT INTO users (id,username,display_name) VALUES (:id,'test','T') ON CONFLICT (id) DO NOTHING", {"id":user_id})
            if feature == "payments":
                runtime = importlib.import_module("app.runtime.payments")
                handler_name = os.environ["FEATURE_NAME"]
                handler = importlib.import_module(f"app.handlers.{handler_name}")
                assert runtime.PRODUCTS == ()
                count = len(calls)
                await feed("/buy support")
                assert not any(c["method"] in ("sendInvoice","createInvoiceLink") for c in calls[count:])
                await dp.feed_update(bot,Update.model_validate({"update_id":100+seq,"pre_checkout_query":{"id":"empty","from":{"id":user_id,"is_bot":False,"first_name":"T"},"currency":"XTR","total_amount":1,"invoice_payload":f"product:support:user:{user_id}:nonce:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}},context={"bot":bot}))
                assert any(c["method"] == "answerPreCheckoutQuery" and c["payload"]["ok"] is False for c in calls)
                evidence["zeroProducts"] = True
                product = runtime.PaymentProduct(**json.loads(os.environ["PRODUCT"]))
                runtime.PRODUCTS = handler.PRODUCTS = (product,)
                await feed("/buy support")
                assert any(c["method"] == "sendInvoice" for c in calls)
                await feed(successful_payment={"currency":"XTR","total_amount":1,"invoice_payload":f"product:support:user:{user_id}:nonce:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","telegram_payment_charge_id":os.environ["CHARGE_ID"],"provider_payment_charge_id":"provider"})
            else:
                await feed("/llm hello" if feature == "llm" else "/broadcast hello")
            kind = {"llm":"llm.request","broadcast":"broadcast.send","payments":"payment.fulfill"}[feature]
            rows = await query("SELECT id,kind,status FROM jobs WHERE kind=:kind",{"kind":kind})
            assert len(rows) == 1, (rows, calls)
            from app.jobs import JobContext, load_job_handlers
            from app.runtime.worker import run_worker
            handlers = load_job_handlers(JobContext(bot=bot,session_factory=session_factory,queue=queue,settings=settings,redis=redis))
            stop = asyncio.Event()
            worker = asyncio.create_task(run_worker(queue,handlers,stop,poll_seconds=0.01))
            try:
                async with asyncio.timeout(15):
                    while True:
                        rows = await query("SELECT id,kind,status,last_error FROM jobs WHERE kind=:kind",{"kind":kind})
                        if rows[0]["status"] == "done" or rows[0]["last_error"]:
                            break
                        await asyncio.sleep(0.025)
                assert rows[0]["status"] == "done", rows
                if feature == "llm":
                    assert any(c["payload"].get("text") == "Full boot answer" for c in calls)
                if feature == "broadcast":
                    assert (await query("SELECT status FROM broadcasts"))[0]["status"] == "done"
                if feature == "payments":
                    assert (await query("SELECT status FROM payments"))[0]["status"] == "paid"
                evidence["rows"] = rows
            finally:
                stop.set()
                await worker
        Path(os.environ["EVIDENCE"]).write_text(json.dumps(evidence,default=str,indent=2))
    finally:
        if session_factory is not None:
            await session_factory.kw["bind"].dispose()
        if redis is not None:
            await redis.aclose()
        await bot.session.close()

asyncio.run(main())
`;

for (const stack of ["grammy", "aiogram"] as const) {
  for (const feature of FEATURES) {
    for (const naming of ["canonical", "custom"] as const) {
      const id = `${stack}-${feature}-${naming}`;
      test(`full boot ${id}: commands-only promotion dispatches, enqueues and consumes`, {
        skip: ENABLED ? false : "AURIFEX_E2E=1 required for installed generated projects and service containers", timeout: 600_000,
      }, async () => {
        const root = await mkdtemp(join(tmpdir(), `aurifex-${id}-`));
        const logs: unknown[] = [];
        const artifact = join(ARTIFACTS, id);
        await mkdir(artifact, { recursive: true });
        const project = join(root, "bot");
        const userId = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 7), 16) + 1000000;
        const env = {
          DATABASE_URL: `postgres://postgres:aurifex_test@127.0.0.1:${postgres.port}/fullboot_${Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 7), 16) + 1000000}`,
          REDIS_URL: `redis://127.0.0.1:${redis.port}/0`, LLM_BASE_URL: llmUrl, LLM_MODEL: "fake", LLM_API_KEY: "test-key",
          USER_ID: String(userId), ADMIN_IDS: String(userId),
          CHARGE_ID: `full_boot_${randomUUID()}`, FEATURE: feature, FEATURE_NAME: naming === "canonical" ? feature : CUSTOM[feature], PRODUCT: JSON.stringify(PRODUCT),
          QUEUE_POLL_MS: "10", LOG_LEVEL: "silent", BOT_TOKEN: TOKEN, WEBHOOK_SECRET: "full-boot-secret",
        };
        async function command(binary: string, args: readonly string[], extra: Record<string, string> = {}) {
          const result = await run(binary, args, { cwd: project, env: { ...env, ...extra, NODE_TEST_CONTEXT: undefined }, timeoutMs: 300_000 });
          logs.push({ binary, args, ...result });
          await writeFile(join(artifact, "commands.json"), JSON.stringify(logs, null, 2));
          assert.equal(result.code, 0, `${binary} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
        }
        async function installAndBuild() {
          if (stack === "grammy") {
            await command("bun", ["install"]);
            await command("bun", ["install", "--frozen-lockfile"]);
            await command("bun", ["run", "typecheck"]);
            await command("bun", ["run", "build"]);
          } else {
            await command("uv", ["lock"]);
            await command("uv", ["sync", "--frozen"]);
            await command("uv", ["run", "python", "-m", "compileall", "-q", "app"]);
          }
        }
        async function probe(phase: string) {
          const path = join(project, stack === "grammy" ? "full-boot-probe.mjs" : "full_boot_probe.py");
          await writeFile(path, stack === "grammy" ? GRAMMY_PROBE : AIOGRAM_PROBE);
          await command(stack === "grammy" ? process.execPath : "uv", stack === "grammy" ? [path] : ["run", "python", path], {
            PHASE: phase, EVIDENCE: join(artifact, `${phase}.json`),
            UPDATE_BASE: String(phase === "baseline" ? userId : userId + 100_000),
            ...(phase === "baseline" ? { DATABASE_URL: "", REDIS_URL: "" } : {}),
          });
        }
        try {
          const policy = await createPathPolicy(root);
          const scaffold = await scaffoldBot({ destination: "bot", spec: spec(stack) }, { policy, now: () => new Date(0) });
          assert.equal(scaffold.status, "ok", JSON.stringify(scaffold));
          await installAndBuild();
          await probe("baseline");
          const name = naming === "canonical" ? feature : CUSTOM[feature];
          const added = await addFeature({ projectRoot: "bot", feature, name }, { policy });
          assert.equal(added.status, "ok", JSON.stringify(added));
          for (const file of added.value.files) {
            const bytes = await readFile(join(root, file.path));
            assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.path);
          }
          await writeFile(join(artifact, "files.json"), JSON.stringify(added.value.files, null, 2));
          // Promotion must leave a runnable deployment surface, not just sources.
          const compose = await readFile(join(project, "docker-compose.yml"), "utf8");
          assert.match(compose, /^ {2}worker:$/m, "promoted project must ship a worker service");
          assert.match(compose, /DATABASE_URL/, "promoted worker must reach postgres");
          if (feature === "broadcast") assert.match(compose, /^ {2}redis:$/m, "promoted broadcast must ship redis");
          assert.ok(added.value.files.some((file) => file.path === `bot/${stack === "grammy" ? `src/features/${name}.ts` : `app/handlers/${name}.py`}`));
          await installAndBuild();
          await command("docker", ["exec", postgres.name, "createdb", "-U", "postgres", new URL(env.DATABASE_URL).pathname.slice(1)]);
          if (stack === "grammy") await command(process.execPath, ["dist/migrate.js"]);
          else await command("uv", ["run", "alembic", "upgrade", "head"]);
          const beforeRequests = requests;
          await probe("promotion");
          if (feature === "llm") assert.equal(requests - beforeRequests, 1);
          const evidence = JSON.parse(await readFile(join(artifact, "promotion.json"), "utf8")) as {
            rows: Array<{ status: string; kind: string }>; zeroProducts: boolean;
          };
          assert.equal(evidence.rows[0]?.status, "done", JSON.stringify(evidence.rows));
          assert.equal(evidence.zeroProducts, feature === "payments", "payments must start with zero products and reject the invoice");
          await writeFile(join(artifact, "result.json"), JSON.stringify({ id, status: "passed", exit: 0, llmRequests: requests - beforeRequests }));
        } catch (error) {
          await writeFile(join(artifact, "result.json"), JSON.stringify({ id, status: "failed", error: String(error) }));
          throw error;
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
}
