import { describe, expect, it } from "vitest";
import { journeyGraph, journeyPositions } from "./journey-graph.js";
import type { JourneyInfo } from "../../../packages/studio-server/src/contracts.js";

const journey: JourneyInfo = {
  id: "request-approval",
  name: "Synthetic request approval",
  source: "approval.journey.json",
  entry: "requests",
  steps: [
    { id: "requests", kind: "page", page: "requests" },
    { id: "form", kind: "page", page: "request" },
    { id: "submit", kind: "operation", operation: "Request.submit" },
  ],
  links: [
    { id: "create", from: "requests", to: "form", kind: "navigation" },
    { id: "send", from: "form", to: "submit", kind: "action", pointer: "/root/children/0/events/onClick/0" },
  ],
  diagnostics: [],
};

describe("the journey graph", () => {
  it("draws a step for every step the journey declares", () => {
    const graph = journeyGraph(journey);
    expect(graph.nodes.map((node) => node.id)).toEqual(["requests", "form", "submit"]);
    expect(graph.nodes.find((node) => node.id === "submit")).toMatchObject({
      kind: "operation",
      detail: "operation: Request.submit",
    });
    expect(graph.nodes.find((node) => node.id === "requests")?.detail).toBe("page: requests");
  });

  it("draws a link for every link, with the kind it declares", () => {
    const graph = journeyGraph(journey);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.find((edge) => edge.id === "create")).toMatchObject({ from: "requests", to: "form", kind: "navigation" });
  });

  it("places the entry first, and keeps a step that leads back where it was", () => {
    const looping: JourneyInfo = {
      ...journey,
      links: [...journey.links, { id: "back", from: "submit", to: "requests", kind: "navigation" }],
    };
    const graph = journeyGraph(looping);
    const positions = journeyPositions(graph);
    const entry = positions.get("requests")!;
    expect(positions.size).toBe(3);
    expect(positions.get("form")!.x).not.toBe(entry.x);
  });

  it("keeps the journey's own problems visible", () => {
    const broken: JourneyInfo = {
      ...journey,
      diagnostics: [{ code: "STUDIO_JOURNEY_PAGE_UNKNOWN", message: "The page 'missing' is not in the manifest." }],
    };
    expect(journeyGraph(broken).nodes).toHaveLength(3);
    expect(broken.diagnostics).toHaveLength(1);
  });
});
