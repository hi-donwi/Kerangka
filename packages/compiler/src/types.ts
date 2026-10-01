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
  checkLockfile?: boolean;
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

export interface QueryOrderBy {
  field: string;
  direction: "asc" | "desc";
}

export interface QueryDefinition {
  /** Entity the query reads from. */
  from: string;
  /** Optional predicate AST narrowing the result set. */
  where?: ExprNode;
  /** Optional selected fields; defaults to whole records. */
  select?: string[];
  /** Optional sort order; strings like "createdAt desc" normalize to objects. */
  orderBy?: QueryOrderBy[] | string[];
  /** Default page size (PLAN.md §8.4: cursor pagination). */
  pageSize?: number;
  /** Maximum page size a client may request. */
  maxLimit?: number;
  [key: string]: unknown;
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
  renamedFrom?: string;
}

/**
 * One period of a rule (PLAN.md §5.12). A record keeps the check that was valid when
 * it happened, so a rate change does not rewrite history.
 */
export interface RuleVersion {
  validFrom: string;
  validTo?: string;
  check: ExprNode | string;
  message?: string;
}

export interface RuleDefinition {
  id: string;
  field?: string;
  message: string;
  check: ExprNode | string;
  /** Periods of this rule; the applicable one is chosen by the effective date. */
  versions?: RuleVersion[];
  /** The record field that selects a version. Defaults to `ctx.now`. */
  effectiveDate?: string;
}

export interface InvariantDefinition {
  id: string;
  message: string;
  assert: ExprNode | string;
}

/**
 * One entry of an `emit` list: an event name, or a declaration naming the event and the data
 * to put in it. Both the string and the object form are read off the raw document by the
 * verifier and the AsyncAPI projector, so both are legal input.
 */
export interface EmitDeclaration {
  event?: string;
  name?: string;
  data?: unknown;
}

export interface WorkflowTransition {
  from: string | string[];
  to: string;
  roles?: string[];
  when?: ExprNode | string;
  then?: unknown[];
  /** Events this transition emits, as names or declarations. */
  emit?: Array<string | EmitDeclaration>;
  /** A delay before the transition may fire, as an ISO-8601 duration such as `"PT1H"`. */
  after?: string;
  /**
   * A trigger for a timed transition: a duration, or an object naming either the delay
   * (`after`) or the record field holding the moment (`at`). The engine reads all three
   * forms, so the interface has to say so — a key the engine honours and the type does not
   * declare is one a structural check would report as a typo.
   */
  timer?: string | { after?: string; at?: string };
}

export interface WorkflowDefinition {
  field?: string;
  states?: string[];
  initial?: string;
  terminal?: string[];
  /** Read as an alias for `terminal` by the workflow verifier. */
  final?: string[];
  transitions: Record<string, WorkflowTransition>;
  tasks?: Record<string, unknown>;
}

export interface ActionDefinition {
  roles?: string[];
  input?: Record<string, FieldDefinition | string>;
  when?: ExprNode | string;
  run?: Record<string, ExprNode | string | unknown>;
  /** Events this action emits, as names or declarations. */
  emit?: Array<string | EmitDeclaration>;
  /** The statement vocabulary of PLAN.md 5.6. `do` is the declared name; `then` is accepted. */
  do?: unknown[];
  then?: unknown[];
}

export interface TraitUseObject {
  trait?: string;
  name?: string;
  exclude?: string[];
}

export type TraitDeclaration = string | TraitUseObject;

export interface EntityDefinition {
  key?: string;
  embedded?: boolean;
  traits?: TraitDeclaration[];
  uses?: TraitDeclaration[];
  exclude?: string[];
  readFilter?: string;
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
  packages?: Record<string, string>;
  types?: Record<string, unknown>;
  contexts?: string[];
  traits?: Record<string, unknown>;
  entities?: Record<string, EntityDefinition>;
  queries?: Record<string, QueryDefinition | Record<string, unknown>>;
  events?: Record<string, unknown>;
  policies?: Record<string, unknown>;
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
  queries?: Record<string, QueryDefinition>;
  entities: Record<string, {
    key: string;
    embedded: boolean;
    fields: Record<string, FieldDefinition>;
    /**
     * The read predicate, already lowered to the engine's tuple AST.
     *
     * Was `string`. The source model still takes a string — that is the author's DSL — but the IR
     * carries a predicate, because a string here is what `engine.ts` silently dropped: it accepted
     * only `typeof === "object"`, so a declared read filter did nothing and said nothing. See
     * ADR-0040.
     *
     * Typed `unknown` because the tuple form is structural and `compiler` must not depend on
     * `engine-ts` to name it; `read-filter.ts` is the single place the two ASTs meet.
     */
    readFilter?: unknown;
    rules?: {
      id: string;
      field?: string;
      message: string;
      check: ExprNode;
      effectiveDate?: string;
      versions?: { validFrom: string; validTo?: string; check: ExprNode; message?: string }[];
    }[];
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
      then?: unknown[];
    }>;
  }>;
  packages?: Record<string, string>;
  types?: Record<string, unknown>;
  events?: Record<string, unknown>;
  policies?: Record<string, unknown>;
  decisions?: Record<string, unknown>;
  schedules?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  views?: Record<string, unknown>;
  navigation?: unknown[];
  examples?: unknown[];
}

/**
 * A compiled entity, as it appears in the IR.
 *
 * Distinct from `EntityDefinition`, which is the author's source shape. The one field that differs
 * in type rather than in name is `readFilter`: a string in the source, a predicate in the IR. See
 * ADR-0040.
 */
export type KIREntityDefinition = KIRDocument["entities"][string];
