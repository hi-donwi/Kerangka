/**
 * Kerangka Model Diff and Breaking Change Analyzer
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { normalizeField } from "../shorthand.js";
import { KIRDocument, ActionDefinition, EntityDefinition, FieldDefinition } from "../types.js";

export type ChangeClassification = "breaking" | "additive" | "compatible";

export interface ModelChange {
  classification: ChangeClassification;
  path: string;
  message: string;
  /** How to make this change without downtime, when the pattern has one (ADR-0032). */
  hint?: string;
  before?: unknown;
  after?: unknown;
}

export interface ModelDiffResult {
  hasBreakingChanges: boolean;
  changes: ModelChange[];
  summary: {
    breaking: number;
    additive: number;
    compatible: number;
  };
}

export class ModelDiffer {
  static diff(oldKir: KIRDocument, newKir: KIRDocument): ModelDiffResult {
    const changes: ModelChange[] = [];

    const oldEntities = oldKir.entities || {};
    const newEntities = newKir.entities || {};

    // 1. Check for removed entities (BREAKING)
    for (const entityName of Object.keys(oldEntities)) {
      if (!newEntities[entityName]) {
        changes.push({
          classification: "breaking",
          path: `entities.${entityName}`,
          message: `Entity '${entityName}' was removed.`,
          before: oldEntities[entityName]
        });
      }
    }

    // 2. Check for added entities (ADDITIVE)
    for (const entityName of Object.keys(newEntities)) {
      if (!oldEntities[entityName]) {
        changes.push({
          classification: "additive",
          path: `entities.${entityName}`,
          message: `Entity '${entityName}' was added.`,
          after: newEntities[entityName]
        });
      }
    }

    // 3. Compare common entities
    for (const [entityName, oldEntity] of Object.entries(oldEntities)) {
      const newEntity = newEntities[entityName];
      if (!newEntity) continue;

      const oldFields = oldEntity.fields || {};
      const newFields = newEntity.fields || {};

      // Removed fields (BREAKING)
      for (const fieldName of Object.keys(oldFields)) {
        if (!newFields[fieldName]) {
          changes.push({
            classification: "breaking",
            path: `entities.${entityName}.fields.${fieldName}`,
            message: `Field '${fieldName}' was removed from entity '${entityName}'.`,
            before: oldFields[fieldName]
          });
        }
      }

      // Added fields
      for (const [fieldName, newField] of Object.entries(newFields)) {
        if (!oldFields[fieldName]) {
          if (newField.required && newField.default === undefined) {
            changes.push({
              classification: "breaking",
              path: `entities.${entityName}.fields.${fieldName}`,
              message: `Required field '${fieldName}' was added to '${entityName}' without a default value.`,
              after: newField
            });
          } else {
            changes.push({
              classification: "additive",
              path: `entities.${entityName}.fields.${fieldName}`,
              message: `Field '${fieldName}' was added to entity '${entityName}'.`,
              after: newField
            });
          }
        }
      }

      // Modified fields
      for (const [fieldName, oldField] of Object.entries(oldFields)) {
        const newField = newFields[fieldName];
        if (!newField) continue;

        // Type change
        if (oldField.type !== newField.type) {
          changes.push({
            classification: "breaking",
            path: `entities.${entityName}.fields.${fieldName}.type`,
            message: `Field '${fieldName}' type changed from '${oldField.type}' to '${newField.type}'.`,
            before: oldField.type,
            after: newField.type
          });
        }

        // Nullability change: Optional -> Required is BREAKING
        if (!oldField.required && newField.required && newField.default === undefined) {
          changes.push({
            classification: "breaking",
            path: `entities.${entityName}.fields.${fieldName}.required`,
            message: `Field '${fieldName}' was changed from optional to required without a default.`,
            before: false,
            after: true
          });
        } else if (oldField.required && !newField.required) {
          changes.push({
            classification: "compatible",
            path: `entities.${entityName}.fields.${fieldName}.required`,
            message: `Field '${fieldName}' was relaxed from required to optional.`,
            before: true,
            after: false
          });
        }

        // Enum value removed is BREAKING
        if (oldField.type === "enum" && newField.type === "enum") {
          const oldVals = oldField.values || [];
          const newVals = newField.values || [];
          for (const v of oldVals) {
            if (!newVals.includes(v)) {
              changes.push({
                classification: "breaking",
                path: `entities.${entityName}.fields.${fieldName}.values`,
                message: `Enum value '${v}' was removed from field '${fieldName}'.`,
                before: oldVals,
                after: newVals
              });
            }
          }
        }
      }

      // 4. Workflow comparison
      if (oldEntity.workflow?.transitions && newEntity.workflow?.transitions) {
        const oldTransitions = oldEntity.workflow.transitions;
        const newTransitions = newEntity.workflow.transitions;

        for (const trName of Object.keys(oldTransitions)) {
          if (!newTransitions[trName]) {
            changes.push({
              classification: "breaking",
              path: `entities.${entityName}.workflow.transitions.${trName}`,
              message: `Workflow transition '${trName}' was removed from '${entityName}'.`,
              before: oldTransitions[trName]
            });
          } else {
            const oldTr = oldTransitions[trName]!;
            const newTr = newTransitions[trName]!;
            if (oldTr.to !== newTr.to) {
              changes.push({
                classification: "breaking",
                path: `entities.${entityName}.workflow.transitions.${trName}.to`,
                message: `Workflow transition '${trName}' destination state changed from '${oldTr.to}' to '${newTr.to}'.`,
                before: oldTr.to,
                after: newTr.to
              });
            }
          }
        }

        for (const trName of Object.keys(newTransitions)) {
          if (!oldTransitions[trName]) {
            changes.push({
              classification: "additive",
              path: `entities.${entityName}.workflow.transitions.${trName}`,
              message: `Workflow transition '${trName}' was added to '${entityName}'.`,
              after: newTransitions[trName]
            });
          }
        }
      }
    }

    // 5. Events. An event is a contract with every consumer that subscribes to it
    // (PLAN.md 7.6), so the same expand/contract rules apply as for a stored field.
    ModelDiffer.diffEvents(oldKir, newKir, changes);
    ModelDiffer.diffPolicies(oldKir, newKir, changes);

    // 6. Actions are the last published contract: what a client is allowed to do,
    // with which input, and what happens when it does.
    ModelDiffer.diffActions(oldKir, newKir, changes);

    const breakingCount = changes.filter(c => c.classification === "breaking").length;
    const additiveCount = changes.filter(c => c.classification === "additive").length;
    const compatibleCount = changes.filter(c => c.classification === "compatible").length;

    return {
      hasBreakingChanges: breakingCount > 0,
      changes,
      summary: {
        breaking: breakingCount,
        additive: additiveCount,
        compatible: compatibleCount
      }
    };
  }

