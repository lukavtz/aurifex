import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parsers } from "prettier/plugins/yaml";

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string>; "continue-on-error"?: boolean };
type Workflow = { on: Record<string, unknown>; jobs: Record<string, { steps: Step[]; env?: Record<string, string>; "continue-on-error"?: boolean }> };

interface YamlNode { readonly type: string; readonly value?: string; readonly children?: readonly YamlNode[] }

function yamlValue(node: YamlNode): unknown {
  const children = node.children ?? [];
  if (node.type === "mapping") return Object.fromEntries(children.map((item) => {
    const [key, value] = item.children ?? [];
    assert.ok(key && value);
    return [String(yamlValue(key)), yamlValue(value)];
  }));
  if (node.type === "sequence") return children.map(yamlValue);
  if (node.value !== undefined) return node.value === "true" ? true : node.value === "false" ? false : node.value;
  return yamlValue(children.find((child) => child.type !== "documentHead") ?? { type: "plain", value: "" });
}

async function workflow(name: string): Promise<Workflow> {
  const source = await readFile(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), "utf8");
  const parser = parsers.yaml;
  assert.ok(parser);
  return yamlValue(await parser.parse(source, { parser: "yaml" } as unknown as Parameters<typeof parser.parse>[1])) as Workflow;
}

test("workflow contracts keep infra gating, advisory review, pinned lint and safe release tags", async () => {
  const ci = await workflow("ci");
  const infra = ci.jobs.infra;
  assert.ok(infra);
  assert.equal(infra["continue-on-error"], undefined);
  assert.equal(infra.env?.AURIFEX_INFRA, "1");
  const step = infra.steps.find((entry) => entry.name === "Run infra suite");
  assert.ok(step?.run);
  assert.equal(step["continue-on-error"], undefined);
  assert.match(step.run, /exit "\$status"/);
  const lint = ci.jobs.workflows?.steps.find((entry) => entry.name === "actionlint");
  assert.ok(lint?.run?.includes("rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667"));
  const security = await workflow("security");
  const review = security.jobs["dependency-review"];
  assert.equal(review?.["continue-on-error"], true);
  const reviewStep = review?.steps.find((entry) => entry.uses?.startsWith("actions/dependency-review-action@"));
  assert.equal(reviewStep?.["continue-on-error"], true);
  assert.deepEqual((reviewStep as Step & { with: Record<string, string> }).with, {
    "fail-on-severity": "high", "fail-on-scopes": "runtime", "comment-summary-in-pr": "always",
  });
  const release = await workflow("release");
  const tag = release.jobs.verify?.steps.find((entry) => entry.name === "Assert tag matches package version");
  assert.equal(tag?.env?.REQUESTED_TAG, "${{ inputs.tag }}");
  assert.ok(tag?.run);
  assert.ok(!tag.run.includes("${{"));
  const root = await mkdtemp(join(tmpdir(), "aurifex-workflow-"));
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.2.0", scripts: { "test:infra": "node --test service.test.cjs" } }));
    for (const [requested, expected] of [["v0.2.0", 0], ["v0.1.0", 1]] as const) {
      const result: SpawnSyncReturns<string> = spawnSync("bash", ["-e", "-c", tag.run], { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_REF_TYPE: "branch", REQUESTED_TAG: requested } });
      assert.equal(result.status, expected, result.stderr);
    }
    for (const fails of [true, false]) {
      await writeFile(join(root, "service.test.cjs"), `const test=require('node:test');const assert=require('node:assert/strict');test('service health',()=>assert.equal(${fails},false));`);
      const result: SpawnSyncReturns<string> = spawnSync("bash", ["-c", step.run], { cwd: root, encoding: "utf8", env: { ...childEnv, AURIFEX_INFRA: "1", RUNNER_TEMP: root, GITHUB_STEP_SUMMARY: join(root, "summary") } });
      assert.equal(result.status, fails ? 1 : 0, result.stdout + result.stderr);
    }
    assert.ok(ci.jobs.audit?.steps.some((entry) => entry.run === "pnpm audit --prod --audit-level high"));
    assert.ok(resolve(root).startsWith(resolve(tmpdir())));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
