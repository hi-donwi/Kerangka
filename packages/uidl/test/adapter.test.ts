import { describe, expect, it } from "vitest";
import { createKerangkaDataAdapter } from "../src/adapter.js";
import { DataError, isDataError } from "../src/errors.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface Stub {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function makeFetch(handler: (call: Call) => Stub) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = v;
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    calls.push(call);
    const stub = handler(call);
    const status = stub.status ?? 200;
    const responseBody = status === 204 ? null : JSON.stringify(stub.body ?? null);
    return new Response(responseBody, { status, headers: stub.headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const baseUrl = "http://localhost:8787";

describe("createKerangkaDataAdapter", () => {
  it("pages a plain query with limit/offset and reads the total from X-Total-Count", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      body: [{ id: "INV-1" }, { id: "INV-2" }],
      headers: { "X-Total-Count": "42" },
    }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl });

    const result = await adapter.query({ collection: "Invoice", page: { number: 3, size: 20 } });

    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(`${baseUrl}/api/Invoice?limit=20&offset=40`);
    expect(result.rows).toEqual([{ id: "INV-1" }, { id: "INV-2" }]);
    expect(result.total).toBe(42);
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(20);
  });

  it("pushes a string equality filter to the server", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      body: [
        { id: "A", status: "sent" },
        { id: "C", status: "sent" },
      ],
    }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl, maxScanRows: 500 });

    const result = await adapter.query({
      collection: "Invoice",
      filters: [{ field: "status", op: "eq", value: "sent" }],
      page: { number: 1, size: 20 },
    });

    expect(calls[0]!.url).toBe(
      `${baseUrl}/api/Invoice?limit=20&offset=0&where=%5B%22%3D%3D%22%2C%5B%22get%22%2C%22status%22%5D%2C%22sent%22%5D`,
    );
    expect(result.rows.map((r) => r.id)).toEqual(["A", "C"]);
    expect(result.total).toBe(2);
  });

  it("pushes one sort key with equality filters", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ body: [{ id: "A", status: "sent" }] }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl });

    await adapter.query({
      collection: "Invoice",
      filters: [{ field: "status", op: "eq", value: "sent" }],
      sort: [{ field: "id", dir: "desc" }],
    });

    expect(calls[0]!.url).toBe(
      `${baseUrl}/api/Invoice?limit=50&offset=0&sort=id%3Adesc&where=%5B%22%3D%3D%22%2C%5B%22get%22%2C%22status%22%5D%2C%22sent%22%5D`,
    );
  });

  it("pushes free-text search and applies column projection", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      body: [
        { id: "A", name: "Acme Corp", nested: { code: "X1" } },
      ],
    }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl });

    const result = await adapter.query({ collection: "Customer", search: "acme", fields: ["id", "name"] });

    expect(calls[0]!.url).toBe(`${baseUrl}/api/Customer?limit=50&offset=0&search=acme`);
    expect(result.rows).toEqual([{ id: "A", name: "Acme Corp" }]);
    expect(result.total).toBe(1);
  });

  it("gets a record and exposes its version as meta", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ body: { id: "INV-1", version: 4 } }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl });

    const result = await adapter.get("invoice", "INV-1");

    expect(calls[0]!.url).toBe(`${baseUrl}/api/invoice/INV-1`);
    expect(result).toEqual({ record: { id: "INV-1", version: 4 }, meta: { version: 4 } });
  });

  it("returns undefined on a 404 get", async () => {
    const { fetchImpl } = makeFetch(() => ({ status: 404, body: { code: "NOT_FOUND", detail: "nope" } }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl });
    expect(await adapter.get("invoice", "missing")).toBeUndefined();
  });

  it("creates a record with a POST body", async () => {
    const { fetchImpl, calls } = makeFetch((call) =>
      call.method === "POST" ? { status: 201, body: { id: "INV-9", version: 1 } } : { status: 500 },
    );
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl });

    const result = await adapter.create({ collection: "Invoice", data: { number: "9" } });

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${baseUrl}/api/Invoice`);
    expect(calls[0]!.body).toEqual({ number: "9" });
    expect(result).toEqual({ record: { id: "INV-9", version: 1 }, meta: { version: 1 } });
  });

  it("updates with If-Match from the mutation version and maps a conflict", async () => {
    const ok = makeFetch(() => ({ body: { id: "INV-1", version: 5 } }));
    const okAdapter = createKerangkaDataAdapter({ baseUrl, fetchImpl: ok.fetchImpl });
    await okAdapter.update({ collection: "Invoice", id: "INV-1", data: { status: "sent" }, version: 4 });
    expect(ok.calls[0]!.method).toBe("PUT");
    expect(ok.calls[0]!.url).toBe(`${baseUrl}/api/Invoice/INV-1`);
    expect(ok.calls[0]!.headers["if-match"]).toBe("4");

    const conflict = makeFetch(() => ({ status: 409, body: { code: "VERSION_CONFLICT", detail: "stale" } }));
    const conflictAdapter = createKerangkaDataAdapter({ baseUrl, fetchImpl: conflict.fetchImpl });
    const error = await conflictAdapter
      .update({ collection: "Invoice", id: "INV-1", data: {}, version: 1 })
      .catch((e: unknown) => e);
    expect(isDataError(error)).toBe(true);
    expect((error as DataError).code).toBe("conflict");
  });

  it("removes a record with a plain DELETE by default", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ status: 204 }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl });
    await adapter.remove("Invoice", "INV-1");
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(`${baseUrl}/api/Invoice/INV-1`);
  });

  it("marks records deleted when softDelete is enabled", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({ status: 204 }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl, softDelete: true });
    await adapter.remove("Invoice", "INV-1");
    expect(calls[0]!.url).toBe(`${baseUrl}/api/Invoice/INV-1?soft=true`);
  });

  it("runs a transition through the action endpoint and unwraps the record", async () => {
    const { fetchImpl, calls } = makeFetch(() => ({
      body: { ok: true, action: "send", record: { id: "INV-1", status: "sent", version: 2 }, events: [] },
    }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl });

    const result = await adapter.transition({ collection: "Invoice", id: "INV-1", transition: "send" });

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${baseUrl}/api/Invoice/INV-1/actions/send`);
    expect(result.record).toMatchObject({ id: "INV-1", status: "sent" });
    expect(result.meta).toEqual({ version: 2 });
  });

  it("maps a 422 problem+json with field errors to a validation DataError", async () => {
    const { fetchImpl } = makeFetch(() => ({
      status: 422,
      body: {
        code: "INPUT_INVALID",
        detail: "Record fails validation",
        errors: [{ field: "number", message: "Field 'number' is required" }],
      },
    }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl });

    const error = await adapter.create({ collection: "Invoice", data: {} }).catch((e: unknown) => e);
    expect(isDataError(error)).toBe(true);
    expect((error as DataError).code).toBe("validation");
    expect((error as DataError).fields).toEqual({ number: "Field 'number' is required" });
  });

  it("fails honestly for report(), which Kerangka does not serve", async () => {
    const { fetchImpl } = makeFetch(() => ({ status: 500 }));
    const adapter = createKerangkaDataAdapter({ baseUrl, fetchImpl });
    const error = await adapter.report("sales-summary", {}).catch((e: unknown) => e);
    expect(isDataError(error)).toBe(true);
    expect((error as DataError).code).toBe("validation");
  });
});
