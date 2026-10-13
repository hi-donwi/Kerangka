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
    expect(body.screens.map((s) => `${s.kind}:${s.id}`)).toEqual(["list:invoices", "form:invoice", "list:customer-list", "form:customer-form"]);
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
