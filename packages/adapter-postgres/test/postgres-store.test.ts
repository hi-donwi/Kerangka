import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { VersionConflictError } from "@kerangka/ports";
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

  it("builds optimistic concurrency version checks and soft delete queries", () => {
    const raw = readFileSync(resolve(examplesDir, "todo.kerangka.json"), "utf8");
    const kir = compile(raw);
    const builder = new PostgresQueryBuilder(kir);

    // Optimistic concurrency update
    const ocUpdate = builder.buildUpdate(
      "Todo",
      "td-1",
      { title: "Updated" },
      { expectedVersion: 2 }
    );
    expect(ocUpdate.sql).toContain("version = version + 1");
    expect(ocUpdate.sql).toContain("version = $3");
    expect(ocUpdate.values).toEqual(["Updated", "td-1", 2]);

    // Soft delete query
    const softDel = builder.buildDelete("Todo", "td-1", { soft: true });
    expect(softDel.sql).toContain("UPDATE todo SET deleted = TRUE, deleted_at = CURRENT_TIMESTAMP WHERE id = $1");
    expect(softDel.values).toEqual(["td-1"]);
  });

  it("builds outbox and timer parameterized queries", () => {
    const builder = new PostgresQueryBuilder();

    // Outbox queries
    const outboxInsert = builder.buildEnqueueOutbox({
      id: "msg-1",
      eventType: "com.kerangka.order.Created",
      payload: { orderId: "ord-1" },
      tenantId: "tenant-z",
    });
    expect(outboxInsert.sql).toContain("INSERT INTO _outbox");
    expect(outboxInsert.values[0]).toBe("msg-1");
    expect(outboxInsert.values[1]).toBe("com.kerangka.order.Created");

    const outboxFetch = builder.buildFetchPendingOutbox(50);
    expect(outboxFetch.sql).toContain("SELECT * FROM _outbox WHERE dispatched_at IS NULL");
    expect(outboxFetch.values).toEqual([50]);

    const outboxMark = builder.buildMarkOutboxDispatched("msg-1");
    expect(outboxMark.sql).toContain("UPDATE _outbox SET dispatched_at = CURRENT_TIMESTAMP WHERE id = $1");
    expect(outboxMark.values).toEqual(["msg-1"]);

    // Timer queries
    const timerInsert = builder.buildEnqueueTimer({
      id: "timer-1",
      target: "Order.escalate",
      payload: { id: "ord-1" },
      triggerAt: "2026-09-28T20:00:00Z",
    });
    expect(timerInsert.sql).toContain("INSERT INTO _timers");
    expect(timerInsert.values[0]).toBe("timer-1");

    const timerFetch = builder.buildFetchDueTimers("2026-09-28T20:00:00Z", 25);
    expect(timerFetch.sql).toContain("SELECT * FROM _timers WHERE dispatched_at IS NULL AND trigger_at <= $1");
    expect(timerFetch.values).toEqual(["2026-09-28T20:00:00Z", 25]);

    const timerMark = builder.buildMarkTimerDispatched("timer-1");
    expect(timerMark.sql).toContain("UPDATE _timers SET dispatched_at = CURRENT_TIMESTAMP WHERE id = $1");
    expect(timerMark.values).toEqual(["timer-1"]);
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
          return { rows: [{ id: params?.[0], title: "Mock task", completed: false, version: 1 }] as R[] };
        }
        if (sql.includes("SELECT * FROM _outbox")) {
          return {
            rows: [
              {
                id: "msg-100",
                event_type: "billing:InvoicePaid",
                payload: '{"id":"inv-1"}',
                created_at: "2026-09-28T00:00:00Z",
              },
            ] as R[],
          };
        }
        if (sql.includes("SELECT * FROM _timers")) {
          return {
            rows: [
              {
                id: "tmr-100",
                target: "Invoice.remind",
                payload: '{"id":"inv-1"}',
                trigger_at: "2026-09-28T00:00:00Z",
              },
            ] as R[],
          };
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

    // Test Outbox Execution
    await store.enqueueOutbox({
      id: "msg-new",
      eventType: "order:Placed",
      payload: { id: "o-1" },
    });
    const pendingOutbox = await store.fetchPendingOutbox(10);
    expect(pendingOutbox).toHaveLength(1);
    expect(pendingOutbox[0]?.eventType).toBe("billing:InvoicePaid");
    await store.markOutboxDispatched("msg-100");

    // Test Timers Execution
    await store.enqueueTimer({
      id: "tmr-new",
      target: "Invoice.escalate",
      triggerAt: "2026-09-28T12:00:00Z",
    });
    const dueTimers = await store.fetchDueTimers("2026-09-28T12:00:00Z", 10);
    expect(dueTimers).toHaveLength(1);
    expect(dueTimers[0]?.target).toBe("Invoice.remind");
    await store.markTimerDispatched("tmr-100");

    // Test Optimistic Concurrency Failure
    await expect(
      store.update("Todo", "task-abc", { title: "New" }, { expectedVersion: 99 })
    ).rejects.toThrow(VersionConflictError);
  });
});
