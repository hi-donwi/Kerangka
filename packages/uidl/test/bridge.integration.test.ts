/**
 * End-to-end proof that the bridge speaks real Kerangka REST.
 *
 * This boots an actual `KerangkaServer` over a `MemoryStore` with the invoicing model and drives
 * it only through `createKerangkaDataAdapter` / `createKerangkaMutationHandler` — no direct store
 * or engine access. If a URL, method, header, or response shape were wrong, this fails.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kerangka/compiler";
import { MemoryStore } from "@kerangka/ports";
import { KerangkaServer } from "@kerangka/server";
import { createKerangkaDataAdapter, createKerangkaMutationHandler } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const invoicingPath = path.resolve(here, "../../../examples/invoicing.kerangka.json");

describe("UIDL bridge against a live Kerangka server", () => {
  const port = 3991;
  const baseUrl = `http://localhost:${port}`;
  let server: KerangkaServer;

  // A host's authentication sets the actor on every request; the server takes it from there.
  const adapter = createKerangkaDataAdapter({
    baseUrl,
    headers: { "X-Actor-Id": "u-billing", "X-Actor-Roles": "admin,billing" },
  });
  const handler = createKerangkaMutationHandler({ adapter });

  beforeAll(async () => {
    const kir = compile(fs.readFileSync(invoicingPath, "utf-8"));
    server = new KerangkaServer(kir, { port, store: new MemoryStore(), quiet: true });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("creates, reads, filters, updates, transitions, and removes through the bridge", async () => {
    // A document's create action → POST /api/{collection}
    const customer = await handler({
      operation: "create",
      collection: "Customer",
      payload: { id: "cust-1", name: "Acme Corp", email: "billing@acme.com" },
    });
    expect(customer).toMatchObject({ record: { id: "cust-1", name: "Acme Corp" } });
    expect((customer as { meta: { version: number } }).meta.version).toBeGreaterThanOrEqual(1);

    // get → GET /api/{collection}/{id}
    const fetched = await adapter.get("Customer", "cust-1");
    expect(fetched?.record).toMatchObject({ id: "cust-1", name: "Acme Corp" });

    // a plain list read is one Kerangka page
    const page = await adapter.query({ collection: "Customer", page: { number: 1, size: 10 } });
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({ id: "cust-1" });

    // update → PUT /api/{collection}/{id}
    const updated = await handler({
      operation: "update",
      collection: "Customer",
      id: "cust-1",
      payload: { tier: "gold" },
    });
    expect(updated).toMatchObject({ record: { id: "cust-1", tier: "gold" } });

    // A computed invoice with one line: total = qty * unitPrice = 2 * 10 = 20.
    // `issuedOn` and `status` are filled in because the REST create endpoint does not apply
    // field defaults yet (finding recorded in the run's progress.md); a generated form sends
    // whatever the user entered for those fields.
    const invoice = await adapter.create({
      collection: "Invoice",
      data: {
        id: "INV-1",
        number: "INV-1",
        customer: "cust-1",
        issuedOn: "2026-01-01",
        dueDate: "2030-01-01",
        status: "draft",
        lines: [{ description: "Consulting", qty: 2, unitPrice: 10 }],
      },
    });
    expect(invoice.record).toMatchObject({ id: "INV-1", status: "draft", total: 20 });

    // transition → POST /api/{collection}/{id}/actions/{transition}
    const sent = await handler({
      operation: "transition",
      collection: "Invoice",
      id: "INV-1",
      transition: "send",
    });
    expect(sent).toMatchObject({ record: { id: "INV-1", status: "sent" } });

    // a filtered read is scanned and filtered by the bridge (server takes no predicate)
    const sentInvoices = await adapter.query({
      collection: "Invoice",
      filters: [{ field: "status", op: "eq", value: "sent" }],
    });
    expect(sentInvoices.total).toBe(1);
    expect(sentInvoices.rows[0]).toMatchObject({ id: "INV-1", status: "sent" });

    // remove → DELETE /api/{collection}/{id}?soft=true
    await handler({ operation: "delete", collection: "Customer", id: "cust-1" });
    expect(await adapter.get("Customer", "cust-1")).toBeUndefined();
  });

  it("surfaces server validation failures as a validation DataError with fields", async () => {
    const error = await adapter
      .create({ collection: "Customer", data: { id: "cust-2", name: "No Email" } })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "DataError", code: "validation" });
    expect((error as { fields?: Record<string, string> }).fields).toHaveProperty("email");
  });
});
