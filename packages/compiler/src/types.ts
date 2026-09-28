/**
 * Kerangka Compiler Types
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { ExprNode } from "@kerangka/k1";

export interface CompilerOptions {
  sourcePath?: string;
  sourceFile?: string;
  validateSchema?: boolean;
}

export interface CompilerDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  code: string;
  /** RFC 6901 JSON pointer into the source document. */
  path?: string;
  /** 1-based; present when the compiler was given the document text. */
  line?: number;
  column?: number;
  /** What to do about it. */
  hint?: string;
}

export class CompilerError extends Error {
  readonly diagnostics: CompilerDiagnostic[];

  constructor(message: string, diagnostics: CompilerDiagnostic[] = []) {
    super(message);
    this.name = "CompilerError";
    this.diagnostics = diagnostics;
  }
}

export interface FieldDefinition {
  type: string;
  required: boolean;
  unique?: boolean;
  precision?: number;
  scale?: number;
  target?: string;
  element?: FieldDefinition;
  values?: string[];
  min?: number;
  max?: number;
  default?: unknown;
  compute?: ExprNode | string;
  description?: string;
}

export interface RuleDefinition {
  id: string;
  field?: string;
  message: string;
  check: ExprNode | string;
}

export interface InvariantDefinition {
  id: string;
  message: string;
  assert: ExprNode | string;
}

export interface WorkflowTransition {
  from: string | string[];
  to: string;
  roles?: string[];
  when?: ExprNode | string;
  then?: unknown[];
}

export interface WorkflowDefinition {
  field?: string;
  states?: string[];
  initial?: string;
  terminal?: string[];
  transitions: Record<string, WorkflowTransition>;
  tasks?: Record<string, unknown>;
}

export interface ActionDefinition {
  roles?: string[];
  input?: Record<string, FieldDefinition | string>;
  when?: ExprNode | string;
  run?: Record<string, ExprNode | string | unknown>;
}

export interface EntityDefinition {
  key?: string;
  embedded?: boolean;
  fields: Record<string, FieldDefinition | string>;
  rules?: RuleDefinition[];
  invariants?: InvariantDefinition[];
  permissions?: Record<string, unknown>;
  workflow?: WorkflowDefinition;
  actions?: Record<string, ActionDefinition>;
}

export interface RawKerangkaDocument {
  kerangka: string;
  app: string;
  meta?: {
    title?: string;
    description?: string;
    version?: string;
    timezone?: string;
    [key: string]: unknown;
  };
  roles?: string[];
  multitenancy?: {
    strategy: "discriminator" | "schema" | "database";
    field?: string;
    header?: string;
    claim?: string;
  };
  traits?: Record<string, unknown>;
  entities?: Record<string, EntityDefinition>;
  events?: Record<string, unknown>;
  decisions?: Record<string, unknown>;
  schedules?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  views?: Record<string, unknown>;
  navigation?: unknown[];
  examples?: unknown[];
  [key: string]: unknown;
}

export interface KIRDocument {
  $schema?: string;
  kir: string;
  app: string;
  meta: {
    title: string;
    description?: string;
    version?: string;
    timezone: string;
    compiledAt: string;
    compilerVersion: string;
  };
  roles?: string[];
  multitenancy?: {
    strategy: "discriminator" | "schema" | "database";
    field?: string;
    header?: string;
    claim?: string;
  };
  entities: Record<string, {
    key: string;
    embedded: boolean;
    fields: Record<string, FieldDefinition>;
    rules?: { id: string; field?: string; message: string; check: ExprNode }[];
    invariants?: { id: string; message: string; assert: ExprNode }[];
    permissions?: Record<string, unknown>;
    workflow?: {
      field: string;
      states: string[];
      initial?: string;
      terminal?: string[];
      transitions: Record<string, {
        from: string | string[];
        to: string;
        roles?: string[];
        when?: ExprNode;
        then?: unknown[];
      }>;
      tasks?: Record<string, unknown>;
    };
    actions?: Record<string, {
      roles?: string[];
      input?: Record<string, FieldDefinition>;
      when?: ExprNode;
      run?: Record<string, ExprNode | unknown>;
    }>;
  }>;
  events?: Record<string, unknown>;
  decisions?: Record<string, unknown>;
  schedules?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  views?: Record<string, unknown>;
  navigation?: unknown[];
  examples?: unknown[];
}
