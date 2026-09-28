/**
 * Kerangka Linter
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * Boundaries, naming rules, and complexity budgets (PLAN.md §7.7, §13).
 *
 * The compiler owns what must be true for a model to compile. The linter owns the advice
 * layer on top: budgets that keep files and logic small, naming that makes a model
 * predictable, declarations nobody uses, and the service boundaries a topology implies.
 * Every finding carries a code, a JSON pointer, and the hint PLAN.md prescribes, so a
 * machine — an agent included — can act on it without reading this file.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ExprNode } from "@kerangka/k1";
import { SourceLocator, closest, pointer } from "../diagnostics.js";
import { CompilerDiagnostic, KIRDocument, RawKerangkaDocument } from "../types.js";
import { ContextDefinition, LoadedContext } from "../workspace.js";

/** Naming style required for a declaration. `any` disables the check. */
export type NamingCase = "kebab" | "pascal" | "camel" | "any";

/** The seven complexity budgets of PLAN.md §7.7. Every value is configurable. */
export interface LintBudgets {
  linesPerFile: number;
  fieldsPerAggregate: number;
  statementsPerAction: number;
  nodesPerExpression: number;
  transitionsPerWorkflow: number;
  aggregatesPerContext: number;
  dependenciesPerContext: number;
}

/** Naming rules of the same preset: contexts kebab-case; aggregates, types, and events
 * PascalCase with events in the past tense; fields, actions, and defs camelCase. */
export interface LintNaming {
  app: NamingCase;
  context: NamingCase;
  aggregate: NamingCase;
  type: NamingCase;
  event: NamingCase;
  field: NamingCase;
  action: NamingCase;
  def: NamingCase;
}

export interface LintPreset {
  name: string;
  budgets: LintBudgets;
  naming: LintNaming;
  /** Which unused-declaration findings this preset reports. */
  unused: {
    exports: boolean;
    defs: boolean;
    fields: boolean;
  };
  /** Whether a `uses` load crossing a service boundary is reported under `--topology`. */
  topology: boolean;
}

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const CAMEL = /^[a-z][A-Za-z0-9]*$/;

/** The `kerangka:recommended` preset of PLAN.md §7.7. */
export const kerangkaRecommendedPreset: LintPreset = {
  name: "kerangka:recommended",
  budgets: {
    linesPerFile: 300,
    fieldsPerAggregate: 40,
    statementsPerAction: 10,
    nodesPerExpression: 30,
    transitionsPerWorkflow: 15,
    aggregatesPerContext: 12,
    dependenciesPerContext: 4,
  },
  naming: {
    app: "kebab",
    context: "kebab",
    aggregate: "pascal",
    type: "pascal",
    event: "pascal",
    field: "camel",
    action: "camel",
    def: "camel",
  },
  unused: { exports: true, defs: true, fields: false },
  topology: true,
};

/** Reports nothing. The escape hatch for a model that has settled into its own shape. */
export const kerangkaOffPreset: LintPreset = {
  name: "kerangka:off",
  budgets: {
    linesPerFile: Number.POSITIVE_INFINITY,
    fieldsPerAggregate: Number.POSITIVE_INFINITY,
    statementsPerAction: Number.POSITIVE_INFINITY,
    nodesPerExpression: Number.POSITIVE_INFINITY,
    transitionsPerWorkflow: Number.POSITIVE_INFINITY,
    aggregatesPerContext: Number.POSITIVE_INFINITY,
    dependenciesPerContext: Number.POSITIVE_INFINITY,
  },
  naming: {
    app: "any",
    context: "any",
    aggregate: "any",
    type: "any",
    event: "any",
    field: "any",
    action: "any",
    def: "any",
  },
  unused: { exports: false, defs: false, fields: false },
  topology: false,
};

const BUILT_IN_PRESETS: Record<string, LintPreset> = {
  "kerangka:recommended": kerangkaRecommendedPreset,
  "kerangka:off": kerangkaOffPreset,
};

