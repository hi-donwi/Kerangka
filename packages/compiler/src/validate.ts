/**
 * Kerangka Model Validator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * Checks a compiled model for names that do not resolve: field types, entity references,
 * fields and inputs used in expressions, function names, workflow states, rule fields,
 * and action targets. Name resolution follows PLAN.md section 5.5.
 */

import { K1_FUNCTIONS, K1_OPERATORS, K1_ROW_AGGREGATES } from "@kerangka/k1";
import { pointer, suggestion } from "./diagnostics.js";
import { COMPOSITE_TYPES, PRIMITIVE_TYPES } from "./shorthand.js";
import { CompilerDiagnostic, EntityDefinition, FieldDefinition, KIRDocument } from "./types.js";

type CompiledEntity = KIRDocument["entities"][string];

/** Where each field, rule, and invariant of an entity was written (traits are inlined). */
export interface EntityOrigins {
  fields: Record<string, string>;
  rules: string[];
  invariants: string[];
}

export type Report = (diagnostic: Omit<CompilerDiagnostic, "severity">) => void;

/** Roots that are always available and not checked further (PLAN.md section 5.5). */
const OPEN_ROOTS = new Set(["actor", "uses", "ctx"]);

interface Scope {
  /** How the scope is named in messages, e.g. "Invoice" or "Line (a row of Invoice.lines)". */
  label: string;
  fields: Record<string, FieldDefinition>;
  /** The enclosing scope, inside a per-row aggregate. */
  outer?: Scope;
  /** Declared action input; undefined where `input` is not checked. */
  input?: { action: string; fields: Record<string, FieldDefinition> };
}

export interface ValidationInput {
  entities: Record<string, CompiledEntity>;
  /** Entities after trait inlining, before compilation: the workflow as written. */
  rawEntities: Record<string, EntityDefinition>;
  origins: Record<string, EntityOrigins>;
  valueTypes: string[];
  decisions: string[];
}

export class ModelValidator {
  private readonly entityNames: string[];
  private readonly callable: Set<string>;
  private readonly functionNames: string[];

  constructor(
    private readonly model: ValidationInput,
    private readonly report: Report
  ) {
    this.entityNames = Object.keys(model.entities);
    this.functionNames = [...K1_FUNCTIONS, ...model.decisions];
    this.callable = new Set([...this.functionNames, ...K1_OPERATORS]);
  }

  validate(): void {
    for (const [name, entity] of Object.entries(this.model.entities)) {
      this.validateEntity(name, entity);
    }
  }

  private validateEntity(name: string, entity: CompiledEntity): void {
    const origins = this.model.origins[name]!;
    const at = (...rest: (string | number)[]) => pointer("entities", name, ...rest);
    const scope: Scope = { label: name, fields: entity.fields };

    for (const [fieldName, field] of Object.entries(entity.fields)) {
      const fieldPath = origins.fields[fieldName] ?? at("fields", fieldName);
      this.checkFieldType(field, fieldPath);
      this.checkExpression(field.compute, scope, `${fieldPath}/compute`);
    }

    (entity.rules ?? []).forEach((rule, i) => {
      const rulePath = origins.rules[i] ?? at("rules", i);
      if (rule.field !== undefined && !(rule.field in entity.fields)) {
        this.unknownField(rule.field, scope, `${rulePath}/field`);
      }
      this.checkExpression(rule.check, scope, `${rulePath}/check`);
    });

    (entity.invariants ?? []).forEach((inv, i) => {
      this.checkExpression(inv.assert, scope, `${origins.invariants[i] ?? at("invariants", i)}/assert`);
    });

    for (const [actionName, action] of Object.entries(entity.actions ?? {})) {
      const inputFields = action.input ?? {};
      for (const [paramName, param] of Object.entries(inputFields)) {
        this.checkFieldType(param, at("actions", actionName, "input", paramName));
      }
      const actionScope: Scope = { ...scope, input: { action: actionName, fields: inputFields } };
      this.checkExpression(action.when, actionScope, at("actions", actionName, "when"));
      for (const [target, value] of Object.entries(action.run ?? {})) {
        const targetPath = at("actions", actionName, "run", target);
        if (!(target in entity.fields)) {
          this.unknownField(target, scope, targetPath);
        }
        this.checkExpression(value, actionScope, targetPath);
      }
    }

    if (entity.workflow) {
      for (const [transName, trans] of Object.entries(entity.workflow.transitions)) {
        this.checkExpression(trans.when, scope, at("workflow", "transitions", transName, "when"));
      }
      this.checkStates(name, entity);
    }
  }

  private checkFieldType(field: FieldDefinition, path: string): void {
    const type = field.type;
    if (
      PRIMITIVE_TYPES.includes(type) ||
      type === "enum" ||
      this.model.valueTypes.includes(type) ||
      this.entityNames.includes(type)
    ) {
      return;
    }
    if (type === "ref") {
      this.checkEntityTarget(field.target, path, "references");
      return;
    }
    if (type === "list") {
      if (field.element?.type === "ref") {
        this.checkEntityTarget(field.element.target, path, "lists");
      } else if (field.element) {
        this.checkFieldType(field.element, path);
      }
      return;
    }
    const known = [...PRIMITIVE_TYPES, ...COMPOSITE_TYPES, ...this.model.valueTypes];
    this.report({
      code: "UNKNOWN_TYPE",
      message: `Unknown type '${type}'`,
      path,
      hint: suggestion(type, known, "types"),
    });
  }

