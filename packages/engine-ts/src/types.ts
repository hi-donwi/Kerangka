/**
 * Kerangka TypeScript Reference Engine Types
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { ExprNode } from "@kerangka/k1";

export interface ActorContext {
  id?: string;
  roles?: string[];
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

export interface ExecutionResult<T = Record<string, unknown>> {
  ok: boolean;
  record?: T;
  error?: string;
  message?: string;
  events?: { name: string; data?: unknown }[];
  sideEffects?: unknown[];
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
