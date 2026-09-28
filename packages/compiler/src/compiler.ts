/**
 * Kerangka Compiler Pipeline
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { compileExpression, ExprNode } from "@kerangka/k1";
import { parse as parseYaml } from "yaml";
import { offsetToPosition, pointer, SourceLocator, suggestion } from "./diagnostics.js";
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
import { EntityOrigins, ModelValidator } from "./validate.js";
import { WorkspaceLoader } from "./workspace.js";

const EXPRESSION_HINT = "Expression syntax is in spec/k1.ebnf; string literals use single quotes.";

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

    const text = typeof input === "string" ? input : undefined;
    let doc: RawKerangkaDocument;
    if (text !== undefined) {
      try {
        doc = (text.trim().startsWith("{") ? JSON.parse(text) : parseYaml(text)) as RawKerangkaDocument;
      } catch (err) {
        const diagnostic: CompilerDiagnostic = {
          severity: "error",
          code: "PARSE_ERROR",
          message: (err as Error).message,
          path: "",
          hint: "The document must be valid JSON or YAML.",
          ...parseErrorPosition(text, err),
        };
        throw new CompilerError(`Failed to parse document syntax: ${diagnostic.message}`, [diagnostic]);
      }
    } else {
      doc = input as RawKerangkaDocument;
    }

    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new CompilerError("Document root must be an object", [
        {
          severity: "error",
          code: "SCHEMA_INVALID",
          message: "Document root must be an object",
          path: "",
          hint: 'Start the document with { "kerangka": "0.1", "app": "<name>", ... }.',
          ...(text !== undefined ? { line: 1, column: 1 } : {}),
        },
      ]);
    }

    if (!doc.app) {
      this.addError("MISSING_APP_NAME", "Document root must declare an 'app' identifier", "/app",
        'Add "app": "<name>" at the document root.');
    }

    // 0. Load multi-context workspace if declared
    if (doc.contexts && Array.isArray(doc.contexts)) {
      const loader = new WorkspaceLoader(doc, this.options.sourcePath);
      const wsResult = loader.load();
      for (const diag of wsResult.diagnostics) {
        this.addError(diag.code, diag.message, diag.path, diag.hint);
      }
      doc.entities = wsResult.flattenedEntities;
      doc.events = wsResult.flattenedEvents;
      doc.policies = wsResult.flattenedPolicies;
      doc.decisions = wsResult.flattenedDecisions;
      doc.traits = wsResult.flattenedTraits;
    }

    // Process Entities
    const compiledEntities: KIRDocument["entities"] = {};
    const inlinedEntities: Record<string, EntityDefinition> = {};
    const origins: Record<string, EntityOrigins> = {};
    const rawEntities = doc.entities ?? {};

    // 1. Inlining traits
    const traits = (doc.traits as Record<string, EntityDefinition>) ?? {};

    for (const [entityName, rawEntity] of Object.entries(rawEntities)) {
      const inlined = this.inlineTraits(entityName, rawEntity, traits);
      inlinedEntities[entityName] = inlined.entity;
      origins[entityName] = inlined.origins;
      compiledEntities[entityName] = this.compileEntity(entityName, inlined.entity, inlined.origins);
    }

    // 2. Resolve every name: types, references, fields, functions, states
    new ModelValidator(
      {
        entities: compiledEntities,
        rawEntities: inlinedEntities,
        origins,
        valueTypes: Object.keys((doc.types as Record<string, unknown> | undefined) ?? {}),
        decisions: Object.keys(doc.decisions ?? {}),
      },
      (diagnostic) => this.addError(diagnostic.code, diagnostic.message, diagnostic.path, diagnostic.hint)
    ).validate();

    if (this.hasErrors()) {
      this.attachPositions(text);
      throw new CompilerError(
        `Compilation failed with ${this.diagnostics.length} diagnostic error(s)`,
        [...this.diagnostics]
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
      ...(doc.policies ? { policies: doc.policies } : {}),
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
    entityName: string,
    entity: EntityDefinition,
    traits: Record<string, EntityDefinition>
  ): { entity: EntityDefinition; origins: EntityOrigins } {
    const origins: EntityOrigins = {
      fields: Object.fromEntries(
        Object.keys(entity.fields ?? {}).map((f) => [f, pointer("entities", entityName, "fields", f)])
      ),
      rules: (entity.rules ?? []).map((_, i) => pointer("entities", entityName, "rules", i)),
      invariants: (entity.invariants ?? []).map((_, i) => pointer("entities", entityName, "invariants", i)),
    };

    const uses = (entity as { uses?: string[] }).uses;
    if (!uses || !Array.isArray(uses)) {
      return { entity, origins };
    }

    const mergedFields = { ...entity.fields };
    const mergedRules = [...(entity.rules ?? [])];
    const mergedInvariants = [...(entity.invariants ?? [])];

    uses.forEach((traitName, i) => {
      const trait = traits[traitName];
      if (!trait) {
        this.addError("UNKNOWN_TRAIT", `Entity uses unknown trait '${traitName}'`,
          pointer("entities", entityName, "uses", i), suggestion(traitName, Object.keys(traits), "traits"));
        return;
      }

      for (const fieldName of Object.keys(trait.fields ?? {})) {
        origins.fields[fieldName] = pointer("traits", traitName, "fields", fieldName);
      }
      Object.assign(mergedFields, trait.fields ?? {});
      (trait.rules ?? []).forEach((rule, j) => {
        mergedRules.push(rule);
        origins.rules.push(pointer("traits", traitName, "rules", j));
      });
      (trait.invariants ?? []).forEach((inv, j) => {
        mergedInvariants.push(inv);
        origins.invariants.push(pointer("traits", traitName, "invariants", j));
      });
    });

    return {
      entity: {
        ...entity,
        fields: mergedFields,
        rules: mergedRules,
        invariants: mergedInvariants,
      },
      origins,
    };
  }

  private compileEntity(
    entityName: string,
    entity: EntityDefinition,
    origins: EntityOrigins
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
            `Invalid compute expression in ${entityName}.${fieldName}: ${(err as Error).message}`,
            `${origins.fields[fieldName] ?? pointer("entities", entityName, "fields", fieldName)}/compute`,
            EXPRESSION_HINT
          );
        }
      }

      compiledFields[fieldName] = normalized;
    }

    const key = entity.key ?? (compiledFields.id ? "id" : (uniqueCandidate ?? "id"));

    // Compile rules
    const compiledRules = (entity.rules ?? []).map((rule, i) => {
      let checkAst: ExprNode;
      if (typeof rule.check === "string") {
        try {
          checkAst = compileExpression(rule.check);
        } catch (err) {
          this.addError(
            "EXPRESSION_ERROR",
            `Invalid rule check expression '${rule.check}' in ${entityName}: ${(err as Error).message}`,
            `${origins.rules[i] ?? pointer("entities", entityName, "rules", i)}/check`,
            EXPRESSION_HINT
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
    const compiledInvariants = (entity.invariants ?? []).map((inv, i) => {
      let assertAst: ExprNode;
      if (typeof inv.assert === "string") {
        try {
          assertAst = compileExpression(inv.assert);
        } catch (err) {
          this.addError(
            "EXPRESSION_ERROR",
            `Invalid invariant assert expression '${inv.assert}' in ${entityName}: ${(err as Error).message}`,
            `${origins.invariants[i] ?? pointer("entities", entityName, "invariants", i)}/assert`,
            EXPRESSION_HINT
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
                `Invalid action 'when' expression in ${entityName}.${actionName}: ${(err as Error).message}`,
                pointer("entities", entityName, "actions", actionName, "when"),
                EXPRESSION_HINT
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
              `Invalid workflow transition 'when' guard in ${entityName}.${transName}: ${(err as Error).message}`,
              pointer("entities", entityName, "workflow", "transitions", transName, "when"),
              EXPRESSION_HINT
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

  private addError(code: string, message: string, path?: string, hint?: string): void {
    const duplicate = this.diagnostics.some(
      (d) => d.code === code && d.path === path && d.message === message
    );
    if (duplicate) return;
    this.diagnostics.push({
      severity: "error",
      code,
      message,
      ...(path !== undefined ? { path } : {}),
      ...(hint !== undefined ? { hint } : {}),
    });
  }

  private attachPositions(text: string | undefined): void {
    if (text === undefined) return;
    const locator = SourceLocator.fromText(text);
    if (!locator) return;
    for (const diagnostic of this.diagnostics) {
      if (diagnostic.path === undefined || diagnostic.line !== undefined) continue;
      const position = locator.locate(diagnostic.path);
      if (position) Object.assign(diagnostic, position);
    }
  }

  private hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === "error");
  }
}

/** Line and column of a JSON or YAML syntax error, when the parser reports one. */
function parseErrorPosition(text: string, err: unknown): { line?: number; column?: number } {
  const linePos = (err as { linePos?: { line: number; col: number }[] }).linePos?.[0];
  if (linePos) return { line: linePos.line, column: linePos.col };
  const offset = /position (\d+)/.exec((err as Error).message ?? "");
  return offset ? offsetToPosition(text, Number(offset[1])) : {};
}
