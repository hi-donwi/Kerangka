import { describe, expect, it, vi } from "vitest";
import { compile } from "@kerangka/compiler";
import type { ActorContext } from "@kerangka/engine-ts";
import { MemoryStore } from "@kerangka/ports";
import { createKerangkaHonoApp, QueryEvaluationError, type ScreensProjectorLike } from "../src/index.js";

const kir = compile(JSON.stringify({
  kerangka: "0.1",
  app: "host-context",
  multitenancy: { strategy: "discriminator", field: "tenantId" },
  roles: ["editor", "reader"],
  queries: { notes: { from: "Note" } },
  entities: {
    Note: {
      fields: { id: "string!", tenantId: "string!", text: "string!", status: "enum(draft, published) = draft" },
      permissions: { read: ["editor", "reader"], create: ["editor"], update: ["editor"], delete: ["editor"] },
      actions: {
        stamp: { roles: ["editor"], then: [{ set: { text: "actor.id" } }] },
        move: { roles: ["editor"], then: [{ set: { tenantId: "'beta'" } }] }
      },
      workflow: { field: "status", transitions: {
        publish: { from: "draft", to: "published", roles: ["editor"] },
        move: { from: "draft", to: "published", roles: ["editor"], then: [{ set: { tenantId: "'beta'" } }] }
      } }
    }
  }
}));

const alpha: ActorContext = { id: "alpha-user", roles: ["editor"], tenantId: "alpha" };
const beta: ActorContext = { id: "beta-user", roles: ["editor"], tenantId: "beta" };
const forged = { "X-Actor-Id": "forged", "X-Actor-Roles": "editor", "X-Tenant-Id": "beta" };
const jsonHeaders = { "Content-Type": "application/json" };

const screens: ScreensProjectorLike = {
  views: () => [],
  view: (id) => id === "home"
    ? { id, kind: "dashboard", route: "/" }
    : { id, kind: "form", entity: "Note", route: "/notes/:id" },
  list: () => ({}),
  form: (_id, record) => ({ record }),
  kpis: () => [{ count: "Note" }],
  dashboard: (_id, results) => ({ results })
};

async function seeded() {
  const store = new MemoryStore();
  for (const tenantId of ["alpha", "beta"]) {
    await store.create("Note", { id: `${tenantId}-note`, tenantId, text: `${tenantId}-secret`, status: "draft" });
  }
  return store;
}

