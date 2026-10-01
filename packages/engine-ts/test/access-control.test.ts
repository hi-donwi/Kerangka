import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { Engine } from "../src/index.js";

/**
 * ADR-0008 says every permission check fails closed. Nothing in the runtime did: an entity's
 * `permissions` map was read by the verifier to warn about unused roles, and by nothing that
 * decides a request. A `delete` restricted to `admin` was decorative.
 *
 * These tests pin `canOperate`, and — more importantly — pin that a tenant-scoped read with no
 * caller is a refusal rather than an empty constraint. That second one is the one that leaks:
 * the old code read an absent actor as "no constraint", so the only request guaranteed to see
 * every tenant's rows was the one that had identified itself as nobody.
 */
const kir = compile(
  JSON.stringify({
    kerangka: "0.1",
    app: "authz",
    roles: ["admin", "billing", "guest"],
    entities: {
      Doc: {
        fields: { id: "string!", tenantId: "string!", status: "string!" },
        readFilter: "tenantId == actor.tenantId",
        permissions: { read: ["admin", "billing"], create: ["admin"], delete: ["admin"] }
      },
      Public: {
        fields: { id: "string!" }
        // no readFilter, no permissions: unrestricted, because that is what it declares
      },
      Scoped: {
        fields: { id: "string!", tenantId: "string!" }
        // tenant-scoped by the mere presence of tenantId, no readFilter declared
      }
    }
  })
);

const engine = () => new Engine(kir);

/** The predicate of a scope that is asserted to be allowed, without repeating the check. */
function whereOf(scope: { allowed: boolean; where?: unknown }): unknown {
  if (!("where" in scope)) throw new Error(`expected an allowed scope, got a refusal`);
  return scope.where;
}
const admin = { id: "u-1", roles: ["admin"], tenantId: "acme" };
const billing = { id: "u-2", roles: ["billing"], tenantId: "acme" };
const guest = { id: "u-3", roles: ["guest"], tenantId: "acme" };

describe("an entity's declared permissions are enforced", () => {
  it("allows an operation the actor's roles cover", () => {
    expect(engine().canOperate("Doc", "read", admin).allowed).toBe(true);
    expect(engine().canOperate("Doc", "create", admin).allowed).toBe(true);
  });

  it("refuses an operation the actor's roles do not cover", () => {
    const denied = engine().canOperate("Doc", "delete", billing);
    expect(denied.allowed).toBe(false);
    expect(denied.code).toBe("PERMISSION_DENIED");
  });

  it("refuses a role the model never granted, even if the caller claims it", () => {
    expect(engine().canOperate("Doc", "create", guest).allowed).toBe(false);
  });

  it("refuses when there is no actor at all", () => {
    // The case that produced the 200 in the original report.
    expect(engine().canOperate("Doc", "read", undefined).allowed).toBe(false);
  });

  it("refuses when the actor has no roles", () => {
    expect(engine().canOperate("Doc", "read", { id: "u-4" }).allowed).toBe(false);
  });

  it("leaves an operation undeclared alone, because the model did not restrict it", () => {
    // `update` is absent from Doc's permissions. Undeclared is not the same as denied: an author
    // who lists `delete` and omits `update` means "no restriction on update", and failing that
    // closed would break every model that mentions only the operations it cares about.
    expect(engine().canOperate("Doc", "update", guest).allowed).toBe(true);
  });

  it("leaves an entity with no permissions map unrestricted", () => {
    expect(engine().canOperate("Public", "delete", guest).allowed).toBe(true);
    expect(engine().canOperate("Public", "delete", undefined).allowed).toBe(true);
  });

  it("refuses every operation on an unknown entity rather than passing it through", () => {
    expect(engine().canOperate("Nope", "read", admin).allowed).toBe(false);
  });
});

describe("a tenant-scoped read with no caller is denied, not unscoped", () => {
  it("refuses when the actor carries no tenant", () => {
    const scope = engine().authorizeRead("Doc", admin);
    expect(scope.allowed).toBe(true);

    // Same entity, same declared filter, but the caller never said who they are.
    expect(engine().authorizeRead("Doc", undefined).allowed).toBe(false);
    expect(engine().authorizeRead("Doc", { id: "u-1", roles: ["admin"] }).allowed).toBe(false);
  });

  it("refuses a tenant-scoped entity that declares no readFilter of its own", () => {
    // `Scoped` has no readFilter, but it has a tenantId, and the engine's own rule treats that
    // as tenant-scoped. Before this, that entity was readable by anyone at all.
    expect(engine().authorizeRead("Scoped", undefined).allowed).toBe(false);
  });

  it("allows an entity that declares neither scoping nor a filter", () => {
    expect(engine().authorizeRead("Public", undefined).allowed).toBe(true);
  });

  it("refuses on an unknown entity rather than allowing it", () => {
    expect(engine().authorizeRead("Nope", undefined).allowed).toBe(false);
  });
});

describe("an allowed read scope carries the caller's constraints", () => {
  it("ANDs the declared filter with the caller's tenant", () => {
    const scope = engine().authorizeRead("Doc", billing);
    expect(scope.allowed).toBe(true);
    expect(whereOf(scope)).toEqual([
      "and",
      ["==", ["get", "tenantId"], "acme"],
      ["==", ["get", "tenantId"], ["actor", "tenantId"]]
    ]);
  });

  it("carries the caller's tenant for an entity that declares no filter", () => {
    expect(whereOf(engine().authorizeRead("Scoped", admin))).toEqual([
      "==",
      ["get", "tenantId"],
      "acme"
    ]);
  });

  it("carries no constraint at all for an unrestricted entity", () => {
    expect(whereOf(engine().authorizeRead("Public", admin))).toBeNull();
  });

  it("keeps excluding soft-deleted rows", () => {
    const soft = new Engine(
      compile(
        JSON.stringify({
          kerangka: "0.1",
          app: "soft",
          entities: { Post: { fields: { id: "string!", deletedAt: "datetime" } } }
        })
      )
    );
    // `deletedAt` uses `is_null`; the `== false` form is for an entity carrying a boolean
    // `deleted` field instead.
    expect(whereOf(soft.authorizeRead("Post", undefined))).toEqual([
      "is_null",
      ["get", "deletedAt"]
    ]);
  });

  it("resolves an actor node against the actor, and never against the record", () => {
    // The check that would have caught the original bug. A record that happens to carry a field
    // called `actor.tenantId` must not satisfy the filter.
    const where = whereOf(engine().authorizeRead("Doc", billing)) as unknown[];
    const declared = where[0] === "and" ? where[2] : where;
    expect(declared).toEqual(["==", ["get", "tenantId"], ["actor", "tenantId"]]);
    expect(JSON.stringify(declared)).toContain('"actor"');
    expect(JSON.stringify(declared)).not.toContain('"get","actor');
  });
});
