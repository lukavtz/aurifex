import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

import aurifex from "../../src/adapters/omp/index.ts";
import type { DomainResult } from "../../src/core/results.ts";
import { BOT_SPEC_VERSION } from "../../src/core/spec/bot-spec.ts";

interface FakeSchema {
  readonly kind: string;
  isStrict: boolean;
  readonly shape?: Record<string, FakeSchema>;
  describe(): FakeSchema;
  optional(): FakeSchema;
  strict(): FakeSchema;
}

function fakeSchema(kind: string, shape?: Record<string, FakeSchema>): FakeSchema {
  const schema: FakeSchema = {
    kind,
    isStrict: false,
    ...(shape === undefined ? {} : { shape }),
    describe: () => schema,
    optional: () => schema,
    strict: () => {
      schema.isStrict = true;
      return schema;
    },
  };
  return schema;
}

const fakeZod = {
  string: () => fakeSchema("string"),
  boolean: () => fakeSchema("boolean"),
  unknown: () => fakeSchema("unknown"),
  enum: (_values: readonly string[]) => fakeSchema("enum"),
  object: (shape: Record<string, FakeSchema>) => fakeSchema("object", shape),
};

interface ExecutableTool {
  readonly name: string;
  readonly description?: string;
  readonly approval?: string;
  readonly parameters: FakeSchema;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ): Promise<{
    readonly content: [{ readonly type: "text"; readonly text: string }];
    readonly details: DomainResult<unknown>;
  }>;
}

interface RegisteredCommand {
  readonly name: string;
  readonly options: { readonly description?: string; readonly handler: unknown };
}

interface FakeHost {
  readonly pi: ExtensionAPI;
  readonly tools: ExecutableTool[];
  readonly commands: RegisteredCommand[];
  readonly notifications: Array<{ message: string; type?: "info" | "warning" | "error" }>;
  readonly userMessages: string[];
  readonly eventHandlers: Map<string, Array<(event: unknown) => unknown>>;
  label(): string | undefined;
}

function createFakeHost(): FakeHost {
  let label: string | undefined;
  const tools: ExecutableTool[] = [];
  const commands: RegisteredCommand[] = [];
  const notifications: FakeHost["notifications"] = [];
  const userMessages: string[] = [];
  const eventHandlers: FakeHost["eventHandlers"] = new Map();
  const pi = {
    zod: fakeZod,
    setLabel: (value: string) => {
      label = value;
    },
    registerTool: (tool: unknown) => {
      tools.push(tool as ExecutableTool);
    },
    registerCommand: (name: string, options: RegisteredCommand["options"]) => {
      commands.push({ name, options });
    },
    on: (event: string, handler: (event: unknown) => unknown) => {
      eventHandlers.set(event, [...(eventHandlers.get(event) ?? []), handler]);
    },
    sendUserMessage: async (content: string) => {
      userMessages.push(content);
    },
  } as unknown as ExtensionAPI;
  return {
    pi,
    tools,
    commands,
    notifications,
    userMessages,
    eventHandlers,
    label: () => label,
  };
}

function fakeContext(
  cwd: string,
  host: FakeHost,
  answers: { input?: string[]; select?: string[] } = {},
): ExtensionContext {
  return {
    cwd,
    ui: {
      input: async () => answers.input?.shift(),
      select: async () => answers.select?.shift(),
      notify: (message: string, type?: "info" | "warning" | "error") => {
        host.notifications.push({ message, ...(type === undefined ? {} : { type }) });
      },
    },
  } as unknown as ExtensionContext;
}

const SPEC = {
  schemaVersion: BOT_SPEC_VERSION,
  name: "demo_bot",
  displayName: "Demo Bot",
  stack: "grammy",
  features: ["commands"],
  deployment: "docker",
  storage: { postgres: false, redis: true },
  i18n: { defaultLocale: "en", en: true, ru: false, zh: false },
  security: { webhookSecret: true, adminAllowlist: true, rateLimit: true, idempotency: true },
  runtime: {
    queue: "none",
    telemetry: { otlp: false, prometheus: false, sentry: false },
  },
};

