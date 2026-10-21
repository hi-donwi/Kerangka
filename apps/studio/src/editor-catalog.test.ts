import { describe, expect, it } from "vitest";
import { editorCatalog, editorThemes, parsePropertyValue } from "./editor-catalog";

describe("runtime-driven inspector metadata", () => {
  it("retains literal strings instead of opportunistic JSON coercion", () => {
    expect(parsePropertyValue({ name: "label", type: "string" }, "false")).toBe("false");
  });
  it("validates enum, numeric, boolean and structured inputs", () => {
    expect(parsePropertyValue({ name: "size", type: "enum", values: ["small", "large"] }, "large")).toBe("large");
    expect(() => parsePropertyValue({ name: "size", type: "enum", values: ["small"] }, "other")).toThrow();
    expect(parsePropertyValue({ name: "min", type: "number" }, "1.5")).toBe(1.5);
    expect(parsePropertyValue({ name: "disabled", type: "boolean" }, "false")).toBe(false);
    expect(() => parsePropertyValue({ name: "rows", type: "array" }, "{}")).toThrow();
    expect(parsePropertyValue({ name: "rows", type: "array" }, "[]")).toEqual([]);
    expect(() => parsePropertyValue({ name: "style", type: "object" }, "{")).toThrow("valid JSON");
  });
  it("preserves explicit binding values", () => {
    expect(parsePropertyValue({ name: "value", type: "string", bindable: true }, '{"$bind":"state.title"}', true)).toEqual({ $bind: "state.title" });
  });
  it("exports the actual installed registry and theme variants for the trusted service", () => {
    const catalog = editorCatalog();
    expect(catalog.components.Button?.props.find((prop) => prop.name === "disabled")?.type).toBe("boolean");
    expect(catalog.themes.map((theme) => theme.id)).toEqual(editorThemes.map((theme) => theme.id));
    expect(catalog.themes[0]?.variants.button).toContain("danger");
  });
});
