/**
 * A dashboard KPI (`views.<id>.dashboard[]`) is an aggregate over the records a caller may read.
 * The compiler's UIDL generator bound a `sum` to the first row of a page (`rows[0].total`) and
 * dropped a `where` it could not lower to one filter, so "Overdue" counted every invoice. The
 * engine computes a KPI with K1's own `count`, `sum`, and `avg` over the rows its `where` admits,
 * and a KPI it cannot evaluate is refused rather than shown as a wrong number.
 */

import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { Engine } from "../src/index.js";

const engine = new Engine(
  compile({
    kerangka: "0.1",
    app: "kpis",
    entities: {
      Invoice: {
        fields: {
          number: "string!",
          status: "enum(draft, sent, paid) = draft",
          dueDate: "date",
          total: "decimal(12,2)",
          lines: "int",
          ownerId: "string",
        },
      },
    },
  } as never)
);

const invoices = [
  { id: "a", number: "A", status: "sent", dueDate: "2020-01-01", total: "100.10", lines: 2, ownerId: "u-1" },
  { id: "b", number: "B", status: "sent", dueDate: "2999-01-01", total: "200.20", lines: 3, ownerId: "u-2" },
  { id: "c", number: "C", status: "draft", dueDate: "2020-01-01", total: "50.00", lines: 1, ownerId: "u-1" },
  { id: "d", number: "D", status: "sent", total: null, lines: 1, ownerId: "u-1" },
];

describe("Engine.kpiSource", () => {
  it("names the aggregate, the entity, and the field", () => {
    expect(engine.kpiSource({ kpi: "Outstanding", sum: "Invoice.total" })).toEqual({ aggregate: "sum", entity: "Invoice", field: "total" });
    expect(engine.kpiSource({ kpi: "Count", count: "Invoice" })).toEqual({ aggregate: "count", entity: "Invoice" });
    expect(engine.kpiSource({ kpi: "Avg", avg: "Invoice.lines" })).toEqual({ aggregate: "avg", entity: "Invoice", field: "lines" });
  });

  it("has none for a KPI that names no aggregate, two of them, or something the model lacks", () => {
    expect(engine.kpiSource({ kpi: "Nothing" })).toBeUndefined();
    expect(engine.kpiSource({ kpi: "Two", sum: "Invoice.total", count: "Invoice" })).toBeUndefined();
    expect(engine.kpiSource({ kpi: "Ghost", count: "Payment" })).toBeUndefined();
    expect(engine.kpiSource({ kpi: "Field", sum: "Invoice.amount" })).toBeUndefined();
    expect(engine.kpiSource({ kpi: "Text", sum: "Invoice.number" })).toBeUndefined();
    expect(engine.kpiSource({ kpi: "Entity", sum: "Invoice" })).toBeUndefined();
  });
});

describe("Engine.kpiValue", () => {
  it("sums a decimal field over every row its where admits, decoded and exact", () => {
    expect(engine.kpiValue({ kpi: "Outstanding", sum: "Invoice.total", where: "status == 'sent'" }, invoices)).toEqual({ ok: true, value: 300.3 });
  });

  it("evaluates a where the generator could not lower: a conjunction and a call", () => {
    expect(engine.kpiValue({ kpi: "Overdue", count: "Invoice", where: "status == 'sent' && dueDate < today()" }, invoices)).toEqual({ ok: true, value: 1 });
  });

  it("counts every row when there is no where", () => {
    expect(engine.kpiValue({ kpi: "All", count: "Invoice" }, invoices)).toEqual({ ok: true, value: 4 });
  });

  it("averages with K1's avg", () => {
    expect(engine.kpiValue({ kpi: "Lines", avg: "Invoice.lines", where: "status == 'sent'" }, invoices)).toEqual({ ok: true, value: 2 });
  });

  it("reads the actor in a where", () => {
    expect(engine.kpiValue({ kpi: "Mine", count: "Invoice", where: "ownerId == actor.id" }, invoices, { id: "u-1", roles: [] })).toEqual({ ok: true, value: 3 });
  });

  it("refuses a KPI it cannot evaluate instead of showing a wrong number", () => {
    const bad = engine.kpiValue({ kpi: "Broken", count: "Invoice", where: "status ==" }, invoices);
    expect(bad).toMatchObject({ ok: false, code: "KPI_INVALID" });
    expect(engine.kpiValue({ kpi: "Ghost", count: "Payment" }, invoices)).toMatchObject({ ok: false, code: "KPI_INVALID" });
  });
});
