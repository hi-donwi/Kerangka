import type { StudioResponse } from "../../../packages/studio-server/src/contracts.js";
import { summarizeOpenApi } from "./context-openapi.js";
import { summarizeUidlDocument } from "./context-uidl.js";

export type ContextViewKind = "overview" | "journey" | "architecture" | "api" | "data";
export type ContextNodeKind = "module" | "journey" | "page" | "operation" | "entity";

export interface ContextAtlasSource {
  id: string;
  label: string;
  path: string;
  revision: string;
  freshness: "current";
}

export interface ContextAtlasNode {
  id: string;
  kind: ContextNodeKind;
  label: string;
  description: string;
  moduleId?: string;
  sourceIds: string[];
  status: "implemented";
  evidence: "declared";
  tags: string[];
  details?: {
    fields?: Array<{ name: string; type: string; required?: boolean }>;
    notes?: string[];
  };
}

export interface ContextAtlasEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  label?: string;
  sourceIds: string[];
  evidence: "declared";
}

export interface ContextAtlasView {
  id: string;
  kind: ContextViewKind;
  label: string;
  description: string;
  nodeIds: string[];
  steps?: Array<{ nodeId: string; label: string; description?: string }>;
}

/**
 * The Studio projection of Context Atlas schema 1.0.
 *
 * This intentionally models only the shared snapshot contract. It does not contain
 * source text, preview rows, raw generated OpenAPI/SQL, or draft mutation callbacks.
 */
export interface ContextAtlasSnapshot {
  schemaVersion: "1.0";
  project: {
    id: string;
    name: string;
    description: string;
    kind: "api" | "website" | "full-stack" | "general";
    capabilities: ContextViewKind[];
    tags: string[];
    version: string;
  };
  sources: ContextAtlasSource[];
  nodes: ContextAtlasNode[];
  edges: ContextAtlasEdge[];
  views: ContextAtlasView[];
}

interface PendingNode extends Omit<ContextAtlasNode, "sourceIds"> {
  sourcePaths: string[];
}

interface PendingEdge extends Omit<ContextAtlasEdge, "sourceIds"> {
  sourcePaths: string[];
}

const moduleId = "module:application";

function encodedId(value: string): string {
  return encodeURIComponent(value);
}

