import { describe, expect, it } from "vitest";
import type { StudioResponse } from "../../../packages/studio-server/src/contracts.js";
import { buildContextAtlasSnapshot } from "./context-atlas.js";

function studioResponse(): StudioResponse {
  return {
    bundle: {
      kind: "kerangka.studio.source",
      version: "0.1",
      revision: "revision-sample-1",
      entry: "app.json",
      sources: {
        "app.json": { format: "json", text: "PRIVATE_SOURCE_SENTINEL" },
        "pages/requests.uidl.json": { format: "json", text: "PRIVATE_PAGE_SENTINEL" },
        "journeys/submit.json": { format: "json", text: "PRIVATE_JOURNEY_SENTINEL" },
      },
      application: {
        pages: { Requests: { mode: "recipe", view: "Requests" } },
        routes: [{ id: "requests", path: "/requests", page: "Requests", access: "session" }],
        preview: { profile: "read", data: "synthetic" },
      },
    },
    inspection: {
      app: "sample-app",
      title: "Synthetic workspace",
      roles: ["operator"],
      entities: [
        {
          name: "Request",
          pointer: "/entities/Request",
          fields: [{ name: "title", type: "string", required: true, computed: false }],
          operations: [{ name: "submit", kind: "action", roles: ["operator"], guarded: true }],
        },
      ],
      screens: [
        {
          id: "request-list",
          label: "Request list",
          kind: "list",
          route: "/requests",
          source: "pages/requests.uidl.json",
          pointer: "/",
          document: { root: { id: "request-root", type: "Container" } },
        },
      ],
      journeys: [
        {
          id: "request-submit",
          name: "Submit request",
          source: "journeys/submit.json",
          entry: "request-list",
          steps: [
            { id: "open", kind: "page", page: "request-list", label: "Open request list" },
            { id: "submit", kind: "operation", operation: "Request.submit" },
          ],
          links: [{ id: "flow", from: "open", to: "submit", kind: "action" }],
          diagnostics: [],
        },
      ],
      synthetic: { Request: [{ title: "PRIVATE_ROW_SENTINEL" }] },
      outputs: {
        openapi: "PRIVATE_OPENAPI_SENTINEL",
        postgres: "PRIVATE_POSTGRES_SENTINEL",
        sqlite: "PRIVATE_SQLITE_SENTINEL",
      },
      sandbox: { filesystemWrites: false, childProcesses: false },
    },
    diagnostics: [],
    excluded: 0,
    writable: false,
  };
}

describe("Context Atlas projection", () => {
  it("projects declared pages, journeys, operations, and entities into linked views", () => {
    const snapshot = buildContextAtlasSnapshot(studioResponse());
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));

    expect(snapshot.schemaVersion).toBe("1.0");
    expect(snapshot.project.kind).toBe("full-stack");
    expect(snapshot.views.map((view) => view.kind)).toEqual([
      "overview",
      "architecture",
      "journey",
      "api",
      "data",
    ]);
    expect(snapshot.nodes.find((node) => node.id === "entity:Request")?.details?.fields).toEqual([
      { name: "title", type: "string", required: true },
    ]);
    expect(snapshot.edges.some((edge) => edge.source === "entity:Request" && edge.target === "operation:Request.submit")).toBe(true);
    expect(snapshot.views.flatMap((view) => view.nodeIds).every((id) => nodeIds.has(id))).toBe(true);
    expect(snapshot.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))).toBe(true);
    expect(snapshot.nodes.flatMap((node) => node.sourceIds).every((id) => snapshot.sources.some((source) => source.id === id))).toBe(true);
  });

  it("keeps the map metadata-only and never copies source text, sample rows, or generated outputs", () => {
    const snapshot = buildContextAtlasSnapshot(studioResponse());
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain("PRIVATE_");
    expect(snapshot.sources.map((source) => source.path)).toEqual([
      "app.json",
      "journeys/submit.json",
      "pages/requests.uidl.json",
    ]);
    expect(snapshot.sources.every((source) => source.revision === "revision-sample-1")).toBe(true);
  });

  it("produces the same node and source identifiers for the same inspection", () => {
    const first = buildContextAtlasSnapshot(studioResponse());
    const second = buildContextAtlasSnapshot(studioResponse());

    expect(second.nodes.map((node) => node.id)).toEqual(first.nodes.map((node) => node.id));
    expect(second.sources.map((source) => source.id)).toEqual(first.sources.map((source) => source.id));
  });
});
