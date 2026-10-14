import { describe, expect, it, vi } from "vitest";
import { createScreensClient } from "../src/screens.js";
import { DataError } from "../src/errors.js";

describe("createScreensClient", () => {
  it("lists available screens from /screens", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        screens: [
          { id: "home", kind: "dashboard", route: "/" },
          { id: "invoices", kind: "list", entity: "Invoice", route: "/invoices" },
          { id: "invoice", kind: "form", entity: "Invoice", route: "/invoice/:id" },
        ],
      }),
    });

    const client = createScreensClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    const screens = await client.list();
    expect(fakeFetch).toHaveBeenCalledWith("http://localhost:3000/screens", expect.objectContaining({ method: "GET" }));
    expect(screens).toHaveLength(3);
    expect(screens[0]).toEqual({ id: "home", kind: "dashboard", route: "/" });
    expect(screens[1]).toEqual({ id: "invoices", kind: "list", entity: "Invoice", route: "/invoices" });
  });

  it("fetches a screen document without record id", async () => {
    const fakeDoc = {
      version: "1.0.0",
      id: "home",
      name: "home",
      root: { id: "root", type: "Column", children: [] },
    };

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => fakeDoc,
    });

    const client = createScreensClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    const doc = await client.get("home");
    expect(fakeFetch).toHaveBeenCalledWith("http://localhost:3000/screens/home", expect.objectContaining({ method: "GET" }));
    expect(doc).toEqual(fakeDoc);
  });

  it("fetches an edit record screen with record id", async () => {
    const fakeEditDoc = {
      version: "1.0.0",
      id: "invoice-INV-1",
      name: "Invoice",
      state: { id: "INV-1", status: "draft", _meta: { version: 2 } },
      root: { id: "root", type: "Column" },
    };

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => fakeEditDoc,
    });

    const client = createScreensClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    const doc = await client.get("invoice", "INV-1");
    expect(fakeFetch).toHaveBeenCalledWith("http://localhost:3000/screens/invoice/INV-1", expect.objectContaining({ method: "GET" }));
    expect(doc).toEqual(fakeEditDoc);
  });

  it("encodes viewId and recordId in the URL", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: "screen" }),
    });

    const client = createScreensClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    await client.get("my/view", "id with spaces");
    expect(fakeFetch).toHaveBeenCalledWith("http://localhost:3000/screens/my%2Fview/id%20with%20spaces", expect.objectContaining({ method: "GET" }));
  });

  it("translates problem json 404 into DataError", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ "content-type": "application/problem+json" }),
      json: async () => ({
        status: 404,
        title: "Not Found",
        detail: "No screen 'nope'.",
        code: "SCREEN_NOT_FOUND",
      }),
    });

    const client = createScreensClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });

    await expect(client.get("nope")).rejects.toThrow(DataError);
  });
});
