import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { PostgresQueryBuilder, PostgresStore } from "../src/index.js";

describe("PostgreSQL Query Builder & Store Adapter", () => {
  const examplesDir = resolve(__dirname, "../../../examples");

  it("builds parameterized SELECT queries for invoicing", () => {
    const raw = readFileSync(resolve(examplesDir, "invoicing.kerangka.json"), "utf8");
    const kir = compile(raw);
    const builder = new PostgresQueryBuilder(kir);

    const getQuery = builder.buildGet("Invoice", "INV-2026-001");
    expect(getQuery.sql).toBe("SELECT * FROM invoice WHERE number = $1");
    expect(getQuery.values).toEqual(["INV-2026-001"]);

    const findQuery = builder.buildFind(
      "Invoice",
      { status: "sent" },
      { limit: 20, offset: 0, sort: { dueDate: "asc" } }
    );
    expect(findQuery.dataQuery.sql).toContain("SELECT * FROM invoice WHERE status = $1 ORDER BY due_date ASC LIMIT $2 OFFSET $3");
    expect(findQuery.dataQuery.values).toEqual(["sent", 20, 0]);
    expect(findQuery.countQuery.sql).toBe("SELECT COUNT(*) as count FROM invoice WHERE status = $1");
    expect(findQuery.countQuery.values).toEqual(["sent"]);
  });

  it("enforces tenant parameterization on multitenant models", () => {
    const raw = readFileSync(resolve(examplesDir, "inventory.kerangka.json"), "utf8");
    const kir = compile(raw);
    const builder = new PostgresQueryBuilder(kir);

    const getQuery = builder.buildGet("StockItem", "SKU-99", { tenantId: "tenant-x" });
    expect(getQuery.sql).toBe("SELECT * FROM stock_item WHERE sku = $1 AND tenant_id = $2");
    expect(getQuery.values).toEqual(["SKU-99", "tenant-x"]);
  });

  it("builds parameterized INSERT and UPDATE with RETURNING *", () => {
    const raw = readFileSync(resolve(examplesDir, "todo.kerangka.json"), "utf8");
    const kir = compile(raw);
    const builder = new PostgresQueryBuilder(kir);

    const insertQuery = builder.buildInsert("Todo", {
      id: "td-1",
      title: "Write Postgres adapter",
      completed: false,
      priority: "high",
    });
    expect(insertQuery.sql).toContain("INSERT INTO todo");
    expect(insertQuery.sql).toContain("RETURNING *");
    expect(insertQuery.values).toContain("Write Postgres adapter");

    const updateQuery = builder.buildUpdate("Todo", "td-1", {
      completed: true,
    });
    expect(updateQuery.sql).toContain("UPDATE todo SET completed = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *");
    expect(updateQuery.values).toEqual([true, "td-1"]);
  });

  it("executes store calls against executor interface", async () => {
    const raw = readFileSync(resolve(examplesDir, "todo.kerangka.json"), "utf8");
    const kir = compile(raw);

    const executedSql: string[] = [];
    const mockExecutor = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async query<R = any>(sql: string, params?: any[]): Promise<{ rows: R[] }> {
        executedSql.push(sql);
        if (sql.includes("SELECT * FROM todo WHERE id")) {
          return { rows: [{ id: params?.[0], title: "Mock task", completed: false }] as R[] };
        }
        return { rows: [] };
      },
    };

    const store = new PostgresStore({ executor: mockExecutor, kir });
    const item = await store.get("Todo", "task-abc");

    expect(item).toBeDefined();
    expect(item?.id).toBe("task-abc");
    expect(item?.title).toBe("Mock task");
    expect(executedSql[0]).toContain("SELECT * FROM todo WHERE id = $1");
  });
});
