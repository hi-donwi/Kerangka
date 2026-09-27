import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compile,
  generateOpenAPI,
  generateGraphQL,
  generateMcpTools,
  generateUIDL
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
      expect(openapi.paths["/api/invoice/{id}"]).toBeDefined();
      expect(openapi.paths["/api/invoice/{id}"].get).toBeDefined();
      expect(openapi.paths["/api/invoice/{id}"].put).toBeDefined();
      expect(openapi.paths["/api/invoice/{id}"].delete).toBeDefined();

      // Workflow transition paths
      expect(openapi.paths["/api/invoice/{id}/actions/send"]).toBeDefined();
      expect(openapi.paths["/api/invoice/{id}/actions/pay"]).toBeDefined();
      expect(openapi.paths["/api/invoice/{id}/actions/void"]).toBeDefined();
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

      // Home dashboard
      const homeDoc = docs["home"]!;
      expect(homeDoc).toBeDefined();
      expect(homeDoc.version).toBe("1.0.0");
      expect(homeDoc.$schema).toBe("https://uidl.dev/schema/v1/document.schema.json");
      expect(homeDoc.route).toBe("/");
      expect(homeDoc.root.type).toBe("Container");
      expect(homeDoc.root.children?.length).toBeGreaterThan(0);

      // Invoices list
      const listDoc = docs["invoices"]!;
      expect(listDoc).toBeDefined();
      expect(listDoc.version).toBe("1.0.0");
      expect(listDoc.route).toBe("/invoices");
      expect(listDoc.dataSources?.items).toBeDefined();
      const tableNode = listDoc.root.children?.find(c => c.type === "Table");
      expect(tableNode).toBeDefined();

      // Invoice form
      const formDoc = docs["invoice"]!;
      expect(formDoc).toBeDefined();
      expect(formDoc.version).toBe("1.0.0");
      expect(formDoc.route).toBe("/invoice/:id");
      expect(formDoc.dataSources?.record).toBeDefined();

      // Navigation shell
      const navDoc = docs["navigation-shell"]!;
      expect(navDoc).toBeDefined();
      expect(navDoc.version).toBe("1.0.0");
      expect(navDoc.root.type).toBe("AppShell");
    });
  });
});
