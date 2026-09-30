/**
 * Kerangka Workspace and Multi-Context Loader
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * Discovers, loads, validates, and flattens multi-context workspaces (PLAN.md §7).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { pointer } from "./diagnostics.js";
import { CompilerDiagnostic, EntityDefinition, RawKerangkaDocument } from "./types.js";

export interface ContextExports {
  entities?: string[] | Record<string, string[]>;
  events?: string[];
  actions?: string[];
  queries?: string[];
}

export interface ContextDefinition {
  context: string;
  description?: string;
  glossary?: Record<string, string>;
  dependsOn?: string[] | Record<string, unknown>;
  exports?: ContextExports;
  entities?: Record<string, EntityDefinition>;
  events?: Record<string, unknown>;
  policies?: Record<string, unknown>;
  queries?: Record<string, unknown>;
  decisions?: Record<string, unknown>;
  traits?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LoadedContext {
  name: string;
  dir: string;
  def: ContextDefinition;
}

export interface WorkspaceLoadResult {
  contexts: Record<string, LoadedContext>;
  diagnostics: CompilerDiagnostic[];
  flattenedEntities: Record<string, EntityDefinition>;
  flattenedEvents: Record<string, unknown>;
  flattenedPolicies: Record<string, unknown>;
  flattenedDecisions: Record<string, unknown>;
  flattenedTraits: Record<string, unknown>;
  flattenedQueries: Record<string, unknown>;
}

function parseFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, "utf8");
  return content.trim().startsWith("{") ? JSON.parse(content) : parseYaml(content);
}

export class WorkspaceLoader {
  private readonly diagnostics: CompilerDiagnostic[] = [];

  constructor(
    private readonly rootDoc: RawKerangkaDocument,
    private readonly sourcePath?: string
  ) {}

  load(): WorkspaceLoadResult {
    const declaredContexts = this.rootDoc.contexts ?? [];
    const baseDir = this.sourcePath ? path.dirname(path.resolve(this.sourcePath)) : process.cwd();
    const loadedContexts: Record<string, LoadedContext> = {};

    // 1. Discover and load each context
    declaredContexts.forEach((contextName, idx) => {
      const contextDir = path.resolve(baseDir, "contexts", contextName);
      if (!fs.existsSync(contextDir) || !fs.statSync(contextDir).isDirectory()) {
        this.diagnostics.push({
          severity: "error",
          code: "CONTEXT_NOT_FOUND",
          message: `Context '${contextName}' directory not found at '${contextDir}'`,
          path: pointer("contexts", idx),
          hint: `Create the context directory 'contexts/${contextName}' with a 'context.kerangka.json' file.`,
        });
        return;
      }

      const contextDef = this.loadContextDefinition(contextDir, contextName);
      if (contextDef) {
        loadedContexts[contextName] = {
          name: contextName,
          dir: contextDir,
          def: contextDef,
        };
      }
    });

    // 2. Validate dependencies (DAG / cycles)
    this.validateDependencyGraph(loadedContexts);

    // 3. Validate context boundaries (exports & undeclared events)
    this.validateBoundaries(loadedContexts);

    // 4. Flatten all contexts into workspace aggregates
    const flattenedEntities: Record<string, EntityDefinition> = { ...(this.rootDoc.entities ?? {}) };
    const flattenedEvents: Record<string, unknown> = { ...(this.rootDoc.events ?? {}) };
    const flattenedPolicies: Record<string, unknown> = { ...(this.rootDoc.policies ?? {}) };
    const flattenedDecisions: Record<string, unknown> = { ...(this.rootDoc.decisions ?? {}) };
    const flattenedTraits: Record<string, unknown> = { ...(this.rootDoc.traits ?? {}) };
    const flattenedQueries: Record<string, unknown> = {};

    // A policy name claimed by more than one context is namespaced as `context.policy`.
    // Deciding that once, before flattening, keeps the result independent of load order.
    const policyNameClaims = new Map<string, number>();
    for (const ctx of Object.values(loadedContexts)) {
      for (const name of Object.keys(ctx.def.policies ?? {})) {
        policyNameClaims.set(name, (policyNameClaims.get(name) ?? 0) + 1);
      }
    }
    for (const name of Object.keys(this.rootDoc.policies ?? {})) {
      policyNameClaims.set(name, (policyNameClaims.get(name) ?? 0) + 1);
    }
    const sharedPolicyNames = new Set(
      [...policyNameClaims.entries()].filter(([, count]) => count > 1).map(([name]) => name),
    );

    for (const ctx of Object.values(loadedContexts)) {
      if (ctx.def.entities) {
        Object.assign(flattenedEntities, ctx.def.entities);
      }
      if (ctx.def.events) {
        Object.assign(flattenedEvents, ctx.def.events);
      }
      if (ctx.def.policies) {
        Object.assign(flattenedPolicies, this.policyKeys(ctx.name, ctx.def.policies, sharedPolicyNames));
      }
      if (ctx.def.decisions) {
        Object.assign(flattenedDecisions, ctx.def.decisions);
      }
      if (ctx.def.traits) {
        Object.assign(flattenedTraits, ctx.def.traits);
      }
      if (ctx.def.queries) {
        Object.assign(flattenedQueries, ctx.def.queries);
      }
    }

    return {
      contexts: loadedContexts,
      diagnostics: this.diagnostics,
      flattenedEntities,
      flattenedEvents,
      flattenedPolicies,
      flattenedDecisions,
      flattenedTraits,
      flattenedQueries,
    };
  }

  /**
   * Policies are flat in the IR but owned by a context, and two contexts may name their
   * policy the same thing (billing and inventory both want `onOrderPlaced`). A name claimed
   * by one context keeps its bare form; a shared name becomes `context.policy`, so no
   * context can silently overwrite another's reaction.
   */
  private policyKeys(
    contextName: string,
    policies: Record<string, unknown>,
    sharedNames: Set<string>,
  ): Record<string, unknown> {
    const seen = new Set<string>();
    const keyed: Record<string, unknown> = {};

    for (const [name, policy] of Object.entries(policies)) {
      let key = sharedNames.has(name) ? `${contextName}.${name}` : name;
      while (seen.has(key)) {
        key = `${key}~`;
      }
      seen.add(key);
      keyed[key] = policy;
    }

    return keyed;
  }

  private loadContextDefinition(contextDir: string, contextName: string): ContextDefinition | undefined {
    let manifest: ContextDefinition = { context: contextName, entities: {} };

    // Primary manifest file
    const manifestCandidates = [
      path.join(contextDir, "context.kerangka.json"),
      path.join(contextDir, "context.kerangka.yaml"),
      path.join(contextDir, "context.kerangka.yml"),
    ];

    for (const cand of manifestCandidates) {
      if (fs.existsSync(cand)) {
        try {
          manifest = parseFile(cand) as ContextDefinition;
          break;
        } catch (err) {
          this.diagnostics.push({
            severity: "error",
            code: "PARSE_ERROR",
            message: `Failed to parse context manifest at ${cand}: ${(err as Error).message}`,
            path: pointer("contexts", contextName),
            hint: "Check context manifest JSON/YAML syntax.",
          });
          return undefined;
        }
      }
    }

    // Also look for individual aggregate files under aggregates/
    const aggregatesDir = path.join(contextDir, "aggregates");
    if (fs.existsSync(aggregatesDir) && fs.statSync(aggregatesDir).isDirectory()) {
      manifest.entities = manifest.entities ?? {};
      for (const file of fs.readdirSync(aggregatesDir)) {
        if (file.endsWith(".kerangka.json") || file.endsWith(".kerangka.yaml") || file.endsWith(".kerangka.yml")) {
          const filePath = path.join(aggregatesDir, file);
          try {
            const agg = parseFile(filePath) as { aggregate?: string; entities?: Record<string, EntityDefinition> } & EntityDefinition;
            const aggName = agg.aggregate ?? path.basename(file).split(".")[0]!;
            manifest.entities[aggName] = agg;
            if (agg.entities) {
              Object.assign(manifest.entities, agg.entities);
            }
          } catch (err) {
            this.diagnostics.push({
              severity: "error",
              code: "PARSE_ERROR",
              message: `Failed to parse aggregate file ${filePath}: ${(err as Error).message}`,
              path: pointer("contexts", contextName, "aggregates", file),
              hint: "Check aggregate definition syntax.",
            });
          }
        }
      }
    }

    return manifest;
  }

  private validateDependencyGraph(contexts: Record<string, LoadedContext>): void {
    const adj = new Map<string, string[]>();
    for (const [name, ctx] of Object.entries(contexts)) {
      const deps: string[] = [];
      if (Array.isArray(ctx.def.dependsOn)) {
        deps.push(...ctx.def.dependsOn);
      } else if (ctx.def.dependsOn && typeof ctx.def.dependsOn === "object") {
        deps.push(...Object.keys(ctx.def.dependsOn));
      }
      adj.set(name, deps);
    }

    // Cycle detection via DFS
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const pathStack: string[] = [];

    const dfs = (node: string): boolean => {
      visited.add(node);
      recStack.add(node);
      pathStack.push(node);

      for (const neighbor of adj.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          const cycle = pathStack.slice(pathStack.indexOf(neighbor)).concat(neighbor);
          this.diagnostics.push({
            severity: "error",
            code: "DEPENDENCY_CYCLE",
            message: `Circular dependency detected between contexts: ${cycle.join(" -> ")}`,
            path: pointer("contexts", node, "dependsOn"),
            hint: "Context dependencies must form a directed acyclic graph (DAG). Decouple using domain events.",
          });
          return true;
        }
      }

      recStack.delete(node);
      pathStack.pop();
      return false;
    };

    for (const name of Object.keys(contexts)) {
      if (!visited.has(name)) {
        dfs(name);
      }
    }
  }

  private validateBoundaries(contexts: Record<string, LoadedContext>): void {
    for (const [contextName, ctx] of Object.entries(contexts)) {
      const declaredEvents = new Set([
        ...Object.keys(ctx.def.events ?? {}),
        ...Object.keys(this.rootDoc.events ?? {}),
      ]);

      // 1. Validate emitted events in workflow transitions
      for (const [entityName, entity] of Object.entries(ctx.def.entities ?? {})) {
        const transitions = entity.workflow?.transitions ?? {};
        for (const [transName, trans] of Object.entries(transitions)) {
          for (const step of trans.then ?? []) {
            if (typeof step === "object" && step !== null && "emit" in step) {
              const emittedEvent = (step as { emit: string }).emit;
              if (typeof emittedEvent === "string" && !declaredEvents.has(emittedEvent)) {
                this.diagnostics.push({
                  severity: "error",
                  code: "UNDECLARED_EVENT",
                  message: `Emitted event '${emittedEvent}' is not declared in context '${contextName}' events`,
                  path: pointer("contexts", contextName, "entities", entityName, "workflow", "transitions", transName, "then"),
                  hint: `Declare '${emittedEvent}' under 'events' in context '${contextName}'.`,
                });
              }
            }
          }
        }
      }

      // 2. Validate policies reacting to foreign events (must be declared in dependsOn and exported)
      const policies = ctx.def.policies ?? {};
      for (const [policyName, policy] of Object.entries(policies)) {
        if (typeof policy === "object" && policy !== null && "on" in policy) {
          const onTrigger = (policy as { on: string }).on;
          if (typeof onTrigger === "string" && onTrigger.includes(".")) {
            const [foreignCtxName, foreignEventName] = onTrigger.split(".");
            if (foreignCtxName && foreignEventName) {
              const foreignCtx = contexts[foreignCtxName];
              if (!foreignCtx) {
                this.diagnostics.push({
                  severity: "error",
                  code: "CONTEXT_NOT_FOUND",
                  message: `Policy '${policyName}' listens to event on unknown context '${foreignCtxName}'`,
                  path: pointer("contexts", contextName, "policies", policyName, "on"),
                  hint: `Check that context '${foreignCtxName}' is declared in the workspace.`,
                });
                continue;
              }

              // Check if foreign context exports this event
              const exportedEvents = foreignCtx.def.exports?.events ?? [];
              if (!exportedEvents.includes(foreignEventName)) {
                this.diagnostics.push({
                  severity: "error",
                  code: "NOT_EXPORTED",
                  message: `Event '${foreignEventName}' is not exported by context '${foreignCtxName}'`,
                  path: pointer("contexts", contextName, "policies", policyName, "on"),
                  hint: `Add '${foreignEventName}' to context '${foreignCtxName}' exports under 'events'.`,
                });
              }
            }
          }
        }
      }
    }
  }
}
