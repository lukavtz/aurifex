import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";
import {
  renderMiniAppSessionPy,
  renderMiniAppSessionTs,
} from "../../src/core/projects/templates/miniapp-session.ts";

const BOT_TOKEN = "123456:test-token-for-miniapp-session";
const FIXED_NOW_MS = 1_700_000_000_000;
const NOW_SECONDS = Math.floor(FIXED_NOW_MS / 1000);

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const dir = mkdtempSync(join(tmpdir(), "aurifex-miniapp-session-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const tsPath = join(dir, "miniapp-session.ts");
writeFileSync(tsPath, renderMiniAppSessionTs(), "utf8");

const pyPath = join(dir, "miniapp_session.py");
const pySource = renderMiniAppSessionPy();
writeFileSync(pyPath, pySource, "utf8");

interface MiniAppModule {
  CSP: string;
  SECURITY_HEADERS: Record<string, string>;
  SESSION_COOKIE: string;
  DEFAULT_SESSION_TTL_SECONDS: number;
  MiniAppAuthError: new (message: string) => Error;
  validateInitData(
    initData: string,
    botToken: string,
    options?: { ttlSeconds?: number; now?: number },
  ): { user: { id: number }; authDate: number; hash: string };
  createSession(
    initData: string,
    botToken: string,
    redis: FakeRedis,
    options?: { ttlSeconds?: number; now?: number },
  ): Promise<{ sessionId: string; csrfToken: string; ttlSeconds: number }>;
  readSession(redis: FakeRedis, sessionId: string): Promise<{
    userId: number;
    authDate: number;
    csrf: string;
    createdAt: number;
  } | null>;
  sessionCookie(id: string, ttl: number, secure: boolean): string;
  clearSessionCookie(secure: boolean): string;
  isAllowedOrigin(origin: string | undefined | null, host: string | null, allowed: readonly string[]): boolean;
  csrfMatches(expected: string, provided: string | null): boolean;
  assertMutationAuthorized(
    request: { origin?: string; host?: string; csrfToken?: string },
    session: { csrf: string } | null,
    allowed: readonly string[],
  ): { csrf: string };
}

class FakeRedis {
  readonly values = new Map<string, string>();
  readonly ttl = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, options: { NX: true; EX: number }): Promise<unknown> {
    assert.equal(options.NX, true);
    assert.equal(options.EX, 300);
    if (this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async setex(key: string, seconds: number, value: string): Promise<unknown> {
    this.values.set(key, value);
    this.ttl.set(key, seconds);
    return "OK";
  }
}

function signInitData(fields: Record<string, string>): string {
  const entries = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(entries.join("\n")).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

function initData(options: { authDate?: number; id?: number } = {}): string {
  return signInitData({
    auth_date: String(options.authDate ?? NOW_SECONDS),
    query_id: "AAH-test-query",
    user: JSON.stringify({
      id: options.id ?? 42,
      first_name: "Test",
      username: "tester",
      language_code: "en",
    }),
  });
}

// Static import is impossible: the module is generated into a temp dir at test time.
const ts = (await import(pathToFileURL(tsPath).href)) as MiniAppModule;

describe("generated miniapp session TypeScript", () => {
  it("uses WebAppData as the HMAC key secret", () => {
    const source = renderMiniAppSessionTs();
    assert.ok(
      source.includes('createHmac("sha256", "WebAppData").update(botToken).digest()'),
      "HMAC key order must be WebAppData -> botToken",
    );
    assert.ok(!source.includes('createHmac("sha256", botToken)'));
    assert.ok(source.includes("timingSafeEqual"));
  });

  it("accepts valid initData and rejects tampering", () => {
    const validated = ts.validateInitData(initData(), BOT_TOKEN, { now: FIXED_NOW_MS });
    assert.equal(validated.user.id, 42);
    assert.equal(validated.authDate, NOW_SECONDS);

    const tampered = initData().replace("tester", "attacker");
    assert.throws(() => ts.validateInitData(tampered, BOT_TOKEN, { now: FIXED_NOW_MS }), ts.MiniAppAuthError);
    assert.throws(() => ts.validateInitData(initData(), "999:other-token", { now: FIXED_NOW_MS }), ts.MiniAppAuthError);
  });

  it("rejects auth_date more than 30 seconds in the future", () => {
    const future = initData({ authDate: NOW_SECONDS + 31 });
    assert.throws(
      () => ts.validateInitData(future, BOT_TOKEN, { now: FIXED_NOW_MS }),
      /future/,
    );
    const nearFuture = initData({ authDate: NOW_SECONDS + 30 });
    assert.equal(
      ts.validateInitData(nearFuture, BOT_TOKEN, { now: FIXED_NOW_MS }).authDate,
      NOW_SECONDS + 30,
    );
  });

  it("rejects initData older than the session TTL", () => {
    const old = initData({ authDate: NOW_SECONDS - 101 });
    assert.throws(
      () => ts.validateInitData(old, BOT_TOKEN, { now: FIXED_NOW_MS, ttlSeconds: 100 }),
      /expired/,
    );
    assert.doesNotThrow(() =>
      ts.validateInitData(initData({ authDate: NOW_SECONDS - 100 }), BOT_TOKEN, {
        now: FIXED_NOW_MS,
        ttlSeconds: 100,
      }),
    );
  });

  it("stores sessions under a hashed key and rejects replay via SET NX EX 300", async () => {
    const source = renderMiniAppSessionTs();
    assert.ok(source.includes('"miniapp:replay:" + sha256Hex(hash)'));
    assert.ok(source.includes('"miniapp:session:" + sha256Hex(sessionId)'));
    assert.ok(source.includes("{ NX: true, EX: REPLAY_TTL_SECONDS }"));
    assert.ok(source.includes("randomBytes(32).toString(\"base64url\")"));

    const redis = new FakeRedis();
    const data = initData();
    const created = await ts.createSession(data, BOT_TOKEN, redis, { now: FIXED_NOW_MS });
    assert.match(created.sessionId, /^[A-Za-z0-9_-]{43}$/);
    assert.match(created.csrfToken, /^[A-Za-z0-9_-]{43}$/);

    const sessionKeys = [...redis.values.keys()].filter((key) => key.startsWith("miniapp:session:"));
    assert.equal(sessionKeys.length, 1);
    const expectedKey = "miniapp:session:" + createHash("sha256").update(created.sessionId).digest("hex");
    assert.equal(sessionKeys[0], expectedKey, "session key must hash the opaque id");
    assert.equal(redis.ttl.get(sessionKeys[0] ?? ""), ts.DEFAULT_SESSION_TTL_SECONDS);

    const stored = await ts.readSession(redis, created.sessionId);
    assert.deepEqual(stored, {
      userId: 42,
      authDate: NOW_SECONDS,
      csrf: created.csrfToken,
      createdAt: Math.floor(Date.now() / 1000),
    });

    await assert.rejects(
      ts.createSession(data, BOT_TOKEN, redis, { now: FIXED_NOW_MS }),
      /already been used/,
    );
  });

  it("emits the required cookie flags", () => {
    assert.equal(
      ts.sessionCookie("abc123", 86400, false),
      "aurifex_session=abc123; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400",
    );
    assert.equal(
      ts.sessionCookie("abc123", 600, true),
      "aurifex_session=abc123; HttpOnly; SameSite=Lax; Path=/; Max-Age=600; Secure",
    );
    assert.equal(
      ts.clearSessionCookie(false),
      "aurifex_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    );
  });

  it("emits the exact CSP and hardening headers", () => {
    assert.equal(ts.CSP, CSP);
    assert.ok(!ts.CSP.includes("unsafe-inline"));
    assert.ok(ts.CSP.includes("frame-ancestors 'none'"));
    assert.deepEqual(ts.SECURITY_HEADERS, {
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
  });

  it("requires allowed Origin and matching CSRF for mutations", () => {
    const session = { userId: 1, authDate: NOW_SECONDS, csrf: "csrf-value", createdAt: NOW_SECONDS };
    assert.equal(ts.isAllowedOrigin("https://app.example", "app.example", []), true);
    assert.equal(ts.isAllowedOrigin("https://evil.example", "app.example", []), false);
    assert.equal(ts.isAllowedOrigin(undefined, "app.example", []), false);
    assert.equal(ts.isAllowedOrigin("https://app.example/path", "app.example", []), false);
    assert.equal(
      ts.isAllowedOrigin("https://allowed.example", "app.example", ["https://allowed.example"]),
      true,
    );
    assert.equal(
      ts.isAllowedOrigin("https://app.example", "app.example", ["https://allowed.example"]),
      false,
    );

    assert.equal(ts.csrfMatches("csrf-value", "csrf-value"), true);
    assert.equal(ts.csrfMatches("csrf-value", "csrf-valuE"), false);
    assert.equal(ts.csrfMatches("csrf-value", undefined as unknown as null), false);

    assert.doesNotThrow(() =>
      ts.assertMutationAuthorized(
        { origin: "https://app.example", host: "app.example", csrfToken: "csrf-value" },
        session,
        [],
      ),
    );
    assert.throws(() =>
      ts.assertMutationAuthorized(
        { origin: "https://evil.example", host: "app.example", csrfToken: "csrf-value" },
        session,
        [],
      ),
    );
    assert.throws(() =>
      ts.assertMutationAuthorized(
        { origin: "https://app.example", host: "app.example", csrfToken: "wrong" },
        session,
        [],
      ),
    );
  });
});

const python = spawnSync("python3", ["--version"], { encoding: "utf8" });

describe("generated miniapp session Python", () => {
  it("contains the HMAC, replay, cookie, and CSP contracts", () => {
    assert.ok(
      pySource.includes('hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256)'),
      "HMAC key order must be WebAppData -> bot_token",
    );
    assert.ok(pySource.includes("hmac.compare_digest(expected, data_hash)"));
    assert.ok(pySource.includes('"miniapp:replay:" + _sha256_hex(init_data_hash)'));
    assert.ok(pySource.includes('"miniapp:session:" + _sha256_hex(session_id)'));
    assert.ok(pySource.includes("nx=True, ex=REPLAY_TTL_SECONDS"));
    assert.ok(pySource.includes("secrets.token_urlsafe(32)"));
    assert.ok(pySource.includes("; HttpOnly; SameSite=Lax; Path=/; Max-Age="));
    assert.ok(pySource.includes('return base + "; Secure" if secure else base'));
    const joinedPy = pySource.replace(/"\s*\n\s*"/g, "");
    assert.ok(joinedPy.includes(CSP));
    assert.ok(pySource.includes("frame-ancestors 'none'"));
    assert.ok(pySource.includes('"X-Content-Type-Options": "nosniff"'));
    assert.ok(pySource.includes('"Referrer-Policy": "no-referrer"'));
    assert.ok(pySource.includes("hmac.compare_digest(expected, provided)"));
    assert.ok(!pySource.includes("unsafe-inline"));
  });

  it("matches the TypeScript CSP constant", () => {
    assert.ok(ts.CSP === CSP);
    assert.ok(pySource.replace(/"\s*\n\s*"/g, "").includes(CSP));
  });

  it("parses, validates, and rejects initData", () => {
    if (python.error || python.status !== 0) return;
    const data = initData();
    const script = [
      "import json, sys",
      "import miniapp_session as m",
      "data = json.loads(sys.stdin.read())",
      "result = m.validate_init_data(data['initData'], data['token'], now=data['now'])",
      "assert result.user.id == 42",
      "assert result.auth_date == data['now']",
      "for bad in data['bad']:",
      "    try:",
      "        m.validate_init_data(bad, data['token'], now=data['now'])",
      "    except m.MiniAppAuthError:",
      "        pass",
      "    else:",
      "        raise SystemExit('accepted bad initData')",
      "assert m.session_cookie('abc', 60, True) == 'aurifex_session=abc; HttpOnly; SameSite=Lax; Path=/; Max-Age=60; Secure'",
      "assert m.is_allowed_origin('https://app.example', 'app.example', [])",
      "assert not m.is_allowed_origin('https://evil.example', 'app.example', [])",
      "assert m.csrf_matches('x', 'x') and not m.csrf_matches('x', 'y')",
      "print('ok')",
    ].join("\n");
    const run = spawnSync("python3", ["-c", script], {
      cwd: dir,
      input: JSON.stringify({
        initData: data,
        token: BOT_TOKEN,
        now: NOW_SECONDS,
        bad: [
          initData({ authDate: NOW_SECONDS + 31 }),
          initData({ authDate: NOW_SECONDS - 86401 }),
          data.replace("tester", "attacker"),
        ],
      }),
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "ok");
  });
});