/** Looks up a built-in preset by name. */
export function resolvePreset(name: string): LintPreset | undefined {
  return BUILT_IN_PRESETS[name];
}

/** The `deploy.kerangka.json` shape, narrowed to what lint reads. */
export interface DeploymentTopology {
  topologies: Record<
    string,
    { services: Record<string, { contexts?: string[]; [key: string]: unknown }> }
  >;
  [key: string]: unknown;
}

export interface LintOptions {
  /** Defaults to `kerangka:recommended`. */
  preset?: LintPreset;
  /** Reported in diagnostics and in the JSON report. */
  sourcePath?: string;
  /** Source text, needed for the lines-per-file budget and for line and column. */
  sourceText?: string;
  /** The parsed document, needed for `lint` overrides and for declarations that do not
   * survive compilation, such as `defs`, `traits`, and `policies`. */
  rootDoc?: RawKerangkaDocument;
  /** Loaded contexts. Absent for a single-file document. */
  contexts?: Record<string, LoadedContext>;
  topology?: DeploymentTopology;
  topologyName?: string;
}

export interface LintCounts {
  entities: number;
  fields: number;
  actions: number;
  expressions: number;
  events: number;
  contexts: number;
  lines: number;
}

export interface LintDiagnostic extends CompilerDiagnostic {
  /** The file this finding belongs to. A context finding belongs to the context's own
   * file, so an editor opens the right one. Absent means the document linted. */
  file?: string;
}

export interface LintResult {
  /** No finding at error severity. */
  ok: boolean;
  preset: string;
  diagnostics: LintDiagnostic[];
  counts: LintCounts;
}

const BUDGET_HINTS: Record<keyof LintBudgets, string> = {
  linesPerFile: "Split the aggregate, or move views and policies to their own files.",
  fieldsPerAggregate: "Extract a value object or a new aggregate.",
  statementsPerAction: "Move logic into defs, or split the action.",
  nodesPerExpression: "Name the parts as defs or computed fields.",
  transitionsPerWorkflow: "Split the lifecycle.",
  aggregatesPerContext: "The context is probably two contexts.",
  dependenciesPerContext: "Revisit the context map.",
};

/** Irregular past participles; every regular one ends in `-ed`. */
const IRREGULAR_PAST = new Set([
  "awoken", "beaten", "begun", "bent", "bitten", "blown", "born", "borne", "bought", "broken",
  "brought", "built", "burnt", "burst", "bought", "caught", "chosen", "cost", "cut", "dealt",
  "done", "drawn", "driven", "drunk", "eaten", "fed", "felt", "flown", "forbidden", "forgotten",
  "forgiven", "frozen", "given", "gone", "grown", "heard", "held", "hidden", "hit", "hung", "hurt",
  "kept", "known", "laid", "led", "left", "lent", "let", "lit", "lost", "made", "meant", "met",
  "paid", "put", "read", "ridden", "run", "said", "seen", "sold", "sent", "set", "sewn", "shaken",
  "shone", "shot", "shown", "shut", "sung", "sunk", "sat", "slain", "slid", "sold", "spent",
  "spun", "spilt", "split", "spread", "sprung", "stolen", "struck", "striven", "sworn", "swept",
  "swum", "swung", "taken", "taught", "thought", "thrown", "thrust", "trodden", "understood",
  "upset", "woken", "worn", "woven", "won", "wound", "withdrawn", "written",
]);

/** Past participles ending in a silent `-en`, as in `Taken` or `Written`. */
const PAST_ENDING_EN = /(?:a|e|i|o|u|w|y)n$|(?:ak|iv|ol|os|ov|un|un)en$/;

export class KerangkaLinter {
  private readonly findings: LintDiagnostic[] = [];
  private readonly counts: LintCounts = {
    entities: 0,
    fields: 0,
    actions: 0,
    expressions: 0,
    events: 0,
    contexts: 0,
    lines: 0,
  };

  private readonly preset: LintPreset;
  private readonly rootDoc?: RawKerangkaDocument;

  constructor(private readonly options: LintOptions = {}) {
    this.preset = this.resolvePreset();
    this.rootDoc = options.rootDoc;
  }

