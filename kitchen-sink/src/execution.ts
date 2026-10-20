import { loadEngine } from "@kerangka/engine-ts";
import type { ManifestEntry } from "./types";

export const LIMITS = {
  inputBytes: 16 * 1024,
  modelBytes: 256 * 1024,
  outputBytes: 8 * 1024,
  entities: 16,
  operations: 128,
  nodes: 20000,
  depth: 32,
  wallClockMs: 1000,
} as const;

export interface ExecutionRequest {
  kir: unknown;
  sample: ManifestEntry;
  inputName: string;
}

export type ExecutionReply =
  | { kind: "fallback"; reason: string }
  | { kind: "result"; status: "ok" | "denied" | "error"; matched: boolean;
      output: string; truncated: boolean; elapsedMs: number };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function checkRequest(request: ExecutionRequest): string | undefined {
  try {
    if (!request.kir || typeof request.kir !== "object") return "MODEL_UNAVAILABLE: Rebuild the sample KIR.";
    if (!request.sample.allowedModes.includes("run") || request.sample.support === "planned") {
      return "RUN_NOT_ALLOWED: This sample is source-only.";
    }
    const stack = [{ value: request.kir, depth: 0 }, { value: request.sample, depth: 0 }];
    let nodes = 0;
    while (stack.length) {
      const { value, depth } = stack.pop()!;
      if (++nodes > LIMITS.nodes) return "WORK_LIMIT: Model and input contain too many nodes.";
      if (depth > LIMITS.depth) return "DEPTH_LIMIT: Model or input nesting is too deep.";
      if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 });
      }
    }
    const encoder = new TextEncoder();
    if (encoder.encode(JSON.stringify(request.kir)).length > LIMITS.modelBytes) return "MODEL_LIMIT: KIR exceeds 256 KiB.";
    if (encoder.encode(JSON.stringify(request.sample)).length > LIMITS.inputBytes) return "INPUT_LIMIT: Sample inputs exceed 16 KiB.";
    const entities = isObject(request.kir) ? request.kir.entities : undefined;
    if (!isObject(entities)) return "MODEL_UNAVAILABLE: KIR has no entities.";
    if (Object.keys(entities).length > LIMITS.entities) return "ENTITY_LIMIT: KIR exceeds 16 entities.";
    let operations = 0;
    for (const entity of Object.values(entities)) {
      if (!isObject(entity)) return "MODEL_UNAVAILABLE: Invalid entity definition.";
      if (isObject(entity.actions)) operations += Object.keys(entity.actions).length;
      if (isObject(entity.workflow) && isObject(entity.workflow.transitions)) {
        operations += Object.keys(entity.workflow.transitions).length;
      }
    }
    if (operations > LIMITS.operations) return "OPERATION_LIMIT: KIR exceeds 128 operations.";
    const input = request.sample.inputs.find((item) => item.name === request.inputName);
    if (!input || !/^[A-Za-z][\w]*\.[A-Za-z][\w]*$/.test(input.run)) return "INVALID_TARGET: Select a declared input.";
    if (!request.sample.expected.outcomes.some((item) => item.input === request.inputName)) {
      return "EXPECTATION_MISSING: No expected outcome is declared for this input.";
    }
  } catch {
    return "INVALID_REQUEST: Model and inputs must be bounded JSON data.";
  }
}

export function executeSample(request: ExecutionRequest): ExecutionReply {
  const reason = checkRequest(request);
  if (reason) return { kind: "fallback", reason };
  try {
    const start = performance.now();
    const input = request.sample.inputs.find((item) => item.name === request.inputName)!;
    const expected = request.sample.expected.outcomes.find((item) => item.input === request.inputName)!;
    const [entity, operation] = input.run.split(".");
    const result = loadEngine(request.kir).run(
      entity, operation, structuredClone(input.record), structuredClone(input.input ?? {}),
      structuredClone(input.actor ?? { roles: [] }), { now: "2026-10-01T00:00:00.000Z", trace: true },
    );
    if (result.error === "UNKNOWN_ENTITY" || result.error === "UNKNOWN_OPERATION" || result.error === "STATEMENT_UNKNOWN") {
      return { kind: "fallback", reason: `${result.error}: This construct cannot run in this sample.` };
    }
    const denied = ["PERMISSION_DENIED", "GUARD_FAILED", "INVALID_STATE_TRANSITION", "VALIDATION_FAILED"];
    const status = result.ok ? "ok" : denied.includes(result.error ?? "") ? "denied" : "error";
    const matched = status === expected.status && (!expected.error || result.error === expected.error) &&
      Object.entries(expected.record ?? {}).every(([key, value]) =>
        JSON.stringify(result.record?.[key]) === JSON.stringify(value));
    const bytes = new TextEncoder().encode(JSON.stringify(result, null, 2));
    return {
      kind: "result", status, matched,
      output: new TextDecoder().decode(bytes.subarray(0, LIMITS.outputBytes), { stream: true }),
      truncated: bytes.length > LIMITS.outputBytes, elapsedMs: performance.now() - start,
    };
  } catch {
    return { kind: "fallback", reason: "EXECUTION_FAILED: This model cannot be evaluated; inspect its source." };
  }
}
