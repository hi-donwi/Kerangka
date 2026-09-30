/**
 * Kerangka TypeScript Reference Engine Core
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import {
  evaluate,
  compileExpression,
  ExprNode,
  addDuration,
  getNextCronRun,
  K1EvaluationError,
} from "@kerangka/k1";
import {
  ActorContext,
  AvailableOperation,
  CanResult,
  CloudEvent,
  DecisionHitPolicy,
  DecisionResult,
  DecisionRule,
  DecisionRow,
  DecisionTableDef,
  DeclarativeExample,
  Effect,
  ExecutionPlan,
  ExecutionResult,
  ExecutionTrace,
  PolicyInvocation,
  QueryPlan,
  ReactionResult,
  RunOptions,
  ScheduledTrigger,
  TraceStep,
  ValidationErrorItem,
  ValidationResult,
} from "./types.js";

interface NormalizedArgs {
  entityName: string;
  opName: string;
  record: Record<string, unknown>;
  input: Record<string, unknown>;
  actor?: ActorContext;
  options: RunOptions;
}

export class Engine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly ir: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(ir: any) {
    this.ir = ir;
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  /**
   * Canonical IR keeps decision tables as `rows` keyed by column name
   * (ADR-0002, `spec/kir.schema.json`). Host-built tables may still pass `rules`.
   */
  private decisionRules(table: DecisionTableDef): DecisionRule[] {
    if (Array.isArray(table.rules)) {
      return table.rules;
    }
    const rows: DecisionRow[] = Array.isArray(table.rows) ? table.rows : [];
    return rows.map((row, index) => ({
      id: `row-${index + 1}`,
      inputs: table.inputs.map((col) => {
        const cell = row[col.name];
        return cell === undefined || cell === null ? "-" : (cell as string | number | boolean);
      }),
      outputs: Object.fromEntries(
        table.outputs.map((out) => [out.name, this.coerceCell(row[out.name], out.type)]),
      ),
    }));
  }

  /** A row cell is written as its literal JSON value; a CSV import may deliver a string. */
  private coerceCell(value: unknown, type?: string): unknown {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") return value;
    const declared = (type ?? "").toLowerCase();
    const isNumeric = /^(int|integer|number|decimal|numeric|float|double|money)/.test(declared);
    const isBoolean = /^(bool)/.test(declared);
    if (isNumeric && /^-?\d+(\.\d+)?$/.test(value.trim())) {
      return Number(value.trim());
    }
    if (isBoolean && /^(true|false)$/i.test(value.trim())) {
      return value.trim().toLowerCase() === "true";
    }
    return value;
  }

  /**
   * The one cell rule (spec/semantics/cells.md §2). A cell is computed only when it
   * unambiguously compiles to K1 and evaluates to a non-null value; otherwise it is a
   * literal, exactly as written. `set`, `emit.data`, action `run`, and decision-table
   * output cells all resolve through here, so the same text means the same thing
   * everywhere.
   */
  private resolveCell(
    value: unknown,
    record: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveCell(item, record, extra));
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;

      // A declared operation: `{ "operator": "multiply", "args": [ … ] }`.
      if (typeof obj.operator === "string") {
        const args = (obj.args ?? obj.value ?? obj.path ?? []) as unknown[];
        const node = { $expr: obj.operator, args: this.cellArgs(args, record, extra) };
        return this.evaluateCellNode(node as ExprNode, record, extra, value);
      }

      if ("literal" in obj) {
        return obj.literal;
      }
      if ("$bind" in obj || "$expr" in obj) {
        return this.evaluateCellNode(obj as unknown as ExprNode, record, extra, value);
      }

      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = this.resolveCell(v, record, extra);
      }
      return out;
    }
    if (typeof value !== "string") {
      return value;
    }

    const node = this.cellNode(value, record, extra);
    if (!node) {
      return value;
    }
    return this.evaluateCellNode(node, record, extra, value);
  }

  /** Compile a cell to an expression node, or `null` when it is plainly a literal. */
  private cellNode(
    value: unknown,
    record: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): ExprNode | null {
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if ("literal" in obj) {
        return { literal: this.cellLiteral(obj.literal) };
      }
      if ("$bind" in obj || "$expr" in obj) {
        return obj as unknown as ExprNode;
      }
      if (typeof obj.path === "string" && Object.keys(obj).length === 1) {
        return { $bind: obj.path };
      }
      if (typeof obj.operator === "string") {
        const args = (obj.args ?? obj.value ?? obj.path ?? []) as unknown[];
        return { $expr: obj.operator, args: this.cellArgs(args, record, extra) };
      }
      return null;
    }
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (trimmed.length >= 2) {
      const first = trimmed[0];
      const last = trimmed[trimmed.length - 1];
      if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
        return { literal: trimmed.slice(1, -1) };
      }
    }

    try {
      const node = compileExpression(trimmed);
      return "$bind" in node || "$expr" in node ? node : null;
    } catch {
      return null;
    }
  }

  /** A literal node accepts only JSON scalars; anything else stays a string. */
  private cellLiteral(value: unknown): string | number | boolean | null {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    return JSON.stringify(value);
  }

  /** Compile each declared argument of an operation cell to an expression node. */
  private cellArgs(args: unknown[], record: Record<string, unknown>, extra: Record<string, unknown>): ExprNode[] {
    return args.map((arg) => {
      if (arg !== null && typeof arg === "object") {
        return this.cellNode(arg, record, extra) ?? { literal: null };
      }
      if (typeof arg === "number" || typeof arg === "boolean" || arg === null) {
        return { literal: arg };
      }
      if (arg === undefined) {
        return { literal: null };
      }
      if (typeof arg === "string") {
        return this.cellNode(arg, record, extra) ?? { literal: arg };
      }
      return { literal: null };
    });
  }

  private evaluateCellNode(
    node: ExprNode,
    record: Record<string, unknown>,
    extra: Record<string, unknown>,
    original: unknown,
  ): unknown {
    try {
      const value = evaluate(node, this.evalContext({ record, data: record, ...extra }));
      return value === null ? original : value;
    } catch {
      return original;
    }
  }

  /**
   * `then[].emit.data` values are references into the record, not literals:
   * `{ "orderId": "id", "amount": "totalAmount" }` (PLAN.md 5.1).
   */
  private resolveEventData(
    data: unknown,
    record: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): unknown {
    return this.resolveCell(data, record, extra);
  }

  /**
   * A `with` cell is a literal unless it parses to a K1 operation. `issued` and `INV-o-1`
   * parse to a literal or nothing and stay as written; `concat(...)` and `now()` parse to a
   * call and are evaluated. Anything that fails to parse is a literal.
   */
  private asExpression(value: string): ExprNode | null {
    try {
      const node = compileExpression(value);
      if ("$bind" in node) {
        // `issued` parses as the bind `issued`; only a path rooted in the evaluation
        // context (`event.data.orderId`) is a reference rather than a literal word.
        return /^(event|eventMetadata|record|state|data|user|actor|input)\./.test(node.$bind) ? node : null;
      }
      if (!("$expr" in node)) return null;
      // `o-7` parses as the subtraction `o - 7`; only a named call such as `concat(...)`
      // or `now()` is an operation. A cell that is a value stays a value.
      return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(node.$expr) ? node : null;
    } catch {
      return null;
    }
  }

  /**
   * Model-level functions callable from a K1 expression. Decision tables are the
   * built-in case (PLAN.md §5.8): `compute: "approverRouting(days)"`.
   */
  private decisionFunctions(): Record<string, (args: unknown[]) => unknown> {
    const tables = (this.ir.decisions ?? {}) as Record<string, DecisionTableDef>;
    const fns: Record<string, (args: unknown[]) => unknown> = {};
    for (const name of Object.keys(tables)) {
      fns[name] = (args: unknown[]) => this.callDecision(name, args);
    }
    return fns;
  }

  /**
   * Decision-table output cells follow the same cell rule (spec/semantics/cells.md §2),
   * scoped to the row input plus `cell`/`value` for the column in question. A row may
   * therefore compute its output from the input that matched it, and a plain literal such
   * as `"auto"` still stays a literal.
   */
  private resolveDecisionOutputs(
    outputs: Record<string, unknown>,
    columns: { name: string; type?: string }[],
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      const coerced = this.coerceCell(outputs[col.name], col.type);
      out[col.name] = this.resolveCell(coerced, input, {
        ...input,
        cell: input[col.name],
        value: input[col.name],
      });
    }
    for (const [k, v] of Object.entries(outputs)) {
      if (!(k in out)) {
        out[k] = this.coerceCell(v);
      }
    }
    return out;
  }

  private callDecision(name: string, args: unknown[]): unknown {
    const table = (this.ir.decisions ?? {})[name] as DecisionTableDef | undefined;
    if (!table) {
      throw new K1EvaluationError(`Unknown decision table '${name}'`, "DECISION_UNKNOWN");
    }

    // Inputs arrive positionally and are bound in declared order (PLAN.md §5.8).
    const input: Record<string, unknown> = {};
    table.inputs.forEach((col, index) => {
      input[col.name] = args[index] ?? null;
    });

    const result = this.decide(name, input);
    if (!result.matched || !result.outputs) {
      const code = result.code ?? "DECISION_NO_MATCH";
      throw new K1EvaluationError(
        `${code}: ${result.error ?? `Decision table '${name}' matched no row`}`,
        code,
      );
    }

    const outputs = result.outputs as Record<string, unknown>;
    const names = table.outputs.map((out) => out.name);
    if (names.length === 1) {
      return outputs[names[0]!];
    }
    return outputs;
  }

  /** Evaluation context with the model's decision tables bound as functions. */
  private evalContext(base: Record<string, unknown>): Record<string, unknown> {
    return { ...base, functions: this.decisionFunctions() };
  }

  private normalizeArgs(args: unknown[]): NormalizedArgs {
    const arg0 = args[0];
    const arg1 = args[1];
    const arg2 = args[2];
    const arg3 = args[3];
    const arg4 = args[4];
    const arg5 = args[5];

    let entityName = "";
    let opName = "";
    let record: Record<string, unknown> = {};
    let input: Record<string, unknown> = {};
    let actor: ActorContext | undefined;
    let options: RunOptions = {};

    if (typeof arg0 === "string" && typeof arg1 === "string") {
      // Style 2: ("Invoice", "send", record, input, actor, options)
      entityName = arg0;
      opName = arg1;
      record = (typeof arg2 === "object" && arg2 !== null ? arg2 : {}) as Record<string, unknown>;
      if (typeof arg3 === "object" && arg3 !== null) {
        if ("roles" in arg3) {
          actor = arg3 as ActorContext;
        } else {
          input = arg3 as Record<string, unknown>;
        }
      }
      if (typeof arg4 === "object" && arg4 !== null) {
        if ("roles" in arg4) {
          actor = arg4 as ActorContext;
        } else {
          options = arg4 as RunOptions;
        }
      } else if (typeof arg4 === "string" || arg4 instanceof Date) {
        options = { now: arg4 };
      }
      if (typeof arg5 === "object" && arg5 !== null) {
        options = arg5 as RunOptions;
      }
    } else if (typeof arg0 === "string" && typeof arg1 === "object" && typeof arg2 === "string") {
      // Style 3 (transition/executeAction): ("Invoice", record, "send", actor/input, now)
      entityName = arg0;
      record = (arg1 ?? {}) as Record<string, unknown>;
      opName = arg2;
      if (typeof arg3 === "object" && arg3 !== null) {
        if ("roles" in arg3) {
          actor = arg3 as ActorContext;
        } else {
          input = arg3 as Record<string, unknown>;
        }
      }
      if (typeof arg4 === "object" && arg4 !== null) {
        if ("roles" in arg4) {
          actor = arg4 as ActorContext;
        } else {
          options = arg4 as RunOptions;
        }
      } else if (typeof arg4 === "string" || arg4 instanceof Date) {
        options = { now: arg4 };
      }
    } else if (typeof arg0 === "string") {
      // Style 1: ("Invoice.send", record, input, actor, options)
      if (arg0.includes(".")) {
        const parts = arg0.split(".");
        entityName = parts[0]!;
        opName = parts.slice(1).join(".");
      } else {
        entityName = Object.keys(this.ir.entities ?? {})[0] ?? "";
        opName = arg0;
      }
      record = (typeof arg1 === "object" && arg1 !== null ? arg1 : {}) as Record<string, unknown>;
      if (typeof arg2 === "object" && arg2 !== null) {
        if ("roles" in arg2) {
          actor = arg2 as ActorContext;
        } else {
          input = arg2 as Record<string, unknown>;
        }
      }
      if (typeof arg3 === "object" && arg3 !== null) {
        if ("roles" in arg3) {
          actor = arg3 as ActorContext;
        } else {
          options = arg3 as RunOptions;
        }
      } else if (typeof arg3 === "string" || arg3 instanceof Date) {
        options = { now: arg3 };
      }
      if (typeof arg4 === "object" && arg4 !== null) {
        options = arg4 as RunOptions;
      } else if (typeof arg4 === "string" || arg4 instanceof Date) {
        options = { now: arg4 };
      }
    }

    return { entityName, opName, record, input, actor, options };
  }

  private createCloudEvent<T = unknown>(
    type: string,
    data: T,
    entityName: string,
    record: Record<string, unknown>,
    actor?: ActorContext,
    now?: string | Date,
    source?: string
  ): CloudEvent<T> {
    const nowIso = now ? new Date(now).toISOString() : new Date().toISOString();
    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const src = source ?? `kerangka/${this.ir.app ?? "app"}/${entityName}`;
    const subject = record.id !== undefined ? String(record.id) : undefined;
    const tenantid = actor?.tenantId !== undefined ? String(actor.tenantId) : undefined;

    return {
      specversion: "1.0",
      id,
      source: src,
      type,
      name: type,
      time: nowIso,
      datacontenttype: "application/json",
      data,
      subject,
      tenantid,
    };
  }

  // ---------------------------------------------------------------------------
  // Computation & Validation
  // ---------------------------------------------------------------------------

  compute(entityName: string, record: Record<string, unknown>): Record<string, unknown> {
    const entity = this.ir.entities?.[entityName];
    if (!entity) return { ...record };

    const result = { ...record };

    for (const [fieldName, fieldDef] of Object.entries(entity.fields ?? {})) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = fieldDef as any;
      if (f.compute && typeof f.compute === "object") {
        try {
          const val = evaluate(
            f.compute as ExprNode,
            this.evalContext({ record: result, data: result }),
          );
          result[fieldName] = val;
        } catch (err) {
          // A decision table that cannot decide must fail the operation, not leave the
          // field silently unset (ADR-0008, fail closed). Other evaluation failures keep
          // the prior value, which is what validation then reports on.
          if (err instanceof K1EvaluationError && err.code.startsWith("DECISION_")) {
            throw err;
          }
        }
      }
    }

    return result;
  }

  validate(entityName: string, record: Record<string, unknown>): ValidationResult {
    const entity = this.ir.entities?.[entityName];
    if (!entity) {
      return {
        valid: false,
        errors: [{ message: `Unknown entity '${entityName}'`, code: "UNKNOWN_ENTITY" }],
      };
    }

    const errors: ValidationErrorItem[] = [];

    // 1. Field-level validation
    for (const [fieldName, fieldDef] of Object.entries(entity.fields ?? {})) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = fieldDef as any;
      const val = record[fieldName];

      if (f.required && (val === undefined || val === null || val === "")) {
        errors.push({
          field: fieldName,
          message: `Field '${fieldName}' is required`,
          code: "REQUIRED_FIELD",
        });
        continue;
      }

      if (val !== undefined && val !== null) {
        if (f.min !== undefined && typeof val === "number" && val < f.min) {
          errors.push({
            field: fieldName,
            message: `Field '${fieldName}' must be >= ${f.min}`,
            code: "MIN_CONSTRAINT",
          });
        }
        if (f.max !== undefined && typeof val === "number" && val > f.max) {
          errors.push({
            field: fieldName,
            message: `Field '${fieldName}' must be <= ${f.max}`,
            code: "MAX_CONSTRAINT",
          });
        }
        if (f.type === "enum" && Array.isArray(f.values) && !f.values.includes(String(val))) {
          errors.push({
            field: fieldName,
            message: `Field '${fieldName}' must be one of: ${f.values.join(", ")}`,
            code: "INVALID_ENUM_VALUE",
          });
        }
      }
    }

    // 2. Business Rules validation
    if (Array.isArray(entity.rules)) {
      for (const rule of entity.rules) {
        if (rule.check && typeof rule.check === "object") {
          try {
            const passed = Boolean(evaluate(rule.check as ExprNode, this.evalContext({ record, data: record })));
            if (!passed) {
              errors.push({
                id: rule.id,
                field: rule.field,
                message: rule.message,
                code: "RULE_FAILED",
              });
            }
          } catch {
            errors.push({
              id: rule.id,
              field: rule.field,
              message: rule.message,
              code: "RULE_EVALUATION_ERROR",
            });
          }
        }
      }
    }

    // 3. Domain Invariants validation
    if (Array.isArray(entity.invariants)) {
      for (const inv of entity.invariants) {
        if (inv.assert && typeof inv.assert === "object") {
          try {
            const passed = Boolean(evaluate(inv.assert as ExprNode, this.evalContext({ record, data: record })));
            if (!passed) {
              errors.push({
                id: inv.id,
                message: inv.message,
                code: "INVARIANT_FAILED",
              });
            }
          } catch {
            errors.push({
              id: inv.id,
              message: inv.message,
              code: "INVARIANT_EVALUATION_ERROR",
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Gating & Discovery: can and available
  // ---------------------------------------------------------------------------

  can(...args: unknown[]): CanResult {
    const { entityName, opName, record, input, actor, options } = this.normalizeArgs(args);

    const entity = this.ir.entities?.[entityName];
    if (!entity) {
      return { allowed: false, code: "UNKNOWN_ENTITY", reason: `Entity '${entityName}' not found` };
    }

    const isTransition = Boolean(entity.workflow?.transitions?.[opName]);
    const isAction = Boolean(entity.actions?.[opName]);

    if (!isTransition && !isAction) {
      return {
        allowed: false,
        code: "UNKNOWN_OPERATION",
        reason: `Operation '${opName}' is neither an action nor a transition on '${entityName}'`,
      };
    }

    const opDef = isTransition ? entity.workflow.transitions[opName] : entity.actions[opName];

    // Role authorization check
    if (Array.isArray(opDef.roles) && opDef.roles.length > 0) {
      const actorRoles = actor?.roles ?? [];
      const hasRole = opDef.roles.some((r: string) => actorRoles.includes(r));
      if (!hasRole) {
        return { allowed: false, code: "PERMISSION_DENIED", reason: "Actor lacks required role" };
      }
    }

    // State machine check
    if (isTransition) {
      const statusField = entity.workflow.field ?? "status";
      const currentStatus = record[statusField];
      const allowedFrom = Array.isArray(opDef.from) ? opDef.from : [opDef.from];
      if (!allowedFrom.includes(currentStatus)) {
        return {
          allowed: false,
          code: "INVALID_STATE_TRANSITION",
          reason: `Cannot transition '${opName}' from current state '${currentStatus}'`,
        };
      }
    }

    // Guard condition check
    if (opDef.when && typeof opDef.when === "object") {
      const workingRecord = this.compute(entityName, record);
      const nowIso = options.now
        ? (typeof options.now === "string" ? options.now : options.now.toISOString())
        : new Date().toISOString();
      try {
        const passed = Boolean(
          evaluate(
            opDef.when as ExprNode,
            this.evalContext({
              record: workingRecord,
              data: workingRecord,
              actor,
              input,
              now: nowIso,
            }),
          )
        );
        if (!passed) {
          return {
            allowed: false,
            code: "GUARD_FAILED",
            reason: "Guard condition evaluated to false",
          };
        }
      } catch (err) {
        return {
          allowed: false,
          code: "GUARD_FAILED",
          reason: `Guard evaluation error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    return { allowed: true };
  }

  available(
    entityName: string,
    record: Record<string, unknown>,
    actor?: ActorContext,
    now?: string | Date
  ): AvailableOperation[] {
    const entity = this.ir.entities?.[entityName];
    if (!entity) return [];

    const results: AvailableOperation[] = [];

    // 1. Workflow transitions
    if (entity.workflow?.transitions) {
      for (const [transName, transDef] of Object.entries(entity.workflow.transitions)) {
        const canRes = this.can(entityName, transName, record, {}, actor, { now });
        if (canRes.allowed) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = transDef as any;
          results.push({
            name: transName,
            type: "transition",
            label: t.label ?? transName,
            targetStatus: t.to,
            roles: t.roles,
          });
        }
      }
    }

    // 2. Actions
    if (entity.actions) {
      for (const [actionName, actionDef] of Object.entries(entity.actions)) {
        const canRes = this.can(entityName, actionName, record, {}, actor, { now });
        if (canRes.allowed) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = actionDef as any;
          results.push({
            name: actionName,
            type: "action",
            label: a.label ?? actionName,
            roles: a.roles,
            inputSchema: a.params ?? a.input,
          });
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Simulation & Execution: plan and run
  // ---------------------------------------------------------------------------

  plan(...args: unknown[]): ExecutionPlan {
    const { entityName, opName, record, input, actor, options } = this.normalizeArgs(args);

    const canRes = this.can(entityName, opName, record, input, actor, options);
    if (!canRes.allowed) {
      return {
        ok: false,
        error: canRes.reason,
        code: canRes.code,
      };
    }

    const entity = this.ir.entities?.[entityName];
    const isTransition = Boolean(entity.workflow?.transitions?.[opName]);
    const workingRecord = this.compute(entityName, record);
    const nextRecord: Record<string, unknown> = { ...workingRecord };
    const events: CloudEvent[] = [];
    const effects: Effect[] = [];

    const nowIso = options.now
      ? (typeof options.now === "string" ? options.now : options.now.toISOString())
      : new Date().toISOString();

    if (isTransition) {
      const transition = entity.workflow.transitions[opName];
      const statusField = entity.workflow.field ?? "status";
      const fromState = record[statusField];
      const toState = transition.to;
      nextRecord[statusField] = toState;
      const recordId = record.id !== undefined ? String(record.id) : (record._id !== undefined ? String(record._id) : "");

      // 1. Leaving fromState: cancel any existing timers for fromState (PLAN.md §5.9)
      if (fromState && entity.workflow) {
        if (entity.workflow.tasks) {
          for (const [, taskDef] of Object.entries(entity.workflow.tasks)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const task = taskDef as any;
            if (task.state === fromState && task.due && task.onOverdue) {
              effects.push({
                type: "cancel-timer",
                target: recordId,
                action: `${entityName}.${task.onOverdue}`,
              });
            }
          }
        }
        if (entity.workflow.transitions) {
          for (const [tName, tDef] of Object.entries(entity.workflow.transitions)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const t = tDef as any;
            const matchesFrom = t.from === fromState || (Array.isArray(t.from) && t.from.includes(fromState));
            if (matchesFrom && (t.after || t.timer)) {
              effects.push({
                type: "cancel-timer",
                target: recordId,
                action: `${entityName}.${tName}`,
              });
            }
          }
        }
      }

      // 2. Entering toState: schedule timers for toState (PLAN.md §5.9)
      if (toState && entity.workflow) {
        if (entity.workflow.tasks) {
          for (const [, taskDef] of Object.entries(entity.workflow.tasks)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const task = taskDef as any;
            if (task.state === toState && task.due && task.onOverdue) {
              try {
                const triggerAt = addDuration(nowIso, String(task.due));
                effects.push({
                  type: "timer",
                  at: triggerAt,
                  action: `${entityName}.${task.onOverdue}`,
                  target: recordId,
                  payload: { entity: entityName, id: recordId, transition: task.onOverdue },
                });
              } catch {
                // Ignore duration parse errors gracefully
              }
            }
          }
        }
        if (entity.workflow.transitions) {
          for (const [tName, tDef] of Object.entries(entity.workflow.transitions)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const t = tDef as any;
            const matchesTo = t.from === toState || (Array.isArray(t.from) && t.from.includes(toState));
            if (matchesTo && (t.after || t.timer)) {
              let triggerAt: string | undefined;
              const durStr = t.after ?? (typeof t.timer === "string" ? t.timer : t.timer?.after);
              if (durStr) {
                try {
                  triggerAt = addDuration(nowIso, String(durStr));
                } catch {
                  // Ignore
                }
              } else if (t.timer?.at) {
                const atVal = nextRecord[t.timer.at] ?? evaluate(t.timer.at as ExprNode, this.evalContext({ record: nextRecord, now: nowIso }));
                if (atVal) {
                  triggerAt = new Date(String(atVal)).toISOString();
                }
              }

              if (triggerAt) {
                effects.push({
                  type: "timer",
                  at: triggerAt,
                  action: `${entityName}.${tName}`,
                  target: recordId,
                  payload: { entity: entityName, id: recordId, transition: tName },
                });
              }
            }
          }
        }
      }

      if (Array.isArray(transition.then)) {
        for (const effect of transition.then) {
          if (effect.emit) {
            const evtData = this.resolveEventData(effect.data, nextRecord, { now: nowIso }) as Record<
              string,
              unknown
            >;
            const ce = this.createCloudEvent(effect.emit, evtData, entityName, nextRecord, actor, options.now);
            events.push(ce);
            effects.push({ type: "emit", event: ce });
          }
          if (effect.set && typeof effect.set === "object") {
            for (const [k, v] of Object.entries(effect.set)) {
              nextRecord[k] = this.resolveCell(v, nextRecord, {
                input,
                actor,
                now: nowIso,
              });
            }
          }
          if (effect.fail && typeof effect.fail === "object") {
            // A declared failure aborts the whole transition: no patch, no event, no effect.
            const declared = effect.fail as { code?: string; message?: string };
            return {
              ok: false,
              error: declared.message ?? declared.code ?? "Action failed",
              code: declared.code ?? "ACTION_FAILED",
            };
          }
          if (effect.call) {
            effects.push({ type: "call", extension: effect.call, input: effect.input ?? {} });
          }
          if (effect.timer || effect.after) {
            const dur = effect.after ?? (typeof effect.timer === "string" ? effect.timer : effect.timer?.after);
            const act = effect.action ?? `${entityName}.${opName}`;
            if (dur) {
              effects.push({
                type: "timer",
                at: addDuration(nowIso, String(dur)),
                action: act,
                target: recordId,
                payload: effect.payload ?? { entity: entityName, id: recordId },
              });
            }
          }
        }
      }
    } else {
      const action = entity.actions[opName];
      if (action.run && typeof action.run === "object") {
        for (const [targetField, cell] of Object.entries(action.run)) {
          nextRecord[targetField] = this.resolveCell(cell, workingRecord, {
            input,
            actor,
            now: nowIso,
          });
        }
      }
      if (Array.isArray(action.emit)) {
        for (const emitDef of action.emit) {
          const evtName = typeof emitDef === "string" ? emitDef : emitDef.event ?? emitDef.name;
          const rawData = typeof emitDef === "object" ? emitDef.data : {};
          const evtData = this.resolveEventData(rawData, nextRecord, { now: nowIso }) as Record<
            string,
            unknown
          >;
          const ce = this.createCloudEvent(evtName, evtData, entityName, nextRecord, actor, options.now);
          events.push(ce);
          effects.push({ type: "emit", event: ce });
        }
      }
    }

    const projectedRecord = this.compute(entityName, nextRecord);

    // Validate Invariants
    const validation = this.validate(entityName, projectedRecord);
    const invariantErr = validation.errors.find((e) => e.code === "INVARIANT_FAILED");
    if (invariantErr) {
      return { ok: false, error: invariantErr.message, code: "INVARIANT_FAILED" };
    }

    // Compute diff patch
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(projectedRecord)) {
      if (record[k] !== v) {
        patch[k] = v;
      }
    }

    effects.push({ type: "persist", entity: entityName, record: projectedRecord });

    return {
      ok: true,
      patch,
      projectedRecord,
      events,
      effects,
    };
  }

  run(...args: unknown[]): ExecutionResult {
    const startTime = Date.now();
    const startedAt = new Date(startTime).toISOString();
    const { entityName, opName, record, input, actor, options } = this.normalizeArgs(args);

    const traceSteps: TraceStep[] = [];
    const captureTrace = Boolean(options.trace);

    // Step 1: Pre-check & can
    const stepStart = Date.now();
    const canRes = this.can(entityName, opName, record, input, actor, options);
    if (captureTrace) {
      traceSteps.push({
        step: "role_check",
        passed: canRes.code !== "PERMISSION_DENIED",
        details: canRes.code === "PERMISSION_DENIED" ? canRes.reason : "Role authorization passed",
        durationMs: Date.now() - stepStart,
      });
      if (canRes.code === "INVALID_STATE_TRANSITION") {
        traceSteps.push({
          step: "state_check",
          passed: false,
          details: canRes.reason,
          durationMs: 0,
        });
      }
      if (canRes.code === "GUARD_FAILED") {
        traceSteps.push({
          step: "guard",
          passed: false,
          details: canRes.reason,
          durationMs: 0,
        });
      }
    }

    if (!canRes.allowed) {
      const endTime = Date.now();
      return {
        ok: false,
        error: canRes.code ?? "OPERATION_FAILED",
        code: canRes.code,
        message: canRes.reason,
        trace: captureTrace
          ? {
              operation: `${entityName}.${opName}`,
              entity: entityName,
              startedAt,
              endedAt: new Date(endTime).toISOString(),
              durationMs: endTime - startTime,
              actor,
              steps: traceSteps,
            }
          : undefined,
      };
    }

    // Step 2: Simulation / Plan
    const planStart = Date.now();
    const planResult = this.plan(entityName, opName, record, input, actor, options);
    if (captureTrace) {
      traceSteps.push({
        step: "mutation",
        passed: planResult.ok,
        details: planResult.ok ? `Generated patch with ${Object.keys(planResult.patch ?? {}).length} fields` : planResult.error,
        durationMs: Date.now() - planStart,
        metadata: { patch: planResult.patch },
      });
      traceSteps.push({
        step: "invariants",
        passed: planResult.ok,
        details: planResult.ok ? "Invariants passed" : planResult.error,
        durationMs: 0,
      });
      traceSteps.push({
        step: "effects",
        passed: true,
        details: `Produced ${planResult.events?.length ?? 0} events and ${planResult.effects?.length ?? 0} effects`,
        durationMs: 0,
        metadata: { eventCount: planResult.events?.length ?? 0 },
      });
    }

    const endTime = Date.now();
    const trace: ExecutionTrace | undefined = captureTrace
      ? {
          operation: `${entityName}.${opName}`,
          entity: entityName,
          startedAt,
          endedAt: new Date(endTime).toISOString(),
          durationMs: endTime - startTime,
          actor,
          steps: traceSteps,
        }
      : undefined;

    if (!planResult.ok) {
      return {
        ok: false,
        error: planResult.code ?? "EXECUTION_FAILED",
        code: planResult.code,
        message: planResult.error,
        trace,
      };
    }

    return {
      ok: true,
      record: planResult.projectedRecord,
      events: planResult.events,
      effects: planResult.effects,
      trace,
    };
  }

  // ---------------------------------------------------------------------------
  // Data Scoping & Query Compilation: readFilter and queryPlan
  // ---------------------------------------------------------------------------

  readFilter(entityName: string, actor?: ActorContext): ExprNode | null {
    const entity = this.ir.entities?.[entityName];
    if (!entity) return null;

    const conditions: ExprNode[] = [];

    // 1. Multi-tenancy check (ADR-0031)
    const isTenantScoped =
      entity.traits?.includes("std:tenantScoped") ||
      entity.fields?.tenantId !== undefined ||
      this.ir.multitenancy !== undefined;

    if (isTenantScoped && actor?.tenantId !== undefined) {
      conditions.push(["==", ["get", "tenantId"], actor.tenantId] as unknown as ExprNode);
    }

    // 2. Soft-delete check
    const isSoftDelete =
      entity.traits?.includes("std:softDelete") ||
      entity.fields?.deleted !== undefined ||
      entity.fields?.deletedAt !== undefined;

    if (isSoftDelete) {
      if (entity.fields?.deleted !== undefined) {
        conditions.push(["==", ["get", "deleted"], false] as unknown as ExprNode);
      } else if (entity.fields?.deletedAt !== undefined) {
        conditions.push(["is_null", ["get", "deletedAt"]] as unknown as ExprNode);
      }
    }

    // 3. Entity-level readFilter
    if (entity.readFilter) {
      if (typeof entity.readFilter === "object") {
        conditions.push(entity.readFilter as ExprNode);
      }
    }

    if (conditions.length === 0) return null;
    if (conditions.length === 1) return conditions[0]!;
    return ["and", ...conditions] as unknown as ExprNode;
  }

  queryPlan(
    queryName: string,
    params: Record<string, unknown> = {},
    actor?: ActorContext
  ): QueryPlan {
    let queryDef = this.ir.queries?.[queryName];
    let targetEntity = queryDef?.from ?? queryDef?.entity;

    if (!queryDef) {
      for (const [eName, ent] of Object.entries(this.ir.entities ?? {})) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q = (ent as any).queries?.[queryName];
        if (q) {
          queryDef = q;
          targetEntity = eName;
          break;
        }
      }
    }

    if (!queryDef) {
      if (this.ir.entities?.[queryName]) {
        queryDef = { from: queryName, limit: 20 };
        targetEntity = queryName;
      } else {
        throw new Error(`Query '${queryName}' not defined in model`);
      }
    }

    targetEntity = targetEntity ?? queryDef.from ?? Object.keys(this.ir.entities ?? {})[0] ?? "";

    const rf = this.readFilter(targetEntity, actor);
    let combinedWhere: ExprNode | undefined;

    if (queryDef.where && rf) {
      combinedWhere = ["and", queryDef.where, rf] as unknown as ExprNode;
    } else if (queryDef.where) {
      combinedWhere = queryDef.where;
    } else if (rf) {
      combinedWhere = rf;
    }

    const pageSize = (queryDef as { pageSize?: number }).pageSize ?? queryDef.limit;
    const limit = Math.min(Number(params.limit ?? pageSize ?? 20), (queryDef as { maxLimit?: number }).maxLimit ?? 100);
    const page = Number(params.page ?? 1);
    const offset = Number(params.offset ?? (page > 1 ? (page - 1) * limit : 0));

    let orderBy: Array<{ field: string; direction: "asc" | "desc" }> | undefined;
    if (queryDef.orderBy) {
      if (Array.isArray(queryDef.orderBy)) {
        orderBy = queryDef.orderBy;
      } else if (typeof queryDef.orderBy === "string") {
        const [f, dir] = queryDef.orderBy.split(" ");
        orderBy = [{ field: f, direction: dir?.toLowerCase() === "desc" ? "desc" : "asc" }];
      }
    }

    return {
      query: queryName,
      entity: targetEntity,
      select: queryDef.select,
      where: combinedWhere,
      orderBy,
      limit,
      offset,
      params,
    };
  }

  // ---------------------------------------------------------------------------
  // Reactive Policies, Decision Tables, and Schedules
  // ---------------------------------------------------------------------------

  react(
    event: CloudEvent | { name?: string; type?: string; data?: unknown },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _contextState?: Record<string, unknown>
  ): ReactionResult {
    const eventName = event.type ?? (event as { name?: string }).name ?? "";
    const eventData = event.data ?? {};
    const invocations: PolicyInvocation[] = [];

    // A policy writes `event.orderId` or `event.data.orderId`; both resolve. The context
    // carries the envelope, with the payload spread in for the shorter form.
    const eventContext = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
      this.evalContext({
        ...extra,
        event: { ...eventData, ...(event as object), type: eventName, data: eventData },
      });

    const policies = this.ir.policies ?? {};

    for (const [policyName, policyDef] of Object.entries(policies)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = policyDef as any;
      if (!p.on) continue;

      const pattern = p.on;
      // A policy may name its event bare (`OrderPlaced`) or qualified by the owning
      // context (`orders.OrderPlaced`). The emitted CloudEvent carries the bare type.
      const barePattern = pattern.includes(".") ? pattern.slice(pattern.lastIndexOf(".") + 1) : pattern;
      const matches =
        pattern === "*" ||
        pattern === eventName ||
        barePattern === eventName ||
        (pattern.endsWith("*") && eventName.startsWith(pattern.slice(0, -1)));

      if (!matches) continue;

      if (p.when && typeof p.when === "object") {
        try {
          const passed = Boolean(evaluate(p.when as ExprNode, eventContext({ eventMetadata: event })));
          if (!passed) continue;
        } catch {
          continue;
        }
      }

      let targetId: string | undefined;
      if (p.target !== undefined && p.target !== null) {
        const asString =
          typeof p.target === "string"
            ? (() => {
                const node = this.asExpression(p.target as string);
                if (!node) return p.target as string;
                try {
                  const value = evaluate(node, eventContext());
                  return value === null || value === undefined ? "" : String(value);
                } catch {
                  return p.target as string;
                }
              })()
            : String(p.target);
        targetId = String(asString ?? "");
      }

      // `with` is the documented, schema-checked key; `input` stays accepted for a host
      // that builds a policy programmatically.
      const bindings = (p.with ?? p.input) as Record<string, unknown> | undefined;
      const input: Record<string, unknown> = {};
      if (bindings && typeof bindings === "object") {
        for (const [k, v] of Object.entries(bindings)) {
          // A cell is a literal (`issued`), a bind (`event.data.orderId`), or a K1
          // operation (`concat(...)`, `now()`). Anything that is not one of those stays
          // exactly as written.
          const node = v && typeof v === "object" ? (v as ExprNode) : typeof v === "string" ? this.asExpression(v) : null;
          if (node) {
            try {
              input[k] = evaluate(node, eventContext());
              continue;
            } catch {
              input[k] = v;
              continue;
            }
          }
          input[k] = v;
        }
      }

      invocations.push({
        policy: policyName,
        action: p.run,
        targetId,
        input,
        // Idempotent policy execution keyed by event id and policy name (PLAN.md §7.7).
        idempotencyKey: `${(event as { id?: string }).id ?? eventName}:${policyName}`,
      });
    }

    return {
      handled: invocations.length > 0,
      invocations,
    };
  }

  decide(
    tableOrName: DecisionTableDef | string,
    input: Record<string, unknown>
  ): DecisionResult {
    let table: DecisionTableDef | undefined;
    if (typeof tableOrName === "string") {
      table = this.ir.decisions?.[tableOrName];
    } else {
      table = tableOrName;
    }

    if (!table) {
      return {
        matched: false,
        hitCount: 0,
        error: `Decision table '${String(tableOrName)}' not found`,
        code: "TABLE_NOT_FOUND",
      };
    }

    const hitPolicy: DecisionHitPolicy = table.hitPolicy ?? "first";
    const matchingOutputs: Record<string, unknown>[] = [];

    for (const rule of this.decisionRules(table)) {
      let ruleMatched = true;

      for (let i = 0; i < table.inputs.length; i++) {
        const col = table.inputs[i]!;
        const cell = rule.inputs[i];
        const val = input[col.name];

        if (cell === "-" || cell === undefined || cell === null) {
          continue;
        }

        if (typeof cell === "string") {
          const trimmed = cell.trim();
          if (trimmed === "-") continue;

          if (trimmed.startsWith(">=") && typeof val === "number") {
            const num = Number(trimmed.slice(2).trim());
            if (!(val >= num)) { ruleMatched = false; break; }
          } else if (trimmed.startsWith(">") && typeof val === "number") {
            const num = Number(trimmed.slice(1).trim());
            if (!(val > num)) { ruleMatched = false; break; }
          } else if (trimmed.startsWith("<=") && typeof val === "number") {
            const num = Number(trimmed.slice(2).trim());
            if (!(val <= num)) { ruleMatched = false; break; }
          } else if (trimmed.startsWith("<") && typeof val === "number") {
            const num = Number(trimmed.slice(1).trim());
            if (!(val < num)) { ruleMatched = false; break; }
          } else if (trimmed.startsWith("[") || trimmed.startsWith("(")) {
            const m = trimmed.match(/^([[(])\s*([0-9.]+)\s*\.\.\s*([0-9.]+)\s*([\])])$/);
            if (m && typeof val === "number") {
              const [, leftBracket, minStr, maxStr, rightBracket] = m;
              const min = Number(minStr);
              const max = Number(maxStr);
              const minOk = leftBracket === "[" ? val >= min : val > min;
              const maxOk = rightBracket === "]" ? val <= max : val < max;
              if (!minOk || !maxOk) { ruleMatched = false; break; }
            }
          } else if (trimmed.includes(",")) {
            const allowed = trimmed.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
            if (!allowed.includes(String(val))) {
              ruleMatched = false;
              break;
            }
          } else {
            const cleanStr = trimmed.replace(/^['"]|['"]$/g, "");
            if (String(val) !== cleanStr) {
              ruleMatched = false;
              break;
            }
          }
        } else if (typeof cell === "number" || typeof cell === "boolean") {
          if (val !== cell) {
            ruleMatched = false;
            break;
          }
        } else if (typeof cell === "object") {
          try {
            const passed = Boolean(evaluate(cell as ExprNode, { cell: val, input, value: val }));
            if (!passed) { ruleMatched = false; break; }
          } catch {
            ruleMatched = false;
            break;
          }
        }
      }

      if (ruleMatched) {
        matchingOutputs.push(
          this.resolveDecisionOutputs(rule.outputs, table.outputs ?? [], input),
        );
        if (hitPolicy === "first") {
          break;
        }
      }
    }

    if (matchingOutputs.length === 0) {
      const tableName = table.name || String(tableOrName);
      return {
        matched: false,
        hitCount: 0,
        error: `Decision table '${tableName}' matched no row`,
        code: "DECISION_NO_MATCH",
      };
    }

    if (hitPolicy === "unique") {
      if (matchingOutputs.length > 1) {
        const tableName = table.name || String(tableOrName);
        return {
          matched: false,
          hitCount: matchingOutputs.length,
          error: `Unique hit policy violated: ${matchingOutputs.length} rules matched in '${tableName}'`,
          code: "UNIQUE_VIOLATION",
        };
      }
      return {
        matched: true,
        hitCount: 1,
        outputs: matchingOutputs[0],
      };
    }

    if (hitPolicy === "collect") {
      return {
        matched: true,
        hitCount: matchingOutputs.length,
        outputs: matchingOutputs,
      };
    }

    return {
      matched: true,
      hitCount: matchingOutputs.length,
      outputs: matchingOutputs[0],
    };
  }

  schedules(
    entityName: string,
    record: Record<string, unknown>,
    now?: string | Date
  ): ScheduledTrigger[] {
    const entity = this.ir.entities?.[entityName];
    if (!entity) return [];

    const triggers: ScheduledTrigger[] = [];
    const nowIso = now
      ? (typeof now === "string" ? now : now.toISOString())
      : new Date().toISOString();
    const recordId = record.id !== undefined ? String(record.id) : (record._id !== undefined ? String(record._id) : undefined);
    const statusField = entity.workflow?.field ?? "status";
    const currentStatus = record[statusField];

    // 1. Workflow transitions with timer or after
    if (entity.workflow?.transitions) {
      for (const [transName, transDef] of Object.entries(entity.workflow.transitions)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = transDef as any;
        if (!t.timer && !t.after) continue;

        // If transition has 'from', it only triggers if current record matches 'from'
        if (t.from && currentStatus !== undefined) {
          const matches = t.from === currentStatus || (Array.isArray(t.from) && t.from.includes(currentStatus));
          if (!matches) continue;
        }

        let triggerAtIso: string | undefined;
        const durStr = t.after ?? (typeof t.timer === "string" ? t.timer : t.timer?.after);

        if (durStr) {
          try {
            triggerAtIso = addDuration(nowIso, String(durStr));
          } catch {
            // Fallback to legacy numeric parsing if needed
            const match = String(durStr).match(/^(\d+)([smhd])$/i);
            if (match) {
              const qty = Number(match[1]);
              const unit = match[2]!.toLowerCase();
              const multipliers: Record<string, number> = {
                s: 1000,
                m: 60 * 1000,
                h: 60 * 60 * 1000,
                d: 24 * 60 * 60 * 1000,
              };
              const ms = new Date(nowIso).getTime() + qty * (multipliers[unit] ?? 1000);
              triggerAtIso = new Date(ms).toISOString();
            }
          }
        } else if (t.timer?.at) {
          const atVal = record[t.timer.at] ?? evaluate(t.timer.at as ExprNode, this.evalContext({ record, now: nowIso }));
          if (atVal) {
            triggerAtIso = new Date(String(atVal)).toISOString();
          }
        }

        if (triggerAtIso) {
          triggers.push({
            id: `trig_${entityName}_${transName}_${recordId ?? "0"}`,
            entity: entityName,
            recordId,
            type: "timer",
            target: `${entityName}.${transName}`,
            triggerAt: triggerAtIso,
            payload: { transition: transName },
          });
        }
      }
    }

    // 2. Workflow tasks with SLA due and onOverdue
    if (entity.workflow?.tasks) {
      for (const [taskName, taskDef] of Object.entries(entity.workflow.tasks)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const task = taskDef as any;
        if (task.due && task.onOverdue) {
          if (task.state && currentStatus !== undefined && task.state !== currentStatus) {
            continue;
          }
          try {
            const triggerAtIso = addDuration(nowIso, String(task.due));
            triggers.push({
              id: `trig_task_${entityName}_${taskName}_${recordId ?? "0"}`,
              entity: entityName,
              recordId,
              type: "timer",
              target: `${entityName}.${task.onOverdue}`,
              triggerAt: triggerAtIso,
              payload: { task: taskName, transition: task.onOverdue },
            });
          } catch {
            // Ignore
          }
        }
      }
    }

    // 3. Document or entity-level recurring schedules (PLAN.md §5.9)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSchedules: Record<string, any> = {
      ...(entity as any).schedules,
      ...(this.ir as any).schedules,
    };

    for (const [sName, sDef] of Object.entries(allSchedules)) {
      if (sDef && sDef.cron) {
        try {
          const nextRun = getNextCronRun(sDef.cron, nowIso);
          triggers.push({
            id: `sched_${entityName}_${sName}`,
            entity: entityName,
            type: "cron",
            target: sDef.run ?? sDef.action ?? `${entityName}.${sName}`,
            triggerAt: nextRun.toISOString(),
            expression: sDef.cron,
            payload: { for: sDef.for, schedule: sName },
          });
        } catch {
          // Ignore
        }
      }
    }

    return triggers;
  }

  // ---------------------------------------------------------------------------
  // Backward Compatible Aliases
  // ---------------------------------------------------------------------------

  transition(
    entityName: string,
    record: Record<string, unknown>,
    transitionName: string,
    actor?: ActorContext,
    now?: string | Date
  ): ExecutionResult {
    const res = this.run(entityName, transitionName, record, {}, actor, { now });
    if (!res.ok && res.error === "UNKNOWN_OPERATION") {
      return { ...res, error: "UNKNOWN_TRANSITION" };
    }
    return res;
  }

  executeAction(
    entityName: string,
    record: Record<string, unknown>,
    actionName: string,
    input?: Record<string, unknown>,
    actor?: ActorContext,
    now?: string | Date
  ): ExecutionResult {
    return this.run(entityName, actionName, record, input ?? {}, actor, { now });
  }

  runExample(example: DeclarativeExample): { passed: boolean; error?: string; actual: ExecutionResult } {
    const [entityName, opName] = example.run.split(".");
    if (!entityName || !opName) {
      return {
        passed: false,
        error: `Invalid run target: ${example.run}`,
        actual: { ok: false, error: "INVALID_TARGET" },
      };
    }

    const actual = this.run(entityName, opName, example.record, example.input ?? {}, example.actor);

    if (actual.ok !== example.expect.ok) {
      return {
        passed: false,
        error: `Expected ok=${example.expect.ok} but got ok=${actual.ok}`,
        actual,
      };
    }

    if (example.expect.error && actual.error !== example.expect.error) {
      return {
        passed: false,
        error: `Expected error='${example.expect.error}' but got '${actual.error}'`,
        actual,
      };
    }

    if (example.expect.record && actual.record) {
      for (const [k, expectedVal] of Object.entries(example.expect.record)) {
        if (actual.record[k] !== expectedVal) {
          return {
            passed: false,
            error: `Expected record.${k}=${expectedVal} but got ${actual.record[k]}`,
            actual,
          };
        }
      }
    }

    return { passed: true, actual };
  }
}