  private resolvePreset(): LintPreset {
    const base = this.options.preset ?? kerangkaRecommendedPreset;
    const overrides = (this.options.rootDoc?.lint ?? {}) as {
      budgets?: Partial<LintBudgets>;
      naming?: Partial<LintNaming>;
      unused?: Partial<LintPreset["unused"]>;
    };
    if (!overrides || typeof overrides !== "object") return base;
    return {
      ...base,
      budgets: { ...base.budgets, ...(overrides.budgets ?? {}) },
      naming: { ...base.naming, ...(overrides.naming ?? {}) },
      unused: { ...base.unused, ...(overrides.unused ?? {}) },
    };
  }

  lint(kir: KIRDocument): LintResult {
    this.findings.length = 0;
    Object.keys(this.counts).forEach((k) => (this.counts[k as keyof LintCounts] = 0));

    this.lintApp(kir);
    this.lintEntities(kir);
    this.lintEvents(kir);
    this.lintDefs();
    this.lintFileLines();
    this.lintContexts();

    this.attachPositions();

    return {
      ok: !this.findings.some((d) => d.severity === "error"),
      preset: this.preset.name,
      diagnostics: [...this.findings].sort(
        (a, b) => (a.path ?? "").localeCompare(b.path ?? "") || a.code.localeCompare(b.code)
      ),
      counts: { ...this.counts },
    };
  }

  // ---------------------------------------------------------------- naming

  private lintApp(kir: KIRDocument): void {
    this.requireCase(kir.app, this.preset.naming.app, "APP_NAMING", pointer("app"), "app", [
      "application id",
    ]);
  }

  private lintEntities(kir: KIRDocument): void {
    const entityNames = Object.keys(kir.entities ?? {});
    this.counts.entities = entityNames.length;

    for (const [entityName, entity] of entityNames.map((n) => [n, kir.entities[n]!] as const)) {
      this.counts.fields += Object.keys(entity.fields ?? {}).length;
      this.requireCase(
        entityName,
        this.preset.naming.aggregate,
        "AGGREGATE_NAMING",
        pointer("entities", entityName),
        entityName,
        entityNames
      );
      this.lintFields(entityName, entity);
      this.lintActions(entityName, entity);
      this.lintWorkflow(entityName, entity);
      this.lintExpressions(entityName, entity);
    }

    const typeNames = Object.keys((this.rootDoc?.types as Record<string, unknown>) ?? {});
    for (const typeName of typeNames) {
      this.requireCase(
        typeName,
        this.preset.naming.type,
        "TYPE_NAMING",
        pointer("types", typeName),
        typeName,
        typeNames
      );
    }
  }

  private lintFields(entityName: string, entity: KIRDocument["entities"][string]): void {
    const fieldNames = Object.keys(entity.fields ?? {});
    for (const fieldName of fieldNames) {
      this.requireCase(
        fieldName,
        this.preset.naming.field,
        "FIELD_NAMING",
        pointer("entities", entityName, "fields", fieldName),
        fieldName,
        fieldNames
      );
    }
    this.budget(
      fieldNames.length,
      "fieldsPerAggregate",
      `Aggregate '${entityName}' declares ${fieldNames.length} fields, over the budget of ${this.preset.budgets.fieldsPerAggregate}.`,
      pointer("entities", entityName, "fields")
    );
  }

  private lintActions(entityName: string, entity: KIRDocument["entities"][string]): void {
    for (const [actionName, action] of Object.entries(entity.actions ?? {})) {
      this.counts.actions++;
      this.requireCase(
        actionName,
        this.preset.naming.action,
        "ACTION_NAMING",
        pointer("entities", entityName, "actions", actionName),
        actionName,
        Object.keys(entity.actions ?? {})
      );
      const statements = Object.keys(action.run ?? {}).length;
      this.budget(
        statements,
        "statementsPerAction",
        `Action '${entityName}.${actionName}' has ${statements} statements, over the budget of ${this.preset.budgets.statementsPerAction}.`,
        pointer("entities", entityName, "actions", actionName, "run")
      );
    }
  }

