/**
 * Screens compiled per request through UIDL recipes (ADR-0045). A form screen embeds the record
 * it edits, so serving one is a read: the read permission and the read filter both apply.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentSchema } from "uidl-runtime";
import { compile } from "@kerangka/compiler";
import { MemoryStore } from "@kerangka/ports";
import { KerangkaServer } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const invoicing = compile(fs.readFileSync(path.resolve(here, "../../../examples/invoicing.kerangka.json"), "utf8"));
const notes = compile({
  kerangka: "0.1",
  app: "notes",
  entities: { Note: { fields: { text: "string!", ownerId: "string!" }, readFilter: "ownerId == actor.id" } },
} as never);

const as = (roles?: string, id = "u-1"): Record<string, string> =>
  roles === undefined ? {} : { "X-Actor-Roles": roles, "X-Actor-Id": id };

describe("screens compiled per request", () => {
  const port = 3983;
  const base = `http://localhost:${port}`;
  const server = new KerangkaServer(invoicing, { port, store: new MemoryStore(), quiet: true });
  const get = (p: string, headers: Record<string, string> = {}) => fetch(`${base}${p}`, { headers });

  beforeAll(async () => {
    await server.start();
    const res = await fetch(`${base}/api/Invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...as("admin,billing") },
      body: JSON.stringify({ id: "INV-1", number: "INV-1", customer: "c-1", issuedOn: "2026-01-01", dueDate: "2030-01-01", status: "draft", lines: [], version: 1 }),
    });
    expect(res.status).toBe(201);
  });
  afterAll(async () => {
    await server.stop();
  });

  it("lists every list and form screen", async () => {
    const body = (await (await get("/screens")).json()) as { screens: Array<{ id: string; kind: string }> };
    expect(body.screens.map((s) => `${s.kind}:${s.id}`)).toEqual(["dashboard:home", "list:invoices", "form:invoice", "list:customer-list", "form:customer-form"]);
  });

  it("compiles a list screen for an actor who may read the entity", async () => {
    const res = await get("/screens/invoices", as("viewer"));
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.id).toBe("invoices");
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("compiles a record's edit form with its data and version", async () => {
    const res = await get("/screens/invoice/INV-1", as("viewer"));
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.id).toBe("invoice-INV-1");
    expect(doc.state).toMatchObject({ id: "INV-1", number: "INV-1", status: "draft" });
    // The store tracks a version for this record, so the form carries it for the save's If-Match.
    expect(doc.state._meta).toEqual({ version: 1 });
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("compiles a create form only for an actor who may create", async () => {
    expect((await get("/screens/invoice", as("billing"))).status).toBe(200);
    expect((await get("/screens/invoice", as("viewer"))).status).toBe(403);
  });

  it("serves nothing to a caller with no role", async () => {
    expect((await get("/screens/invoices")).status).toBe(403);
    expect((await get("/screens/invoice/INV-1")).status).toBe(403);
  });

  it("answers 404 for a screen or a record that does not exist", async () => {
    expect((await get("/screens/nope", as("admin"))).status).toBe(404);
    expect((await get("/screens/invoices/INV-1", as("admin"))).status).toBe(404);
    expect((await get("/screens/invoice/INV-404", as("admin"))).status).toBe(404);
  });

  it("is described in the served OpenAPI document", async () => {
    const doc = (await (await get("/openapi.json")).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/screens", "/screens/{viewId}", "/screens/{viewId}/{id}"]));
  });
});

describe("a record screen under a read filter", () => {
  const port = 3984;
  const base = `http://localhost:${port}`;
  const server = new KerangkaServer(notes, { port, store: new MemoryStore(), quiet: true });

  beforeAll(async () => {
    await server.start();
    for (const [id, ownerId] of [["n-1", "u-1"], ["n-2", "u-2"]]) {
      await fetch(`${base}/api/Note`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...as("", ownerId) },
        body: JSON.stringify({ id, text: id, ownerId }),
      });
    }
  });
  afterAll(async () => {
    await server.stop();
  });

  it("embeds a record only for an actor its read filter admits", async () => {
    expect((await fetch(`${base}/screens/note-form/n-1`, { headers: as("", "u-1") })).status).toBe(200);
    expect((await fetch(`${base}/screens/note-form/n-2`, { headers: as("", "u-1") })).status).toBe(403);
  });
});

/**
 * A KPI is an aggregate over every record the caller may read. The generator's dashboard summed
 * the first row of a page and counted every invoice for "Overdue", because it dropped a `where`
 * it could not lower; and it showed the same numbers to every caller.
 */
