import { realpath } from "node:fs/promises";

import { resolveStack, type TargetResolution } from "./targets/catalog.ts";
import type { BotFeature, BotStack } from "./spec/bot-spec.ts";
import type { DomainResult } from "./results.ts";
import { domainFailure, domainSuccess } from "./results.ts";
import { createPathPolicy, type PathPolicy, PathPolicyError } from "./security/path-policy.ts";
import { addFeature, type FeatureResult } from "./projects/add-feature.ts";
import { planDeploy, type DeployResult } from "./projects/deploy.ts";
import { inspectBot, type InspectResult } from "./projects/inspect.ts";
import { scaffoldBot, type ScaffoldResult } from "./projects/scaffold.ts";
import { generateTestHarness, type HarnessResult } from "./projects/test-harness.ts";
import { upgradePlan, type UpgradeResult } from "./projects/upgrade.ts";
import { verifyBot, type VerifyResult } from "./projects/verify.ts";

export interface CoreOperationsOptions {
  readonly root: string;
  readonly now?: () => Date;
}

export interface CoreOperations {
  resolveTarget(request: { stack: BotStack }): Promise<DomainResult<TargetResolution>>;
  scaffoldBot(request: {
    destination: string;
    spec: unknown;
    overwrite?: boolean;
  }): Promise<DomainResult<ScaffoldResult>>;
  inspectBot(request: { projectRoot: string }): Promise<DomainResult<InspectResult>>;
  verifyBot(request: { projectRoot: string }): Promise<DomainResult<VerifyResult>>;
  addFeature(request: {
    projectRoot: string;
    feature: BotFeature;
    name: string;
    overwrite?: boolean;
  }): Promise<DomainResult<FeatureResult>>;
  planDeploy(request: {
    projectRoot: string;
    domain: string;
    mode?: "webhook" | "polling";
    overwrite?: boolean;
  }): Promise<DomainResult<DeployResult>>;
  generateTestHarness(request: {
    projectRoot: string;
    overwrite?: boolean;
  }): Promise<DomainResult<HarnessResult>>;
  upgradePlan(request: { projectRoot: string }): Promise<DomainResult<UpgradeResult>>;
}

function failureFrom(error: unknown): DomainResult<never> {
  if (error instanceof PathPolicyError) {
    return domainFailure({
      code: error.code === "file_exists" ? "destination_exists" : error.code,
      detail: error.message,
      retryable: false,
    });
  }
  return domainFailure({
    code: "internal_error",
    detail: error instanceof Error ? error.message : "unexpected failure",
    retryable: false,
  });
}

async function guard<T>(operation: () => Promise<DomainResult<T>>): Promise<DomainResult<T>> {
  try {
    return await operation();
  } catch (error) {
    return failureFrom(error);
  }
}

export async function createCoreOperations(
  options: CoreOperationsOptions,
): Promise<CoreOperations> {
  const policy: PathPolicy = await createPathPolicy(await realpath(options.root));
  const now = options.now ?? (() => new Date());
  return {
    resolveTarget: async ({ stack }) => guard(async () => domainSuccess(resolveStack(stack))),
    scaffoldBot: (request) => guard(() => scaffoldBot(request, { policy, now })),
    inspectBot: ({ projectRoot }) => guard(() => inspectBot(projectRoot, policy)),
    verifyBot: ({ projectRoot }) => guard(() => verifyBot(projectRoot, policy)),
    addFeature: (request) => guard(() => addFeature(request, { policy })),
    planDeploy: (request) => guard(() => planDeploy(request, { policy })),
    generateTestHarness: (request) => guard(() => generateTestHarness(request, { policy })),
    upgradePlan: ({ projectRoot }) => guard(() => upgradePlan(projectRoot, policy)),
  };
}
