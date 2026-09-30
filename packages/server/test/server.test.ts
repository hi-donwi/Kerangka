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

  it("returns RFC 9457 Problem Details on invalid input", async () => {
    const res = await fetch(`${baseUrl}/api/customer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Missing required 'name'
        creditLimit: 1000
      })
    });
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const problem = await res.json();
    expect(problem.type).toBe("https://kerangka.dev/errors/INPUT_INVALID");
    expect(problem.code).toBe("INPUT_INVALID");
    expect(problem.status).toBe(422);
    expect(problem.title).toBe("Validation Failed");
  });

  it("replays response when Idempotency-Key is provided", async () => {
    const key = "server-idem-key-1";
    const res1 = await fetch(`${baseUrl}/api/customer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key
      },
      body: JSON.stringify({
        id: "cust-idem-1",
        name: "Idempotent Corp",
        email: "idem@corp.com"
      })
    });
    expect(res1.status).toBe(201);
    const body1 = await res1.json();

    const res2 = await fetch(`${baseUrl}/api/customer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key
      },
      body: JSON.stringify({
        id: "cust-idem-1",
        name: "Idempotent Corp",
        email: "idem@corp.com"
      })
    });
    expect(res2.status).toBe(201);
    expect(res2.headers.get("x-cache-lookup")).toBe("HIT");
    const body2 = await res2.json();
    expect(body2).toEqual(body1);
  });

  /**
   * The emitted document is what a client generates code from, so it has to describe
   * the body the server actually sends. These two sites used to disagree: both action
   * endpoints declared `200: $ref → the entity`, while the server returns an envelope.
   * A generated client compiled against that document and then read a field the server
   * never sent.
   *
   * Comparing a live response against the document is the only form of this check that
   * cannot go stale: it fails when either side moves, and it fails without anyone
   * remembering that a contract exists.
   */
  describe("the OpenAPI document describes the response it actually returns", () => {
    const settle = async (number: string) => {
      const created = await fetch(`${baseUrl}/api/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number,
          customer: "cust-1",
          issuedOn: "2026-09-30",
          dueDate: "2026-10-30",
          status: "draft",
          lines: [{ description: "Consulting", qty: 1, unitPrice: 100 }]
        })
      });
      expect(created.status).toBe(201);
    };

    const responseSchemaFor = async (path: string) => {
      const spec = await (await fetch(`${baseUrl}/openapi.json`)).json();
      const schema = spec.paths?.[path]?.post?.responses?.["200"]?.content?.["application/json"]
        ?.schema;
      expect(schema, `no 200 schema for ${path}`).toBeDefined();
      return schema as { properties?: Record<string, unknown>; required?: string[] };
    };

    it("declares every field a transition response carries, and nothing it does not", async () => {
      await settle("INV-002");
      const res = await fetch(`${baseUrl}/api/invoice/INV-002/actions/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: ["billing"] })
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      const schema = await responseSchemaFor("/api/invoice/{id}/actions/send");
      expect(Object.keys(body).sort()).toEqual(Object.keys(schema.properties ?? {}).sort());
      expect((schema.required ?? []).sort()).toEqual(Object.keys(body).sort());
    });

    it("describes `record` as the entity, so a client reads the stored aggregate", async () => {
      await settle("INV-003");
      const res = await fetch(`${baseUrl}/api/invoice/INV-003/actions/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: ["billing"] })
      });
      const body = await res.json();
      const schema = await responseSchemaFor("/api/invoice/{id}/actions/send");

      // The record is the aggregate after the run, so it carries the entity's fields —
      // which is what made the old `$ref` to the entity look almost right, and wrong in
      // the one place a client actually reads from.
      expect(schema.properties?.record).toMatchObject({
        $ref: "#/components/schemas/Invoice"
      });
      expect(body.record.status).toBe("sent");
    });

    it("describes `events` as CloudEvents, with the attributes ADR-0023 requires", async () => {
      await settle("INV-004");
      const res = await fetch(`${baseUrl}/api/invoice/INV-004/actions/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: ["billing"] })
      });
      const body = await res.json();
      const schema = await responseSchemaFor("/api/invoice/{id}/actions/send");

      const items = (schema.properties?.events as { items?: { required?: string[] } }).items;
      expect(items?.required).toContain("specversion");
      expect(items?.required).toContain("source");
      expect(items?.required).toContain("data");

      expect(Array.isArray(body.events)).toBe(true);
      for (const event of body.events) {
        for (const attribute of items?.required ?? []) {
          expect(event, `${attribute} missing from ${event.type}`).toHaveProperty(attribute);
        }
      }
    });
  });
});
