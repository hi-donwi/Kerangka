import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { createKerangkaHonoApp } from "../src/index.js";
import { MemoryStore } from "@kerangka/ports";

/**
 * The regression this file exists for.
 *
 * A model declaring a tenant-scoped `readFilter` and a `permissions` map served **every** tenant's
 * rows to a request carrying no `X-Actor-Id`, no `X-Actor-Roles` and no `X-Tenant-Id`:
 *
 *   GET    /api/doc  -> 200, both tenants
 *   GET    /api/doc/d-acme -> 200
 *   POST   /api/doc  -> 201
 *   DELETE /api/doc/d-acme -> 204
 *
 * Four causes, and this file closes the surface rather than one of them: the dead `typeof
 * === "object"` branch, the fail-open tenant check, the two GET paths that called the store
 * without planning, and `permissions` never being consulted. The tests that matter most are the
 * 403s, because a leak that returns 200 is a leak nobody downstream can detect.
 */
const kir = compile(
  JSON.stringify({
    kerangka: "0.1",
    app: "tenancy",
    roles: ["admin", "billing"],
    entities: {
      Doc: {
        fields: { id: "string!", tenantId: "string!", amount: "int!", deleted: "boolean" },
        readFilter: "tenantId == actor.tenantId",
        permissions: {
          read: ["admin", "billing"],
          create: ["admin"],
          update: ["admin"],
          delete: ["admin"]
        }
      },
      Open: { fields: { id: "string!", note: "string!" } }
    }
  })
);

const TENANTS = ["acme", "globex"];

async function seeded() {
  const store = new MemoryStore();
  const app = createKerangkaHonoApp(kir, { store });
  for (const tenantId of TENANTS) {
    await app.request("/api/doc", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Actor-Roles": "admin", "X-Tenant-Id": tenantId },
      body: JSON.stringify({ id: `d-${tenantId}`, tenantId, amount: 10 })
    });
  }
  return { store, app };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const as = (tenantId?: string, roles?: string): any => ({
  ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
  ...(roles ? { "X-Actor-Roles": roles } : {})
});

const json = (r: Response) =>
  r.json() as Promise<{ items?: Array<{ id?: string; tenantId?: string }> }>;

describe("a tenant-scoped collection is not readable by an anonymous caller", () => {
  it("refuses the list, instead of returning every tenant", () => {
    return seeded().then(async ({ app }) => {
      const res = await app.request("/api/doc", as());
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).not.toContain("globex");
      expect(body).not.toContain("acme");
    });
  });

  it("refuses a single record, instead of returning it", async () => {
    const { app } = await seeded();
    const res = await app.request("/api/doc/d-acme", as());

    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("acme");
  });

  it("refuses a create, an update and a delete", async () => {
    const { app } = await seeded();

    const created = await app.request("/api/doc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "d-new", tenantId: "acme", amount: 1 })
    });
    expect(created.status).toBe(403);

    const updated = await app.request("/api/doc/d-acme", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 99 })
    });
    expect(updated.status).toBe(403);

    const deleted = await app.request("/api/doc/d-acme", { method: "DELETE" });
    expect(deleted.status).toBe(403);
  });

  it("reports the refusal as a problem, with a stable code", async () => {
    const { app } = await seeded();
    const res = await app.request("/api/doc", as());
    const body = (await res.json()) as { type?: string; code?: string };

    expect(res.status).toBe(403);
    expect(body.type).toContain("problem");
    expect(body.code).toBe("PERMISSION_DENIED");
  });
});

describe("a caller that establishes a tenant sees only its own rows", () => {
  it("filters the list to one tenant", async () => {
    const { app } = await seeded();
    const res = await app.request("/api/doc", as("acme", "billing"));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.items?.map((i) => i.tenantId)).toEqual(["acme"]);
  });

  it("refuses a record belonging to another tenant", async () => {
    const { app } = await seeded();
    // A 404 here would be a defensible answer to a probe, and a bad one: it tells the caller
    // which ids exist. ADR-0040 requires the refusal, so the request is refused.
    const res = await app.request("/api/doc/d-globex", as("acme", "billing"));

    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("globex");
  });

  it("still answers a record that belongs to the caller", async () => {
    const { app } = await seeded();
    const res = await app.request("/api/doc/d-acme", as("acme", "billing"));

    expect(res.status).toBe(200);
    expect((await res.json() as { tenantId: string }).tenantId).toBe("acme");
  });
});

describe("a declared permission is enforced per operation", () => {
  it("refuses a delete from a role the model did not grant", async () => {
    const { app } = await seeded();
    const res = await app.request("/api/doc/d-acme", {
      method: "DELETE",
      headers: as("acme", "billing")
    });

    expect(res.status).toBe(403);
  });

  it("allows a delete from a role the model did grant", async () => {
    const { app } = await seeded();
    const res = await app.request("/api/doc/d-acme", {
      method: "DELETE",
      headers: as("acme", "admin")
    });

    expect(res.status).toBe(204);
  });

  it("refuses a create from a role the model did not grant", async () => {
    const { app } = await seeded();
    const res = await app.request("/api/doc", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...as("acme", "billing") },
      body: JSON.stringify({ id: "d-x", tenantId: "acme", amount: 1 })
    });

    expect(res.status).toBe(403);
  });
});

describe("an entity that declares no scoping stays open", () => {
  it("is readable and creatable without a caller", async () => {
    const { app } = await seeded();
    await app.request("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "o-1", note: "public" })
    });

    const res = await app.request("/api/open", as());

    expect(res.status).toBe(200);
    expect((await json(res)).items?.length).toBe(1);
  });
});

describe("a soft-deleted row is not readable through the plain REST path either", () => {
  it("excludes it from the collection", async () => {
    const { app } = await seeded();
    // Soft delete was enforced by `readFilter`, which `GET /api/:entity` never called.
    await app.request("/api/doc/d-acme", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...as("acme", "admin") },
      body: JSON.stringify({ deleted: true })
    });

    const res = await app.request("/api/doc", as("acme", "billing"));
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(body.items?.map((i) => i.id)).toEqual([]);
  });

  it("refuses to serve it by id", async () => {
    const { app } = await seeded();
    await app.request("/api/doc/d-acme", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...as("acme", "admin") },
      body: JSON.stringify({ deleted: true })
    });

    expect((await app.request("/api/doc/d-acme", as("acme", "billing"))).status).toBe(403);
  });
});
