/**
 * Permissions are written as a role list (`"read": ["admin"]`) or as a role map
 * (`"update": { "admin": true, "billing": "status == 'draft'" }`, PLAN.md §5.1). `canOperate`
 * only understood the list: a map was "not an array" and so allowed everyone, and an empty
 * list, which reads as "nobody", allowed everyone too. Both failed open.
 */

import { describe, expect, it } from "vitest";
import { compile } from "@kerangka/compiler";
import { Engine } from "../src/index.js";

const engine = new Engine(
  compile({
    kerangka: "0.1",
    app: "perms",
    roles: ["admin", "billing", "viewer"],
    entities: {
      Invoice: {
        fields: { status: "enum(draft, sent) = draft" },
        permissions: {
          read: ["admin", "billing", "viewer"],
          update: { admin: true, billing: "status == 'draft'", viewer: false },
          delete: [],
        },
      },
    },
  } as never)
);

const as = (...roles: string[]) => ({ id: "u", roles });

describe("canOperate with a role map", () => {
  it("grants a role mapped to true, with or without a record", () => {
    expect(engine.canOperate("Invoice", "update", as("admin")).allowed).toBe(true);
    expect(engine.canOperate("Invoice", "update", as("admin"), { status: "sent" }).allowed).toBe(true);
  });

  it("refuses a role the map does not grant, and a role mapped to false", () => {
    expect(engine.canOperate("Invoice", "update", as("auditor"))).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
    expect(engine.canOperate("Invoice", "update", as("viewer"))).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
    expect(engine.canOperate("Invoice", "update", undefined)).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
  });

  it("decides a conditional grant against the record", () => {
    expect(engine.canOperate("Invoice", "update", as("billing"), { status: "draft" }).allowed).toBe(true);
    expect(engine.canOperate("Invoice", "update", as("billing"), { status: "sent" })).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
  });

  it("asks for the record rather than guessing when only a condition could grant", () => {
    expect(engine.canOperate("Invoice", "update", as("billing"))).toMatchObject({ allowed: false, code: "PERMISSION_NEEDS_RECORD" });
  });
});

describe("canOperate with a role list", () => {
  it("lets nobody perform an operation whose list is empty", () => {
    expect(engine.canOperate("Invoice", "delete", as("admin"))).toMatchObject({ allowed: false, code: "PERMISSION_DENIED" });
  });

  it("still leaves an operation the model does not mention open", () => {
    expect(engine.canOperate("Invoice", "create", as("viewer")).allowed).toBe(true);
  });
});
