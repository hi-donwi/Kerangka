/**
 * Kerangka Compiler Pipeline
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import * as path from "node:path";
import { compileExpression, ExprNode } from "@kerangka/k1";
import { parse as parseYaml } from "yaml";
import { offsetToPosition, pointer, SourceLocator, suggestion } from "./diagnostics.js";
import { LOCKFILE_NAME, PackageResolver, readLockfile, verifyLockfile } from "./packages/index.js";
import { normalizeField } from "./shorthand.js";
import {
  CompilerDiagnostic,
  CompilerError,
  CompilerOptions,
  EntityDefinition,
  FieldDefinition,
  InvariantDefinition,
  KIRDocument,
  RawKerangkaDocument,
  RuleDefinition,
  WorkflowDefinition,
  QueryDefinition,
  QueryOrderBy,
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
      if (Object.keys(wsResult.flattenedQueries).length > 0) {
        doc.queries = { ...(doc.queries ?? {}), ...wsResult.flattenedQueries } as RawKerangkaDocument["queries"];
      }
    }

    // 0b. Resolve packages (@kerangka/std and any declared in doc.packages)
    const basePath = this.options.sourcePath
      ? path.dirname(path.resolve(this.options.sourcePath))
      : process.cwd();
    const pkgResolver = new PackageResolver(doc, basePath);
    const pkgResolution = pkgResolver.resolve();
    for (const diag of pkgResolution.diagnostics) {
      this.addError(diag.code, diag.message, diag.path, diag.hint);
    }

    // Verify kerangka.lock if present or requested
    const lockfilePath = path.join(basePath, LOCKFILE_NAME);
    const lockfile = readLockfile(lockfilePath);
    if (lockfile) {
      const lockVerification = verifyLockfile(lockfile, pkgResolution);
      for (const diag of lockVerification.diagnostics) {
        this.addError(diag.code, diag.message, diag.path, diag.hint);
      }
    } else if (this.options.checkLockfile) {
      this.addError(
        "LOCKFILE_MISSING",
        `Missing '${LOCKFILE_NAME}' lockfile in '${basePath}'`,
        "",
        "Run 'kerangka pkg lock' to generate kerangka.lock."
      );
    }

    // Merge traits: package traits + workspace traits + document traits
    const allTraits: Record<string, any> = {
      ...pkgResolution.traits,
      ...((doc.traits as Record<string, any>) ?? {}),
    };

    // Merge types: package types + document types
    const allTypes: Record<string, any> = {
      ...pkgResolution.types,
      ...((doc.types as Record<string, any>) ?? {}),
    };

    // Process Entities
    const compiledEntities: KIRDocument["entities"] = {};
    const inlinedEntities: Record<string, EntityDefinition> = {};
    const origins: Record<string, EntityOrigins> = {};
    const rawEntities = doc.entities ?? {};

    // 1. Inlining traits
    for (const [entityName, rawEntity] of Object.entries(rawEntities)) {
      const inlined = this.inlineTraits(entityName, rawEntity, allTraits);
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
        valueTypes: Object.keys(allTypes),
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

    // Named queries: top-level plus per-entity, with orderBy strings normalized.
    const allQueries: Record<string, QueryDefinition> = {};
    for (const [queryName, query] of Object.entries(doc.queries ?? {})) {
      allQueries[queryName] = this.normalizeQuery(query as QueryDefinition);
    }
    for (const entity of Object.values(compiledEntities)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entityQueries = (entity as any).queries as Record<string, QueryDefinition> | undefined;
      if (entityQueries) {
        for (const [queryName, query] of Object.entries(entityQueries)) {
          if (!allQueries[queryName]) {
            const normalized = this.normalizeQuery({ ...query, from: query.from ?? "?" });
            normalized.from = query.from || (entity.key !== undefined ? "?" : "?");
            normalized.from = (query as QueryDefinition).from || Object.keys(compiledEntities).find((e) => compiledEntities[e] === entity) || "";
            allQueries[queryName] = normalized;
          }
        }
      }
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
      ...(doc.packages ? { packages: doc.packages } : {}),
      ...(Object.keys(allTypes).length > 0 ? { types: allTypes } : {}),
      entities: compiledEntities,
      ...(Object.keys(allQueries).length > 0 ? { queries: allQueries } : {}),
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

  private normalizeQuery(query: QueryDefinition): QueryDefinition {
    let orderBy: QueryOrderBy[] | undefined;
    if (query.orderBy) {
      orderBy = query.orderBy.map((entry) => {
        if (typeof entry === "string") {
          const trimmed = entry.trim();
          // Accept both "createdAt desc" and cursor-style "-createdAt" (+ = asc).
          if (trimmed.startsWith("-") || trimmed.startsWith("+")) {
            return {
              field: trimmed.slice(1),
              direction: trimmed.startsWith("-") ? ("desc" as const) : ("asc" as const),
            };
          }
          const [field, direction] = trimmed.split(/\s+/);
          return { field: field!, direction: direction?.toLowerCase() === "desc" ? ("desc" as const) : ("asc" as const) };
        }
        return entry;
      });
    }
    return { ...query, ...(orderBy ? { orderBy } : {}) };
  }

  private inlineTraits(
    entityName: string,
    entity: EntityDefinition,
    traits: Record<string, any>
  ): { entity: EntityDefinition; origins: EntityOrigins } {
    const origins: EntityOrigins = {
      fields: Object.fromEntries(
        Object.keys(entity.fields ?? {}).map((f) => [f, pointer("entities", entityName, "fields", f)])
      ),
      rules: (entity.rules ?? []).map((_, i) => pointer("entities", entityName, "rules", i)),
      invariants: (entity.invariants ?? []).map((_, i) => pointer("entities", entityName, "invariants", i)),
    };

    const rawUses = entity.traits ?? entity.uses;
    if (!rawUses || !Array.isArray(rawUses) || rawUses.length === 0) {
      return { entity, origins };
    }

    const mergedFields: Record<string, any> = { ...entity.fields };
    const mergedRules = [...(entity.rules ?? [])];
    const mergedInvariants = [...(entity.invariants ?? [])];
    let mergedReadFilter = entity.readFilter;

    const globalExclude = new Set(entity.exclude ?? []);

    rawUses.forEach((useItem, i) => {
      let traitName: string;
      const itemExclude = new Set<string>();

      if (typeof useItem === "string") {
        traitName = useItem;
      } else if (useItem && typeof useItem === "object") {
        traitName = (useItem as any).trait ?? (useItem as any).name ?? "";
        if (Array.isArray((useItem as any).exclude)) {
          (useItem as any).exclude.forEach((e: string) => itemExclude.add(e));
        }
      } else {
        return;
      }

      // Lookup trait: direct name, or with "std:" prefix, or without "std:" prefix
      let trait = traits[traitName];
      if (!trait && !traitName.includes(":")) {
        trait = traits[`std:${traitName}`];
      }
      if (!trait && traitName.startsWith("std:")) {
        trait = traits[traitName.slice(4)];
      }

      if (!trait) {
        this.addError(
          "UNKNOWN_TRAIT",
          `Entity '${entityName}' uses unknown trait '${traitName}'`,
          pointer("entities", entityName, entity.traits ? "traits" : "uses", i),
          suggestion(traitName, Object.keys(traits), "traits")
        );
        return;
      }

      const isExcluded = (field: string) => globalExclude.has(field) || itemExclude.has(field);

      // Trait fields
      for (const [fieldName, fieldDef] of Object.entries(trait.fields ?? {})) {
        if (isExcluded(fieldName)) {
          continue;
        }

        // Collision check
        if (fieldName in (entity.fields ?? {})) {
          this.addError(
            "TRAIT_FIELD_COLLISION",
            `Field '${fieldName}' already defined on entity '${entityName}'; trait '${traitName}' cannot override it silently. Exclude the trait member explicitly or rename the field.`,
            pointer("entities", entityName, "fields", fieldName),
            `Add '${fieldName}' to 'exclude' or rename the field.`
          );
          continue;
        }

        if (fieldName in mergedFields && !(fieldName in (entity.fields ?? {}))) {
          this.addError(
            "TRAIT_FIELD_COLLISION",
            `Field '${fieldName}' on entity '${entityName}' defined by multiple traits. Exclude it explicitly.`,
            pointer("entities", entityName, entity.traits ? "traits" : "uses", i),
            `Add '${fieldName}' to 'exclude' in trait declaration.`
          );
          continue;
        }

        origins.fields[fieldName] = pointer("traits", traitName, "fields", fieldName);

        // Mix in default from trait if present
        let fObj: any = typeof fieldDef === "object" && fieldDef !== null ? { ...fieldDef } : { type: fieldDef };
        if (trait.defaults && trait.defaults[fieldName] !== undefined && fObj.default === undefined) {
          fObj.default = trait.defaults[fieldName];
        }
        mergedFields[fieldName] = fObj;
      }

      // Trait rules
      (trait.rules ?? []).forEach((rule: any, j: number) => {
        let ruleDef: RuleDefinition;
        if (typeof rule === "string") {
          ruleDef = {
            id: `${traitName}_rule_${j + 1}`,
            message: `Rule from trait ${traitName}`,
            check: rule,
          };
        } else {
          ruleDef = rule as RuleDefinition;
        }
        if (ruleDef.field && isExcluded(ruleDef.field)) {
          return;
        }
        mergedRules.push(ruleDef);
        origins.rules.push(pointer("traits", traitName, "rules", j));
      });

      // Trait invariants
      (trait.invariants ?? []).forEach((inv: any, j: number) => {
        let invDef: InvariantDefinition;
        if (typeof inv === "string") {
          invDef = {
            id: `${traitName}_inv_${j + 1}`,
            message: `Invariant from trait ${traitName}`,
            assert: inv,
          };
        } else {
          invDef = inv as InvariantDefinition;
        }
        mergedInvariants.push(invDef);
        origins.invariants.push(pointer("traits", traitName, "invariants", j));
      });

      // Trait readFilter
      if (trait.readFilter && typeof trait.readFilter === "string") {
        if (!mergedReadFilter) {
          mergedReadFilter = trait.readFilter;
        } else {
          mergedReadFilter = `(${mergedReadFilter}) && (${trait.readFilter})`;
        }
      }
    });

    return {
      entity: {
        ...entity,
        fields: mergedFields,
        rules: mergedRules,
        invariants: mergedInvariants,
        ...(mergedReadFilter ? { readFilter: mergedReadFilter } : {}),
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
      ...(entity.readFilter ? { readFilter: entity.readFilter } : {}),
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