describe("host-owned actor and tenant context (KX-01)", () => {
  it("does not trust actor headers or tenant query parameters by default", async () => {
    const store = await seeded();
    const app = createKerangkaHonoApp({ ...kir, multitenancy: undefined }, { store });
    const res = await app.request("/api/note?tenantId=beta", { headers: forged });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("PERMISSION_DENIED");
  });

  it("supports explicit header trust for development", async () => {
    const store = await seeded();
    const app = createKerangkaHonoApp(kir, { store, trustContextHeaders: true });
    const res = await app.request("/api/note?tenantId=alpha", {
      headers: { "X-Actor-Id": "dev-user", "X-Actor-Roles": "reader" }
    });
    expect(res.status).toBe(200);
    expect((await res.json()).items.map((row: { id: string }) => row.id)).toEqual(["alpha-note"]);
  });

  it("resolves a host context once and ignores forged identity and tenant scope", async () => {
    const store = await seeded();
    const resolveContext = vi.fn(async (request: Request) => {
      expect(request.headers.get("Authorization")).toBe("Bearer verified-session");
      return alpha;
    });
    const app = createKerangkaHonoApp(kir, { store, resolveContext, trustContextHeaders: true });
    const res = await app.request("/api/note?tenantId=beta", {
      headers: { ...forged, Authorization: "Bearer verified-session" }
    });
    expect(res.status).toBe(200);
    expect((await res.json()).items.map((row: { id: string }) => row.id)).toEqual(["alpha-note"]);
    expect(resolveContext).toHaveBeenCalledTimes(1);
    expect(resolveContext.mock.calls[0]?.[0]).toBeInstanceOf(Request);
  });

  it("never falls back to headers when the host returns null", async () => {
    const app = createKerangkaHonoApp(kir, {
      store: await seeded(), trustContextHeaders: true, resolveContext: async () => null
    });
    const res = await app.request("/api/note", { headers: forged });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("TENANT_REQUIRED");
  });

  it.each([false, true])("does not promote body roles to an actor (host resolver: %s)", async (useResolver) => {
    const store = await seeded();
    const app = createKerangkaHonoApp({ ...kir, multitenancy: undefined }, {
      store, ...(useResolver ? { resolveContext: async () => null } : {})
    });
    const update = vi.spyOn(store, "update");
    const action = await app.request("/api/note/alpha-note/actions/stamp", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ id: "forged", roles: ["editor"] })
    });
    expect(action.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    const mcp = await app.request("/api/mcp/call", {
      method: "POST", headers: jsonHeaders,
      body: JSON.stringify({ name: "Note.stamp", arguments: {
        id: "forged", roles: ["editor"], record: { tenantId: "alpha", text: "before" }
      } })
    });
    expect(await mcp.json()).toMatchObject({ ok: false, error: "PERMISSION_DENIED" });
  });

  it.each([["plain", Error], ["typed", QueryEvaluationError]] as const)("fails closed without exposing a resolver failure (%s)", async (_kind, Failure) => {
    const store = await seeded();
    const find = vi.spyOn(store, "find");
    const app = createKerangkaHonoApp(kir, {
      store, trustContextHeaders: true,
      resolveContext: async () => { throw new Failure("private identity backend failure"); }
    });
    const res = await app.request("/api/note", { headers: forged });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await res.text()).not.toContain("private identity");
    expect(find).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/api/note"],
    ["GET", "/api/note/alpha-note"],
    ["POST", "/api/note"],
    ["PUT", "/api/note/alpha-note"],
    ["DELETE", "/api/note/alpha-note"],
    ["GET", "/api/note/queries/notes"],
    ["POST", "/api/note/alpha-note/actions/stamp"],
    ["POST", "/api/note/alpha-note/transitions/publish"],
    ["POST", "/api/mcp/call"],
    ["GET", "/screens"],
    ["GET", "/screens/home"],
    ["GET", "/screens/note/alpha-note"]
  ])("refuses %s %s without a tenant before touching the store", async (method, path) => {
    const store = await seeded();
    const accesses = [vi.spyOn(store, "get"), vi.spyOn(store, "find"), vi.spyOn(store, "create"),
      vi.spyOn(store, "update"), vi.spyOn(store, "delete")];
    const app = createKerangkaHonoApp(kir, {
      store, screens, resolveContext: async () => ({ id: "known-user", roles: ["editor"] })
    });
    const res = await app.request(path, {
      method, headers: jsonHeaders,
      ...(method === "POST" || method === "PUT" ? { body: JSON.stringify({ name: "Note.stamp", record: {} }) } : {})
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("TENANT_REQUIRED");
    for (const access of accesses) expect(access).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("refuses an empty tenant (%j)", async (tenantId) => {
    const app = createKerangkaHonoApp(kir, { resolveContext: async () => ({ ...alpha, tenantId }) });
    const res = await app.request("/api/note");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("TENANT_REQUIRED");
  });

  it("keeps metadata and preflight available without resolving an actor", async () => {
    const resolveContext = vi.fn(async () => null);
    const app = createKerangkaHonoApp(kir, { resolveContext });
    for (const path of ["/health", "/livez", "/openapi.json", "/schema.graphql", "/api/mcp/tools", "/uidl"]) {
      expect((await app.request(path)).status).toBe(200);
    }
    expect((await app.request("/api/note", { method: "OPTIONS" })).status).toBe(204);
    expect(resolveContext).not.toHaveBeenCalled();
  });

  it("scopes item reads at the store boundary, not just through a read filter", async () => {
    const store = await seeded();
    const get = vi.spyOn(store, "get");
    const app = createKerangkaHonoApp(kir, { store, resolveContext: async () => alpha });
    const res = await app.request("/api/note/beta-note", { headers: forged });
    expect(res.status).toBe(404);
    expect(get).toHaveBeenCalledWith("Note", "beta-note", { tenantId: "alpha" });
    expect(await res.text()).not.toContain("beta-secret");
  });

  it("applies the host context to named queries, screens and MCP", async () => {
    const app = createKerangkaHonoApp(kir, { store: await seeded(), screens, resolveContext: async () => alpha });
    const query = await app.request("/api/note/queries/notes?tenantId=beta", { headers: forged });
    expect(query.status).toBe(200);
    expect((await query.json()).items.map((row: { id: string }) => row.id)).toEqual(["alpha-note"]);
    const dashboard = await app.request("/screens/home?tenantId=beta", { headers: forged });
    expect(dashboard.status).toBe(200);
    expect(await dashboard.json()).toEqual({ results: [{ value: 1 }] });
    const form = await app.request("/screens/note/alpha-note", { headers: forged });
    expect(form.status).toBe(200);
    expect((await form.json()).record.data.text).toBe("alpha-secret");
    const mcp = await app.request("/api/mcp/call", {
      method: "POST", headers: { ...forged, ...jsonHeaders },
      body: JSON.stringify({ name: "Note.stamp", arguments: { record: { id: "virtual", tenantId: "alpha", text: "before" } } })
    });
    expect(mcp.status).toBe(200);
    expect((await mcp.json()).record.text).toBe("alpha-user");
  });

  it("binds a created record and its audit actor to the host context", async () => {
    const store = await seeded();
    const app = createKerangkaHonoApp(kir, { store, resolveContext: async () => alpha });
    const res = await app.request("/api/note", {
      method: "POST", headers: { ...forged, ...jsonHeaders },
      body: JSON.stringify({ id: "new-note", text: "new" })
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ tenantId: "alpha", createdBy: "alpha-user" });
  });

  it.each([
    ["POST", "/api/note"],
    ["PUT", "/api/note/alpha-note"],
    ["DELETE", "/api/note/alpha-note"],
    ["POST", "/api/note/alpha-note/actions/stamp"],
    ["POST", "/api/note/alpha-note/transitions/publish"]
  ])("does not elevate a host reader through headers on %s %s", async (method, path) => {
    const store = await seeded();
    const writes = [vi.spyOn(store, "create"), vi.spyOn(store, "update"), vi.spyOn(store, "delete")];
    const app = createKerangkaHonoApp(kir, {
      store, trustContextHeaders: true, resolveContext: async () => ({ ...alpha, roles: ["reader"] })
    });
    const res = await app.request(path, {
      method, headers: { ...forged, ...jsonHeaders },
      ...(method === "DELETE" ? {} : { body: JSON.stringify({ id: "new-note", tenantId: "alpha", text: "new" }) })
    });
    expect(res.status).toBe(403);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it("uses host scope for updates, transitions and deletes", async () => {
    const store = await seeded();
    const app = createKerangkaHonoApp(kir, { store, resolveContext: async () => alpha });
    const updated = await app.request("/api/note/alpha-note", {
      method: "PUT", headers: { ...forged, ...jsonHeaders }, body: JSON.stringify({ text: "edited" })
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ tenantId: "alpha", text: "edited", updatedBy: "alpha-user" });
    const published = await app.request("/api/note/alpha-note/transitions/publish", { method: "POST", headers: forged });
    expect(published.status).toBe(200);
    expect((await published.json()).record.status).toBe("published");
    const deleted = await app.request("/api/note/alpha-note", { method: "DELETE", headers: forged });
    expect(deleted.status).toBe(204);
    expect(await store.get("Note", "alpha-note")).toBeNull();
    expect((await store.get("Note", "beta-note"))?.text).toBe("beta-secret");
  });

  it("does not share context between concurrent requests", async () => {
    const app = createKerangkaHonoApp(kir, {
      store: await seeded(),
      resolveContext: async (request: Request) => {
        await Promise.resolve();
        return request.headers.get("Authorization") === "Bearer alpha" ? alpha : beta;
      }
    });
    const responses = await Promise.all(["alpha", "beta"].map((tenantId) => app.request("/api/note", {
      headers: { Authorization: `Bearer ${tenantId}` }
    })));
    for (const [index, res] of responses.entries()) {
      expect(res.status).toBe(200);
      expect((await res.json()).items.map((row: { tenantId: string }) => row.tenantId)).toEqual([index === 0 ? "alpha" : "beta"]);
    }
  });

  it("rejects an MCP record from another tenant", async () => {
    const app = createKerangkaHonoApp(kir, { resolveContext: async () => alpha });
    const res = await app.request("/api/mcp/call", {
      method: "POST", headers: jsonHeaders,
      body: JSON.stringify({ name: "Note.stamp", arguments: { record: { tenantId: "beta", text: "foreign" } } })
    });
    expect(res.status).toBe(403);
  });

  it.each(["POST", "PUT"])("refuses a tenant change in a %s body", async (method) => {
    const store = await seeded();
    const app = createKerangkaHonoApp(kir, { store, resolveContext: async () => alpha });
    const res = await app.request(method === "POST" ? "/api/note" : "/api/note/alpha-note", {
      method, headers: jsonHeaders, body: JSON.stringify({ id: "new-note", text: "new", tenantId: "beta" })
    });
    expect(res.status).toBe(403);
    expect((await store.get("Note", "alpha-note"))?.tenantId).toBe("alpha");
  });

  it.each(["actions/move", "transitions/move"])("refuses a tenant change from %s before persistence", async (operation) => {
    const store = await seeded();
    const update = vi.spyOn(store, "update");
    const app = createKerangkaHonoApp(kir, { store, resolveContext: async () => alpha });
    const res = await app.request(`/api/note/alpha-note/${operation}`, { method: "POST" });
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect(await store.get("Note", "alpha-note")).toMatchObject({ tenantId: "alpha", status: "draft" });
  });

  it("isolates idempotent responses between tenants and replays within one context", async () => {
    let actor = alpha;
    const app = createKerangkaHonoApp(kir, { store: await seeded(), resolveContext: async () => actor });
    const request = (id: string) => app.request("/api/note", {
      method: "POST", headers: { ...jsonHeaders, "Idempotency-Key": "shared-key" },
      body: JSON.stringify({ id, tenantId: actor.tenantId, text: id })
    });
    const first = await request("alpha-new");
    expect(first.status).toBe(201);
    const replay = await request("alpha-new");
    expect(replay.status).toBe(201);
    expect(replay.headers.get("X-Idempotent-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(await first.json());
    actor = beta;
    const other = await request("beta-new");
    expect(other.status).toBe(201);
    expect((await other.json()).tenantId).toBe("beta");
    expect(other.headers.get("X-Cache-Lookup")).toBeNull();
  });

  it("does not replay an action cached for another actor or a revoked role", async () => {
    let actor = alpha;
    const app = createKerangkaHonoApp(kir, { store: await seeded(), resolveContext: async () => actor });
    const stamp = () => app.request("/api/note/alpha-note/actions/stamp", {
      method: "POST", headers: { ...jsonHeaders, "Idempotency-Key": "stamp-key" }, body: "{}"
    });
    const first = await stamp();
    expect(first.status).toBe(200);
    expect((await first.json()).record.text).toBe("alpha-user");
    actor = { ...alpha, id: "second-user" };
    const second = await stamp();
    expect(second.status).toBe(200);
    expect((await second.json()).record.text).toBe("second-user");
    actor = { ...actor, roles: ["reader"] };
    const revoked = await stamp();
    expect(revoked.status).toBe(403);
    expect(revoked.headers.get("X-Idempotent-Replayed")).toBeNull();
  });

  it("treats reordered roles as the same idempotency scope", async () => {
    let roles = ["editor", "reader"];
    const store = await seeded();
    const update = vi.spyOn(store, "update");
    const app = createKerangkaHonoApp(kir, { store, resolveContext: async () => ({ ...alpha, roles }) });
    const stamp = () => app.request("/api/note/alpha-note/actions/stamp", {
      method: "POST", headers: { ...jsonHeaders, "Idempotency-Key": "role-order" }, body: "{}"
    });
    expect((await stamp()).status).toBe(200);
    roles = ["reader", "editor"];
    const replay = await stamp();
    expect(replay.status).toBe(200);
    expect(replay.headers.get("X-Idempotent-Replayed")).toBe("true");
    expect(update).toHaveBeenCalledTimes(1);
  });
});
