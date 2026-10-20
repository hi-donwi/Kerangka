import { compile } from "@kerangka/compiler";
import { loadEngine } from "@kerangka/engine-ts";
import { StudioError, type StudioDiagnostic } from "./contracts.js";

export interface ScenarioResult {
  ok: boolean;
  operation: string;
  record?: Record<string, unknown>;
  error?: string;
  code?: string;
  effects: unknown[];
  events: unknown[];
  diagnostics: StudioDiagnostic[];
}

export function runScenario(sourceText: string, entity: string, operation: string, record: Record<string, unknown>, actor?: Record<string, unknown>, now?: string): ScenarioResult {
  let kir: unknown;
  try {
    kir = compile(sourceText);
  } catch (error) {
    return { ok: false, operation: `${entity}.${operation}`, effects: [], events: [], diagnostics: [{ severity: "error", code: "STUDIO_SCENARIO_COMPILE", source: "", message: error instanceof Error ? error.message : "The model does not compile." }] };
  }
  try {
    const engine = loadEngine(kir as never);
    const result = engine.run(entity, operation, record, {}, actor as never, now ? { now } : undefined);
    return {
      ok: result.ok,
      operation: `${entity}.${operation}`,
      record: result.record,
      error: result.error ?? result.message,
      code: result.code,
      effects: result.effects ?? result.sideEffects ?? [],
      events: result.events ?? [],
      diagnostics: [],
    };
  } catch (error) {
    return { ok: false, operation: `${entity}.${operation}`, effects: [], events: [], diagnostics: [{ severity: "error", code: "STUDIO_SCENARIO_FAILED", source: "", message: error instanceof Error ? error.message : "The scenario could not run." }] };
  }
}

export function assertScenarioInputs(entity: string, operation: string, record: unknown): void {
  if (typeof entity !== "string" || entity.length < 1 || entity.length > 128) throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (typeof operation !== "string" || operation.length < 1 || operation.length > 128) throw new StudioError("STUDIO_DRAFT_REQUEST");
  if (typeof record !== "object" || record === null || Array.isArray(record)) throw new StudioError("STUDIO_DRAFT_REQUEST");
}