  /**
   * Event payloads are compared like stored fields, because a consumer is as bound to
   * an event's shape as a row is to a table. The hints are the two-phase transitions of
   * ADR-0032: introduce optional, tighten later, and never remove in one step.
   */
  private static diffEvents(
    oldKir: KIRDocument,
    newKir: KIRDocument,
    changes: ModelChange[]
  ): void {
    const oldEvents = (oldKir.events ?? {}) as Record<string, unknown>;
    const newEvents = (newKir.events ?? {}) as Record<string, unknown>;

    for (const eventName of Object.keys(oldEvents)) {
      if (!newEvents[eventName]) {
        changes.push({
          classification: "breaking",
          path: `events.${eventName}`,
          message: `Event '${eventName}' was removed; every subscriber stops receiving it.`,
          hint: "Stop emitting it in one version, then remove the declaration in the next.",
          before: oldEvents[eventName]
        });
      }
    }

    for (const eventName of Object.keys(newEvents)) {
      if (!oldEvents[eventName]) {
        changes.push({
          classification: "additive",
          path: `events.${eventName}`,
          message: `Event '${eventName}' was added.`,
          after: newEvents[eventName]
        });
      }
    }

    for (const [eventName, oldDeclared] of Object.entries(oldEvents)) {
      const newDeclared = newEvents[eventName];
      if (!newDeclared) continue;

      ModelDiffer.diffFields(
        `events.${eventName}`,
        `event '${eventName}'`,
        normalizeEventFields(oldDeclared as Record<string, unknown>),
        normalizeEventFields(newDeclared as Record<string, unknown>),
        changes
      );
    }
  }

