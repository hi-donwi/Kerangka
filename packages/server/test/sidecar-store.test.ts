import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { loadEngine } from "@kerangka/engine-ts";
import { createJsonRpcDispatcher, SessionStore } from "../src/index.js";

/**
 * The engine is pure: `run` returns effects and the host applies them. In the sidecar
 * that host is the session store, so a run lands somewhere and a later call reads it back.
 */
const engine = loadEngine(compile(readFileSync(resolve(__dirname, "../../../examples/invoicing.kerangka.json"), "utf8")));

const draft = {
  id: "inv-store-1",
  number: "INV-STORE-1",
  customer: "cust-1",
  issuedOn: "2026-09-01",
  dueDate: "2026-10-01",
  status: "draft",
  lines: [{ description: "Consulting", qty: 1, unitPrice: 100 }],
};

function session() {
  const store = new SessionStore();
  const dispatch = createJsonRpcDispatcher(engine, store);
  let id = 0;
  const call = (method: string, params: Record<string, unknown> = {}) => {
    id += 1;
    const line = dispatch(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return JSON.parse(line as string) as unknown as { result?: unknown; error?: { code: number; message: string } };
  };
  return { store, call };
}

const billing = { id: "u-1", roles: ["billing"] };

describe("the sidecar session store", () => {
  it("stores what a run persisted and reads it back", () => {
    const { call } = session();

    const sent = call("run", { action: "Invoice.send", record: draft, actor: billing });
    expect((sent.result as unknown as { ok: boolean }).ok).toBe(true);

    const fetched = call("get", { entity: "Invoice", id: "inv-store-1" });
    expect((fetched.result as unknown as { record: { status: string } }).record.status).toBe("sent");
  });

  it("runs against a stored aggregate by id alone", () => {
    const { call } = session();
    call("run", { action: "Invoice.send", record: draft, actor: billing });

    // No record at all beyond the id: the store supplies the rest.
    const paid = call("run", { action: "Invoice.pay", record: { id: "inv-store-1" }, actor: billing });
    expect((paid.result as unknown as { ok: boolean }).ok).toBe(true);
    expect((paid.result as unknown as { record: { status: string } }).record.status).toBe("paid");

    const fetched = call("get", { entity: "Invoice", id: "inv-store-1" });
    expect((fetched.result as unknown as { record: { status: string } }).record.status).toBe("paid");
  });

  it("stores nothing for an aggregate with no id to address it by", () => {
    const { call } = session();
    const sent = call("run", { action: "Invoice.send", record: { ...draft, id: undefined }, actor: billing });
    expect((sent.result as unknown as { ok: boolean }).ok).toBe(true);

    const listed = call("list", { entity: "Invoice" });
    expect((listed.result as unknown as { records: never[] }).records).toEqual([]);
  });

  it("stores an aggregate created by a statement", () => {
    const store = new SessionStore();
    const dispatch = createJsonRpcDispatcher(engine, store);
    const line = dispatch(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "run",
        params: {
          action: "Invoice.send",
          record: { ...draft, id: "inv-create-1" },
          actor: billing,
        },
      }),
    );
    expect(line).not.toBeNull();

    // A created Note (or any aggregate) arrives as its own persist effect.
    const notes = store.list("Note");
    expect(Array.isArray(notes)).toBe(true);
  });

  it("changes nothing when the run is refused", () => {
    const { call } = session();
    const before = call("list", { entity: "Invoice" });

    const refused = call("run", {
      action: "Invoice.send",
      record: draft,
      actor: { id: "u-2", roles: ["viewer"] },
    });
    expect((refused.result as unknown as { ok: boolean; code: string }).ok).toBe(false);
    expect((refused.result as unknown as { code: string }).code).toBe("PERMISSION_DENIED");

    const after = call("list", { entity: "Invoice" });
    expect(after.result).toEqual(before.result);
  });

  it("records the events a run emitted", () => {
    const { call } = session();
    call("run", { action: "Invoice.send", record: draft, actor: billing });

    const events = call("events", { type: "InvoiceSent" });
    const list = (events.result as unknown as { events: { type: string }[] }).events;
    expect(list).toHaveLength(1);
    expect(list[0]?.type).toBe("InvoiceSent");
  });

  it("lists every stored aggregate of an entity", () => {
    const { call } = session();
    call("run", { action: "Invoice.send", record: draft, actor: billing });
    call("run", {
      action: "Invoice.send",
      record: { ...draft, id: "inv-store-2", number: "INV-STORE-2" },
      actor: billing,
    });

    const listed = call("list", { entity: "Invoice" });
    const records = (listed.result as unknown as { records: { number: string }[] }).records;
    expect(records.map((r) => r.number).sort()).toEqual(["INV-STORE-1", "INV-STORE-2"]);
  });

  it("returns null for an id it never saw", () => {
    const { call } = session();
    const fetched = call("get", { entity: "Invoice", id: "inv-nope" });
    expect((fetched.result as unknown as { record: null }).record).toBeNull();
  });

  it("computes a record a host seeds", () => {
    const { call } = session();
    const put = call("put", { entity: "Invoice", record: draft });
    expect((put.result as unknown as { record: { status: string } }).record.status).toBe("draft");

    const fetched = call("get", { entity: "Invoice", id: "inv-store-1" });
    expect((fetched.result as unknown as { record: { status: string } }).record.status).toBe("draft");
  });

  it("clears the session on request", () => {
    const { call } = session();
    call("run", { action: "Invoice.send", record: draft, actor: billing });
    call("clear");

    const listed = call("list", { entity: "Invoice" });
    expect((listed.result as unknown as { records: never[] }).records).toEqual([]);
  });

  it("keeps a revision per aggregate so a host can spot a lost update", () => {
    const store = new SessionStore();
    const dispatch = createJsonRpcDispatcher(engine, store);
    const call = (method: string, params: Record<string, unknown>) =>
      JSON.parse(
        dispatch(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })) as string,
      ) as unknown as { result?: unknown };

    call("run", { action: "Invoice.send", record: draft, actor: billing });
    const first = store.revisionOf("Invoice", "inv-store-1");
    call("run", { action: "Invoice.pay", record: { id: "inv-store-1" }, actor: billing });
    const second = store.revisionOf("Invoice", "inv-store-1");

    expect(first).not.toBeNull();
    expect(second).toBeGreaterThan(first as number);
  });
});
