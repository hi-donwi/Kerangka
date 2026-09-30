import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kerangka/compiler";
import { MemoryStore } from "@kerangka/ports";
import { SessionStore } from "../src/index.js";
import type { ConnectorsPort } from "@kerangka/ports";
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
      // `effectsFailed` is declared but optional, so the property is not "the keys match":
      // it is that nothing undeclared is sent, and everything the contract calls required
      // actually arrives.
      for (const key of Object.keys(body)) {
        expect(schema.properties, `undeclared field '${key}' in the response`).toHaveProperty(key);
      }
      for (const key of schema.required ?? []) {
        expect(body, `required field '${key}' missing from the response`).toHaveProperty(key);
      }
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

  /**
   * A run whose side effect never happened used to answer `ok: true` and log a warning.
   * The aggregate is genuinely written, so the response cannot simply be an error — but
   * the caller has to be able to see what was not delivered.
   */
  describe("a run reports the effects it could not deliver", () => {
    const settle = async (base: string, number: string) => {
      const created = await fetch(`${base}/api/invoice`, {
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

    it("names the extension the shipped example cannot deliver, instead of dropping it", async () => {
      await settle(baseUrl, "INV-050");
      const res = await fetch(`${baseUrl}/api/invoice/INV-050/actions/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: ["billing"] })
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      // `send` asks for `sendInvoiceEmail`, and the default registry has no such connector.
      // That used to be a silent no-op: the invoice said "sent" and no email was ever sent.
      expect(body.effectsFailed).toEqual([
        { index: 1, type: "call", target: "sendInvoiceEmail", code: "EFFECT_UNHANDLED" }
      ]);
    });

    it("leaves a run with nothing to deliver exactly as it was", async () => {
      await settle(baseUrl, "INV-051");
      // `pay` is guarded `from: "sent"`, so the invoice has to get there first. `send`
      // reports its own unhandled call; what is under test is the run after it.
      await fetch(`${baseUrl}/api/invoice/INV-051/actions/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: ["billing"] })
      });
      const res = await fetch(`${baseUrl}/api/invoice/INV-051/actions/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: ["billing"] })
      });
      const body = await res.json();

      // `pay` has no host effect, so the field is absent rather than an empty array. A
      // caller polling for it does not have to distinguish "clean" from "not checked".
      expect(body).not.toHaveProperty("effectsFailed");
      expect(body.record.status).toBe("paid");
    });

    it("distinguishes an effect that failed from one nothing could handle", async () => {
      // A connector that claims the extension and then fails is a different fault from a
      // deployment that never registered it, and a caller retrying needs to tell them apart.
      const port = 3988;
      const failing = new KerangkaServer(kir, {
        port,
        quiet: true,
        store: new MemoryStore(),
        connectors: {
          has: () => true,
          call: () => Promise.reject(new Error("smtp refused the relay at 10.0.0.4:587"))
        }
      });
      await failing.start();
      const base = `http://localhost:${port}`;
      try {
        await settle(base, "INV-052");
        const res = await fetch(`${base}/api/invoice/INV-052/actions/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles: ["billing"] })
        });
        const body = await res.json();

        expect(body.effectsFailed).toEqual([
          { index: 1, type: "call", target: "sendInvoiceEmail", code: "EFFECT_NOT_APPLIED" }
        ]);
      } finally {
        await failing.stop();
      }
    });

    it("keeps the connector's own error out of the response", async () => {
      // The reason goes to the server log, not to an HTTP client: a connector error can
      // carry an endpoint, a host, or a response body.
      const port = 3989;
      const failing = new KerangkaServer(kir, {
        port,
        quiet: true,
        store: new MemoryStore(),
        connectors: {
          has: () => true,
          call: () => Promise.reject(new Error("smtp refused the relay at 10.0.0.4:587"))
        }
      });
      await failing.start();
      const base = `http://localhost:${port}`;
      try {
        await settle(base, "INV-053");
        const res = await fetch(`${base}/api/invoice/INV-053/actions/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles: ["billing"] })
        });
        const raw = await res.text();
        expect(raw).not.toContain("10.0.0.4");
        expect(raw).not.toContain("smtp refused");
        expect(JSON.parse(raw).effectsFailed[0].code).toBe("EFFECT_NOT_APPLIED");
      } finally {
        await failing.stop();
      }
    });
  });

  /**
   * Reporting is not durability. With a session configured, an effect the deployment
   * could not deliver is queued where a host can drain it, retry it, and acknowledge it —
   * the same discipline the sidecar has had since it stopped dropping effects.
   *
   * The queue is deliberately not in the same transaction as the record: the aggregate is
   * stored through `StorePort` and the queue is a separate store with its own lifecycle. A
   * crash in that window still loses the effect, and the tests say so rather than implying
   * otherwise.
   */
  describe("a host drains the effects a run could not deliver", () => {
    const alwaysFails = () => Promise.reject(new Error("smtp down"));
    const drainServer = async (port: number, call: ConnectorsPort["call"]) => {
      const session = new SessionStore();
      const server = new KerangkaServer(kir, {
        port,
        quiet: true,
        store: new MemoryStore(),
        session,
        connectors: { has: () => true, call }
      });
      await server.start();
      return {
        base: `http://localhost:${port}`,
        session,
        stop: () => server.stop()
      };
    };

    const settle = async (base: string, number: string) => {
      const created = await fetch(`${base}/api/invoice`, {
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

    const send = async (base: string, number: string) => {
      const res = await fetch(`${base}/api/invoice/${number}/actions/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: ["billing"] })
      });
      expect(res.status).toBe(200);
      return (await res.json()) as {
        effectsFailed?: Array<{ code: string; type: string }>;
      };
    };

    it("queues an effect nothing could deliver, and a host can drain it", async () => {
      const harness = await drainServer(3993, alwaysFails);
      try {
        await settle(harness.base, "INV-060");
        const body = await send(harness.base, "INV-060");
        expect(body.effectsFailed?.[0]?.code).toBe("EFFECT_NOT_APPLIED");

        const drained = await fetch(`${harness.base}/api/effects`);
        expect(drained.status).toBe(200);
        const { effects } = await drained.json();
        expect(effects).toHaveLength(1);
        // The queued entry is the effect itself, so a host can perform or retry the real
        // call rather than a description of it.
        expect(effects[0].effect).toMatchObject({ type: "call", extension: "sendInvoiceEmail" });
        expect(effects[0].state).toBe("pending");
        expect(effects[0].attempts).toBe(0);
      } finally {
        await harness.stop();
      }
    });

    it("keeps an effect pending when the host could not perform it, and counts the attempt", async () => {
      const harness = await drainServer(3994, alwaysFails);
      try {
        await settle(harness.base, "INV-061");
        await send(harness.base, "INV-061");

        const { effects } = await (await fetch(`${harness.base}/api/effects`)).json();
        const id = effects[0].id as string;

        const nacked = await fetch(`${harness.base}/api/effects/${id}/nack`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "mailbox unavailable" })
        });
        expect(nacked.status).toBe(200);
        const { effect } = await nacked.json();
        expect(effect.state).toBe("pending");
        expect(effect.attempts).toBe(1);
        expect(effect.lastError).toBe("mailbox unavailable");

        // Still there: a nack is a retry signal, not a deletion.
        const after = await (await fetch(`${harness.base}/api/effects`)).json();
        expect(after.effects).toHaveLength(1);
      } finally {
        await harness.stop();
      }
    });

    it("stops offering an effect once the host acknowledges it", async () => {
      const harness = await drainServer(3995, alwaysFails);
      try {
        await settle(harness.base, "INV-062");
        await send(harness.base, "INV-062");

        const { effects } = await (await fetch(`${harness.base}/api/effects`)).json();
        const acked = await fetch(`${harness.base}/api/effects/${effects[0].id}/ack`, {
          method: "POST"
        });
        expect(acked.status).toBe(200);
        expect((await acked.json()).effect.state).toBe("delivered");

        const after = await (await fetch(`${harness.base}/api/effects`)).json();
        expect(after.effects).toHaveLength(0);
      } finally {
        await harness.stop();
      }
    });

    it("answers honestly when the server has no queue at all", async () => {
      const harness = await drainServer(3996, alwaysFails);
      await harness.stop();

      const plain = new KerangkaServer(kir, { port: 3997, quiet: true, store: new MemoryStore() });
      await plain.start();
      try {
        const res = await fetch("http://localhost:3997/api/effects");
        // 501, not an empty list: an empty queue would read as "nothing failed", which is
        // the exact confusion this endpoint has to avoid.
        expect(res.status).toBe(501);
        const problem = await res.json();
        expect(problem.code).toBe("EFFECT_QUEUE_UNAVAILABLE");
      } finally {
        await plain.stop();
      }
    });

    it("404s an acknowledgement for an effect that is not queued", async () => {
      const harness = await drainServer(3998, alwaysFails);
      try {
        const res = await fetch(`${harness.base}/api/effects/failed-effect-999-0/ack`, {
          method: "POST"
        });
        expect(res.status).toBe(404);
        expect((await res.json()).code).toBe("EFFECT_NOT_FOUND");
      } finally {
        await harness.stop();
      }
    });
  });
});
