/**
 * Kerangka CLI - Graph Command
 * Draws the architecture / context map as Mermaid (PLAN.md §13, §7.7, §8).
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  compile,
  CompilerError,
  DeploymentTopology,
  LoadedContext,
  RawKerangkaDocument,
  WorkspaceLoader,
} from "@kerangka/compiler";

export interface GraphOptions {
  /** Output format: 'mermaid' (default) or 'json'. */
  format?: "mermaid" | "json";
  /** Output file path or '-' for stdout (default: stdout). */
  output?: string;
  /** Layout direction: 'TD' (top-down, default) or 'LR' (left-to-right). */
  direction?: "TD" | "LR";
  /** Deployment topology name from deploy.kerangka.json to group contexts into services. */
  topology?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: "context" | "entity" | "service";
  entities?: string[];
  exports?: Record<string, string[]>;
  service?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "dependsOn" | "event" | "uses" | "reference" | "embedded";
  label?: string;
}

export interface GraphData {
  app: string;
  direction: "TD" | "LR";
  topology?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const MANIFEST_NAMES = ["kerangka.json", "kerangka.yaml", "kerangka.yml"];

export function graphCommand(targetPath: string, options: GraphOptions = {}): boolean {
  const manifest = resolveManifest(targetPath);
  if (!manifest) {
    console.error(`Error: No Kerangka document at '${targetPath}' (looked for ${MANIFEST_NAMES.join(", ")}).`);
    return false;
  }

  const text = readFileSync(manifest, "utf8");
  const sourcePath = manifest;
  const direction = options.direction ?? "TD";

  try {
    const raw = (text.trim().startsWith("{") ? JSON.parse(text) : parseYaml(text)) as RawKerangkaDocument;
    let graphData: GraphData;

    if (Array.isArray(raw.contexts) && raw.contexts.length > 0) {
      const loader = new WorkspaceLoader(raw, sourcePath);
      const wsResult = loader.load();
      const topology = options.topology ? readTopology(manifest) : undefined;
      graphData = buildWorkspaceGraph(raw.app, wsResult.contexts, direction, topology, options.topology);
    } else {
      const kir = compile(text, { sourcePath });
      graphData = buildSingleModelGraph(kir.app, kir, direction);
    }

    const outputText = options.format === "json"
      ? JSON.stringify(graphData, null, 2)
      : renderMermaid(graphData);

    if (options.output && options.output !== "-") {
      writeFileSync(options.output, outputText, "utf8");
      console.log(`Graph written to ${options.output}`);
    } else {
      console.log(outputText);
    }

    return true;
  } catch (err) {
    if (err instanceof CompilerError) {
      console.error(`Error: Compilation failed for ${sourcePath}:`);
      for (const diag of err.diagnostics) {
        console.error(`  - [${diag.code}] ${diag.message}`);
      }
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    return false;
  }
}

function buildWorkspaceGraph(
  appName: string,
  contexts: Record<string, LoadedContext>,
  direction: "TD" | "LR",
  deployTopology?: DeploymentTopology,
  topologyName?: string
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();

  // Determine service mapping if topology is provided
  const contextToService = new Map<string, string>();
  if (deployTopology && topologyName && deployTopology.topologies?.[topologyName]) {
    const services = deployTopology.topologies[topologyName].services ?? {};
    for (const [svcName, svc] of Object.entries(services)) {
      for (const ctxName of svc.contexts ?? []) {
        contextToService.set(ctxName, svcName);
      }
    }
  }

  for (const [name, ctx] of Object.entries(contexts)) {
    const entityNames = Object.keys(ctx.def.entities ?? {});
    const exportedEvents = ctx.def.exports?.events ?? [];
    const exportedEntities = Array.isArray(ctx.def.exports?.entities)
      ? ctx.def.exports.entities
      : Object.keys(ctx.def.exports?.entities ?? {});
    const exportedActions = ctx.def.exports?.actions ?? [];
    const exportedQueries = ctx.def.exports?.queries ?? [];

    const exportsMap: Record<string, string[]> = {};
    if (exportedEvents.length > 0) exportsMap.events = exportedEvents;
    if (exportedEntities.length > 0) exportsMap.entities = exportedEntities;
    if (exportedActions.length > 0) exportsMap.actions = exportedActions;
    if (exportedQueries.length > 0) exportsMap.queries = exportedQueries;

    nodes.push({
      id: name,
      label: name,
      type: "context",
      entities: entityNames,
      exports: Object.keys(exportsMap).length > 0 ? exportsMap : undefined,
      service: contextToService.get(name),
      metadata: {
        description: ctx.def.description,
        glossary: ctx.def.glossary ? Object.keys(ctx.def.glossary) : undefined,
      },
    });

    // 1. dependsOn edges
    const deps: string[] = [];
    if (Array.isArray(ctx.def.dependsOn)) {
      deps.push(...ctx.def.dependsOn);
    } else if (ctx.def.dependsOn && typeof ctx.def.dependsOn === "object") {
      deps.push(...Object.keys(ctx.def.dependsOn));
    }

    for (const dep of deps) {
      const key = `${name}->${dep}:dependsOn`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({
          from: name,
          to: dep,
          type: "dependsOn",
          label: "depends on",
        });
      }
    }

    // 2. Event policies (asynchronous subscriptions)
    const policies = ctx.def.policies ?? {};
    for (const policy of Object.values(policies)) {
      if (typeof policy === "object" && policy !== null && "on" in policy) {
        const onTrigger = (policy as { on: string }).on;
        if (typeof onTrigger === "string" && onTrigger.includes(".")) {
          const [sourceCtx, eventName] = onTrigger.split(".");
          if (sourceCtx && eventName) {
            const key = `${sourceCtx}->${name}:event:${eventName}`;
            if (!edgeSet.has(key)) {
              edgeSet.add(key);
              edges.push({
                from: sourceCtx,
                to: name,
                type: "event",
                label: `on: ${eventName}`,
              });
            }
          }
        }
      }
    }

    // 3. uses (synchronous cross-context loads)
    if (ctx.def.uses && typeof ctx.def.uses === "object") {
      for (const targetCtx of Object.keys(ctx.def.uses)) {
        const key = `${name}->${targetCtx}:uses`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({
            from: name,
            to: targetCtx,
            type: "uses",
            label: "uses load",
          });
        }
      }
    }
  }

