import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parsers } from "prettier/plugins/yaml";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
  if?: string;
  "continue-on-error"?: boolean;
};
type Job = {
  steps: Step[];
  env?: Record<string, string>;
  if?: string;
  "continue-on-error"?: boolean;
  strategy?: { matrix?: Record<string, readonly string[]> };
};
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job> };

interface YamlNode {
  readonly type: string;
  readonly value?: string;
  readonly children?: readonly YamlNode[];
}

const RETIRED_JOBS = ["infra", "e2e", "docker", "load"];

const TOOLS = ["telegram_bot_inspect", "telegram_bot_target_resolve", "telegram_bot_verify"];

const COMMANDS = ["target", "inspect", "verify", "install"];

const RETIRED_TOOL_NAMES =
  /telegram_bot_(?:scaffold|add_feature|deploy_plan|test_harness|upgrade|upgrade_plan)/;

const RETIRED_SCRIPTS =
  /(?:pnpm|npm|node --test)[^\n]*\b(?:test:e2e|test:infra|test:docker|test:load)\b/;

const ACTIONLINT_IMAGE =
  "rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667";

function yamlValue(node: YamlNode): unknown {
  const children = node.children ?? [];
  if (node.type === "mapping" || node.type === "flowMapping")
    return Object.fromEntries(
      children.map((item) => {
        const [key, value] = item.children ?? [];
        assert.ok(key && value);
        return [String(yamlValue(key)), yamlValue(value)];
      }),
    );
  if (node.type === "sequence" || node.type === "flowSequence") return children.map(yamlValue);
  if (node.type === "flowSequenceItem") {
    assert.ok(children[0], "empty flow sequence item");
    return yamlValue(children[0]);
  }
  if (node.value !== undefined)
    return node.value === "true" ? true : node.value === "false" ? false : node.value;
  return yamlValue(
    children.find((child) => child.type !== "documentHead") ?? { type: "plain", value: "" },
  );
}

async function workflowSource(name: string): Promise<string> {
  return readFile(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), "utf8");
}

async function workflow(name: string): Promise<Workflow> {
  const parser = parsers.yaml;
  assert.ok(parser);
  return yamlValue(
    (await parser.parse(await workflowSource(name), { parser: "yaml" } as unknown as Parameters<
      typeof parser.parse
    >[1])) as YamlNode,
  ) as Workflow;
}

function namedStep(job: Job | undefined, name: string): Step {
  assert.ok(job, "job is missing");
  const found = job.steps.find((entry) => entry.name === name);
  assert.ok(found, `step "${name}" is missing`);
  return found;
}

test("ci keeps one verify gate, no retired jobs, four commands and three tools", async () => {
  const ci = await workflow("ci");
  assert.deepEqual(Object.keys(ci.jobs).toSorted(), [
    "audit",
    "fuzz",
    "package",
    "verify",
    "workflows",
  ]);
  for (const retired of RETIRED_JOBS) assert.equal(ci.jobs[retired], undefined);

  const verify = ci.jobs.verify;
  assert.ok(verify);
  assert.ok(verify.steps.some((entry) => entry.run === "pnpm verify"));

  const lint = namedStep(ci.jobs.workflows, "actionlint");
  assert.ok(lint.run?.includes(ACTIONLINT_IMAGE), "actionlint image must stay digest-pinned");

  assert.ok(
    ci.jobs.audit?.steps.some((entry) => entry.run === "pnpm audit --prod --audit-level high"),
  );

  const pack = namedStep(ci.jobs.package, "Pack and install the tarball");
  assert.ok(pack.run);
  for (const command of COMMANDS) assert.ok(pack.run.includes(command), `missing ${command}`);
  assert.match(pack.run, /\^ {2}aurifex \$\{command\}/);
  assert.match(pack.run, /aurifex \(new\|add\|deploy\|harness\|upgrade\)/);
  assert.ok(
    pack.run.includes("telegram_bot_inspect,telegram_bot_target_resolve,telegram_bot_verify"),
    "package smoke must assert the exact three-tool surface",
  );

  const source = await workflowSource("ci");
  assert.doesNotMatch(source, RETIRED_TOOL_NAMES);
  assert.doesNotMatch(source, RETIRED_SCRIPTS);
});

