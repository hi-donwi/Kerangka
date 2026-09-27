/**
 * Kerangka Model Diff and Breaking Change Analyzer
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { KIRDocument, FieldDefinition } from "../types.js";

export type ChangeClassification = "breaking" | "additive" | "compatible";

export interface ModelChange {
  classification: ChangeClassification;
  path: string;
  message: string;
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
}
