import type { JourneyInfo } from "../../../packages/studio-server/src/contracts.js";

/**
 * A journey, as a graph.
 *
 * The journey names steps and links; the canvas draws them. A step is either a page
 * that exists or an operation the model declares, and a link is where a connection is
 * realized. The canvas invents nothing: a step that names a page the project does not
 * have is still drawn, because the journey's own diagnostics say so, and hiding it
 * would hide the problem.
 */

export interface JourneyNode {
  id: string;
  label: string;
  kind: "page" | "operation" | "annotation";
  detail: string;
}

export interface JourneyEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  label: string;
}

export interface JourneyGraph {
  id: string;
  name: string;
  entry: string;
  nodes: JourneyNode[];
  edges: JourneyEdge[];
}

const KIND_LABELS: Record<string, string> = {
  action: "action",
  navigation: "navigation",
  annotation: "annotation",
};

export function journeyGraph(journey: JourneyInfo): JourneyGraph {
  return {
    id: journey.id,
    name: journey.name,
    entry: journey.entry,
    nodes: journey.steps.map((step) => ({
      id: step.id,
      label: step.label ?? step.id,
      kind: step.kind,
      detail: step.page ? `page: ${step.page}` : step.operation ? `operation: ${step.operation}` : "annotation",
    })),
    edges: journey.links.map((link) => ({
      id: link.id,
      from: link.from,
      to: link.to,
      kind: link.kind,
      label: link.label ?? KIND_LABELS[link.kind] ?? link.kind,
    })),
  };
}

export const JOURNEY_COLUMN_WIDTH = 240;
export const JOURNEY_ROW_HEIGHT = 110;

/**
 * The position of every step.
 *
 * The entry is placed first, and the steps that follow it are placed in order of
 * appearance, so the journey reads in the order the author wrote it. A step that
 * leads back to an earlier one is drawn there and not duplicated: a journey may loop.
 */
export function journeyPositions(graph: JourneyGraph): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const order = [graph.entry, ...graph.nodes.map((node) => node.id)].filter(
    (id, index, all) => id && all.indexOf(id) === index,
  );
  order.forEach((id, index) => {
    positions.set(id, {
      x: (index % 4) * (JOURNEY_COLUMN_WIDTH + 40),
      y: Math.floor(index / 4) * JOURNEY_ROW_HEIGHT,
    });
  });
  return positions;
}