  private checkEntityTarget(target: string | undefined, path: string, verb: string): void {
    if (target !== undefined && this.entityNames.includes(target)) return;
    this.report({
      code: "UNKNOWN_REFERENCE",
      message: target === undefined ? `Field ${verb} no entity` : `Field ${verb} unknown entity '${target}'`,
      path,
      hint:
        target === undefined
          ? "Name the entity, e.g. ref(Customer) or list(Line)."
          : suggestion(target, [...this.entityNames, ...PRIMITIVE_TYPES], "entities"),
    });
  }

  private checkExpression(node: unknown, scope: Scope, path: string): void {
    this.walk(node, scope, path, new Set());
  }

  private walk(node: unknown, scope: Scope, path: string, reported: Set<string>): void {
    if (!node || typeof node !== "object") return;

    if ("$bind" in node && typeof node.$bind === "string") {
      this.checkBinding(node.$bind, scope, path, reported);
      return;
    }
    if (!("$expr" in node) || typeof node.$expr !== "string") return;

    const name = node.$expr;
    const args = "args" in node && Array.isArray(node.args) ? (node.args as unknown[]) : [];
    if (!this.callable.has(name) && !reported.has(`call:${name}`)) {
      reported.add(`call:${name}`);
      this.report({
        code: "UNKNOWN_FUNCTION",
        message: `Unknown function '${name}'`,
        path,
        hint: suggestion(name, this.functionNames, "functions and decision tables"),
      });
    }

    if (K1_ROW_AGGREGATES.includes(name) && args.length >= 2) {
      this.walk(args[0], scope, path, reported);
      const row = this.rowScope(args[0], scope);
      // A row of unknown shape (a list of scalars, an unresolved list) is not checked.
      if (row) this.walk(args[1], row, path, reported);
      args.slice(2).forEach((arg) => this.walk(arg, scope, path, reported));
      return;
    }
    args.forEach((arg) => this.walk(arg, scope, path, reported));
  }

  private rowScope(listNode: unknown, scope: Scope): Scope | undefined {
    if (!listNode || typeof listNode !== "object" || !("$bind" in listNode)) return undefined;
    const listName = listNode.$bind;
    if (typeof listName !== "string") return undefined;
    const target = scope.fields[listName]?.element?.target;
    const entity = target !== undefined ? this.model.entities[target] : undefined;
    if (!entity) return undefined;
    return {
      label: `${target} (a row of ${scope.label}.${listName})`,
      fields: entity.fields,
      outer: scope,
      input: scope.input,
    };
  }

  private checkBinding(binding: string, scope: Scope, where: string, reported: Set<string>): void {
    const [root = "", next] = binding.split(/\.|\[/);
    if (OPEN_ROOTS.has(root) || reported.has(binding)) return;

    if (root === "record" || root === "input") {
      // `record[...]`, `input['x']`, and a bare root are not checked.
      if (next === undefined || !/^[A-Za-z_]\w*$/.test(next)) return;
      if (root === "record") {
        let top = scope;
        while (top.outer) top = top.outer;
        if (next in top.fields) return;
        reported.add(binding);
        this.unknownField(next, top, where);
        return;
      }
      if (!scope.input || next in scope.input.fields) return;
      reported.add(binding);
      const inputs = Object.keys(scope.input.fields);
      this.report({
        code: "UNKNOWN_FIELD",
        message: `'${next}' is not an input of action '${scope.input.action}'`,
        path: where,
        hint: inputs.length === 0
          ? `Action '${scope.input.action}' declares no input; add it under "input".`
          : suggestion(next, inputs, "inputs"),
      });
      return;
    }

    if (root in scope.fields) return;
    reported.add(binding);
    this.unknownField(root, scope, where);
  }

  private unknownField(name: string, scope: Scope, path: string): void {
    this.report({
      code: "UNKNOWN_FIELD",
      message: `'${name}' is not a field of ${scope.label}`,
      path,
      hint: suggestion(name, Object.keys(scope.fields), `fields of ${scope.label}`),
    });
  }

  /**
   * States come from `workflow.states` when declared, otherwise from the values of the
   * state field when it is an enum. With neither, the states are whatever the
   * transitions name, so there is nothing to check against.
   */
  private checkStates(entityName: string, entity: CompiledEntity): void {
    const workflow = this.model.rawEntities[entityName]?.workflow;
    if (!workflow) return;
    const stateField = entity.fields[workflow.field ?? "status"];
    const states =
      workflow.states && workflow.states.length > 0
        ? workflow.states
        : stateField?.type === "enum"
          ? (stateField.values ?? [])
          : undefined;
    if (!states) return;

    const at = (...rest: (string | number)[]) => pointer("entities", entityName, "workflow", ...rest);
    const check = (state: unknown, path: string) => {
      if (typeof state !== "string" || states.includes(state)) return;
      this.report({
        code: "UNKNOWN_STATE",
        message: `'${state}' is not a state of the ${entityName} workflow`,
        path,
        hint: suggestion(state, states, "states"),
      });
    };

    for (const [transName, trans] of Object.entries(workflow.transitions ?? {})) {
      if (Array.isArray(trans.from)) {
        trans.from.forEach((s, i) => check(s, at("transitions", transName, "from", i)));
      } else {
        check(trans.from, at("transitions", transName, "from"));
      }
      check(trans.to, at("transitions", transName, "to"));
    }
    if (workflow.initial !== undefined) check(workflow.initial, at("initial"));
    (workflow.terminal ?? []).forEach((s, i) => check(s, at("terminal", i)));
    for (const [taskName, task] of Object.entries(workflow.tasks ?? {})) {
      if (task && typeof task === "object" && "state" in task) {
        check(task.state, at("tasks", taskName, "state"));
      }
    }
  }
}
