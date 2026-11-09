import { createHash } from "node:crypto";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Evidence {
  readonly path: string;
  readonly sha256: string;
  readonly checkId?: string;
}

export interface FileRef {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  readonly id: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly evidence?: { readonly path: string; readonly line?: number };
}

export type PathUsage = "read" | "write";

export interface DomainError {
  readonly code: string;
  readonly detail: string;
  readonly retryable: boolean;
  readonly details?: JsonValue;
}

export interface DomainSuccess<T> {
  readonly schemaVersion: "domain-result-1.0.0";
  readonly status: "ok";
  readonly value: T;
  readonly evidence: readonly Evidence[];
}

export interface DomainFailure {
  readonly schemaVersion: "domain-result-1.0.0";
  readonly status: "error";
  readonly error: DomainError;
  readonly evidence: readonly Evidence[];
}

export type DomainResult<T> = DomainSuccess<T> | DomainFailure;

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).toSorted())
      result[key] = sortJson(value[key] as JsonValue);
    return result;
  }
  return value;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateEvidence(evidence: readonly Evidence[]): void {
  for (const reference of evidence) {
    if (!/^[a-f0-9]{64}$/.test(reference.sha256)) {
      throw new TypeError("Evidence sha256 must be 64 lowercase hexadecimal characters");
    }
  }
}

export function domainSuccess<T>(value: T, evidence: readonly Evidence[] = []): DomainSuccess<T> {
  validateEvidence(evidence);
  return { schemaVersion: "domain-result-1.0.0", status: "ok", value, evidence };
}

export function domainFailure(
  input: DomainError & { readonly evidence?: readonly Evidence[] },
): DomainFailure {
  const evidence = input.evidence ?? [];
  validateEvidence(evidence);
  if (!input.code.trim() || !input.detail.trim()) {
    throw new TypeError("Domain error code and detail must be nonempty");
  }
  return {
    schemaVersion: "domain-result-1.0.0",
    status: "error",
    error: {
      code: input.code,
      detail: input.detail,
      retryable: input.retryable,
      ...(input.details === undefined ? {} : { details: input.details }),
    },
    evidence,
  };
}

export function serializeDomainResult(result: DomainResult<unknown>): string {
  return canonicalJson(result as unknown as JsonValue);
}

export function isDomainError(value: unknown): value is DomainError {
  if (typeof value !== "object" || value === null) return false;
  if (!("code" in value) || !("detail" in value)) return false;
  return typeof value.code === "string" && typeof value.detail === "string";
}