function sourcePath(response: StudioResponse, candidate: string | undefined): string {
  if (candidate && Object.hasOwn(response.bundle.sources, candidate)) return candidate;
  if (Object.hasOwn(response.bundle.sources, response.bundle.entry)) return response.bundle.entry;
  return "";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function buildProjectKind(response: StudioResponse): ContextAtlasSnapshot["project"]["kind"] {
  const hasEntities = Boolean(response.inspection?.entities.length);
  const hasScreens = Boolean(response.inspection?.screens.length);
  if (hasEntities && hasScreens) return "full-stack";
  if (hasEntities) return "api";
  if (hasScreens) return "website";
  return "general";
}

/** Convert a Studio inspection to a metadata-only Context Atlas snapshot. */
export function buildContextAtlasSnapshot(response: StudioResponse): ContextAtlasSnapshot {
  const inspection = response.inspection;
  const pendingNodes: PendingNode[] = [];
  const pendingEdges: PendingEdge[] = [];
  const screenIds = new Map<string, string[]>();
  const operationIds = new Map<string, string[]>();
  const journeyViews: ContextAtlasView[] = [];

  const entryPath = sourcePath(response, response.bundle.entry);
  const addScreenReference = (reference: string, id: string) => {
    const matches = screenIds.get(reference) ?? [];
    if (!matches.includes(id)) screenIds.set(reference, [...matches, id]);
  };
  const resolveScreen = (reference: string | undefined): string | undefined => {
    if (!reference) return undefined;
    const matches = screenIds.get(reference) ?? [];
    return matches.length === 1 ? matches[0] : undefined;
  };
  pendingNodes.push({
    id: moduleId,
    kind: "module",
    label: inspection?.title || inspection?.app || "Project model",
    description: "Read-only map of the project model inspected by Studio.",
    sourcePaths: entryPath ? [entryPath] : [],
    status: "implemented",
    evidence: "declared",
    tags: ["read-only"],
  });

  for (const screen of inspection?.screens ?? []) {
    const id = `page:${encodedId(screen.id)}`;
    const path = sourcePath(response, screen.source);
    const uidl = summarizeUidlDocument(screen.document);
    const route = screen.route || uidl.route || "";
    addScreenReference(screen.id, id);
    addScreenReference(screen.label, id);
    addScreenReference(screen.source, id);
    addScreenReference(screen.source.replace(/(?:\.uidl)?\.(?:json|ya?ml)$/i, ""), id);
    pendingNodes.push({
      id,
      kind: "page",
      label: screen.label,
      description: `Declared ${screen.kind} page${route ? ` at ${route}` : ""}.`,
      moduleId,
      sourcePaths: path ? [path] : [],
      status: "implemented",
      evidence: "declared",
      tags: [screen.kind],
      details: {
        notes: [
          `Route: ${route || "not declared"}`,
          `Source pointer: ${screen.pointer}`,
          ...uidl.notes,
        ],
      },
    });
    if (entryPath) {
      pendingEdges.push({
        id: `contains:${encodedId(id)}`,
        source: moduleId,
        target: id,
        relation: "contains",
        sourcePaths: [entryPath],
        evidence: "declared",
      });
    }
  }

  for (const entity of inspection?.entities ?? []) {
    const id = `entity:${encodedId(entity.name)}`;
    pendingNodes.push({
      id,
      kind: "entity",
      label: entity.name,
      description: "Entity and fields declared by the project model.",
      moduleId,
      sourcePaths: entryPath ? [entryPath] : [],
      status: "implemented",
      evidence: "declared",
      tags: ["data-model"],
      details: {
        fields: entity.fields.map((field) => ({
          name: field.name,
          type: field.type,
          required: field.required,
        })),
        notes: [
          `Source pointer: ${entity.pointer}`,
          ...(entity.workflow ? [`Workflow states: ${entity.workflow.states.join(", ")}`] : []),
          ...(entity.fields.some((field) => field.computed)
            ? [`Computed fields: ${entity.fields.filter((field) => field.computed).map((field) => field.name).join(", ")}`]
            : []),
        ],
      },
    });
    if (entryPath) {
      pendingEdges.push({
        id: `contains:${encodedId(id)}`,
        source: moduleId,
        target: id,
        relation: "contains",
        sourcePaths: [entryPath],
        evidence: "declared",
      });
    }

    for (const operation of entity.operations) {
      const operationId = `operation:${encodedId(`${entity.name}.${operation.name}`)}`;
      const notes = [
        `Kind: ${operation.kind}`,
        ...(operation.roles.length ? [`Roles: ${operation.roles.join(", ")}`] : []),
        ...(operation.guarded ? ["Guarded by a declared rule."] : []),
        ...(operation.from?.length && operation.to
          ? [`Transition: ${operation.from.join(", ")} → ${operation.to}`]
          : []),
      ];
      operationIds.set(operation.name, [...(operationIds.get(operation.name) ?? []), operationId]);
      operationIds.set(`${entity.name}.${operation.name}`, [operationId]);
      pendingNodes.push({
        id: operationId,
        kind: "operation",
        label: operation.name,
        description: `Declared ${operation.kind} on ${entity.name}.`,
        moduleId,
        sourcePaths: entryPath ? [entryPath] : [],
        status: "implemented",
        evidence: "declared",
        tags: [operation.kind],
        details: { notes },
      });
      if (entryPath) {
        pendingEdges.push({
          id: `defines:${encodedId(operationId)}`,
          source: id,
          target: operationId,
          relation: "defines",
          sourcePaths: [entryPath],
          evidence: "declared",
        });
      }
    }
  }

  const entityNames = new Set((inspection?.entities ?? []).map((entity) => entity.name));
  for (const endpoint of summarizeOpenApi(inspection?.outputs.openapi ?? "", entityNames)) {
    const endpointId = `operation:http:${encodedId(`${endpoint.method}:${endpoint.path}`)}`;
    const entityId = endpoint.entityName ? `entity:${encodedId(endpoint.entityName)}` : undefined;
    const domainOperationId = endpoint.entityName && endpoint.actionName
      ? operationIds.get(`${endpoint.entityName}.${endpoint.actionName}`)?.[0]
      : undefined;
    pendingNodes.push({
      id: endpointId,
      kind: "operation",
      label: `${endpoint.method.toUpperCase()} ${endpoint.path}`,
      description: "Generated REST endpoint from the inspected project model.",
      moduleId,
      sourcePaths: entryPath ? [entryPath] : [],
      status: "implemented",
      evidence: "declared",
      tags: ["http", endpoint.method, ...(endpoint.entityName ? [endpoint.entityName] : [])],
      details: {
        ...(endpoint.requestFields.length ? { fields: endpoint.requestFields } : {}),
        notes: [
          ...endpoint.notes,
          ...(domainOperationId && endpoint.entityName && endpoint.actionName
            ? [`Served by ${endpoint.entityName}.${endpoint.actionName}`]
            : []),
        ],
      },
    });
    if (entryPath && entityId) {
      pendingEdges.push({
        id: `exposes:${encodedId(endpointId)}`,
        source: entityId,
        target: endpointId,
        relation: "exposes",
        sourcePaths: [entryPath],
        evidence: "declared",
      });
    }
    if (entryPath && domainOperationId) {
      pendingEdges.push({
        id: `served-by:${encodedId(endpointId)}`,
        source: domainOperationId,
        target: endpointId,
        relation: "served-by",
        sourcePaths: [entryPath],
        evidence: "declared",
      });
    }
  }

  const operationNodeIds = pendingNodes.filter((node) => node.kind === "operation").map((node) => node.id);
  for (const journey of inspection?.journeys ?? []) {
    const id = `journey:${encodedId(journey.id)}`;
    const path = sourcePath(response, journey.source);
    const stepNodeById = new Map<string, string>();
    const resolvedSteps = journey.steps.flatMap((step) => {
      const operationMatches = operationIds.get(step.operation ?? "") ?? [];
      const target = step.kind === "page"
        ? resolveScreen(step.page ?? step.id)
        : operationMatches.length === 1 ? operationMatches[0] : undefined;
      if (!target) return [];
      stepNodeById.set(step.id, target);
      return [{
        nodeId: target,
        label: step.label || step.page || step.operation || step.id,
      }];
    });

    pendingNodes.push({
      id,
      kind: "journey",
      label: journey.name,
      description: "Declared path through project pages and model operations.",
      moduleId,
      sourcePaths: path ? [path] : [],
      status: "implemented",
      evidence: "declared",
      tags: ["journey"],
      details: { notes: [`Entry: ${journey.entry}`, `${journey.steps.length} declared steps`] },
    });
    if (entryPath) {
      pendingEdges.push({
        id: `contains:${encodedId(id)}`,
        source: moduleId,
        target: id,
        relation: "contains",
        sourcePaths: path ? [path] : [entryPath],
        evidence: "declared",
      });
    }

    const entryNode = stepNodeById.get(journey.entry);
    if (entryNode && path) {
      pendingEdges.push({
        id: `starts:${encodedId(id)}`,
        source: id,
        target: entryNode,
        relation: "starts-at",
        sourcePaths: [path],
        evidence: "declared",
      });
    }
    for (const link of journey.links) {
      const from = stepNodeById.get(link.from);
      const to = stepNodeById.get(link.to);
      if (!from || !to || !path) continue;
      pendingEdges.push({
        id: `journey-link:${encodedId(journey.id)}:${encodedId(link.id)}`,
        source: from,
        target: to,
        relation: link.kind || "leads-to",
        label: link.label,
        sourcePaths: [path],
        evidence: "declared",
      });
    }

    journeyViews.push({
      id: `view:${id}`,
      kind: "journey",
      label: journey.name,
      description: "Declared page and operation sequence.",
      nodeIds: unique([id, ...resolvedSteps.map((step) => step.nodeId)]),
      steps: resolvedSteps,
    });
  }

  const sourcePaths = unique(pendingNodes.flatMap((node) => node.sourcePaths).concat(
    pendingEdges.flatMap((edge) => edge.sourcePaths),
  )).sort((left, right) => left.localeCompare(right));
  const sourceIdByPath = new Map(sourcePaths.map((path) => [path, `source:${path}`]));
  const sources: ContextAtlasSource[] = sourcePaths.map((path) => ({
    id: sourceIdByPath.get(path)!,
    label: path,
    path,
    revision: response.bundle.revision,
    freshness: "current",
  }));
  const nodes: ContextAtlasNode[] = pendingNodes.map(({ sourcePaths: paths, ...node }) => ({
    ...node,
    sourceIds: unique(paths.map((path) => sourceIdByPath.get(path)).filter((id): id is string => Boolean(id))),
  }));
  const edges: ContextAtlasEdge[] = pendingEdges.map(({ sourcePaths: paths, ...edge }) => ({
    ...edge,
    sourceIds: unique(paths.map((path) => sourceIdByPath.get(path)).filter((id): id is string => Boolean(id))),
  }));

  const allNodeIds = nodes.map((node) => node.id);
  const architectureNodeIds = nodes
    .filter((node) => ["module", "page", "journey", "entity", "operation"].includes(node.kind) && !node.tags.includes("http"))
    .map((node) => node.id);
  const capabilities: ContextViewKind[] = ["overview", "architecture"];
  const views: ContextAtlasView[] = [
    {
      id: "view:overview",
      kind: "overview",
      label: "Overview",
      description: "Project structure projected from the current Studio inspection.",
      nodeIds: allNodeIds,
    },
    {
      id: "view:architecture",
      kind: "architecture",
      label: "Architecture",
      description: "Pages, journeys, entities, and their declared relationships.",
      nodeIds: architectureNodeIds,
    },
  ];

  if (journeyViews.length) {
    capabilities.push("journey");
    views.push(...journeyViews);
  }
  if (operationNodeIds.length) {
    capabilities.push("api");
    views.push({
      id: "view:api",
      kind: "api",
      label: "API",
      description: "Generated REST endpoints, request and response shapes, and declared model operations.",
      nodeIds: operationNodeIds,
    });
  }
  const entityNodeIds = nodes.filter((node) => node.kind === "entity").map((node) => node.id);
  if (entityNodeIds.length) {
    capabilities.push("data");
    views.push({
      id: "view:data",
      kind: "data",
      label: "Data model",
      description: "Declared entities and field definitions. Generated SQL remains in Studio's database views.",
      nodeIds: entityNodeIds,
    });
  }

  return {
    schemaVersion: "1.0",
    project: {
      id: "kerangka-studio",
      name: inspection?.title || inspection?.app || "Project context",
      description: "A local, read-only Context Atlas projection of the Studio inspection.",
      kind: buildProjectKind(response),
      capabilities,
      tags: ["kerangka-studio", "read-only"],
      version: response.bundle.revision,
    },
    sources,
    nodes,
    edges,
    views,
  };
}
