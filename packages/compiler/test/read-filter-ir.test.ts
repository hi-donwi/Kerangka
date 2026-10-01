import { describe, expect, it } from "vitest";
import { compile } from "../src/index.js";

/**
 * `readFilter` reached the IR as a string, and the engine only accepted an object
 * (`typeof entity.readFilter === "object"`), so a declared read filter did nothing. These tests
 * pin the IR shape, because the failure they prevent is invisible: a model that declares a
 * read filter compiles cleanly, runs, and enforces nothing.
 */
const compileEntity = (entity: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  compile(
    JSON.stringify({
      kerangka: "0.1",
      app: "rf",
      ...extra,
      entities: { Doc: entity }
    })
  );

describe("a declared readFilter reaches the IR as a predicate", () => {
  it("lowers it for an entity that uses no trait", () => {
    // The common case, and the one that used to leak: this path returned early with the filter
    // still a string.
    const kir = compileEntity({
      fields: { id: "string!", tenantId: "string!" },
      readFilter: "tenantId == actor.tenantId"
    });

    expect(kir.entities.Doc!.readFilter).toEqual([
      "==",
      ["get", "tenantId"],
      ["actor", "tenantId"]
    ]);
  });

  it("is not a string, whatever the model says", () => {
    const kir = compileEntity({
      fields: { id: "string!" },
      readFilter: "status == 'open'"
    });

    expect(typeof kir.entities.Doc!.readFilter).not.toBe("string");
  });

  it("leaves the IR's readFilter absent when the model declares none", () => {
    const kir = compileEntity({ fields: { id: "string!" } });

    expect(kir.entities.Doc!.readFilter).toBeUndefined();
  });
});

describe("a trait's readFilter combines with the entity's as predicates", () => {
  // `ownerId` comes from the trait, not from the entity: declaring it in both is
  // TRAIT_FIELD_COLLISION, which is the compiler working correctly.
  const withTrait = () =>
    compile(
      JSON.stringify({
        kerangka: "0.1",
        app: "rf",
        traits: {
          Owned: {
            readFilter: "ownerId == actor.id",
            fields: { ownerId: "string!" }
          }
        },
        entities: {
          Doc: {
            fields: { id: "string!", tenantId: "string!" },
            readFilter: "tenantId == actor.tenantId",
            uses: ["Owned"]
          }
        }
      })
    );

  it("ANDs the two filters", () => {
    // Previously `(${a}) && (${b})`, a longer string, which the engine then dropped whole — so
    // adding a trait filter used to discard the entity's own.
    expect(withTrait().entities.Doc!.readFilter).toEqual([
      "and",
      ["==", ["get", "tenantId"], ["actor", "tenantId"]],
      ["==", ["get", "ownerId"], ["actor", "id"]]
    ]);
  });

  it("keeps the trait filter when the entity declares none", () => {
    const kir = compile(
      JSON.stringify({
        kerangka: "0.1",
        app: "rf",
        traits: { Owned: { readFilter: "ownerId == actor.id", fields: { ownerId: "string!" } } },
        entities: { Doc: { fields: { id: "string!" }, uses: ["Owned"] } }
      })
    );

    expect(kir.entities.Doc!.readFilter).toEqual(["==", ["get", "ownerId"], ["actor", "id"]]);
  });
});

describe("a readFilter that cannot be lowered fails the build", () => {
  it("reports a filter naming `user`, which is neither the record nor the caller", () => {
    // Before this, a model with an unusable read filter compiled and shipped. Now the author
    // finds out at the point where they can still do something about it.
    expect(() =>
      compileEntity({ fields: { id: "string!", email: "string!" }, readFilter: "email == user.email" })
    ).toThrow(/readFilter/);
  });

  it("reports a filter that does not parse", () => {
    expect(() => compileEntity({ fields: { id: "string!" }, readFilter: "tenantId ==" })).toThrow(
      /readFilter/
    );
  });

  it("reports a bad trait readFilter, not just the entity's", () => {
    expect(() =>
      compile(
        JSON.stringify({
          kerangka: "0.1",
          app: "rf",
          traits: { Broken: { readFilter: "x == user.x", fields: { x: "string!" } } },
          entities: { Doc: { fields: { id: "string!", x: "string!" }, uses: ["Broken"] } }
        })
      )
    ).toThrow(/readFilter/);
  });
});
