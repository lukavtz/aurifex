import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

import aurifex from "../../src/adapters/omp/index.ts";
import { REPO } from "../fixtures/reference-project.ts";
import type { DomainResult } from "../../src/core/results.ts";

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

test("registers three tools and three commands without touching the filesystem", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-omp-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const host = createFakeHost();
  aurifex(host.pi);

  assert.equal(host.label(), "Aurifex");
  assert.deepEqual(await readdir(root), []);

  const expected = [
    ["telegram_bot_target_resolve", "read"],
    ["telegram_bot_inspect", "read"],
    ["telegram_bot_verify", "read"],
  ];
  assert.equal(host.tools.length, 3);
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

  assert.equal(
    host.tools.find((tool) => tool.name === "telegram_bot_verify")?.description,
    "Run static file-content checks; no project code execution, network, or Telegram calls.",
  );

  const guidance = host.eventHandlers.get("before_agent_start");
  assert.equal(guidance?.length, 1);
  const prepared = guidance?.[0]?.({ systemPrompt: ["base prompt"] }) as
    { systemPrompt: string[] } | undefined;
  assert.equal(prepared?.systemPrompt.length, 2);
  const guidanceText = prepared?.systemPrompt[1] ?? "";
  assert.match(guidanceText, /skills\/telegram-bot-discovery/);
  assert.match(guidanceText, /never infer/);
  assert.match(guidanceText, /telegram_bot_verify/);
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

test("verifies a reference project through the verify tool", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aurifex-omp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const example = join(root, "bot");
  await cp(join(REPO, "examples", "grammy_commands"), example, {
    recursive: true,
    filter: (path) => !path.includes("node_modules"),
  });

  const host = createFakeHost();
  aurifex(host.pi);
  const tool = host.tools.find((candidate) => candidate.name === "telegram_bot_verify");
  assert.ok(tool);

  const result = await tool.execute(
    "call-2",
    { projectRoot: "bot" },
    undefined,
    undefined,
    fakeContext(root, host),
  );
  assert.equal(result.details.status, "ok");
  const payload = JSON.parse(result.content[0].text) as {
    status: string;
    value: { ok: boolean; checks: unknown[] };
  };
  assert.equal(payload.status, "ok");
  assert.equal(payload.value.ok, true);
  assert.equal(payload.value.checks.length, 29);
});

test("aurifex-new submits the discovery prompt instead of writing files", async (t) => {
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
  assert.match(prompt, /telegram_bot_verify/);
  assert.doesNotMatch(prompt, /telegram_bot_scaffold/);
  assert.match(prompt, /User arguments: demo-bot grammy/);
  assert.deepEqual(await readdir(root), []);
  assert.equal(host.notifications.length, 0);
});
