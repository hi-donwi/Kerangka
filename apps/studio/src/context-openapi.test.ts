import { describe, expect, it } from "vitest";
import { summarizeOpenApi } from "./context-openapi.js";

const contract = JSON.stringify({
  openapi: "3.1.0",
  paths: {
    "/api/request": {
      parameters: [
        {
          name: "tenantId",
          in: "query",
          schema: { type: "string" },
          description: "PRIVATE_PARAMETER_DESCRIPTION",
        },
      ],
      get: {
        operationId: "listRequest",
        tags: ["Request"],
        responses: {
          "200": {
            description: "PRIVATE_RESPONSE_DESCRIPTION",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Request" } },
              },
            },
          },
          "400": { $ref: "#/components/responses/ProblemResponse" },
        },
      },
      post: {
        operationId: "createRequest",
        tags: ["Request"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateRequestRequest" },
              example: { title: "PRIVATE_PAYLOAD_VALUE" },
            },
          },
        },
        responses: {
          "201": {
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Request" } },
            },
          },
        },
      },
    },
    "/api/request/{id}/actions/submit": {
      post: {
        operationId: "request_action_submit",
        tags: ["Request"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { comment: { type: "string", example: "PRIVATE_COMMENT" } },
                required: ["comment"],
              },
            },
          },
        },
        responses: { "200": { description: "accepted" } },
      },
    },
  },
  components: {
    schemas: {
      Request: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string" },
        },
        required: ["id", "title"],
      },
      CreateRequestRequest: {
        type: "object",
        properties: { title: { type: "string" }, status: { type: "string" } },
        required: ["title"],
      },
      ProblemDetails: {
        type: "object",
        properties: { title: { type: "string" }, status: { type: "integer" } },
      },
    },
    responses: {
      ProblemResponse: {
        description: "PRIVATE_ERROR_DESCRIPTION",
        content: {
          "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } },
        },
      },
    },
  },
});

describe("OpenAPI context summaries", () => {
  it("projects endpoint methods, paths, parameters, payload fields, and response shapes", () => {
    const endpoints = summarizeOpenApi(contract, new Set(["Request"]));

    expect(endpoints).toHaveLength(3);
    expect(endpoints[0]).toMatchObject({
      method: "get",
      path: "/api/request",
      entityName: "Request",
      notes: expect.arrayContaining([
        "Endpoint: GET /api/request",
        "Operation: listRequest",
        "Parameters: tenantId (query, string)",
        "Response 200: array<Request> (id: string [required], title: string [required], status: string)",
        "Response 400: ProblemDetails (title: string, status: integer), application/problem+json",
      ]),
    });
    expect(endpoints[1]?.requestFields).toEqual([
      { name: "title", type: "string", required: true },
      { name: "status", type: "string", required: false },
    ]);
    expect(endpoints[1]?.requestBodyRequired).toBe(true);
    expect(endpoints[1]?.notes).toContain("Request body: required");
    expect(endpoints[2]).toMatchObject({ actionName: "submit", entityName: "Request" });

    const serialized = JSON.stringify(endpoints);
    expect(serialized).not.toContain("PRIVATE_");
  });

  it("ignores malformed or non-object generated documents", () => {
    expect(summarizeOpenApi("not-json", new Set())).toEqual([]);
    expect(summarizeOpenApi(JSON.stringify({ paths: [] }), new Set())).toEqual([]);
  });
});