describe("a dashboard screen", () => {
  const port = 3985;
  const base = `http://localhost:${port}`;
  const sales = compile({
    kerangka: "0.1",
    app: "sales",
    roles: ["manager", "rep"],
    entities: {
      Deal: {
        fields: { amount: "decimal(12,2)!", stage: "enum(open, won, lost) = open", ownerId: "string!" },
        permissions: { read: ["manager", "rep"], create: ["manager", "rep"] },
        readFilter: "ownerId == actor.id",
      },
      Salary: {
        fields: { amount: "decimal(12,2)!" },
        permissions: { read: ["manager"], create: ["manager"] },
      },
    },
    views: {
      home: {
        dashboard: [
          { kpi: "Won", sum: "Deal.amount", where: "stage == 'won'" },
          { kpi: "Open deals", count: "Deal", where: "stage == 'open'" },
          { kpi: "Payroll", sum: "Salary.amount" },
          { kpi: "Broken", count: "Deal", where: "stage ==" },
        ],
      },
    },
  } as never);
  const server = new KerangkaServer(sales, { port, store: new MemoryStore(), quiet: true });

  /** Label to printed value, for each KPI the screen shows. */
  const kpisOf = async (headers: Record<string, string>) => {
    const res = await fetch(`${base}/screens/home`, { headers });
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
    const shown: Record<string, unknown> = {};
    const walk = (n: { id: string; props?: Record<string, unknown>; children?: unknown[] }) => {
      if (/-kpi-\d+$/.test(n.id)) {
        const [label, value] = n.children as Array<{ props: Record<string, unknown> }>;
        shown[String(label!.props.value)] = value!.props.value;
      }
      (n.children as typeof n[] | undefined)?.forEach(walk);
    };
    walk(doc.root);
    return shown;
  };

  beforeAll(async () => {
    await server.start();
    const deals = [
      ["d-1", "100.10", "won", "u-1"],
      ["d-2", "50.00", "open", "u-1"],
      ["d-3", "999.00", "won", "u-2"],
      ["d-4", "200.20", "won", "u-1"],
    ];
    for (const [id, amount, stage, ownerId] of deals) {
      const res = await fetch(`${base}/api/Deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...as("rep", ownerId) },
        body: JSON.stringify({ id, amount, stage, ownerId }),
      });
      expect(res.status).toBe(201);
    }
    const res = await fetch(`${base}/api/Salary`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...as("manager", "m-1") },
      body: JSON.stringify({ id: "s-1", amount: "4000.00" }),
    });
    expect(res.status).toBe(201);
  });
  afterAll(async () => {
    await server.stop();
  });

  it("aggregates every record the caller may read, under the KPI's where", async () => {
    const shown = await kpisOf(as("rep", "u-1"));
    // u-2's 999.00 is behind the read filter; d-2 is open.
    expect(shown.Won).toBe("300.3");
    expect(shown["Open deals"]).toBe("1");
  });

  it("leaves out a KPI over an entity the caller may not read", async () => {
    expect(await kpisOf(as("rep", "u-1"))).not.toHaveProperty("Payroll");
    expect((await kpisOf(as("manager", "m-1"))).Payroll).toBe("4000");
  });

  it("shows no number for a KPI that cannot be evaluated", async () => {
    expect((await kpisOf(as("rep", "u-1"))).Broken).toBe("\u2014");
  });

  it("shows a caller with no role no figures at all", async () => {
    expect(await kpisOf({})).toEqual({});
  });
});