test("registers nine tools and three commands without touching the filesystem", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-omp-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const host = createFakeHost();
  aurifex(host.pi);

  assert.equal(host.label(), "Aurifex");
  assert.deepEqual(await readdir(root), []);

  const expected = [
    ["telegram_bot_target_resolve", "read"],
    ["telegram_bot_scaffold", "write"],
    ["telegram_bot_inspect", "read"],
    ["telegram_bot_verify", "read"],
    ["telegram_bot_add_feature", "write"],
    ["telegram_bot_deploy_plan", "write"],
    ["telegram_bot_test_harness", "write"],
    ["telegram_bot_upgrade", "write"],
    ["telegram_bot_upgrade_plan", "read"],
  ];
  assert.equal(host.tools.length, 9);
  for (const [name, approval] of expected) {
    const tool = host.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `missing tool ${name}`);
    assert.equal(tool.approval, approval);
    assert.equal(tool.parameters.kind, "object");
    assert.equal(tool.parameters.isStrict, true);
  }

  assert.deepEqual(
    host.commands.map((command) => command.name),
    ["aurifex-new", "aurifex-verify", "aurifex-deploy"],
  );
  for (const command of host.commands) {
    assert.equal(typeof command.options.description, "string");
    assert.equal(typeof command.options.handler, "function");
  }

  const scaffold = host.tools.find((tool) => tool.name === "telegram_bot_scaffold");
  assert.ok(scaffold);
  assert.match(scaffold.description ?? "", /skills\/telegram-bot-discovery/);
  assert.match(scaffold.description ?? "", /never invent/);

  const guidance = host.eventHandlers.get("before_agent_start");
  assert.equal(guidance?.length, 1);
  const prepared = guidance?.[0]?.({ systemPrompt: ["base prompt"] });
  assert.deepEqual(prepared, {
    systemPrompt: [
      "base prompt",
      "Before telegram_bot_scaffold or telegram_bot_add_feature, run the discovery questions in skills/telegram-bot-discovery and confirm the proposed BotSpec; never infer the stack, features, storage, locales, or payment products for the user. Never ask for or print bot tokens, webhook secrets, API keys, or passwords. Own generated projects through the aurifex tools, and run telegram_bot_verify after changing a generated bot.",
    ],
  });
  assert.deepEqual(await readdir(root), []);
});

test("executes target resolve against the context cwd", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-omp-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const host = createFakeHost();
  aurifex(host.pi);
  const tool = host.tools.find((candidate) => candidate.name === "telegram_bot_target_resolve");
  assert.ok(tool);

  const result = await tool.execute(
    "call-1",
    { stack: "grammy" },
    undefined,
    undefined,
    fakeContext(root, host),
  );
  assert.equal(result.details.status, "ok");
  const payload = JSON.parse(result.content[0].text) as {
    status: string;
    value: { target: { frameworkVersion: string } };
  };
  assert.equal(payload.status, "ok");
  assert.equal(payload.value.target.frameworkVersion, "1.46.0");
});

test("scaffolds a bot through the scaffold tool", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-omp-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const host = createFakeHost();
  aurifex(host.pi);
  const tool = host.tools.find((candidate) => candidate.name === "telegram_bot_scaffold");
  assert.ok(tool);

  const result = await tool.execute(
    "call-2",
    { destination: "demo-bot", spec: SPEC },
    undefined,
    undefined,
    fakeContext(root, host),
  );
  assert.equal(result.details.status, "ok");
  const payload = JSON.parse(result.content[0].text) as {
    status: string;
    value: { files: unknown[]; stack: string };
  };
  assert.equal(payload.status, "ok");
  assert.equal(payload.value.stack, "grammy");
  assert.ok(payload.value.files.length > 0);
  assert.ok((await readdir(join(root, "demo-bot"))).length > 0);
});

test("aurifex-new submits the discovery prompt instead of scaffolding", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-omp-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const host = createFakeHost();
  aurifex(host.pi);
  const newCommand = host.commands.find((command) => command.name === "aurifex-new");
  assert.ok(newCommand);
  const handler = newCommand.options.handler as (
    args: string,
    ctx: ExtensionContext,
  ) => Promise<void>;

  await handler("demo-bot grammy", fakeContext(root, host));

  assert.equal(host.userMessages.length, 1);
  const prompt = host.userMessages[0] ?? "";
  assert.match(prompt, /skills\/telegram-bot-discovery/);
  assert.match(prompt, /never infer/i);
  assert.match(prompt, /confirm/i);
  assert.match(prompt, /telegram_bot_scaffold/);
  assert.match(prompt, /User arguments: demo-bot grammy/);
  assert.deepEqual(await readdir(root), []);
  assert.equal(host.notifications.length, 0);
});
