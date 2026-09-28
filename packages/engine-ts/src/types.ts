/**
 * Kerangka TypeScript Reference Engine Types
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { ExprNode } from "@kerangka/k1";

export interface ActorContext {
  id?: string;
  roles?: string[];
  tenantId?: string;
  [key: string]: unknown;
}

export interface ValidationErrorItem {
  id?: string;
  field?: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorItem[];
}

/**
 * CloudEvents 1.0 specification compliant domain event envelope.
 * (ADR-0023: CloudEvents Envelope for Domain Events)
 */
export interface CloudEvent<T = unknown> {
  specversion: "1.0";
  id: string;
  source: string;
  type: string;
  name?: string; // Optional convenience alias for type
  time: string; // ISO 8601
  datacontenttype: "application/json";
  data: T;
  subject?: string;
  tenantid?: string;
  traceparent?: string;
  [extension: string]: unknown;
}

/**
 * Pure engine side effects produced during execution (ADR-0005).
 */
export type Effect =
  | { type: "emit"; event: CloudEvent }
  | { type: "call"; extension: string; input: Record<string, unknown> }
  | { type: "persist"; entity: string; record: Record<string, unknown>; isNew?: boolean }
  | { type: "notify"; recipient: string; template: string; params: Record<string, unknown> };

export interface TraceStep {
  step: "role_check" | "state_check" | "guard" | "compute" | "mutation" | "invariants" | "effects";
  passed: boolean;
  details?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionTrace {
  operation: string;
  entity: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  actor?: ActorContext;
  steps: TraceStep[];
}

export interface CanResult {
  allowed: boolean;
  reason?: string;
  code?: string;
}

export interface AvailableOperation {
  name: string;
  type: "action" | "transition";
  label?: string;
  targetStatus?: string;
  roles?: string[];
  inputSchema?: Record<string, unknown>;
}

export interface ExecutionPlan {
  ok: boolean;
  error?: string;
  code?: string;
  patch?: Record<string, unknown>;
  projectedRecord?: Record<string, unknown>;
  events?: CloudEvent[];
  effects?: Effect[];
}

export interface RunOptions {
  now?: string | Date;
  trace?: boolean;
  eventSource?: string;
  idempotencyKey?: string;
}

export interface ExecutionResult<T = Record<string, unknown>> {
  ok: boolean;
  record?: T;
  error?: string;
  code?: string;
  message?: string;
  events?: CloudEvent[];
  effects?: Effect[];
  sideEffects?: unknown[];
  trace?: ExecutionTrace;
}

export interface DeclarativeExample {
  name: string;
  run: string; // e.g. "Invoice.send" or "StockItem.reserve" or "Todo.toggle"
  record: Record<string, unknown>;
  input?: Record<string, unknown>;
  actor?: ActorContext;
  expect: {
    ok: boolean;
    error?: string;
    record?: Record<string, unknown>;
  };
}

export interface QueryPlan {
  query: string;
  entity: string;
  select?: string[];
  where?: ExprNode;
  orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;
  limit: number;
  offset: number;
  params?: Record<string, unknown>;
}

export type DecisionHitPolicy = "first" | "unique" | "collect" | "priority";

export interface DecisionRule {
  id?: string;
  inputs: Array<string | number | boolean | null | ExprNode>;
  outputs: Record<string, unknown>;
  description?: string;
}

export interface DecisionTableDef {
  name: string;
  hitPolicy?: DecisionHitPolicy;
  inputs: Array<{ name: string; type?: string }>;
  outputs: Array<{ name: string; type?: string }>;
  rules: DecisionRule[];
}

export interface DecisionResult {
  matched: boolean;
  hitCount: number;
  outputs?: Record<string, unknown> | Array<Record<string, unknown>>;
  error?: string;
  code?: string;
}

export interface ScheduledTrigger {
  id: string;
  entity: string;
  recordId?: string;
  type: "timer" | "cron";
  target: string;
  triggerAt: string;
  expression?: string;
  payload?: Record<string, unknown>;
}

export interface PolicyInvocation {
  policy: string;
  action: string;
  targetId?: string;
  input?: Record<string, unknown>;
}

export interface ReactionResult {
  handled: boolean;
  invocations: PolicyInvocation[];
}
