import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/index.js";

const rows = new Map<string, Record<string, unknown>>();
for (let i = 0; i < 20_000; i += 1) {
  rows.set(`inv-${i}`, {
    id: `inv-${i}`,
    tenantId: i % 2 === 0 ? "tenant-a" : "tenant-b",
    status: i % 3 === 0 ? "sent" : "draft",
    priority: i % 5,
    name: `Invoice ${i}`,
  });
}

const store = new MemoryStore(new Map([["Invoice", rows]]));

describe("query filtering: bounded scan versus predicate pushdown", () => {
  it("records a repeatable 20,000-record baseline", async () => {
    const iterations = 100;
    const scanStart = performance.now();
    for (let i = 0; i < iterations; i += 1) {
    const result = Array.from(rows.values())
      .filter((row) => row.tenantId === "tenant-a" && row.status === "sent" && Number(row.priority) > 1)
      .slice(0, 50);
      expect(result.length).toBeGreaterThan(0);
    }
    const scanMs = performance.now() - scanStart;

    const pushdownStart = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      const result = await store.find("Invoice", undefined, {
        tenantId: "tenant-a",
        where: ["and", ["==", ["get", "status"], "sent"], [">", ["get", "priority"], 1]],
        limit: 50,
        offset: 0,
      });
      expect(result.items.length).toBeGreaterThan(0);
    }
    const pushdownMs = performance.now() - pushdownStart;
    console.info(`[query benchmark] scan=${scanMs.toFixed(2)}ms pushdown=${pushdownMs.toFixed(2)}ms iterations=${iterations}`);
  });
});
