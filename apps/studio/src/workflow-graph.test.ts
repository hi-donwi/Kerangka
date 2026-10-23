import { describe, expect, it } from "vitest";
import { workflowDepths, workflowGraph, workflowPositions } from "./workflow-graph.js";
import type { EntityInfo } from "../../../packages/studio-server/src/contracts.js";

const entity: EntityInfo = {
  name: "Request",
  pointer: "/entities/Request",
  fields: [{ name: "status", type: "enum", required: true, computed: false }],
  workflow: { states: ["draft", "submitted", "approved", "rejected"], initial: "draft", terminal: ["approved", "rejected"] },
  operations: [
    { name: "submit", kind: "transition", roles: ["employee"], from: ["draft"], to: "submitted", guarded: true },
    { name: "approve", kind: "transition", roles: ["manager"], from: ["submitted"], to: "approved", guarded: false },
    { name: "reject", kind: "transition", roles: ["manager"], from: ["submitted"], to: "rejected", guarded: false },
    { name: "recall", kind: "transition", roles: ["employee"], from: ["submitted"], to: "draft", guarded: false },
    { name: "archive", kind: "action", roles: [], guarded: false },
  ],
};

describe("the workflow graph", () => {
  it("takes the states and the transitions from the model, not from the canvas", () => {
    const graph = workflowGraph(entity);
    expect(graph.entity).toBe("Request");
    expect(graph.states.map((state) => state.id)).toEqual(["draft", "submitted", "approved", "rejected"]);
    expect(graph.transitions.map((transition) => transition.id)).toEqual([
      "Request.submit.draft",
      "Request.approve.submitted",
      "Request.reject.submitted",
      "Request.recall.submitted",
    ]);
  });

  it("takes the initial and the terminal states from the model, not from the transitions", () => {
    const graph = workflowGraph(entity);
    // A cycle leads back into "draft", so the transitions alone would say that no
    // state is initial. The model says which one it is.
    expect(graph.states.find((state) => state.id === "draft")?.initial).toBe(true);
    expect(graph.states.find((state) => state.id === "approved")?.terminal).toBe(true);
    expect(graph.states.find((state) => state.id === "rejected")?.terminal).toBe(true);
    expect(graph.states.find((state) => state.id === "submitted")?.initial).toBe(false);
    expect(graph.states.find((state) => state.id === "submitted")?.terminal).toBe(false);
  });

  it("keeps a legal cycle, because a state machine may go back", () => {
    const graph = workflowGraph(entity);
    const recall = graph.transitions.find((transition) => transition.id === "Request.recall.submitted");
    expect(recall?.to).toBe("draft");
    expect(graph.states.find((state) => state.id === "draft")?.terminal).toBe(false);
  });

  it("ignores an action that is not a transition", () => {
    expect(workflowGraph(entity).transitions.some((transition) => transition.label === "archive")).toBe(false);
  });

  it("places the states in columns by their depth, so the flow reads left to right", () => {
    const graph = workflowGraph(entity);
    const depths = workflowDepths(graph);
    expect(depths.get("draft")).toBe(0);
    expect(depths.get("submitted")).toBe(1);
    expect(depths.get("approved")).toBe(2);
    const positions = workflowPositions(graph);
    expect(positions.get("draft")!.x).toBeLessThan(positions.get("submitted")!.x);
    expect(positions.get("submitted")!.x).toBeLessThan(positions.get("approved")!.x);
  });

  it("has nothing to draw for an entity without a workflow", () => {
    const plain: EntityInfo = { ...entity, operations: [] };
    expect(workflowGraph(plain).states).toEqual([]);
  });
});
