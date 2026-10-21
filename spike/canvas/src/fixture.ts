/**
 * One controlled fixture for both candidates.
 *
 * A spike that measures two different graphs measures nothing. Both candidates get the
 * same nodes, the same edges, the same positions, and the same events, so the only
 * difference left is the canvas.
 *
 * Two graphs matter, because they have different legality:
 *
 * - `workflow`: a state machine. A transition back to an earlier state is legal, so a
 *   canvas that refuses cycles refuses a legal model.
 * - `containment`: a UI tree. A node belongs to one parent, so a cycle is a defect and
 *   a second parent is a defect too.
 */

export interface SpikeNode {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface SpikeEdge {
  id: string;
  from: string;
  to: string;
}

export interface SpikeGraph {
  nodes: SpikeNode[];
  edges: SpikeEdge[];
}

/** A deterministic generator, so two runs measure the same graph. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLUMNS = 25;
const COLUMN_WIDTH = 220;
const ROW_HEIGHT = 120;

function positions(count: number): SpikeNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    x: (index % COLUMNS) * COLUMN_WIDTH,
    y: Math.floor(index / COLUMNS) * ROW_HEIGHT,
    label: `State ${index}`,
  }));
}

/** A state machine with forward transitions, back transitions, and a legal cycle. */
export function workflowGraph(nodeCount = 250, edgeCount = 500): SpikeGraph {
  const nodes = positions(nodeCount);
  const random = generator(20261021);
  const edges: SpikeEdge[] = [];
  for (let index = 0; index + 1 < nodeCount; index++) {
    edges.push({ id: `e${edges.length}`, from: `n${index}`, to: `n${index + 1}` });
  }
  while (edges.length < edgeCount) {
    const from = Math.floor(random() * nodeCount);
    const to = Math.floor(random() * nodeCount);
    if (from === to) continue;
    edges.push({ id: `e${edges.length}`, from: `n${from}`, to: `n${to}` });
  }
  return { nodes, edges };
}

/** A UI containment tree: every node has one parent, so no cycle is legal. */
export function containmentGraph(nodeCount = 250): SpikeGraph {
  const nodes = positions(nodeCount);
  const edges: SpikeEdge[] = [];
  for (let index = 1; index < nodeCount; index++) {
    edges.push({ id: `e${edges.length}`, from: `n${Math.floor((index - 1) / 3)}`, to: `n${index}` });
  }
  return { nodes, edges };
}
