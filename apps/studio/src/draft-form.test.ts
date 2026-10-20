import { describe, expect, it } from "vitest";
import { DRAFT_FIELD_TYPES, fieldDefinition, fieldNameProblem } from "./draft-form";

describe("fieldDefinition", () => {
  it("marks optional fields with a question mark and required fields with a bang", () => {
    expect(fieldDefinition("string", false)).toBe("string?");
    expect(fieldDefinition("string", true)).toBe("string!");
    expect(fieldDefinition("decimal", true)).toBe("decimal!");
  });
});

describe("fieldNameProblem", () => {
  it("accepts a letter or underscore start with alphanumerics", () => {
    expect(fieldNameProblem("note")).toBeNull();
    expect(fieldNameProblem("_internal")).toBeNull();
    expect(fieldNameProblem("line2Total")).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(fieldNameProblem("")).toMatch(/field name/i);
  });

  it("rejects a leading digit, spaces, and symbols", () => {
    expect(fieldNameProblem("2fast")).not.toBeNull();
    expect(fieldNameProblem("line total")).not.toBeNull();
    expect(fieldNameProblem("total!")).not.toBeNull();
  });

  it("rejects names longer than 64 characters", () => {
    expect(fieldNameProblem("a".repeat(65))).toMatch(/64/);
    expect(fieldNameProblem("a".repeat(64))).toBeNull();
  });
});

describe("draft field types", () => {
  it("offers no aliases and no whitespace", () => {
    const types: readonly string[] = DRAFT_FIELD_TYPES;
    expect(types).toEqual(types.map((type) => type.trim()));
    expect(new Set(types).size).toBe(types.length);
    expect(types).not.toContain("integer");
    expect(types).not.toContain("float");
  });
});
