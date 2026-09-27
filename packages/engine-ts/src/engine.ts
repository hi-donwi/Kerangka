/**
 * Kerangka TypeScript Reference Engine Core
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { evaluate, ExprNode } from "@kerangka/k1";
import {
  ActorContext,
  DeclarativeExample,
  ExecutionResult,
  ValidationErrorItem,
  ValidationResult,
} from "./types.js";

export class Engine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly ir: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(ir: any) {
    this.ir = ir;
  }

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
            const passed = Boolean(evaluate(rule.check as ExprNode, { record }));
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
            const passed = Boolean(evaluate(inv.assert as ExprNode, { record }));
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

  transition(
    entityName: string,
    record: Record<string, unknown>,
    transitionName: string,
    actor?: ActorContext,
    now?: string | Date
  ): ExecutionResult {
    const entity = this.ir.entities?.[entityName];
    if (!entity) return { ok: false, error: "UNKNOWN_ENTITY" };

    const workflow = entity.workflow;
    if (!workflow) return { ok: false, error: "NO_WORKFLOW_DEFINED" };

    const transition = workflow.transitions?.[transitionName];
    if (!transition) return { ok: false, error: "UNKNOWN_TRANSITION" };

    // Actor Role Check
    if (Array.isArray(transition.roles) && transition.roles.length > 0) {
      const actorRoles = actor?.roles ?? [];
      const hasRole = transition.roles.some((r: string) => actorRoles.includes(r));
      if (!hasRole) {
        return { ok: false, error: "PERMISSION_DENIED", message: "Actor lacks required role" };
      }
    }

    // Current Status Check
    const statusField = workflow.field ?? "status";
    const currentStatus = record[statusField];
    const allowedFrom = Array.isArray(transition.from) ? transition.from : [transition.from];

    if (!allowedFrom.includes(currentStatus)) {
      return {
        ok: false,
        error: "INVALID_STATE_TRANSITION",
        message: `Cannot execute transition '${transitionName}' from state '${currentStatus}'`,
      };
    }

    // Guard Condition Check
    const workingRecord = this.compute(entityName, record);
    if (transition.when && typeof transition.when === "object") {
      try {
        const guardPassed = Boolean(
          evaluate(transition.when as ExprNode, {
            record: workingRecord,
            actor,
            now: now ?? new Date().toISOString(),
          })
        );
        if (!guardPassed) {
          return { ok: false, error: "GUARD_FAILED", message: "Transition guard expression evaluated to false" };
        }
      } catch {
        return { ok: false, error: "GUARD_FAILED", message: "Guard evaluation error" };
      }
    }

    // Execute State Change
    const nextRecord: Record<string, unknown> = { ...workingRecord, [statusField]: transition.to };

    // Execute Then Side Effects
    const events: { name: string; data?: unknown }[] = [];
    if (Array.isArray(transition.then)) {
      for (const effect of transition.then) {
        if (effect.emit) {
          events.push({ name: effect.emit, data: effect.data });
        }
        if (effect.set && typeof effect.set === "object") {
          for (const [k, v] of Object.entries(effect.set)) {
            if (v === "now()") {
              nextRecord[k] = (now ? (typeof now === "string" ? now : now.toISOString()) : new Date().toISOString());
            } else {
              nextRecord[k] = v;
            }
          }
        }
      }
    }

    const finalRecord = this.compute(entityName, nextRecord);
    return { ok: true, record: finalRecord, events };
  }

  executeAction(
    entityName: string,
    record: Record<string, unknown>,
    actionName: string,
    input?: Record<string, unknown>,
    actor?: ActorContext
  ): ExecutionResult {
    const entity = this.ir.entities?.[entityName];
    if (!entity) return { ok: false, error: "UNKNOWN_ENTITY" };

    const action = entity.actions?.[actionName];
    if (!action) return { ok: false, error: "UNKNOWN_ACTION" };

    // Role check
    if (Array.isArray(action.roles) && action.roles.length > 0) {
      const actorRoles = actor?.roles ?? [];
      const hasRole = action.roles.some((r: string) => actorRoles.includes(r));
      if (!hasRole) {
        return { ok: false, error: "PERMISSION_DENIED" };
      }
    }

    const workingRecord = this.compute(entityName, record);

    // Guard condition
    if (action.when && typeof action.when === "object") {
      try {
        const passed = Boolean(
          evaluate(action.when as ExprNode, {
            record: workingRecord,
            input: input ?? {},
            actor,
          })
        );
        if (!passed) {
          return { ok: false, error: "GUARD_FAILED" };
        }
      } catch {
        return { ok: false, error: "GUARD_FAILED" };
      }
    }

    // Run mutations
    const nextRecord: Record<string, unknown> = { ...workingRecord };
    if (action.run && typeof action.run === "object") {
      for (const [targetField, exprOrVal] of Object.entries(action.run)) {
        if (exprOrVal && typeof exprOrVal === "object") {
          try {
            nextRecord[targetField] = evaluate(exprOrVal as ExprNode, {
              record: workingRecord,
              input: input ?? {},
              actor,
            });
          } catch {
            nextRecord[targetField] = exprOrVal;
          }
        } else {
          nextRecord[targetField] = exprOrVal;
        }
      }
    }

    const finalRecord = this.compute(entityName, nextRecord);

    // Validate Invariants after action
    const validation = this.validate(entityName, finalRecord);
    const invariantErr = validation.errors.find((e) => e.code === "INVARIANT_FAILED");
    if (invariantErr) {
      return { ok: false, error: "INVARIANT_FAILED", message: invariantErr.message };
    }

    return { ok: true, record: finalRecord };
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

    const entity = this.ir.entities?.[entityName];
    if (!entity) {
      return {
        passed: false,
        error: `Entity ${entityName} not found in model`,
        actual: { ok: false, error: "UNKNOWN_ENTITY" },
      };
    }

    let actual: ExecutionResult;
    if (entity.workflow?.transitions?.[opName]) {
      actual = this.transition(entityName, example.record, opName, example.actor);
    } else if (entity.actions?.[opName]) {
      actual = this.executeAction(entityName, example.record, opName, example.input, example.actor);
    } else {
      return {
        passed: false,
        error: `Operation ${opName} is neither a workflow transition nor an action on ${entityName}`,
        actual: { ok: false, error: "UNKNOWN_OPERATION" },
      };
    }

    // Verify expectations
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