  private lintWorkflow(entityName: string, entity: KIRDocument["entities"][string]): void {
    const workflow = entity.workflow;
    if (!workflow) return;
    const transitionNames = Object.keys(workflow.transitions ?? {});
    this.budget(
      transitionNames.length,
      "transitionsPerWorkflow",
      `Workflow '${entityName}' has ${transitionNames.length} transitions, over the budget of ${this.preset.budgets.transitionsPerWorkflow}.`,
      pointer("entities", entityName, "workflow", "transitions")
    );
  }

  /** Every expression an author has to read: rules, invariants, guards, and computed fields. */
  private lintExpressions(entityName: string, entity: KIRDocument["entities"][string]): void {
    const check = (node: ExprNode | string | undefined, path: string): void => {
      if (node === undefined) return;
      const ast = typeof node === "string" ? undefined : node;
      if (!ast) return;
      this.counts.expressions++;
      const nodes = countNodes(ast);
      this.budget(
        nodes,
        "nodesPerExpression",
        `Expression at ${entityName} has ${nodes} nodes, over the budget of ${this.preset.budgets.nodesPerExpression}.`,
        path
      );
    };

    for (const [fieldName, field] of Object.entries(entity.fields ?? {})) {
      check(field.compute, pointer("entities", entityName, "fields", fieldName, "compute"));
    }
    (entity.rules ?? []).forEach((rule, i) =>
      check(rule.check, pointer("entities", entityName, "rules", rule.id ?? i, "check"))
    );
    (entity.invariants ?? []).forEach((inv, i) =>
      check(inv.assert, pointer("entities", entityName, "invariants", inv.id ?? i, "assert"))
    );
    for (const [transitionName, transition] of Object.entries(entity.workflow?.transitions ?? {})) {
      check(transition.when, pointer("entities", entityName, "workflow", "transitions", transitionName, "when"));
    }
    for (const [actionName, action] of Object.entries(entity.actions ?? {})) {
      check(action.when, pointer("entities", entityName, "actions", actionName, "when"));
    }
  }

  private lintEvents(kir: KIRDocument): void {
    const eventNames = Object.keys(kir.events ?? {});
    this.counts.events = eventNames.length;
    for (const eventName of eventNames) {
      this.requireCase(
        eventName,
        this.preset.naming.event,
        "EVENT_NAMING",
        pointer("events", eventName),
        eventName,
        eventNames
      );
      if (this.preset.naming.event !== "any" && !isPastTense(eventName)) {
        this.add({
          severity: "warning",
          code: "EVENT_TENSE",
          message: `Event '${eventName}' is not in the past tense.`,
          path: pointer("events", eventName),
          hint: "An event names something that already happened, as in 'InvoicePaid'.",
        });
      }
    }
  }

  private lintDefs(): void {
    const defs = (this.rootDoc?.defs as Record<string, unknown>) ?? {};
    const defNames = Object.keys(defs);
    if (defNames.length === 0) return;

    for (const defName of defNames) {
      this.requireCase(
        defName,
        this.preset.naming.def,
        "DEF_NAMING",
        pointer("defs", defName),
        defName,
        defNames
      );
    }

    if (!this.preset.unused.defs) return;
    // A def is used when its name appears anywhere else in the document.
    const body = JSON.stringify({ ...this.rootDoc, defs: {} });
    for (const defName of defNames) {
      if (!new RegExp(`\\b${escapeRegExp(defName)}\\b`).test(body)) {
        this.add({
          severity: "warning",
          code: "UNUSED_DEF",
          message: `Def '${defName}' is never used.`,
          path: pointer("defs", defName),
          hint: "Reference it from a rule, guard, query, or view, or delete it.",
        });
      }
    }
  }

  private lintFileLines(): void {
    const text = this.options.sourceText;
    if (text === undefined) return;
    this.counts.lines = text.split("\n").length;
    this.budget(
      this.counts.lines,
      "linesPerFile",
      `File has ${this.counts.lines} lines, over the budget of ${this.preset.budgets.linesPerFile}.`,
      ""
    );
  }

