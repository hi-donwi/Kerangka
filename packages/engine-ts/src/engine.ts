/**
 * Kerangka TypeScript Reference Engine Core
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { evaluate, ExprNode } from "@kerangka/k1";
import {
  ActorContext,
  AvailableOperation,
  CanResult,
  CloudEvent,
  DecisionHitPolicy,
  DecisionResult,
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
          const val = evaluate(f.compute as ExprNode, { record: result, data: result });
          result[fieldName] = val;
        } catch {
          // Keep prior value if evaluation fails
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
            const passed = Boolean(evaluate(rule.check as ExprNode, { record, data: record }));
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
            const passed = Boolean(evaluate(inv.assert as ExprNode, { record, data: record }));
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
          evaluate(opDef.when as ExprNode, {
            record: workingRecord,
            data: workingRecord,
            actor,
            input,
            now: nowIso,
          })
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
      nextRecord[statusField] = transition.to;

      if (Array.isArray(transition.then)) {
        for (const effect of transition.then) {
          if (effect.emit) {
            const ce = this.createCloudEvent(effect.emit, effect.data, entityName, nextRecord, actor, options.now);
            events.push(ce);
            effects.push({ type: "emit", event: ce });
          }
          if (effect.set && typeof effect.set === "object") {
            for (const [k, v] of Object.entries(effect.set)) {
              nextRecord[k] = v === "now()" ? nowIso : v;
            }
          }
          if (effect.call) {
            effects.push({ type: "call", extension: effect.call, input: effect.input ?? {} });
          }
        }
      }
    } else {
      const action = entity.actions[opName];
      if (action.run && typeof action.run === "object") {
        for (const [targetField, exprOrVal] of Object.entries(action.run)) {
          if (exprOrVal && typeof exprOrVal === "object") {
            try {
              nextRecord[targetField] = evaluate(exprOrVal as ExprNode, {
                record: workingRecord,
                data: workingRecord,
                input,
                actor,
                now: nowIso,
              });
            } catch {
              nextRecord[targetField] = exprOrVal;
            }
          } else {
            nextRecord[targetField] = exprOrVal;
          }
        }
      }
      if (Array.isArray(action.emit)) {
        for (const emitDef of action.emit) {
          const evtName = typeof emitDef === "string" ? emitDef : emitDef.event ?? emitDef.name;
          const evtData = typeof emitDef === "object" ? emitDef.data : {};
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

    const limit = Math.min(Number(params.limit ?? queryDef.limit ?? 20), queryDef.maxLimit ?? 100);
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

    const policies = this.ir.policies ?? {};

    for (const [policyName, policyDef] of Object.entries(policies)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = policyDef as any;
      if (!p.on) continue;

      const pattern = p.on;
      const matches =
        pattern === "*" ||
        pattern === eventName ||
        (pattern.endsWith("*") && eventName.startsWith(pattern.slice(0, -1)));

      if (!matches) continue;

      if (p.when && typeof p.when === "object") {
        try {
          const passed = Boolean(evaluate(p.when as ExprNode, { event: eventData, eventMetadata: event }));
          if (!passed) continue;
        } catch {
          continue;
        }
      }

      let targetId: string | undefined;
      if (p.target) {
        if (typeof p.target === "string" && p.target.startsWith("event.")) {
          const path = p.target.slice(6);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          targetId = String((eventData as any)[path] ?? "");
        } else {
          targetId = String(p.target);
        }
      }

      const input: Record<string, unknown> = {};
      if (p.input && typeof p.input === "object") {
        for (const [k, v] of Object.entries(p.input)) {
          if (typeof v === "string" && v.startsWith("event.")) {
            const path = v.slice(6);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input[k] = (eventData as any)[path];
          } else if (v && typeof v === "object") {
            try {
              input[k] = evaluate(v as ExprNode, { event: eventData });
            } catch {
              input[k] = v;
            }
          } else {
            input[k] = v;
          }
        }
      }

      invocations.push({
        policy: policyName,
        action: p.run,
        targetId,
        input,
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

    for (const rule of table.rules) {
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
        matchingOutputs.push(rule.outputs);
        if (hitPolicy === "first") {
          break;
        }
      }
    }

    if (matchingOutputs.length === 0) {
      return {
        matched: false,
        hitCount: 0,
      };
    }

    if (hitPolicy === "unique") {
      if (matchingOutputs.length > 1) {
        return {
          matched: false,
          hitCount: matchingOutputs.length,
          error: `Unique hit policy violated: ${matchingOutputs.length} rules matched`,
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
    const nowMs = now ? (typeof now === "string" ? new Date(now).getTime() : now.getTime()) : Date.now();
    const recordId = record.id !== undefined ? String(record.id) : undefined;

    if (entity.workflow?.transitions) {
      for (const [transName, transDef] of Object.entries(entity.workflow.transitions)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = transDef as any;
        if (!t.timer) continue;

        let triggerAtMs: number | undefined;

        if (t.timer.after) {
          const str = String(t.timer.after);
          const match = str.match(/^(\d+)([smhd])$/);
          if (match) {
            const qty = Number(match[1]);
            const unit = match[2];
            const multipliers: Record<string, number> = {
              s: 1000,
              m: 60 * 1000,
              h: 60 * 60 * 1000,
              d: 24 * 60 * 60 * 1000,
            };
            triggerAtMs = nowMs + qty * (multipliers[unit!] ?? 1000);
          }
        } else if (t.timer.at) {
          const atVal = record[t.timer.at] ?? evaluate(t.timer.at as ExprNode, { record, now: new Date(nowMs).toISOString() });
          if (atVal) {
            triggerAtMs = new Date(String(atVal)).getTime();
          }
        }

        if (triggerAtMs !== undefined && !isNaN(triggerAtMs)) {
          triggers.push({
            id: `trig_${entityName}_${transName}_${recordId ?? "0"}`,
            entity: entityName,
            recordId,
            type: "timer",
            target: `${entityName}.${transName}`,
            triggerAt: new Date(triggerAtMs).toISOString(),
            payload: { transition: transName },
          });
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
