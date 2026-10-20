import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compile,
  generateOpenAPI,
  generateGraphQL,
  generateMcpTools,
  generateUIDL,
  UIDLGenerator,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoicingPath = path.resolve(__dirname, "../../../examples/invoicing.kerangka.json");
const invoicingSource = fs.readFileSync(invoicingPath, "utf-8");

describe("Kerangka Projections", () => {
  const kir = compile(invoicingSource);

  describe("OpenAPI 3.1 Projection", () => {
    it("generates valid OpenAPI 3.1.0 specification object", () => {
      const openapi = generateOpenAPI(kir, { serverUrl: "https://api.example.com" }) as any;

      expect(openapi.openapi).toBe("3.1.0");
      expect(openapi.info.title).toBe("Invoicing");
      expect(openapi.servers[0].url).toBe("https://api.example.com");

      // Components schemas
      expect(openapi.components.schemas.Invoice).toBeDefined();
      expect(openapi.components.schemas.Customer).toBeDefined();
      expect(openapi.components.schemas.Line).toBeDefined();
      expect(openapi.components.schemas.ProblemDetails).toBeDefined();
      expect(openapi.components.schemas.CreateInvoiceRequest).toBeDefined();

      // Embedded entity Line should not have top-level paths
      expect(openapi.paths["/api/line"]).toBeUndefined();

      // Entity paths
      expect(openapi.paths["/api/invoice"]).toBeDefined();
      expect(openapi.paths["/api/invoice"].get).toBeDefined();
      expect(openapi.paths["/api/invoice"].post).toBeDefined();
      expect(openapi.paths["/api/invoice/events"].get).toBeDefined();
      expect(openapi.paths["/api/invoice/events"].get.responses["200"].content["text/event-stream"]).toBeDefined();
      expect(openapi.paths["/api/invoice"].get.parameters.map((parameter: any) => parameter.name)).toEqual(
        expect.arrayContaining(["sort", "where", "search"]),
      );
      expect(openapi.paths["/api/invoice/{id}"]).toBeDefined();
      expect(openapi.paths["/api/invoice/{id}"].get).toBeDefined();
      expect(openapi.paths["/api/invoice/{id}"].put).toBeDefined();
      expect(openapi.paths["/api/invoice/{id}"].delete).toBeDefined();

      // Workflow transition paths
      expect(openapi.paths["/api/invoice/{id}/actions/send"]).toBeDefined();
      expect(openapi.paths["/api/invoice/{id}/actions/pay"]).toBeDefined();
      expect(openapi.paths["/api/invoice/{id}/actions/void"]).toBeDefined();
    });

    it("emits operational routes when includeOperationalRoutes is true", () => {
      const openapi = generateOpenAPI(kir, { includeOperationalRoutes: true }) as any;

      expect(openapi.paths["/api/events"]).toBeDefined();
      expect(openapi.paths["/api/events"].get.operationId).toBe("listOutboxEvents");
      expect(openapi.paths["/api/events/{id}/ack"]).toBeDefined();
      expect(openapi.paths["/api/events/{id}/nack"]).toBeDefined();

      expect(openapi.paths["/api/effects"]).toBeDefined();
      expect(openapi.paths["/api/effects"].get.operationId).toBe("listUndeliveredEffects");
      expect(openapi.paths["/api/effects/{id}/ack"]).toBeDefined();
      expect(openapi.paths["/api/effects/{id}/nack"]).toBeDefined();

      expect(openapi.paths["/api/mcp"]).toBeDefined();
      expect(openapi.paths["/api/mcp"].get.operationId).toBe("listMcpTools");
      expect(openapi.paths["/api/mcp"].post.operationId).toBe("callMcpTool");

      expect(openapi.components.schemas.CloudEvent).toBeDefined();
      expect(openapi.components.schemas.ConnectorEffect).toBeDefined();
    });
  });

  describe("GraphQL SDL Projection", () => {
    it("generates GraphQL SDL with types, queries, and mutations", () => {
      const sdl = generateGraphQL(kir);

      expect(sdl).toContain("type Invoice {");
      expect(sdl).toContain("type Customer {");
      expect(sdl).toContain("type Line {");
      expect(sdl).toContain("input CreateInvoiceInput {");
      expect(sdl).toContain("type Query {");
      expect(sdl).toContain("listInvoice(filter: InvoiceFilterInput, limit: Int, offset: Int): [Invoice!]!");
      expect(sdl).toContain("getInvoice(id: ID!): Invoice");
      expect(sdl).toContain("type Mutation {");
      expect(sdl).toContain("createInvoice(input: CreateInvoiceInput!): Invoice!");
      expect(sdl).toContain("invoiceSend(id: ID!): Invoice!");
      expect(sdl).toContain("invoicePay(id: ID!): Invoice!");
    });
  });

  describe("Model Context Protocol (MCP) Projection", () => {
    it("generates MCP tool definitions with schemas", () => {
      const tools = generateMcpTools(kir);
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain("list_invoice");
      expect(toolNames).toContain("get_invoice");
      expect(toolNames).toContain("create_invoice");
      expect(toolNames).toContain("update_invoice");
      expect(toolNames).toContain("delete_invoice");
      expect(toolNames).toContain("transition_invoice_send");
      expect(toolNames).toContain("transition_invoice_pay");

      const createTool = tools.find(t => t.name === "create_invoice");
      expect(createTool).toBeDefined();
      expect(createTool?.inputSchema.type).toBe("object");
      expect(createTool?.inputSchema.properties.customer).toBeDefined();
      expect(createTool?.inputSchema.properties.dueDate).toBeDefined();
    });
  });

  describe("UIDL Screen Projection", () => {
    it("generates UIDL documents compliant with UIDL-Runtime schema", () => {
      const docs = generateUIDL(kir);
      const findNode = (node: any, pred: (n: any) => boolean): any =>
        pred(node) ? node : (node.children ?? []).map((c: any) => findNode(c, pred)).find(Boolean);

      // A dashboard is not a static document. Emitting one showed the first row as a sum and
      // dropped a where the generator could not lower.
      expect(docs["home"]).toBeUndefined();
      expect(JSON.stringify(docs)).not.toContain("rows[0]");
      expect(UIDLGenerator.refusedDashboards(kir)).toEqual([
        expect.objectContaining({
          viewId: "home",
          screen: "/screens/home",
          code: "DASHBOARD_NOT_STATIC",
        }),
      ]);

      // Invoices list
      const listDoc = docs["invoices"]!;
      expect(listDoc).toBeDefined();
      expect(listDoc.version).toBe("1.0.0");
      expect(listDoc.route).toBe("/invoices");
      expect(listDoc.layout).toEqual({
        container: "constrained",
        maxWidth: "80rem",
        padding: "responsive",
      });
      const itemsQuery = (listDoc.dataSources as any)?.items?.["$query"];
      expect(itemsQuery?.collection).toBe("Invoice");
      expect(itemsQuery?.page?.number).toEqual({ $bind: "state.page" });
      const tableNode = findNode(listDoc.root, (n) => n.type === "DataTable");
      expect(tableNode).toBeDefined();

      // Invoice form
      const formDoc = docs["invoice"]!;
      expect(formDoc).toBeDefined();
      expect(formDoc.version).toBe("1.0.0");
      expect(formDoc.route).toBe("/invoice/:id");
      expect(formDoc.layout).toEqual({
        container: "constrained",
        maxWidth: "80rem",
        padding: "responsive",
      });
      const recordQuery = (formDoc.dataSources as any)?.record?.["$query"];
      expect(recordQuery?.filters).toEqual([{ field: "id", op: "eq", value: { $bind: "state.params.id" } }]);

      // No invented navigation shell: nav lives as a Navbar inside each document.
      expect(docs["navigation-shell"]).toBeUndefined();
    });

    it("generates dynamic dashboard document when includeDynamicDashboards is true", () => {
      const docs = generateUIDL(kir, { includeDynamicDashboards: true });
      expect(docs["home"]).toBeDefined();
      const homeDoc = docs["home"]!;
      expect(homeDoc.layout?.container).toBe("constrained");
      expect(homeDoc.dataSources?.dashboard).toEqual({
        $query: { endpoint: "/screens/home" },
      });
      expect(UIDLGenerator.refusedDashboards(kir, { includeDynamicDashboards: true })).toEqual([]);
    });

    it("merges overlays cleanly onto base documents", () => {
      const listDoc = generateUIDL(kir)["invoices"]!;
      const overlay = {
        name: "Custom Invoices Title",
        layout: { maxWidth: "96rem" },
        state: { customFilter: "active" },
      };
      const merged = UIDLGenerator.mergeOverlay(listDoc, overlay);
      expect(merged.name).toBe("Custom Invoices Title");
      expect(merged.layout?.maxWidth).toBe("96rem");
      expect(merged.layout?.container).toBe("constrained");
      expect(merged.state?.customFilter).toBe("active");
      expect(merged.state?.page).toBe(1);
    });
  });

  /**
   * The emitted document is about the model. The served one is about a running server, and
   * carries the operational routes a deployment has — `/api/events` and `/api/effects` only
   * when a session is configured. Those live in `packages/server`, and it matters that they
   * stay there: an emitted document is a file a consumer generates a client from, and
   * advertising `/api/events` to someone who then runs the model with no session would be a
   * promise the code cannot keep.
   */
  describe("the emitted document describes the model, not a deployment", () => {
    it("carries no operational routes", () => {
      const spec = generateOpenAPI(kir) as {
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      };
      for (const path of Object.keys(spec.paths)) {
        expect(path, `${path} is a deployment route, not a model one`).toMatch(
          /^\/api\/[a-z]/
        );
        expect(path).not.toMatch(/mcp|effects/i);
      }
    });

    it("carries no queue or MCP schemas", () => {
      const spec = generateOpenAPI(kir) as {
        components: { schemas: Record<string, unknown> };
      };
      expect(spec.components.schemas).not.toHaveProperty("OutboxEntry");
      expect(spec.components.schemas).not.toHaveProperty("HostEffectEntry");
    });
  });
});