test("dependency review stays advisory", async () => {
  const security = await workflow("security");
  const review = security.jobs["dependency-review"];
  assert.equal(review?.["continue-on-error"], true);
  const reviewStep = review?.steps.find((entry) =>
    entry.uses?.startsWith("actions/dependency-review-action@"),
  );
  assert.equal(reviewStep?.["continue-on-error"], true);
  assert.deepEqual(reviewStep?.with, {
    "fail-on-severity": "high",
    "fail-on-scopes": "runtime",
    "comment-summary-in-pr": "always",
  });
});

test("release binds the tag to the package version, builds two examples", async () => {
  const release = await workflow("release");
  const tag = namedStep(release.jobs.verify, "Assert tag matches package version");
  assert.equal(tag.env?.REQUESTED_TAG, "${{ inputs.tag }}");
  assert.ok(tag.run);
  assert.ok(!tag.run.includes("${{"), "tag-check script must not interpolate expressions");

  const cli = namedStep(release.jobs.verify, "Assert CLI surface");
  assert.ok(cli.run);
  for (const command of COMMANDS) assert.ok(cli.run.includes(command), `missing ${command}`);
  assert.match(cli.run, /aurifex \(new\|add\|deploy\|harness\|upgrade\)/);

  const examples = release.jobs.examples;
  assert.ok(examples, "release must define the examples job");
  assert.deepEqual(examples.strategy?.matrix?.example, ["grammy_commands", "aiogram_commands"]);

  const source = await workflowSource("release");
  assert.doesNotMatch(source, RETIRED_TOOL_NAMES);
  assert.doesNotMatch(source, /grammy_payments/);

  const root = await mkdtemp(join(tmpdir(), "aurifex-workflow-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.3.0" }));
    for (const [requested, expected] of [
      ["v0.3.0", 0],
      ["v0.2.0", 1],
    ] as const) {
      const result: SpawnSyncReturns<string> = spawnSync("bash", ["-e", "-c", tag.run], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GITHUB_REF_TYPE: "branch", REQUESTED_TAG: requested },
      });
      assert.equal(result.status, expected, result.stderr);
    }
    assert.ok(resolve(root).startsWith(resolve(tmpdir())));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host matrix installs the packed plugin and checks the three-tool surface", async () => {
  const matrix = await workflow("host-matrix");
  const hosts = matrix.jobs.hosts;
  assert.ok(hosts);
  assert.deepEqual(hosts.strategy?.matrix?.host, ["omp", "dsh", "claude"]);

  const bun = hosts.steps.find((entry) => entry.uses?.startsWith("oven-sh/setup-bun@"));
  assert.equal(bun?.uses, "oven-sh/setup-bun@v2");
  assert.equal(bun?.if, "matrix.host == 'omp'");
  assert.equal(bun?.with?.["bun-version"], "1.4.4");

  for (const host of ["omp", "dsh", "claude"]) {
    const step = hosts.steps.find((entry) => entry.run?.includes(`--host ${host}`));
    assert.ok(step, `missing install step for ${host}`);
    assert.ok(step.run?.includes("scripts/smoke-hosts.ts"));
  }

  const source = await workflowSource("host-matrix");
  assert.doesNotMatch(source, RETIRED_TOOL_NAMES);
  assert.doesNotMatch(source, /\bnine tools\b/);

  const smoke = await readFile(new URL("../../scripts/smoke-hosts.ts", import.meta.url), "utf8");
  for (const tool of TOOLS) assert.ok(smoke.includes(tool), `smoke-hosts must assert ${tool}`);
  assert.doesNotMatch(smoke, RETIRED_TOOL_NAMES);
  assert.doesNotMatch(smoke, /exactly nine tools/);
});
