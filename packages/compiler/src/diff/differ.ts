/**
 * Kerangka Model Diff and Breaking Change Analyzer
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { normalizeField } from "../shorthand.js";
import { KIRDocument, FieldDefinition } from "../types.js";

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

      const oldFields = normalizeEventFields(oldDeclared as Record<string, unknown>);
      const newFields = normalizeEventFields(newDeclared as Record<string, unknown>);

      for (const fieldName of Object.keys(oldFields)) {
        if (!newFields[fieldName]) {
          changes.push({
            classification: "breaking",
            path: `events.${eventName}.${fieldName}`,
            message: `Field '${fieldName}' was removed from event '${eventName}'; consumers reading it break.`,
            hint: "Stop emitting the field in one version, then remove it in the next.",
            before: oldFields[fieldName]
          });
        }
      }

      for (const [fieldName, newField] of Object.entries(newFields)) {
        const oldField = oldFields[fieldName];
        if (oldField) continue;

        if (newField.required && newField.default === undefined) {
          changes.push({
            classification: "breaking",
            path: `events.${eventName}.${fieldName}`,
            message: `Required field '${fieldName}' was added to event '${eventName}' without a default.`,
            hint: "Add it optional first, let every producer ship, then require it (ADR-0032).",
            after: newField
          });
        } else {
          changes.push({
            classification: "additive",
            path: `events.${eventName}.${fieldName}`,
            message: `Field '${fieldName}' was added to event '${eventName}'.`,
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
            path: `events.${eventName}.${fieldName}.type`,
            message: `Event '${eventName}' field '${fieldName}' type changed from '${oldField.type}' to '${newField.type}'.`,
            hint: "Publish both versions of the event while producers and consumers move.",
            before: oldField.type,
            after: newField.type
          });
        }

        if (!oldField.required && newField.required && newField.default === undefined) {
          changes.push({
            classification: "breaking",
            path: `events.${eventName}.${fieldName}.required`,
            message: `Event '${eventName}' field '${fieldName}' became required without a default.`,
            hint: "This is the Contract phase; it is only safe once every producer emits the field.",
            before: false,
            after: true
          });
        } else if (oldField.required && !newField.required) {
          changes.push({
            classification: "compatible",
            path: `events.${eventName}.${fieldName}.required`,
            message: `Event '${eventName}' field '${fieldName}' was relaxed to optional.`,
            before: true,
            after: false
          });
        }

        if (oldField.type === "enum" && newField.type === "enum") {
          for (const value of oldField.values ?? []) {
            if (!(newField.values ?? []).includes(value)) {
              changes.push({
                classification: "breaking",
                path: `events.${eventName}.${fieldName}.values`,
                message: `Enum value '${value}' was removed from event '${eventName}' field '${fieldName}'.`,
                before: oldField.values,
                after: newField.values
              });
            }
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
}

/** An event's fields are stored as written, so normalise them before comparing. */
function normalizeEventFields(declared: Record<string, unknown>): Record<string, FieldDefinition> {
  const out: Record<string, FieldDefinition> = {};
  for (const [fieldName, fieldDef] of Object.entries(declared ?? {})) {
    out[fieldName] = normalizeField(fieldDef as string | FieldDefinition);
  }
  return out;
}
