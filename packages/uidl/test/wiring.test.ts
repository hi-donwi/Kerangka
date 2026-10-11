import { describe, expect, it, vi } from "vitest";
import { routeParams, seedFormFromRecord, seedRouteParams, withRowRoutes } from "../src/wiring.js";
import type { DataAdapter, Query, QueryResult } from "../src/types.js";

function createFakeStore(initial: Record<string, unknown> = {}) {
  let state: Record<string, unknown> = { ...initial };
  const listeners = new Set<() => void>();
  return {
    get state() {
      return state;
    },
    setState(path: string, value: unknown) {
      const keys = path.split(".");
      const last = keys.pop()!;
      let cursor = state;
      for (const key of keys) {
        if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
        cursor = cursor[key] as Record<string, unknown>;
      }
      cursor[last] = value;
      listeners.forEach((listener) => listener());
    },
    getValue(path?: string) {
      if (!path) return state;
      let cursor: unknown = state;
      for (const key of path.split(".")) {
        if (cursor === null || typeof cursor !== "object" || !(key in (cursor as Record<string, unknown>))) {
          return undefined;
        }
        cursor = (cursor as Record<string, unknown>)[key];
      }
      return cursor;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

describe("routeParams", () => {
  it("extracts named segments and decodes them", () => {
    expect(routeParams("/invoice/:id", "/invoice/INV%201")).toEqual({ id: "INV 1" });
  });

  it("returns an empty object when the pattern is static and matches", () => {
    expect(routeParams("/invoices", "/invoices")).toEqual({});
  });

  it("returns undefined when the path does not match", () => {
    expect(routeParams("/invoice/:id", "/invoice")).toBeUndefined();
    expect(routeParams("/invoice/:id", "/customer/C-1")).toBeUndefined();
  });

  it("ignores trailing slashes", () => {
    expect(routeParams("/invoice/:id/", "/invoice/INV-1/")).toEqual({ id: "INV-1" });
  });
});

describe("seedRouteParams", () => {
  it("writes state.params when the path matches", () => {
    const store = createFakeStore();
    expect(seedRouteParams(store, "/invoice/:id", "/invoice/INV-1")).toBe(true);
    expect(store.getValue("params")).toEqual({ id: "INV-1" });
  });

  it("leaves state.params alone when the path does not match", () => {
    const store = createFakeStore();
    expect(seedRouteParams(store, "/invoice/:id", "/invoices")).toBe(false);
    expect(store.getValue("params")).toBeUndefined();
  });
});

describe("seedFormFromRecord", () => {
  it("copies the first record row into state.form", () => {
    const store = createFakeStore({ $data: { record: { rows: [{ id: "INV-1", number: "A-1" }] } } });
    seedFormFromRecord(store);
    expect(store.getValue("form")).toEqual({ id: "INV-1", number: "A-1" });
  });

  it("seeds a blank form when the record query has no rows", () => {
    const store = createFakeStore({ $data: { record: { rows: [] } } });
    seedFormFromRecord(store);
    expect(store.getValue("form")).toEqual({});
  });

  it("keeps the form in step when the record resolves again", () => {
    const store = createFakeStore({ $data: { record: { rows: [] } } });
    seedFormFromRecord(store);
    store.setState("$data.record.rows", [{ id: "INV-1" }]);
    expect(store.getValue("form")).toEqual({ id: "INV-1" });
  });

  it("applies the transform before writing state.form", () => {
    const store = createFakeStore({ $data: { record: { rows: [{ id: "INV-1", total: 5 }] } } });
    seedFormFromRecord(store, { transform: (record) => ({ ...record, total: Number(record.total) * 100 }) });
    expect(store.getValue("form")).toEqual({ id: "INV-1", total: 500 });
  });

  it("does not write again for an unchanged record (no self-triggered loop)", () => {
    const store = createFakeStore({ $data: { record: { rows: [{ id: "INV-1" }] } } });
    const setState = vi.spyOn(store, "setState");
    seedFormFromRecord(store);
    store.setState("$data.record.rows", [{ id: "INV-1" }]);
    expect(setState.mock.calls.filter(([path]) => path === "form")).toHaveLength(1);
  });

  it("unsubscribes when the returned function is called", () => {
    const store = createFakeStore({ $data: { record: { rows: [] } } });
    const stop = seedFormFromRecord(store);
    stop();
    store.setState("$data.record.rows", [{ id: "INV-1" }]);
    expect(store.getValue("form")).toEqual({});
  });
});

describe("withRowRoutes", () => {
  function fakeAdapter(result: QueryResult): DataAdapter {
    return {
      query: async <T = Record<string, unknown>>() => result as QueryResult<T>,
      get: async <T = Record<string, unknown>>() => undefined as { record: T; meta: { version: number } } | undefined,
      create: async <T = Record<string, unknown>>() => ({ record: {} as T, meta: { version: 1 } }),
      update: async <T = Record<string, unknown>>() => ({ record: {} as T, meta: { version: 1 } }),
      remove: async () => {},
      transition: async <T = Record<string, unknown>>() => ({ record: {} as T, meta: { version: 1 } }),
      report: async <T = unknown>() => undefined as T,
    };
  }

  it("decorates rows with the route the template builds", async () => {
    const adapter = withRowRoutes(fakeAdapter({ rows: [{ id: "INV-1" }], total: 1, page: 1, pageSize: 20 }), () =>
      "/invoice/:id",
    );
    const result = await adapter.query({ collection: "Invoice" });
    expect(result.rows).toEqual([{ id: "INV-1", route: "/invoice/INV-1" }]);
  });

  it("leaves rows alone when routeFor returns undefined", async () => {
    const rows = [{ id: "INV-1" }];
    const adapter = withRowRoutes(fakeAdapter({ rows, total: 1, page: 1, pageSize: 20 }), () => undefined);
    const result = await adapter.query({ collection: "Invoice" });
    expect(result.rows).toEqual(rows);
  });

  it("passes the query through so routeFor can decide by collection", async () => {
    const seen: Query[] = [];
    const adapter = withRowRoutes(fakeAdapter({ rows: [], total: 0, page: 1, pageSize: 20 }), (query) => {
      seen.push(query);
      return undefined;
    });
    await adapter.query({ collection: "Customer" });
    expect(seen).toEqual([{ collection: "Customer" }]);
  });

  it("forwards non-query operations to the wrapped adapter", async () => {
    const remove = vi.fn(async () => {});
    const adapter = withRowRoutes({ ...fakeAdapter({ rows: [], total: 0, page: 1, pageSize: 20 }), remove }, () => undefined);
    await adapter.remove("Invoice", "INV-1");
    expect(remove).toHaveBeenCalledWith("Invoice", "INV-1", undefined);
  });
});
