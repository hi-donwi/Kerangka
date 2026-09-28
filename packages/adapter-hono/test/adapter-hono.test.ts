import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { MemoryStore } from "@kerangka/ports";
import { createKerangkaHonoApp } from "../src/index.js";

describe("Hono HTTP Adapter (@kerangka/adapter-hono)", () => {
  const examplesDir = resolve(__dirname, "../../../examples");
  const todoRaw = readFileSync(resolve(examplesDir, "todo.kerangka.json"), "utf8");
  const kir = compile(todoRaw);

  it("serves metadata endpoints (OpenAPI, GraphQL, MCP, UIDL, health)", async () => {
    const app = createKerangkaHonoApp(kir);

    // 1. Health
    const healthRes = await app.request("/health");
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toEqual({ status: "ok" });

    // 2. OpenAPI
    const openApiRes = await app.request("/openapi.json");
    expect(openApiRes.status).toBe(200);
    const openApiJson = await openApiRes.json();
    expect(openApiJson.openapi).toBe("3.1.0");
    expect(openApiJson.info.title).toContain("Todo");

    // 3. GraphQL SDL
    const gqlRes = await app.request("/schema.graphql");
    expect(gqlRes.status).toBe(200);
    const gqlText = await gqlRes.text();
    expect(gqlText).toContain("type Todo");

    // 4. MCP Tools
    const mcpRes = await app.request("/api/mcp/tools");
    expect(mcpRes.status).toBe(200);
    const mcpJson = await mcpRes.json();
    expect(mcpJson.tools.length).toBeGreaterThan(0);

    // 5. UIDL
    const uidlListRes = await app.request("/uidl");
    expect(uidlListRes.status).toBe(200);
    const uidlList = await uidlListRes.json();
    expect(uidlList.documents.length).toBeGreaterThan(0);
  });

  it("performs full CRUD operations over REST", async () => {
    const store = new MemoryStore();
    const app = createKerangkaHonoApp(kir, { store });

    // 1. Create
    const createRes = await app.request("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "td-1",
        title: "Test Hono Adapter",
        completed: false,
        priority: "high",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBe("td-1");
    expect(created.title).toBe("Test Hono Adapter");

    // 2. List
    const listRes = await app.request("/api/todo");
    expect(listRes.status).toBe(200);
    expect(listRes.headers.get("X-Total-Count")).toBe("1");
    const listJson = await listRes.json();
    expect(listJson.items).toHaveLength(1);
    expect(listJson.items[0].id).toBe("td-1");

    // 3. Get item
    const getRes = await app.request("/api/todo/td-1");
    expect(getRes.status).toBe(200);
    const item = await getRes.json();
    expect(item.id).toBe("td-1");

    // 4. Update item
    const putRes = await app.request("/api/todo/td-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    expect(putRes.status).toBe(200);
    const updated = await putRes.json();
    expect(updated.completed).toBe(true);

    // 5. Delete item
    const delRes = await app.request("/api/todo/td-1", { method: "DELETE" });
    expect(delRes.status).toBe(204);

    // 6. Verify 404 after delete
    const afterDel = await app.request("/api/todo/td-1");
    expect(afterDel.status).toBe(404);
  });

  it("returns RFC 9457 Problem Details on validation failures", async () => {
    const app = createKerangkaHonoApp(kir);

    const invalidRes = await app.request("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Missing required 'title'
        completed: false,
      }),
    });

    expect(invalidRes.status).toBe(422);
    expect(invalidRes.headers.get("Content-Type")).toContain("application/problem+json");

    const problem = await invalidRes.json();
    expect(problem.type).toBe("https://kerangka.dev/errors/INPUT_INVALID");
    expect(problem.title).toBe("Validation Failed");
    expect(problem.status).toBe(422);
    expect(problem.code).toBe("INPUT_INVALID");
    expect(problem.instance).toBe("/api/todo");
    expect(Array.isArray(problem.errors)).toBe(true);
  });

  it("handles optimistic concurrency version conflicts with RFC 9457", async () => {
    const store = new MemoryStore();
    const app = createKerangkaHonoApp(kir, { store });

    // Seed record with version 1
    await store.create("Todo", {
      id: "td-oc",
      title: "Concurrency Task",
      completed: false,
      priority: "medium",
      version: 1,
    });

    // Attempt update with stale version
    const staleUpdateRes = await app.request("/api/todo/td-oc", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": '"99"',
      },
      body: JSON.stringify({ title: "Updated" }),
    });

    expect(staleUpdateRes.status).toBe(409);
    expect(staleUpdateRes.headers.get("Content-Type")).toContain("application/problem+json");
    const problem = await staleUpdateRes.json();
    expect(problem.code).toBe("VERSION_CONFLICT");
    expect(problem.title).toBe("Version Conflict");
  });

  it("supports Idempotency-Key and replays identical responses without re-executing", async () => {
    const store = new MemoryStore();
    const app = createKerangkaHonoApp(kir, { store });

    const key = "idem-key-999";

    // First request
    const firstRes = await app.request("/api/todo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        id: "td-idem",
        title: "Idempotent Creation",
        completed: false,
        priority: "low",
      }),
    });
    expect(firstRes.status).toBe(201);
    const firstBody = await firstRes.json();
    expect(firstBody.id).toBe("td-idem");

    // Second request with same Idempotency-Key
    const secondRes = await app.request("/api/todo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        id: "td-idem",
        title: "Idempotent Creation",
        completed: false,
        priority: "low",
      }),
    });

    // Replay returns the ORIGINAL response status (201), matching server.ts and
    // draft-ietf-httpapi-idempotency semantics.
    expect(secondRes.status).toBe(201);
    expect(secondRes.headers.get("X-Cache-Lookup")).toBe("HIT");
    expect(secondRes.headers.get("X-Idempotent-Replayed")).toBe("true");
    const secondBody = await secondRes.json();
    expect(secondBody).toEqual(firstBody);

    // Verify only 1 record exists in store
    const list = await store.find("Todo");
    expect(list.total).toBe(1);
  });

  it("enforces tenant isolation via X-Tenant-Id header", async () => {
    const store = new MemoryStore();
    const app = createKerangkaHonoApp(kir, { store });

    // Tenant Alpha creates todo
    await app.request("/api/todo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": "alpha",
      },
      body: JSON.stringify({ id: "td-alpha", title: "Alpha Task", completed: false, priority: "high" }),
    });

    // Tenant Beta creates todo
    await app.request("/api/todo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": "beta",
      },
      body: JSON.stringify({ id: "td-beta", title: "Beta Task", completed: false, priority: "low" }),
    });

    // Query Tenant Alpha
    const alphaList = await (await app.request("/api/todo", { headers: { "X-Tenant-Id": "alpha" } })).json();
    expect(alphaList.items).toHaveLength(1);
    expect(alphaList.items[0].id).toBe("td-alpha");

    // Query Tenant Beta
    const betaList = await (await app.request("/api/todo", { headers: { "X-Tenant-Id": "beta" } })).json();
    expect(betaList.items).toHaveLength(1);
    expect(betaList.items[0].id).toBe("td-beta");
  });

  it("dispatches side-effects to ConnectorsPort when actions/transitions execute", async () => {
    const invoicingRaw = readFileSync(resolve(examplesDir, "invoicing.kerangka.json"), "utf8");
    const invoicingKir = compile(invoicingRaw);
    const store = new MemoryStore();

    const dispatchedCalls: unknown[] = [];
    const mockConnectors = {
      has: () => true,
      call: async <T = unknown>(invocation: unknown): Promise<T> => {
        dispatchedCalls.push(invocation);
        return { ok: true } as unknown as T;
      },
    };

    const app = createKerangkaHonoApp(invoicingKir, {
      store,
      connectors: mockConnectors,
    });

    // Create draft invoice
    const createRes = await app.request("/api/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "INV-999",
        number: "INV-999",
        customer: "cust-1",
        status: "draft",
        issuedOn: "2026-09-28",
        dueDate: "2026-10-28",
        lines: [{ description: "Consulting", qty: 2, unitPrice: 500 }],
      }),
    });
    expect(createRes.status).toBe(201);

    // Trigger "send" transition which has { "call": "sendInvoiceEmail" }
    const sendRes = await app.request("/api/invoice/INV-999/transitions/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Roles": "billing",
      },
    });

    expect(sendRes.status).toBe(200);
    const sendBody = await sendRes.json();
    expect(sendBody.ok).toBe(true);
    expect(sendBody.record.status).toBe("sent");

    // Verify side-effect call dispatched to connectors
    expect(dispatchedCalls.length).toBeGreaterThan(0);
    expect(dispatchedCalls[0]).toMatchObject({
      connector: "sendInvoiceEmail",
      operation: "call",
    });
  });


  it("rejects Idempotency-Key reuse with a different payload (IDEMPOTENCY_CONFLICT)", async () => {
    const app = createKerangkaHonoApp(kir);

    const firstRes = await app.request("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "conflict-1" },
      body: JSON.stringify({ id: "td-c1", title: "First", completed: false, priority: "low" }),
    });
    expect(firstRes.status).toBe(201);

    const secondRes = await app.request("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "conflict-1" },
      body: JSON.stringify({ id: "td-c1", title: "Different payload", completed: false, priority: "low" }),
    });
    expect(secondRes.status).toBe(422);
    const problem = await secondRes.json();
    expect(problem.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(problem.title).toBe("Idempotency Conflict");
  });

  it("rejects concurrent duplicates of an in-flight request (IDEMPOTENCY_IN_PROGRESS)", async () => {
    const store = new MemoryStore();
    const app = createKerangkaHonoApp(kir, { store });

    // Begin (mark in flight) directly on the store to simulate a concurrent duplicate
    // while the first request is still executing.
    const { MemoryIdempotencyStore, computeRequestFingerprint } = await import("../src/index.js");
    const idem = new MemoryIdempotencyStore();
    const fingerprint = computeRequestFingerprint("POST", "/api/todo", { id: "td-flight" });
    expect(idem.begin("flight-1", fingerprint).kind).toBe("new");

    const app2 = createKerangkaHonoApp(kir, { store, idempotencyStore: idem });
    const dupRes = await app2.request("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "flight-1" },
      body: JSON.stringify({ id: "td-flight", title: "Concurrent", completed: false, priority: "low" }),
    });
    expect(dupRes.status).toBe(409);
    const problem = await dupRes.json();
    expect(problem.code).toBe("IDEMPOTENCY_IN_PROGRESS");
  });

  it("sorts collection results via the sort parameter", async () => {
    const store = new MemoryStore();
    const app = createKerangkaHonoApp(kir, { store });

    for (const [id, priority] of [["td-a", "low"], ["td-b", "high"], ["td-c", "low"]]) {
      await app.request("/api/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: `Task ${id}`, completed: false, priority }),
      });
    }

    const asc = await app.request("/api/todo?sort=priority");
    const ascJson = await asc.json();
    const prioritiesAsc = ascJson.items.map((t: { priority: string }) => t.priority);
    expect(prioritiesAsc).toEqual([...prioritiesAsc].sort());

    const desc = await app.request("/api/todo?sort=-priority");
    const descJson = await desc.json();
    const prioritiesDesc = descJson.items.map((t: { priority: string }) => t.priority);
    expect(prioritiesDesc).toEqual([...prioritiesAsc].reverse());
  });

  it("paginates collections with an opaque nextCursor", async () => {
    const store = new MemoryStore();
    const app = createKerangkaHonoApp(kir, { store });

    for (let i = 1; i <= 5; i += 1) {
      await app.request("/api/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: `td-${i}`, title: `Task ${i}`, completed: false, priority: "low" }),
      });
    }

    const page1 = await app.request("/api/todo?limit=2");
    const page1Json = await page1.json();
    expect(page1Json.items).toHaveLength(2);
    expect(page1Json.nextCursor).toBeDefined();
    expect(typeof page1Json.nextCursor).toBe("string");

    const page2 = await app.request(`/api/todo?limit=2&cursor=${encodeURIComponent(page1Json.nextCursor)}`);
    const page2Json = await page2.json();
    expect(page2Json.items).toHaveLength(2);
    const seen = new Set([...page1Json.items, ...page2Json.items].map((t: { id: string }) => t.id));
    expect(seen.size).toBe(4);

    const page3 = await app.request(`/api/todo?limit=2&cursor=${encodeURIComponent(page2Json.nextCursor)}`);
    const page3Json = await page3.json();
    expect(page3Json.items).toHaveLength(1);
    expect(page3Json.nextCursor).toBeUndefined();
  });

  it("rejects malformed cursors with a problem details response", async () => {
    const app = createKerangkaHonoApp(kir);
    const res = await app.request("/api/todo?cursor=!!!not-base64!!!");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toEqual([]);
  });


  it("serves named queries with filtering, sorting, projection, and paging", async () => {
    const doc = {
      kerangka: "0.1",
      app: "queries-app",
      queries: {
        byPriority: {
          from: "Task",
          where: ["==", ["get", "priority"], "high"],
          select: ["id", "priority"],
          orderBy: ["-seq"],
          pageSize: 2,
        },
      },
      entities: {
        Task: {
          fields: {
            title: "string!",
            priority: "string",
            seq: "int",
          },
        },
      },
    };
    const qkir = compile(JSON.stringify(doc));
    const store = new MemoryStore();
    const app = createKerangkaHonoApp(qkir, { store });

    for (let i = 1; i <= 3; i += 1) {
      await app.request("/api/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `t-${i}`,
          title: `Task ${i}`,
          priority: i === 2 ? "low" : "high",
          seq: i,
        }),
      });
    }

    // Filter + sort desc + projection
    const res = await app.request("/api/task/queries/byPriority");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.query).toBe("byPriority");
    expect(json.total).toBe(2);
    expect(json.items.map((t: { id: string }) => t.id)).toEqual(["t-3", "t-1"]);
    // Projection: only selected fields survive
    expect(Object.keys(json.items[0]).sort()).toEqual(["id", "priority"]);
    expect(json.items[0].title).toBeUndefined();

    // Paging: default pageSize 2 → both rows; explicit limit=1 → nextCursor
    const page1 = await app.request("/api/task/queries/byPriority?limit=1");
    const page1Json = await page1.json();
    expect(page1Json.items).toHaveLength(1);
    expect(page1Json.nextCursor).toBeDefined();

    const page2 = await app.request(
      `/api/task/queries/byPriority?limit=1&cursor=${encodeURIComponent(page1Json.nextCursor)}`
    );
    const page2Json = await page2.json();
    expect(page2Json.items).toHaveLength(1);
    expect(page2Json.items[0].id).toBe("t-1");
  });

  it("supports comparison predicates and named query 404s", async () => {
    const doc = {
      kerangka: "0.1",
      app: "queries-cmp",
      queries: {
        expensive: {
          from: "Task",
          where: [">=", ["get", "weight"], 10],
          orderBy: ["-weight"],
        },
      },
      entities: {
        Task: {
          fields: { title: "string!", weight: "int", createdAt: "datetime" },
        },
      },
    };
    const ckir = compile(JSON.stringify(doc));
    const store = new MemoryStore();
    const app = createKerangkaHonoApp(ckir, { store });

    for (const [id, weight] of [["t-a", 5], ["t-b", 15], ["t-c", 20]]) {
      await app.request("/api/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: `T ${id}`, weight, createdAt: "2026-01-01T00:00:00Z" }),
      });
    }

    const res = await app.request("/api/task/queries/expensive");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items.map((t: { id: string }) => t.id)).toEqual(["t-c", "t-b"]);

    const missing = await app.request("/api/task/queries/nope");
    expect(missing.status).toBe(404);
    const problem = await missing.json();
    expect(problem.code).toBe("NOT_FOUND");

    const wrongEntity = await app.request("/api/widget/queries/expensive");
    expect(wrongEntity.status).toBe(404);
  });
});
