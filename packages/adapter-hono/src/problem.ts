/**
 * RFC 9457 Problem Details for HTTP APIs
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  errors?: unknown[];
  [key: string]: unknown;
}

export function getDefaultTitle(status: number, code: string): string {
  switch (code) {
    case "INPUT_INVALID":
    case "REQUIRED":
    case "OUT_OF_RANGE":
    case "PATTERN_MISMATCH":
    case "TYPE_MISMATCH":
      return "Validation Failed";
    case "FORBIDDEN":
    case "PERMISSION_DENIED":
      return "Forbidden";
    case "NOT_FOUND":
    case "UNKNOWN_ENTITY":
    case "UNKNOWN_ACTION":
    case "UNKNOWN_TRANSITION":
      return "Not Found";
    case "GUARD_FAILED":
      return "Guard Condition Failed";
    case "INVALID_TRANSITION":
    case "INVALID_STATE_TRANSITION":
      return "Invalid State Transition";
    case "VERSION_CONFLICT":
      return "Version Conflict";
    case "INVARIANT_VIOLATED":
      return "Domain Invariant Violated";
    case "IDEMPOTENCY_CONFLICT":
      return "Idempotency Conflict";
    default:
      if (status >= 500) return "Internal Server Error";
      if (status === 404) return "Not Found";
      if (status === 403) return "Forbidden";
      if (status === 401) return "Unauthorized";
      if (status === 409) return "Conflict";
      if (status === 422) return "Unprocessable Entity";
      return "Bad Request";
  }
}

export function createProblemDetails(options: {
  status: number;
  code: string;
  title?: string;
  detail?: string;
  instance?: string;
  errors?: unknown[];
}): ProblemDetails {
  const type = options.code === "PERMISSION_DENIED"
    ? `https://kerangka.dev/problem/PERMISSION_DENIED`
    : `https://kerangka.dev/errors/${options.code}`;
  const title = options.title ?? getDefaultTitle(options.status, options.code);

  const problem: ProblemDetails = {
    type,
    title,
    status: options.status,
    code: options.code,
  };

  if (options.detail) problem.detail = options.detail;
  if (options.instance) problem.instance = options.instance;
  if (options.errors && options.errors.length > 0) problem.errors = options.errors;

  return problem;
}
