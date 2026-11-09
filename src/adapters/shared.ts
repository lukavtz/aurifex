import { createCoreOperations, type CoreOperations } from "../core/operations.ts";

export function createHostCoreOperations(root: string): Promise<CoreOperations> {
  return createCoreOperations({ root });
}
