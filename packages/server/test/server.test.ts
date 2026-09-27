import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kerangka/compiler";
import { MemoryStore } from "@kerangka/ports";
import { KerangkaServer } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const invoicingPath = path.resolve(__dirname, "../../../examples/invoicing.kerangka.json");
const invoicingSource = fs.readFileSync(invoicingPath, "utf-8");

describe("KerangkaServer (Dev Server & REST/MCP/UIDL Runtime)", () => {
  const kir = compile(invoicingSource);
  const port = 3987;
  const baseUrl = `http://localhost:${port}`;
  let server: KerangkaServer;

  beforeAll(async () => {
    server = new KerangkaServer(kir, {
      port,
      store: new MemoryStore(),
      quiet: true
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("serves OpenAPI 3.1 specification at /openapi.json", async () => {
    const res = await fetch(`${baseUrl}/openapi.json`);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Invoicing");
  });

  it("serves GraphQL schema SDL at /schema.graphql", async () => {
    const res = await fetch(`${baseUrl}/schema.graphql`);
    expect(res.status).toBe(200);
    const sdl = await res.text();
    expect(sdl).toContain("type Invoice {");
    expect(sdl).toContain("type Query {");
  });

  it("serves MCP tools at /api/mcp/tools", async () => {
    const res = await fetch(`${baseUrl}/api/mcp/tools`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools.some((t: any) => t.name === "create_invoice")).toBe(true);
  });

  it("serves UIDL screen documents at /uidl/:docId", async () => {
    const listRes = await fetch(`${baseUrl}/uidl/invoices`);
    expect(listRes.status).toBe(200);
    const listDoc = await listRes.json();
    expect(listDoc.version).toBe("1.0.0");
    expect(listDoc.$schema).toBe("https://uidl.dev/schema/v1/document.schema.json");
    expect(listDoc.route).toBe("/invoices");

    const homeRes = await fetch(`${baseUrl}/uidl/home`);
    expect(homeRes.status).toBe(200);
    const homeDoc = await homeRes.json();
    expect(homeDoc.id).toBe("home");
  });

  it("supports REST CRUD on entities", async () => {
    // 1. Create Customer
    const createRes = await fetch(`${baseUrl}/api/customer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "cust-1",
        name: "Acme Corp",
        email: "billing@acme.com",
        creditLimit: 50000
      })
    });
    expect(createRes.status).toBe(201);
    const customer = await createRes.json();
    expect(customer.id).toBe("cust-1");
    expect(customer.name).toBe("Acme Corp");

    // 2. Read Customer
    const getRes = await fetch(`${baseUrl}/api/customer/cust-1`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.email).toBe("billing@acme.com");

    // 3. List Customers
    const listRes = await fetch(`${baseUrl}/api/customer`);
    expect(listRes.status).toBe(200);
    const items = await listRes.json();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(1);

    // 4. Create and Transition Invoice
    const invoiceRes = await fetch(`${baseUrl}/api/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        number: "INV-001",
        customer: "cust-1",
        issuedOn: "2026-09-27",
        dueDate: "2026-10-15",
        status: "draft",
        lines: [
          { description: "Consulting", qty: 10, unitPrice: 150 }
        ]
      })
    });
    expect(invoiceRes.status).toBe(201);
    const invoice = await invoiceRes.json();
    expect(invoice.total).toBe(1500);
    expect(invoice.status).toBe("draft");

    // Send transition
    const sendRes = await fetch(`${baseUrl}/api/invoice/INV-001/actions/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roles: ["billing"] })
    });
    expect(sendRes.status).toBe(200);
    const sentResult = await sendRes.json();
    expect(sentResult.record.status).toBe("sent");
  });

  it("executes MCP tool calls via /api/mcp/call", async () => {
    const callRes = await fetch(`${baseUrl}/api/mcp/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "get_customer",
        arguments: { id: "cust-1" }
      })
    });
    expect(callRes.status).toBe(200);
    const mcpResponse = await callRes.json();
    expect(mcpResponse.content).toBeDefined();
    expect(mcpResponse.content[0].text).toContain("Acme Corp");
  });

  it("serves playground HTML at root /", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Kerangka Dev Playground");
    expect(html).toContain("Invoicing");
  });
});
