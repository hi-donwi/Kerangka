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
          document: {
            route: "/requests",
            root: {
              id: "request-root",
              type: "Container",
              children: [
                { id: "request-title", type: "Text", props: { value: "PRIVATE_UIDL_TEXT" } },
                { id: "submit-request", type: "Button", events: { onClick: [{ api: { url: "PRIVATE_UIDL_URL" } }] } },
              ],
            },
          },
        },
      ],
      journeys: [
        {
          id: "request-submit",
          name: "Submit request",
          source: "journeys/submit.json",
          entry: "open",
          steps: [
            { id: "open", kind: "page", page: "Request list", label: "Open request list" },
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
    expect(snapshot.edges.some((edge) => edge.source === "journey:request-submit" && edge.target === "page:request-list" && edge.relation === "starts-at")).toBe(true);
    expect(snapshot.edges.some((edge) => edge.source === "page:request-list" && edge.target === "operation:Request.submit")).toBe(true);
    const page = snapshot.nodes.find((node) => node.id === "page:request-list");
    expect(page?.details?.notes).toContain("UIDL: Container [request-root]");
    expect(page?.details?.notes).toContain("UIDL:   Text [request-title]");
    expect(page?.details?.notes).toContain("UIDL:     events: onClick");
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

  it("maps generated HTTP endpoint and payload shapes without copying the OpenAPI document", () => {
    const response = studioResponse();
    response.inspection!.outputs.openapi = JSON.stringify({
      paths: {
        "/api/request": {
          get: {
            operationId: "listRequest",
            tags: ["Request"],
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { type: "array", items: { $ref: "#/components/schemas/Request" } },
                  },
                },
              },
            },
          },
          post: {
            operationId: "createRequest",
            tags: ["Request"],
            requestBody: {
              required: true,
              content: { "application/json": { schema: { $ref: "#/components/schemas/CreateRequestRequest" } } },
            },
            responses: { "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Request" } } } } },
          },
        },
        "/api/request/{id}/actions/submit": {
          post: {
            operationId: "request_action_submit",
            tags: ["Request"],
            requestBody: {
              content: { "application/json": { schema: { type: "object", properties: { comment: { type: "string" } }, required: ["comment"] } } },
            },
            responses: { "200": { description: "PRIVATE_RESPONSE_DESCRIPTION" } },
          },
        },
      },
      components: {
        schemas: {
          Request: { type: "object", properties: { id: { type: "string" }, title: { type: "string" } }, required: ["id"] },
          CreateRequestRequest: { type: "object", properties: { title: { type: "string" }, status: { type: "string" } }, required: ["title"] },
        },
      },
    });

    const snapshot = buildContextAtlasSnapshot(response);
    const apiView = snapshot.views.find((view) => view.kind === "api");
    const create = snapshot.nodes.find((node) => node.label === "POST /api/request");
    const submit = snapshot.nodes.find((node) => node.label === "POST /api/request/{id}/actions/submit");

    expect(snapshot.project.kind).toBe("full-stack");
    expect(apiView?.nodeIds).toContain(create?.id);
    expect(create?.details?.fields).toEqual([
      { name: "title", type: "string", required: true },
      { name: "status", type: "string", required: false },
    ]);
    expect(create?.details?.notes).toContain("Endpoint: POST /api/request");
    expect(create?.details?.notes).toContain("Response 201: Request (id: string [required], title: string)");
    expect(submit).toBeDefined();
    expect(snapshot.edges.some((edge) => edge.source === "operation:Request.submit" && edge.target === submit?.id && edge.relation === "served-by")).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE_");
  });

  it("classifies API-only and web-only snapshots from their inspected contents", () => {
    const apiResponse = studioResponse();
    apiResponse.inspection!.screens = [];
    apiResponse.inspection!.journeys = [];
    expect(buildContextAtlasSnapshot(apiResponse).project.kind).toBe("api");

    const webResponse = studioResponse();
    webResponse.inspection!.entities = [];
    webResponse.inspection!.journeys = [];
    webResponse.inspection!.outputs.openapi = "{}";
    const webSnapshot = buildContextAtlasSnapshot(webResponse);
    expect(webSnapshot.project.kind).toBe("website");
    expect(webSnapshot.views.some((view) => view.kind === "api")).toBe(false);
    expect(webSnapshot.views.some((view) => view.kind === "data")).toBe(false);
  });
});
