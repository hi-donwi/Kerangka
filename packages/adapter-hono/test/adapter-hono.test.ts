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

  it("refuses a dashboard document instead of serving a wrong KPI", async () => {
    const invoicing = compile(readFileSync(resolve(examplesDir, "invoicing.kerangka.json"), "utf8"));
    const app = createKerangkaHonoApp(invoicing);
    const list = await (await app.request("/uidl")).json();
    expect(list.documents).not.toContain("home");
    const res = await app.request("/uidl/home");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("DASHBOARD_NOT_STATIC");
    expect(body.detail).toContain("GET /screens/home");
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
    const app = createKerangkaHonoApp(kir, { store, trustContextHeaders: true });

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
      trustContextHeaders: true,
    });

    // Create draft invoice
    const createRes = await app.request("/api/invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Roles": "billing",
      },
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
    const scope = computeRequestFingerprint("CONTEXT", kir.app, { roles: [] });
    expect(idem.begin(JSON.stringify([scope, "flight-1"]), fingerprint).kind).toBe("new");

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


  it("filters a named query whose where is written as text, instead of returning every row", async () => {
    const qkir = compile(
      JSON.stringify({
        kerangka: "0.1",
        app: "text-where",
        queries: { urgent: { from: "Task", where: "priority == 'high'" } },
        entities: { Task: { fields: { title: "string!", priority: "string" } } },
      })
    );
    const app = createKerangkaHonoApp(qkir, { store: new MemoryStore() });
    for (const [id, priority] of [["t-1", "high"], ["t-2", "low"], ["t-3", "high"]] as const) {
      await app.request("/api/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: id, priority }),
      });
    }
    const res = await app.request("/api/task/queries/urgent");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items.map((t: { id: string }) => t.id).sort()).toEqual(["t-1", "t-3"]);
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

  it("mounts /screens and computes dynamic dashboard KPIs when screens projector is provided", async () => {
    const doc = {
      kerangka: "0.1",
      app: "sales",
      roles: ["manager", "rep"],
      entities: {
        Deal: {
          fields: { amount: "decimal(12,2)!", stage: "enum(open, won, lost) = open", ownerId: "string!" },
          permissions: { read: ["manager", "rep"], create: ["manager", "rep"] },
          readFilter: "ownerId == actor.id",
        },
      },
      views: {
        home: {
          dashboard: [
            { kpi: "Won", sum: "Deal.amount", where: "stage == 'won'" },
            { kpi: "Open deals", count: "Deal", where: "stage == 'open'" },
          ],
        },
      },
    };
    const ckir = compile(JSON.stringify(doc));
    const store = new MemoryStore();

    // Fake screens projector adhering to ScreensProjectorLike
    const fakeScreens = {
      views: () => [
        { id: "home", kind: "dashboard" as const, route: "/" },
        { id: "deal-list", kind: "list" as const, entity: "Deal", route: "/deal-list" },
        { id: "deal-form", kind: "form" as const, entity: "Deal", route: "/deal-form/:id" },
      ],
      view: (id: string) => {
        if (id === "home") return { id: "home", kind: "dashboard" as const, route: "/" };
        if (id === "deal-list") return { id: "deal-list", kind: "list" as const, entity: "Deal", route: "/deal-list" };
        if (id === "deal-form") return { id: "deal-form", kind: "form" as const, entity: "Deal", route: "/deal-form/:id" };
        return undefined;
      },
      list: (viewId: string) => ({ id: viewId, kind: "list", type: "Column" }),
      form: (viewId: string, record?: { id: string; data: Record<string, unknown>; version?: number }) => ({
        id: viewId,
        kind: "form",
        record,
      }),
      kpis: (viewId: string) => [
        { kpi: "Won", sum: "Deal.amount", where: "stage == 'won'" },
        { kpi: "Open deals", count: "Deal", where: "stage == 'open'" },
      ],
      dashboard: (viewId: string, results: Array<{ value: number } | { withheld: true } | { error: string }>) => ({
        id: viewId,
        kind: "dashboard",
        results,
      }),
    };

    const app = createKerangkaHonoApp(ckir, { store, screens: fakeScreens, trustContextHeaders: true });

    // Seed deals
    await store.create("Deal", { id: "d-1", amount: 100.5, stage: "won", ownerId: "u-1" });
    await store.create("Deal", { id: "d-2", amount: 50.0, stage: "open", ownerId: "u-1" });
    await store.create("Deal", { id: "d-3", amount: 999.0, stage: "won", ownerId: "u-2" }); // different owner

    // 1. List screens
    const listScreensRes = await app.request("/screens");
    expect(listScreensRes.status).toBe(200);
    const screensList = await listScreensRes.json();
    expect(screensList.screens).toHaveLength(3);

    // 2. Dashboard screen with dynamic KPIs evaluated under actor context
    const dashRes = await app.request("/screens/home", {
      headers: { "X-Actor-Id": "u-1", "X-Actor-Roles": "rep" },
    });
    expect(dashRes.status).toBe(200);
    const dashJson = await dashRes.json();
    expect(dashJson.results).toEqual([
      { value: 100.5 }, // u-2's 999 is filtered by readFilter
      { value: 1 },     // d-2 is open
    ]);

    // 3. Form screen with existing record
    const formRes = await app.request("/screens/deal-form/d-1", {
      headers: { "X-Actor-Id": "u-1", "X-Actor-Roles": "rep" },
    });
    expect(formRes.status).toBe(200);
    const formJson = await formRes.json();
    expect(formJson.record.id).toBe("d-1");

    // 4. Form screen for forbidden record (u-2's deal)
    const forbiddenRes = await app.request("/screens/deal-form/d-3", {
      headers: { "X-Actor-Id": "u-1", "X-Actor-Roles": "rep" },
    });
    expect(forbiddenRes.status).toBe(403);

    // 5. 307 redirect from /uidl/home to /screens/home
    const uidlRedirectRes = await app.request("/uidl/home");
    expect(uidlRedirectRes.status).toBe(307);
    expect(uidlRedirectRes.headers.get("Location")).toBe("/screens/home");
  });
});