  return {
    app: appName,
    direction,
    topology: topologyName,
    nodes,
    edges,
  };
}

function buildSingleModelGraph(appName: string, kir: any, direction: "TD" | "LR"): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();

  for (const [entityName, entity] of Object.entries<any>(kir.entities ?? {})) {
    nodes.push({
      id: entityName,
      label: entityName,
      type: "entity",
      metadata: {
        embedded: Boolean(entity.embedded),
        fieldCount: Object.keys(entity.fields ?? {}).length,
        hasWorkflow: Boolean(entity.workflow),
      },
    });

    // Detect relationships and references
    for (const [fieldName, fieldDef] of Object.entries<any>(entity.fields ?? {})) {
      const typeStr = typeof fieldDef === "string" ? fieldDef : fieldDef.type ?? "";

      // ref(TargetEntity)
      const refMatch = typeStr.match(/ref\(([^)]+)\)/);
      if (refMatch && refMatch[1]) {
        const target = refMatch[1].trim();
        const key = `${entityName}->${target}:ref:${fieldName}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({
            from: entityName,
            to: target,
            type: "reference",
            label: fieldName,
          });
        }
      }

      // embedded list(TargetEntity)
      const listMatch = typeStr.match(/list\(([^)]+)\)/);
      if (listMatch && listMatch[1]) {
        const target = listMatch[1].trim();
        if (kir.entities?.[target]?.embedded) {
          const key = `${entityName}->${target}:embedded`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({
              from: entityName,
              to: target,
              type: "embedded",
              label: `1..* ${fieldName}`,
            });
          }
        }
      }
    }
  }

  return {
    app: appName,
    direction,
    nodes,
    edges,
  };
}

export function renderMermaid(graph: GraphData): string {
  const lines: string[] = [];
  lines.push(`flowchart ${graph.direction}`);

  // Group nodes by service if topology is present
  const services = new Map<string, GraphNode[]>();
  const unassignedNodes: GraphNode[] = [];

  for (const node of graph.nodes) {
    if (node.service) {
      const list = services.get(node.service) ?? [];
      list.push(node);
      services.set(node.service, list);
    } else {
      unassignedNodes.push(node);
    }
  }

  const renderNode = (n: GraphNode, indent = "  "): string => {
    let details = `<b>${n.label}</b>`;
    if (n.entities && n.entities.length > 0) {
      details += `<br/>Entities: ${n.entities.join(", ")}`;
    }
    if (n.exports) {
      const expList: string[] = [];
      if (n.exports.events) expList.push(`Events: ${n.exports.events.join(", ")}`);
      if (n.exports.entities) expList.push(`Entities: ${n.exports.entities.join(", ")}`);
      if (n.exports.actions) expList.push(`Actions: ${n.exports.actions.join(", ")}`);
      if (n.exports.queries) expList.push(`Queries: ${n.exports.queries.join(", ")}`);
      if (expList.length > 0) {
        details += `<br/>Exports: [${expList.join("; ")}]`;
      }
    }
    if (n.metadata?.embedded) {
      details += " (embedded)";
    }
    return `${indent}${n.id}["${details}"]`;
  };

  // Render services as subgraphs
  for (const [svcName, svcNodes] of services.entries()) {
    lines.push(`  subgraph svc_${svcName.replace(/[^a-zA-Z0-9_]/g, "_")} ["Service: ${svcName}"]`);
    for (const n of svcNodes) {
      lines.push(renderNode(n, "    "));
    }
    lines.push("  end");
  }

  for (const n of unassignedNodes) {
    lines.push(renderNode(n, "  "));
  }

  // Render edges
  if (graph.edges.length > 0) {
    lines.push("");
    for (const e of graph.edges) {
      const label = e.label ? `|${e.label}|` : "";
      switch (e.type) {
        case "dependsOn":
          lines.push(`  ${e.from} -->${label} ${e.to}`);
          break;
        case "event":
          lines.push(`  ${e.from} -.->${label} ${e.to}`);
          break;
        case "uses":
          lines.push(`  ${e.from} ==>${label} ${e.to}`);
          break;
        case "embedded":
          lines.push(`  ${e.from} *--${label} ${e.to}`);
          break;
        case "reference":
        default:
          lines.push(`  ${e.from} -->${label} ${e.to}`);
          break;
      }
    }
  }

  return lines.join("\n");
}

function resolveManifest(pathStr: string): string | undefined {
  const target = resolve(pathStr);
  if (existsSync(target) && statSync(target).isFile()) return target;
  if (existsSync(target) && statSync(target).isDirectory()) {
    for (const name of MANIFEST_NAMES) {
      const candidate = join(target, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function readTopology(sourcePath: string): DeploymentTopology | undefined {
  for (const dir of [dirname(sourcePath), join(dirname(sourcePath), basename(dirname(sourcePath)))]) {
    const candidate = join(dir, "deploy.kerangka.json");
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, "utf8")) as DeploymentTopology;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
