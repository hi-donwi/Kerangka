import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

/**
 * The workflow of one entity, as a graph.
 *
 * The states and the transitions come from the model, not from the canvas: the console
 * draws what the model declares and invents nothing. A transition that leads back to
 * an earlier state is legal and is drawn as such, because a state machine is allowed
 * to cycle.
 */

export interface WorkflowState {
  id: string;
  label: string;
  initial: boolean;
  terminal: boolean;
}

export interface WorkflowTransition {
  id: string;
  from: string;
  to: string;
  label: string;
  roles: string[];
  guarded: boolean;
}

export interface WorkflowGraph {
  entity: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
}

export function workflowGraph(entity: EntityInfo): WorkflowGraph {
  const transitions: WorkflowTransition[] = entity.operations
    .filter((operation) => operation.kind === "transition")
    .flatMap((operation) =>
      // A transition without a target cannot be drawn, and a state machine that
      // declares one is a model problem the compiler reports, not the console.
      operation.to
        ? (operation.from ?? []).map((from) => ({
            id: `${entity.name}.${operation.name}.${from}`,
            from,
            to: operation.to as string,
            label: operation.name,
            roles: operation.roles,
            guarded: operation.guarded,
          }))
        : [],
    );

  const order: string[] = [];
  for (const transition of transitions) {
    for (const state of [transition.from, transition.to]) {
      if (!order.includes(state)) order.push(state);
    }
  }
  const hasIncoming = new Set(transitions.map((transition) => transition.to));
  const hasOutgoing = new Set(transitions.map((transition) => transition.from));
  const declared = entity.workflow;
  // The model says which state is initial and which are terminal. Guessing from the
  // transitions would be wrong for a machine that leads back to an earlier state.
  const initialStates = new Set(declared?.initial ? [declared.initial] : []);
  const terminalStates = new Set(declared?.terminal ?? []);

  return {
    entity: entity.name,
    states: order.map((id) => ({
      id,
      label: id,
      initial: initialStates.size ? initialStates.has(id) : !hasIncoming.has(id),
      terminal: terminalStates.size ? terminalStates.has(id) : !hasOutgoing.has(id),
    })),
    transitions,
  };
}

/**
 * The depth of every state, from the states nothing leads into.
 *
 * The depth decides the column a state is drawn in, so a workflow reads left to right
 * the way the model does. A cycle has no depth to give it, so it keeps the depth of
 * the state it was reached from.
 */
export function workflowDepths(graph: WorkflowGraph): Map<string, number> {
  const depths = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const transition of graph.transitions) {
    incoming.set(transition.to, [...(incoming.get(transition.to) ?? []), transition.from]);
  }
  const roots = graph.states.filter((state) => state.initial).map((state) => state.id);
  const queue = roots.length ? roots : graph.states.slice(0, 1).map((state) => state.id);
  for (const root of queue) depths.set(root, 0);
  let index = 0;
  while (index < queue.length) {
    const current = queue[index++]!;
    const depth = depths.get(current) ?? 0;
    for (const transition of graph.transitions) {
      if (transition.from !== current) continue;
      if (depths.has(transition.to)) continue;
      depths.set(transition.to, depth + 1);
      queue.push(transition.to);
    }
  }
  // A state in a cycle that no root reaches still needs a place to be drawn.
  for (const state of graph.states) {
    if (!depths.has(state.id)) depths.set(state.id, 0);
  }
  return depths;
}

export const COLUMN_WIDTH = 220;
export const ROW_HEIGHT = 96;

/** The position of every state, so the canvas opens on a readable flow. */
export function workflowPositions(graph: WorkflowGraph): Map<string, { x: number; y: number }> {
  const depths = workflowDepths(graph);
  const byDepth = new Map<number, string[]>();
  for (const state of graph.states) {
    const depth = depths.get(state.id) ?? 0;
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), state.id]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [depth, states] of byDepth) {
    states.forEach((state, row) => {
      positions.set(state, {
        x: depth * (COLUMN_WIDTH + 60),
        y: row * ROW_HEIGHT,
      });
    });
  }
  return positions;
}