  // ---------------------------------------------------------------- contexts

  private lintContexts(): void {
    const contexts = this.options.contexts;
    if (!contexts) return;
    this.counts.contexts = Object.keys(contexts).length;

    for (const [name, ctx] of Object.entries(contexts)) {
      this.requireCase(
        name,
        this.preset.naming.context,
        "CONTEXT_NAMING",
        "",
        name,
        Object.keys(contexts),
        ctx
      );
      this.lintContextAggregates(name, ctx);
      this.lintContextDependencies(name, ctx);
    }
    this.lintContextExports(contexts);
    this.lintTopologyLoads(contexts);
  }

  private lintContextAggregates(name: string, ctx: LoadedContext): void {
    this.budgetInContext(
      ctx,
      "aggregatesPerContext",
      Object.keys(ctx.def.entities ?? {}).length,
      "/entities",
      `Context '${name}'`
    );
  }

  /** Structural dependencies: declared `dependsOn` plus every other context a load reads. */
  private lintContextDependencies(name: string, ctx: LoadedContext): void {
    const edges = new Set<string>(declaredDependencies(ctx.def));
    for (const load of collectLoads(ctx.def)) {
      if (load.context !== name) edges.add(load.context);
    }
    this.budgetInContext(ctx, "dependenciesPerContext", edges.size, "/dependsOn", `Context '${name}'`);
  }

  private lintContextExports(contexts: Record<string, LoadedContext>): void {
    for (const [name, ctx] of Object.entries(contexts)) {
      const exports = ctx.def.exports ?? {};
      for (const [kind, declared] of Object.entries(exportedNames(exports))) {
        for (const exported of declared) {
          const defined =
            kind === "events"
              ? (ctx.def.events ?? {})
              : kind === "entities"
                ? (ctx.def.entities ?? {})
                : ctx.def[kind];
          if (!(defined && Object.prototype.hasOwnProperty.call(defined, exported))) {
            this.addInContext(ctx, {
              severity: "error",
              code: "EXPORT_NOT_DEFINED",
              message: `Context '${name}' exports ${kind} '${exported}', which it does not define.`,
              path: pointer("exports", kind),
              hint: `Declare '${exported}' under '${kind}' in context '${name}', or remove it from exports.`,
            });
            continue;
          }
          if (!this.preset.unused.exports) continue;
          if (this.isExportUsed(contexts, name, exported)) continue;
          this.addInContext(ctx, {
            severity: "warning",
            code: "UNUSED_EXPORT",
            message: `Context '${name}' exports '${exported}', which no other context uses.`,
            path: pointer("exports", kind),
            hint: "Every other context reaches it through 'dependsOn'. Remove the export, or use it.",
          });
        }
      }
    }
  }