  /**
   * A field map is compared the same way wherever it appears: a stored column, an
   * event payload, an action's input. Removing one, retyping one, making one
   * required, or dropping an enum value breaks whatever already reads it; adding
   * an optional one is additive. The hints are ADR-0032's two-phase transitions.
   */
  private static diffFields(
    pathPrefix: string,
    label: string,
    oldFields: Record<string, FieldDefinition>,
    newFields: Record<string, FieldDefinition>,
    changes: ModelChange[]
  ): void {
    for (const fieldName of Object.keys(oldFields)) {
      if (!newFields[fieldName]) {
        changes.push({
          classification: "breaking",
          path: `${pathPrefix}.${fieldName}`,
          message: `Field '${fieldName}' was removed from ${label}; whatever reads it breaks.`,
          hint: "Stop sending the field in one version, then remove it in the next.",
          before: oldFields[fieldName]
        });
      }
    }

    for (const [fieldName, newField] of Object.entries(newFields)) {
      if (oldFields[fieldName]) continue;

      if (newField.required && newField.default === undefined) {
        changes.push({
          classification: "breaking",
          path: `${pathPrefix}.${fieldName}`,
          message: `Required field '${fieldName}' was added to ${label} without a default.`,
          hint: "Add it optional first, let every producer ship, then require it (ADR-0032).",
          after: newField
        });
      } else {
        changes.push({
          classification: "additive",
          path: `${pathPrefix}.${fieldName}`,
          message: `Field '${fieldName}' was added to ${label}.`,
          after: newField
        });
      }
    }

    for (const [fieldName, oldField] of Object.entries(oldFields)) {
      const newField = newFields[fieldName];
      if (!newField) continue;

      if (oldField.type !== newField.type) {
        changes.push({
          classification: "breaking",
          path: `${pathPrefix}.${fieldName}.type`,
          message: `${label} field '${fieldName}' type changed from '${oldField.type}' to '${newField.type}'.`,
          hint: "Publish both shapes while producers and consumers move.",
          before: oldField.type,
          after: newField.type
        });
      }

      if (!oldField.required && newField.required && newField.default === undefined) {
        changes.push({
          classification: "breaking",
          path: `${pathPrefix}.${fieldName}.required`,
          message: `${label} field '${fieldName}' became required without a default.`,
          hint: "This is the Contract phase; it is only safe once every producer sends the field.",
          before: false,
          after: true
        });
      } else if (oldField.required && !newField.required) {
        changes.push({
          classification: "compatible",
          path: `${pathPrefix}.${fieldName}.required`,
          message: `${label} field '${fieldName}' was relaxed to optional.`,
          before: true,
          after: false
        });
      }

      if (oldField.type === "enum" && newField.type === "enum") {
        for (const value of oldField.values ?? []) {
          if (!(newField.values ?? []).includes(value)) {
            changes.push({
              classification: "breaking",
              path: `${pathPrefix}.${fieldName}.values`,
              message: `Enum value '${value}' was removed from ${label} field '${fieldName}'.`,
              before: oldField.values,
              after: newField.values
            });
          }
        }
      }
    }
  }

  /**
   * A policy is what a consumer's side of the model does. Removing one, or pointing it
   * somewhere else, changes what happens when an event arrives.
   */
  private static diffPolicies(
    oldKir: KIRDocument,
    newKir: KIRDocument,
    changes: ModelChange[]
  ): void {
    const oldPolicies = (oldKir.policies ?? {}) as Record<string, { on?: string; run?: string }>;
    const newPolicies = (newKir.policies ?? {}) as Record<string, { on?: string; run?: string }>;

    for (const [name, oldPolicy] of Object.entries(oldPolicies)) {
      const newPolicy = newPolicies[name];
      if (!newPolicy) {
        changes.push({
          classification: "breaking",
          path: `policies.${name}`,
          message: `Policy '${name}' was removed; '${oldPolicy.on ?? "its event"}' no longer has a reaction.`,
          before: oldPolicy
        });
        continue;
      }
      if (oldPolicy.on !== newPolicy.on) {
        changes.push({
          classification: "breaking",
          path: `policies.${name}.on`,
          message: `Policy '${name}' now listens to '${newPolicy.on ?? "nothing"}' instead of '${oldPolicy.on ?? "nothing"}'.`,
          before: oldPolicy.on,
          after: newPolicy.on
        });
      }
      if (oldPolicy.run !== newPolicy.run) {
        changes.push({
          classification: "breaking",
          path: `policies.${name}.run`,
          message: `Policy '${name}' now runs '${newPolicy.run ?? "nothing"}' instead of '${oldPolicy.run ?? "nothing"}'.`,
          before: oldPolicy.run,
          after: newPolicy.run
        });
      }
    }

    for (const name of Object.keys(newPolicies)) {
      if (!oldPolicies[name]) {
        changes.push({
          classification: "additive",
          path: `policies.${name}`,
          message: `Policy '${name}' was added.`,
          after: newPolicies[name]
        });
      }
    }
  }

