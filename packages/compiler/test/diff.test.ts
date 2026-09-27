import { describe, expect, it } from "vitest";
import { compile, diffModels } from "../src/index.js";

describe("Model Differ & Breaking Change Gate", () => {
  const baseModel = {
    kerangka: "0.1",
    app: "testapp",
    entities: {
      User: {
        fields: {
          username: "string!",
          email: "string!",
          status: "enum(active, suspended) = active"
        },
        workflow: {
          field: "status",
          transitions: {
            suspend: { from: "active", to: "suspended" }
          }
        }
      }
    }
  };

  it("detects no changes on identical models", () => {
    const k1 = compile(baseModel as any);
    const k2 = compile(baseModel as any);
    const result = diffModels(k1, k2);

    expect(result.hasBreakingChanges).toBe(false);
    expect(result.changes.length).toBe(0);
  });

  it("detects breaking change when entity is removed", () => {
    const k1 = compile(baseModel as any);
    const modified = {
      kerangka: "0.1",
      app: "testapp",
      entities: {}
    };
    const k2 = compile(modified as any);
    const result = diffModels(k1, k2);

    expect(result.hasBreakingChanges).toBe(true);
    expect(result.summary.breaking).toBe(1);
    expect(result.changes[0]?.message).toContain("Entity 'User' was removed");
  });

  it("detects breaking change when required field added without default", () => {
    const k1 = compile(baseModel as any);
    const modified = {
      ...baseModel,
      entities: {
        User: {
          fields: {
            ...baseModel.entities.User.fields,
            role: "string!" // required without default -> BREAKING
          }
        }
      }
    };
    const k2 = compile(modified as any);
    const result = diffModels(k1, k2);

    expect(result.hasBreakingChanges).toBe(true);
    expect(result.changes.some(c => c.classification === "breaking" && c.path.includes("role"))).toBe(true);
  });

  it("detects additive change when optional field is added", () => {
    const k1 = compile(baseModel as any);
    const modified = {
      ...baseModel,
      entities: {
        User: {
          fields: {
            ...baseModel.entities.User.fields,
            nickname: "string?" // optional -> ADDITIVE
          }
        }
      }
    };
    const k2 = compile(modified as any);
    const result = diffModels(k1, k2);

    expect(result.hasBreakingChanges).toBe(false);
    expect(result.summary.additive).toBe(1);
  });
});
