import { realpath } from "node:fs/promises";

import { resolveStack, type TargetResolution } from "./targets/catalog.ts";
import type { BotStack } from "./spec/bot-spec.ts";
import type { DomainResult } from "./results.ts";
import { domainFailure, domainSuccess } from "./results.ts";
import { createPathPolicy, type PathPolicy, PathPolicyError } from "./security/path-policy.ts";
import { inspectBot, type InspectResult } from "./projects/inspect.ts";
import { verifyBot, type VerifyResult } from "./projects/verify.ts";

export interface CoreOperationsOptions {
  readonly root: string;
}

export interface CoreOperations {
  resolveTarget(request: { stack: BotStack }): Promise<DomainResult<TargetResolution>>;
  inspectBot(request: { projectRoot: string }): Promise<DomainResult<InspectResult>>;
  verifyBot(request: { projectRoot: string }): Promise<DomainResult<VerifyResult>>;
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
  return {
    resolveTarget: async ({ stack }) => guard(async () => domainSuccess(resolveStack(stack))),
    inspectBot: ({ projectRoot }) => guard(() => inspectBot(projectRoot, policy)),
    verifyBot: ({ projectRoot }) => guard(() => verifyBot(projectRoot, policy)),
  };
}