  /**
   * An action is what a caller may do. Removing it, taking a role away from it, or
   * changing what it does all change what a client can rely on.
   */
  private static diffActions(
    oldKir: KIRDocument,
    newKir: KIRDocument,
    changes: ModelChange[]
  ): void {
    const oldEntities = (oldKir.entities ?? {}) as Record<string, EntityDefinition>;
    const newEntities = (newKir.entities ?? {}) as Record<string, EntityDefinition>;
    const declaredRoles = new Set(newKir.roles ?? []);

    for (const [entityName, newEntity] of Object.entries(newEntities)) {
      const oldEntity = oldEntities[entityName];
      const oldActions = (oldEntity?.actions ?? {}) as Record<string, ActionDefinition>;
      const newActions = (newEntity.actions ?? {}) as Record<string, ActionDefinition>;

      for (const [actionName, oldAction] of Object.entries(oldActions)) {
        if (!newActions[actionName]) {
          changes.push({
            classification: "breaking",
            path: `entities.${entityName}.actions.${actionName}`,
            message: `Action '${actionName}' was removed from '${entityName}'; callers get no such action.`,
            hint: "There is no deprecation, so remove it only once every caller has moved.",
            before: oldAction
          });
        }
      }

      for (const [actionName, newAction] of Object.entries(newActions)) {
        const oldAction = oldActions[actionName];
        if (!oldAction) {
          changes.push({
            classification: "additive",
            path: `entities.${entityName}.actions.${actionName}`,
            message: `Action '${actionName}' was added to '${entityName}'.`,
            after: newAction
          });
          continue;
        }

        const label = `action '${entityName}.${actionName}'`;
        const path = `entities.${entityName}.actions.${actionName}`;

        ModelDiffer.diffFields(
          `${path}.input`,
          label,
          normalizeActionInput(oldAction.input),
          normalizeActionInput(newAction.input),
          changes
        );

        // Narrowing who may call it is the change that breaks a client silently:
        // the call still compiles and returns a denial.
        const oldRoles = oldAction.roles ?? [];
        const newRoles = newAction.roles ?? [];
        for (const role of oldRoles) {
          if (newRoles.includes(role)) continue;
          changes.push({
            classification: "breaking",
            path: `${path}.roles`,
            message: `Role '${role}' lost access to ${label}.`,
            hint: "Widen the roles first, move the callers off the role, then narrow.",
            before: oldRoles,
            after: newRoles
          });
        }
        for (const role of newRoles) {
          if (oldRoles.includes(role)) continue;
          changes.push({
            classification: "compatible",
            path: `${path}.roles`,
            message: `Role '${role}' gained access to ${label}.`,
            before: oldRoles,
            after: newRoles
          });
          if (declaredRoles.size > 0 && !declaredRoles.has(role)) {
            changes.push({
              classification: "breaking",
              path: `${path}.roles.${role}`,
              message: `${label} names role '${role}', which the document does not declare.`,
              hint: "Declare the role or drop it from the action; an undeclared role denies everyone.",
              after: role
            });
          }
        }

        ModelDiffer.diffBehaviour(path, label, oldAction, newAction, changes);
      }
    }
  }

  /** `when`, `do`, and `run` are what an action actually does; a change is never compatible. */
  private static diffBehaviour(
    path: string,
    label: string,
    oldAction: ActionDefinition,
    newAction: ActionDefinition,
    changes: ModelChange[]
  ): void {
    for (const part of ["when", "do", "then", "run"] as const) {
      const before = canonical(oldAction[part]);
      const after = canonical(newAction[part]);
      if (before === after) continue;

      // The IR normalises the statement list to `then`; `do` is the declared name, so
      // report the part the developer wrote rather than the key the compiler chose.
      const written = part === "then" ? "do" : part;

      changes.push({
        classification: "breaking",
        path: `${path}.${written}`,
        message: `${label} changed what it does: '${written}' differs.`,
        hint: "A client that relied on the old outcome changes; there is no compatible version of this.",
        before: oldAction[part],
        after: newAction[part]
      });
    }
  }
}

/** An action's input fields are stored as written, so normalise them before comparing. */
function normalizeActionInput(
  input: Record<string, FieldDefinition | string> | undefined
): Record<string, FieldDefinition> {
  const out: Record<string, FieldDefinition> = {};
  for (const [fieldName, fieldDef] of Object.entries(input ?? {})) {
    out[fieldName] = normalizeField(fieldDef as string | FieldDefinition);
  }
  return out;
}

/** Key order is not a change, so compare the structure rather than the text. */
function canonical(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    return v;
  });
}

/** An event's fields are stored as written, so normalise them before comparing. */
function normalizeEventFields(declared: Record<string, unknown>): Record<string, FieldDefinition> {
  const out: Record<string, FieldDefinition> = {};
  for (const [fieldName, fieldDef] of Object.entries(declared ?? {})) {
    out[fieldName] = normalizeField(fieldDef as string | FieldDefinition);
  }
  return out;
}
