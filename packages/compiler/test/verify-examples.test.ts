import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDocument } from "@kerangka/compiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.resolve(__dirname, "../../../examples");

function verifyExample(name: string) {
  const file = path.join(examplesDir, name);
  const source = fs.readFileSync(file, "utf8");
  return verifyDocument(JSON.parse(source), source);
}

describe("keranga verify on the shipped examples", () => {
  it("does not report a context-qualified event as an orphan listener", () => {
    const result = verifyExample("commerce/kerangka.json");
    // The commerce policies listen to `orders.OrderPlaced`; orders emits `OrderPlaced`.
    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain("EVENT_ORPHAN_LISTENER");
  });

  it("reads a decision table written in the canonical rows form", () => {
    const result = verifyExample("leave-request.kerangka.json");
    const codes = result.findings.map((f) => f.code);
    expect(codes).not.toContain("DECISION_EMPTY_TABLE");
  });

  it("has no findings against invoicing", () => {
    const result = verifyExample("invoicing.kerangka.json");
    expect(result.findings).toEqual([]);
  });

  it("reports a policy that runs an action nobody declared", () => {
    const source = JSON.stringify({
      kerangka: "0.1",
      app: "broken-policy",
      events: { OrderPlaced: { orderId: "uuid!" } },
      entities: {
        Order: { fields: { status: "enum(draft, placed) = draft" } },
        Invoice: { fields: { orderId: "uuid!" } },
      },
      policies: {
        onOrderPlaced: { on: "OrderPlaced", run: "Invoice.create" },
      },
    });

    const result = verifyDocument(JSON.parse(source), source);
    const finding = result.findings.find((f) => f.code === "POLICY_UNKNOWN_ACTION");

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("Invoice.create");
    expect(result.ok).toBe(false);
  });

  it("accepts a policy that runs a declared action", () => {
    const source = JSON.stringify({
      kerangka: "0.1",
      app: "good-policy",
      events: { OrderPlaced: { orderId: "uuid!" } },
      entities: {
        Order: { fields: { status: "enum(draft, placed) = draft" } },
        Invoice: { fields: { orderId: "uuid!" }, actions: { create: { roles: ["system"] } } },
      },
      policies: {
        onOrderPlaced: { on: "OrderPlaced", run: "Invoice.create" },
      },
    });

    const result = verifyDocument(JSON.parse(source), source);
    expect(result.findings.filter((f) => f.code === "POLICY_UNKNOWN_ACTION")).toEqual([]);
  });
});
