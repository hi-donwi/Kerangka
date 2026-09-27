/**
 * Kerangka Compiler Pipeline
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { compileExpression, ExprNode } from "@kerangka/k1";
import { parse as parseYaml } from "yaml";
import { normalizeField } from "./shorthand.js";
import {
  CompilerDiagnostic,
  CompilerError,
  CompilerOptions,
  EntityDefinition,
  FieldDefinition,
  KIRDocument,
  RawKerangkaDocument,
  WorkflowDefinition,
} from "./types.js";

export const COMPILER_VERSION = "0.1.0";

export class Compiler {
  private readonly options: CompilerOptions;
  private readonly diagnostics: CompilerDiagnostic[] = [];

  constructor(options: CompilerOptions = {}) {
    this.options = options;
  }

  static compile(input: string | RawKerangkaDocument, options?: CompilerOptions): KIRDocument {
    const compiler = new Compiler(options);
    return compiler.compileDocument(input);
  }

  compileDocument(input: string | RawKerangkaDocument): KIRDocument {
    this.diagnostics.length = 0;

    let doc: RawKerangkaDocument;
    if (typeof input === "string") {
      try {
        doc = (input.trim().startsWith("{") ? JSON.parse(input) : parseYaml(input)) as RawKerangkaDocument;
      } catch (err) {
        throw new CompilerError(
          `Failed to parse document syntax: ${(err as Error).message}`,
          [{ severity: "error", code: "PARSE_ERROR", message: (err as Error).message }]
        );
      }
    } else {
      doc = input;
    }

    if (!doc.app) {
      this.addError("MISSING_APP_NAME", "Document root must declare an 'app' identifier");
    }

    // Process Entities
    const compiledEntities: KIRDocument["entities"] = {};
    const rawEntities = doc.entities ?? {};

    // 1. Inlining traits
    const traits = (doc.traits as Record<string, EntityDefinition>) ?? {};

    for (const [entityName, rawEntity] of Object.entries(rawEntities)) {
      const entity = this.inlineTraits(rawEntity, traits);
      compiledEntities[entityName] = this.compileEntity(entityName, entity);
    }

    // 2. Validate References across entities
    this.validateReferences(compiledEntities);

    if (this.hasErrors()) {
      throw new CompilerError(
        `Compilation failed with ${this.diagnostics.length} diagnostic error(s)`,
        this.diagnostics
      );
    }

    // Assemble canonical KIR
    const nowIso = new Date().toISOString();
    const kir: KIRDocument = {
      $schema: "https://kerangka.dev/spec/kir.schema.json",
      kir: "0.1",
      app: doc.app,
      meta: {
        title: doc.meta?.title ?? doc.app,
        description: doc.meta?.description,
        version: doc.meta?.version ?? "0.1.0",
        timezone: doc.meta?.timezone ?? "UTC",
        compiledAt: nowIso,
        compilerVersion: COMPILER_VERSION,
      },
      ...(doc.roles ? { roles: doc.roles } : {}),
      ...(doc.multitenancy ? { multitenancy: doc.multitenancy } : {}),
      entities: compiledEntities,
      ...(doc.events ? { events: doc.events } : {}),
      ...(doc.decisions ? { decisions: doc.decisions } : {}),
      ...(doc.schedules ? { schedules: doc.schedules } : {}),
      ...(doc.extensions ? { extensions: doc.extensions } : {}),
      ...(doc.views ? { views: doc.views } : {}),
      ...(doc.navigation ? { navigation: doc.navigation } : {}),
      ...(doc.examples ? { examples: doc.examples } : {}),
    };

    return kir;
  }

  private inlineTraits(
    entity: EntityDefinition,
    traits: Record<string, EntityDefinition>
  ): EntityDefinition {
    const uses = (entity as { uses?: string[] }).uses;
    if (!uses || !Array.isArray(uses)) {
      return entity;
    }

    const mergedFields = { ...entity.fields };
    const mergedRules = [...(entity.rules ?? [])];
    const mergedInvariants = [...(entity.invariants ?? [])];

    for (const traitName of uses) {
      const trait = traits[traitName];
      if (!trait) {
        this.addError("UNKNOWN_TRAIT", `Entity uses unknown trait '${traitName}'`);
        continue;
      }

      if (trait.fields) {
        Object.assign(mergedFields, trait.fields);
      }
      if (trait.rules) {
        mergedRules.push(...trait.rules);
      }
      if (trait.invariants) {
        mergedInvariants.push(...trait.invariants);
      }
    }

    return {
      ...entity,
      fields: mergedFields,
      rules: mergedRules,
      invariants: mergedInvariants,
    };
  }

  private compileEntity(
    entityName: string,
    entity: EntityDefinition
  ): KIRDocument["entities"][string] {
    const embedded = Boolean(entity.embedded);

    // Normalize and compile fields
    const compiledFields: Record<string, FieldDefinition> = {};
    let uniqueCandidate: string | undefined = undefined;

    for (const [fieldName, fieldDef] of Object.entries(entity.fields ?? {})) {
      const normalized = normalizeField(fieldDef);
      if (normalized.unique && !uniqueCandidate) {
        uniqueCandidate = fieldName;
      }

      if (normalized.compute && typeof normalized.compute === "string") {
        try {
          normalized.compute = compileExpression(normalized.compute);
        } catch (err) {
          this.addError(
            "EXPRESSION_ERROR",
            `Invalid compute expression in ${entityName}.${fieldName}: ${(err as Error).message}`
          );
        }
      }

      compiledFields[fieldName] = normalized;
    }

    const key = entity.key ?? (compiledFields.id ? "id" : (uniqueCandidate ?? "id"));

    // Compile rules
    const compiledRules = (entity.rules ?? []).map((rule) => {
      let checkAst: ExprNode;
      if (typeof rule.check === "string") {
        try {
          checkAst = compileExpression(rule.check);
        } catch (err) {
          this.addError(
            "EXPRESSION_ERROR",
            `Invalid rule check expression '${rule.check}' in ${entityName}: ${(err as Error).message}`
          );
          checkAst = { literal: false };
        }
      } else {
        checkAst = rule.check;
      }
      return {
        id: rule.id,
        field: rule.field,
        message: rule.message,
        check: checkAst,
      };
    });

    // Compile invariants
    const compiledInvariants = (entity.invariants ?? []).map((inv) => {
      let assertAst: ExprNode;
      if (typeof inv.assert === "string") {
        try {
          assertAst = compileExpression(inv.assert);
        } catch (err) {
          this.addError(
            "EXPRESSION_ERROR",
            `Invalid invariant assert expression '${inv.assert}' in ${entityName}: ${(err as Error).message}`
          );
          assertAst = { literal: false };
        }
      } else {
        assertAst = inv.assert;
      }
      return {
        id: inv.id,
        message: inv.message,
        assert: assertAst,
      };
    });

    // Compile workflow
    let compiledWorkflow: KIRDocument["entities"][string]["workflow"] = undefined;
    if (entity.workflow) {
      compiledWorkflow = this.compileWorkflow(entityName, entity.workflow);
    }

    // Compile actions
    let compiledActions: KIRDocument["entities"][string]["actions"] = undefined;
    if (entity.actions) {
      compiledActions = {};
      for (const [actionName, actionDef] of Object.entries(entity.actions)) {
        let whenAst: ExprNode | undefined = undefined;
        if (actionDef.when) {
          if (typeof actionDef.when === "string") {
            try {
              whenAst = compileExpression(actionDef.when);
            } catch (err) {
              this.addError(
                "EXPRESSION_ERROR",
                `Invalid action 'when' expression in ${entityName}.${actionName}: ${(err as Error).message}`
              );
            }
          } else {
            whenAst = actionDef.when;
          }
        }

        const inputDefs: Record<string, FieldDefinition> = {};
        if (actionDef.input) {
          for (const [paramName, paramDef] of Object.entries(actionDef.input)) {
            inputDefs[paramName] = normalizeField(paramDef);
          }
        }

        const runAssignments: Record<string, ExprNode | unknown> = {};
        if (actionDef.run && typeof actionDef.run === "object") {
          for (const [targetField, runVal] of Object.entries(actionDef.run)) {
            if (typeof runVal === "string") {
              try {
                runAssignments[targetField] = compileExpression(runVal);
              } catch {
                runAssignments[targetField] = { literal: runVal };
              }
            } else {
              runAssignments[targetField] = runVal;
            }
          }
        }

        compiledActions[actionName] = {
          ...(actionDef.roles ? { roles: actionDef.roles } : {}),
          ...(Object.keys(inputDefs).length > 0 ? { input: inputDefs } : {}),
          ...(whenAst ? { when: whenAst } : {}),
          ...(Object.keys(runAssignments).length > 0 ? { run: runAssignments } : {}),
        };
      }
    }

    return {
      key,
      embedded,
      fields: compiledFields,
      ...(compiledRules.length > 0 ? { rules: compiledRules } : {}),
      ...(compiledInvariants.length > 0 ? { invariants: compiledInvariants } : {}),
      ...(entity.permissions ? { permissions: entity.permissions } : {}),
      ...(compiledWorkflow ? { workflow: compiledWorkflow } : {}),
      ...(compiledActions ? { actions: compiledActions } : {}),
    };
  }

  private compileWorkflow(
    entityName: string,
    rawWorkflow: WorkflowDefinition
  ): NonNullable<KIRDocument["entities"][string]["workflow"]> {
    const transitions = rawWorkflow.transitions ?? {};
    const stateSet = new Set<string>(rawWorkflow.states ?? []);

    for (const trans of Object.values(transitions)) {
      if (Array.isArray(trans.from)) {
        trans.from.forEach((s) => stateSet.add(s));
      } else if (trans.from) {
        stateSet.add(trans.from);
      }
      if (trans.to) {
        stateSet.add(trans.to);
      }
    }

    const states = Array.from(stateSet);
    const initial = rawWorkflow.initial ?? (states.length > 0 ? states[0] : undefined);

    const compiledTransitions: NonNullable<KIRDocument["entities"][string]["workflow"]>["transitions"] = {};
    for (const [transName, trans] of Object.entries(transitions)) {
      let whenAst: ExprNode | undefined = undefined;
      if (trans.when) {
        if (typeof trans.when === "string") {
          try {
            whenAst = compileExpression(trans.when);
          } catch (err) {
            this.addError(
              "EXPRESSION_ERROR",
              `Invalid workflow transition 'when' guard in ${entityName}.${transName}: ${(err as Error).message}`
            );
          }
        } else {
          whenAst = trans.when;
        }
      }

      compiledTransitions[transName] = {
        from: trans.from,
        to: trans.to,
        ...(trans.roles ? { roles: trans.roles } : {}),
        ...(whenAst ? { when: whenAst } : {}),
        ...(trans.then ? { then: trans.then } : {}),
      };
    }

    return {
      field: rawWorkflow.field ?? "status",
      states,
      ...(initial ? { initial } : {}),
      ...(rawWorkflow.terminal ? { terminal: rawWorkflow.terminal } : {}),
      transitions: compiledTransitions,
      ...(rawWorkflow.tasks ? { tasks: rawWorkflow.tasks } : {}),
    };
  }

  private validateReferences(entities: KIRDocument["entities"]): void {
    const entityNames = new Set(Object.keys(entities));

    for (const [entityName, entity] of Object.entries(entities)) {
      for (const [fieldName, field] of Object.entries(entity.fields)) {
        if (field.type === "ref" && field.target) {
          if (!entityNames.has(field.target)) {
            this.addError(
              "UNKNOWN_REFERENCE",
              `Field ${entityName}.${fieldName} references unknown entity '${field.target}'`
            );
          }
        } else if (field.type === "list" && field.element?.target) {
          if (!entityNames.has(field.element.target)) {
            this.addError(
              "UNKNOWN_REFERENCE",
              `Field ${entityName}.${fieldName} lists unknown entity '${field.element.target}'`
            );
          }
        }
      }
    }
  }

  private addError(code: string, message: string): void {
    this.diagnostics.push({
      severity: "error",
      code,
      message,
    });
  }

  private hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === "error");
  }
}