  private isExportUsed(contexts: Record<string, LoadedContext>, owner: string, name: string): boolean {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`);
    for (const [other, ctx] of Object.entries(contexts)) {
      if (other === owner) continue;
      if (pattern.test(JSON.stringify(ctx.def))) return true;
    }
    return false;
  }

  /** With a topology, every `uses` load that crosses a service boundary is a network call. */
  private lintTopologyLoads(contexts: Record<string, LoadedContext>): void {
    if (!this.preset.topology) return;
    const services = this.selectedServices();
    if (!services) return;
    const serviceOf = new Map<string, string>();
    for (const [service, spec] of Object.entries(services)) {
      for (const contextName of spec.contexts ?? []) serviceOf.set(contextName, service);
    }

    for (const [name, ctx] of Object.entries(contexts)) {
      const from = serviceOf.get(name);
      if (!from) continue;
      for (const load of collectLoads(ctx.def)) {
        const to = serviceOf.get(load.context);
        if (!to || to === from) continue;
        this.add({
          severity: "warning",
          code: "CROSS_SERVICE_LOAD",
          message: `Context '${name}' loads '${load.name}' from '${load.context}' in service '${to}', while it runs in '${from}'.`,
          path: pointer("contexts", name, load.path),
          hint: "A load that crosses a service boundary is a synchronous network call. Call an action or wait for an event instead.",
        });
      }
    }
  }

  private selectedServices(): Record<string, { contexts?: string[] }> | undefined {
    const topology = this.options.topology;
    if (!topology) return undefined;
    const name = this.options.topologyName;
    if (name && topology.topologies?.[name]) return topology.topologies[name]!.services;
    const first = Object.keys(topology.topologies ?? {})[0];
    return first ? topology.topologies[first]!.services : undefined;
  }

  // ---------------------------------------------------------------- helpers

  private budget(value: number, budget: keyof LintBudgets, message: string, path: string): void {
    if (value <= this.preset.budgets[budget]) return;
    this.add({
      severity: "error",
      code: budgetCode(budget),
      message,
      path,
      hint: BUDGET_HINTS[budget],
    });
  }

  private budgetInContext(
    ctx: LoadedContext,
    budget: keyof LintBudgets,
    value: number,
    path: string,
    subject: string
  ): void {
    if (value <= this.preset.budgets[budget]) return;
    this.addInContext(ctx, {
      severity: "error",
      code: budgetCode(budget),
      message: `${subject} has ${value} ${budgetLabel(budget)}, over the budget of ${this.preset.budgets[budget]}.`,
      path,
      hint: BUDGET_HINTS[budget],
    });
  }

  private requireCase(
    name: string,
    style: NamingCase,
    code: string,
    path: string,
    label: string,
    candidates: string[],
    ctx?: LoadedContext
  ): void {
    if (style === "any" || matchesCase(name, style)) return;
    const suggestion = closest(name, candidates);
    const diagnostic: LintDiagnostic = {
      severity: "warning",
      code,
      message: `${label} '${name}' is not ${describeCase(style)}.`,
      path,
      hint: suggestion
        ? `Rename it to '${suggestion}', or to the ${describeCase(style)} name this preset requires.`
        : `Name it in ${describeCase(style)}, as this preset requires.`,
    };
    if (ctx) this.addInContext(ctx, diagnostic);
    else this.add(diagnostic);
  }

  private add(diagnostic: LintDiagnostic): void {
    this.findings.push(diagnostic);
  }

  /**
   * Records a finding that belongs to a context's own file, so the pointer resolves there
   * and an editor opens that file rather than the workspace manifest.
   */
  private addInContext(ctx: LoadedContext, diagnostic: LintDiagnostic): void {
    const file = this.contextFile(ctx);
    this.findings.push({ ...diagnostic, ...(file ? { file } : {}) });
  }

  /** The manifest a loaded context was read from, when it is still on disk. */
  private contextFile(ctx: LoadedContext): string | undefined {
    if (!ctx.dir) return undefined;
    for (const name of ["context.kerangka.json", "context.kerangka.yaml", "context.kerangka.yml"]) {
      const candidate = join(ctx.dir, name);
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private attachPositions(): void {
    const locators = new Map<string, SourceLocator>();
    const locatorFor = (file: string): SourceLocator | undefined => {
      const cached = locators.get(file);
      if (cached) return cached;
      const locator = SourceLocator.fromText(readFileSync(file, "utf8"));
      if (locator) locators.set(file, locator);
      return locator;
    };

    for (const finding of this.findings) {
      if (finding.line !== undefined) continue;
      const file = finding.file ?? this.options.sourcePath;
      if (!file || finding.path === undefined) continue;
      let locator = locatorFor(file);
      if (!locator && finding.file) {
        // The context is not on disk (a caller built it in memory); fall back to the
        // document the caller did give us.
        locator = this.options.sourceText ? SourceLocator.fromText(this.options.sourceText) : undefined;
        if (locator) locators.set(this.options.sourcePath ?? "", locator);
      }
      const position = locator?.locate(finding.path);
      if (position) Object.assign(finding, position);
    }
  }
}

/** Lints a compiled document. The one call most callers need. */
export function lintDocument(kir: KIRDocument, options: LintOptions = {}): LintResult {
  return new KerangkaLinter(options).lint(kir);
}

// ---------------------------------------------------------------- pure helpers

/** `BUDGET_FIELDS_PER_AGGREGATE`, the code an agent can match on. */
function budgetCode(budget: keyof LintBudgets): string {
  return `BUDGET_${budget.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

/** What a budget counts, so the message reads as a sentence. */
function budgetLabel(budget: keyof LintBudgets): string {
  switch (budget) {
    case "linesPerFile":
      return "lines";
    case "fieldsPerAggregate":
      return "fields";
    case "statementsPerAction":
      return "statements";
    case "nodesPerExpression":
      return "nodes";
    case "transitionsPerWorkflow":
      return "transitions";
    case "aggregatesPerContext":
      return "aggregates";
    case "dependenciesPerContext":
      return "context dependencies";
  }
}

function matchesCase(name: string, style: NamingCase): boolean {  switch (style) {
    case "kebab":
      return KEBAB.test(name);
    case "pascal":
      return PASCAL.test(name);
    case "camel":
      return CAMEL.test(name);
    case "any":
      return true;
  }
}

function describeCase(style: NamingCase): string {
  switch (style) {
    case "kebab":
      return "kebab-case";
    case "pascal":
      return "PascalCase";
    case "camel":
      return "camelCase";
    case "any":
      return "any case";
  }
}

/** True when the last word of a PascalCase name reads as a past participle. */
function isPastTense(name: string): boolean {
  const lastWord = name.split(/(?=[A-Z][a-z])|(?<=[a-z])(?=[A-Z])/).pop() ?? name;
  const lower = lastWord.toLowerCase();
  if (IRREGULAR_PAST.has(lower)) return true;
  if (lower.endsWith("ed")) return true;
  return PAST_ENDING_EN.test(lower);
}

function countNodes(node: ExprNode): number {
  if (!node || typeof node !== "object") return 0;
  if ("literal" in node) return 1;
  if ("$bind" in node) return 1;
  if ("$expr" in node) return 1 + (node.args ?? []).reduce((n, a) => n + countNodes(a), 0);
  return 0;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declaredDependencies(def: ContextDefinition): string[] {
  if (Array.isArray(def.dependsOn)) return def.dependsOn;
  if (def.dependsOn && typeof def.dependsOn === "object") return Object.keys(def.dependsOn);
  return [];
}

/** `exports` accepts a list or a map from kind to list; lint reads either. */
function exportedNames(exports: ContextDefinition["exports"]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [kind, value] of Object.entries(exports ?? {})) {
    if (Array.isArray(value)) out[kind] = value as string[];
    else if (value && typeof value === "object") out[kind] = Object.keys(value as Record<string, unknown>);
  }
  return out;
}

export interface LoadReference {
  context: string;
  name: string;
  path: string;
}

/**
 * Finds every cross-context load in a context definition. Two shapes are accepted: a
 * `uses` block keyed by context name, and any object carrying `from` and `load`.
 */
export function collectLoads(def: ContextDefinition): LoadReference[] {
  const found: LoadReference[] = [];
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, `${path}/${i}`));
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;

    if (typeof record.from === "string" && typeof record.load === "string") {
      found.push({ context: record.from, name: record.load, path });
    }
    if (record.uses && typeof record.uses === "object") {
      for (const [context, value] of Object.entries(record.uses as Record<string, unknown>)) {
        const load = typeof value === "string" ? value : (value as { load?: unknown })?.load;
        if (typeof load === "string") {
          found.push({ context, name: load, path: `${path}/uses/${context}` });
        }
      }
    }
    for (const [key, value] of Object.entries(record)) {
      if (key === "uses") continue;
      visit(value, `${path}/${key}`);
    }
  };

  Object.entries(def).forEach(([key, value]) => {
    if (key === "context" || key === "exports" || key === "glossary") return;
    visit(value, `/${key}`);
  });
  return found;
}
