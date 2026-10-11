import { bench, describe } from "vitest";
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
  bench("bounded scan", () => {
    const result = Array.from(rows.values())
      .filter((row) => row.tenantId === "tenant-a" && row.status === "sent" && Number(row.priority) > 1)
      .slice(0, 50);
    if (result.length === 0) throw new Error("benchmark fixture unexpectedly empty");
  });

  bench("predicate pushdown", async () => {
    const result = await store.find("Invoice", undefined, {
      tenantId: "tenant-a",
      where: ["and", ["==", ["get", "status"], "sent"], [">", ["get", "priority"], 1]],
      limit: 50,
      offset: 0,
    });
    if (result.items.length === 0) throw new Error("benchmark fixture unexpectedly empty");
  });
});
