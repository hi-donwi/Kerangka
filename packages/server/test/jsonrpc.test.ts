import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@kerangka/compiler";
import { Engine, loadEngine } from "@kerangka/engine-ts";
import { createJsonRpcDispatcher } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, "../../../examples");

function engineFor(name: string): Engine {
  const raw = fs.readFileSync(path.join(examplesDir, name), "utf8");
  return loadEngine(compile(raw));
}

function rpc(dispatch: (line: string) => string | null, payload: unknown): any {
  const line = dispatch(JSON.stringify(payload));
  expect(line, "a request with an id must produce a response line").not.toBeNull();
  return JSON.parse(line as string);
}

describe("stdio JSON-RPC (Runtime API, PLAN.md §10)", () => {
  const invoicing = engineFor("invoicing.kerangka.json");
  const dispatch = createJsonRpcDispatcher(invoicing);

  it("answers describe with the model metadata", () => {
    const res = rpc(dispatch, { jsonrpc: "2.0", id: 1, method: "describe", params: {} });
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
    expect(res.result.app).toBe("invoicing");
    expect(res.result.entities).toContain("Invoice");
  });

  it("exposes validate, compute, can, available, and plan", () => {
    const draft = {
      id: "inv-rpc-1",
      number: "INV-1",
      customer: "cust-1",
      issuedOn: "2026-09-01",
      dueDate: "2026-10-01",
      lines: [{ description: "Work", qty: 2, unitPrice: 100 }],
      status: "draft",
    };

    const validate = rpc(dispatch, {
      jsonrpc: "2.0",
      id: 2,
      method: "validate",
      params: { entity: "Invoice", record: draft },
    });
    expect(validate.result.valid).toBe(true);

    const compute = rpc(dispatch, {
      jsonrpc: "2.0",
      id: 3,
      method: "compute",
      params: { entity: "Invoice", record: draft },
    });
    expect(compute.result.record.total).toBe(200);

    const can = rpc(dispatch, {
      jsonrpc: "2.0",
      id: 4,
      method: "can",
      params: {
        operation: "Invoice.send",
        record: draft,
        actor: { id: "u-1", roles: ["billing"] },
      },
    });
    expect(can.result.allowed).toBe(true);

    const available = rpc(dispatch, {
      jsonrpc: "2.0",
      id: 5,
      method: "available",
      params: { entity: "Invoice", record: draft, actor: { id: "u-1", roles: ["billing"] } },
    });
    expect(Array.isArray(available.result.operations)).toBe(true);

    const plan = rpc(dispatch, {
      jsonrpc: "2.0",
      id: 6,
      method: "plan",
      params: { action: "Invoice.send", record: draft, actor: { id: "u-1", roles: ["billing"] } },
    });
    expect(plan.result.ok).toBe(true);
  });

  it("runs an action and returns record, events, and effects", () => {
    const res = rpc(dispatch, {
      jsonrpc: "2.0",
      id: 7,
      method: "run",
      params: {
        action: "Invoice.send",
        record: {
          id: "inv-rpc-2",
          number: "INV-2",
          customer: "cust-2",
          issuedOn: "2026-09-01",
          dueDate: "2026-10-01",
          lines: [{ description: "Work", qty: 1, unitPrice: 50 }],
          status: "draft",
        },
        actor: { id: "u-1", roles: ["billing"] },
        options: { trace: true },
      },
    });

    expect(res.result.ok).toBe(true);
    expect(res.result.record.status).toBe("sent");
    expect(res.result.trace.operation).toBe("Invoice.send");
    expect(Array.isArray(res.result.trace.steps)).toBe(true);
  });

  it("returns a domain refusal as a result, not a protocol error", () => {
    const res = rpc(dispatch, {
      jsonrpc: "2.0",
      id: 8,
      method: "run",
      params: {
        action: "Invoice.send",
        record: { id: "inv-rpc-3", number: "INV-3", customer: "c", status: "draft", lines: [] },
        actor: { id: "u-2", roles: ["viewer"] },
      },
    });

    expect(res.error).toBeUndefined();
    expect(res.result.ok).toBe(false);
    expect(res.result.code).toBeDefined();
  });

  it("decides a table, reads filters, and plans queries", () => {
    const leaveRequest = createJsonRpcDispatcher(engineFor("leave-request.kerangka.json"));

    const decide = rpc(leaveRequest, {
      jsonrpc: "2.0",
      id: 9,
      method: "decide",
      params: { table: "approverRouting", inputs: { days: 6 } },
    });
    expect(decide.result.matched).toBe(true);
    expect(decide.result.outputs).toEqual({ approverRole: "hr-director" });

    const filter = rpc(dispatch, {
      jsonrpc: "2.0",
      id: 10,
      method: "readFilter",
      params: { entity: "Invoice", actor: { id: "u-1", roles: ["billing"] } },
    });
    expect(filter.jsonrpc).toBe("2.0");
    expect(filter.jsonrpc).toBe("2.0");

    const queryPlan = rpc(dispatch, {
      jsonrpc: "2.0",
      id: 11,
      method: "queryPlan",
      params: { query: "openInvoices" },
    });
    expect(queryPlan.jsonrpc).toBe("2.0");
  });

  it("exposes schedules and react", () => {
    const lr = createJsonRpcDispatcher(engineFor("leave-request.kerangka.json"));

    const schedules = rpc(lr, {
      jsonrpc: "2.0",
      id: 12,
      method: "schedules",
      params: { entity: "LeaveRequest", record: { id: "lr-1", status: "submitted", startDate: "2026-09-01" } },
    });
    expect(Array.isArray(schedules.result.schedules)).toBe(true);

    const react = rpc(lr, {
      jsonrpc: "2.0",
      id: 13,
      method: "react",
      params: { event: { type: "leave:LeaveRequested", data: { leaveRequestId: "lr-1" } } },
    });
    expect(react.jsonrpc).toBe("2.0");
  });

  it("uses the JSON-RPC error codes", () => {
    const parse = JSON.parse(dispatch("{ not json") as string);
    expect(parse.error.code).toBe(-32700);

    const unknown = rpc(dispatch, { jsonrpc: "2.0", id: 14, method: "teleport" });
    expect(unknown.error.code).toBe(-32601);

    const invalid = rpc(dispatch, { jsonrpc: "2.0", id: 15, method: "validate", params: {} });
    expect(invalid.error.code).toBe(-32602);

    const badShape = rpc(dispatch, { id: 16, method: "describe" });
    expect(badShape.error.code).toBe(-32600);
  });

  it("stays silent for notifications", () => {
    expect(dispatch(JSON.stringify({ jsonrpc: "2.0", method: "describe" }))).toBeNull();
  });
});
