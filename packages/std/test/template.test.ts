import { describe, expect, it } from "vitest";
import { expandTemplate, templateParams } from "../src/index.js";

const codes = (result: ReturnType<typeof expandTemplate>) => result.problems.map((p) => p.code);

describe("expandTemplate", () => {
  it("replaces a whole-string placeholder with the argument's JSON value", () => {
    const result = expandTemplate(
      { template: "t", type: "view", params: ["columns", "size", "flag"], columns: "${columns}", size: "${size}", flag: "${flag}" },
      { columns: ["a", "b"], size: 20, flag: false }
    );
    expect(result.problems).toEqual([]);
    expect(result.value).toEqual({ columns: ["a", "b"], size: 20, flag: false });
  });

  it("interpolates a placeholder inside a longer string", () => {
    const result = expandTemplate(
      { template: "t", type: "action", params: ["state", "limit"], when: "status == '${state}' && total < ${limit}" },
      { state: "draft", limit: 100 }
    );
    expect(result.value).toEqual({ when: "status == 'draft' && total < 100" });
  });

  it("uses a declared default when the argument is absent", () => {
    const result = expandTemplate(
      { template: "t", type: "workflow", params: { field: { default: "status" } }, field: "${field}", transitions: {} },
      {}
    );
    expect(result.value).toEqual({ field: "status", transitions: {} });
  });

  it("leaves dotted and prefixed placeholders for the connectors that own them", () => {
    const result = expandTemplate(
      { template: "t", type: "action", params: [], url: "https://x/${input.currency}", auth: "Bearer ${secret:KEY}" },
      {}
    );
    expect(result.value).toEqual({ url: "https://x/${input.currency}", auth: "Bearer ${secret:KEY}" });
  });

  it("does not let an argument alias the template's own data", () => {
    const columns = ["a"];
    const result = expandTemplate({ template: "t", type: "view", params: ["c"], one: "${c}", two: "${c}" }, { c: columns });
    (result.value!.one as string[]).push("mutated");
    expect(result.value!.two).toEqual(["a"]);
    expect(columns).toEqual(["a"]);
  });

  it("reports an argument the template does not declare", () => {
    const result = expandTemplate({ template: "t", type: "view", params: ["entity"], list: "${entity}" }, { entity: "A", entiy: "B" });
    expect(result.value).toBeUndefined();
    expect(result.problems).toEqual([
      expect.objectContaining({ code: "TEMPLATE_PARAM_UNKNOWN", path: "/with/entiy" }),
    ]);
  });

  it("reports a required argument that is missing", () => {
    const result = expandTemplate({ template: "t", type: "view", params: ["entity"], list: "${entity}" }, {});
    expect(result.problems).toEqual([
      expect.objectContaining({ code: "TEMPLATE_PARAM_MISSING", path: "/with" }),
    ]);
  });

  it("reports a placeholder the template never declared, as a defect of the template", () => {
    const result = expandTemplate({ template: "t", type: "view", params: ["entity"], list: "${entty}" }, { entity: "A" });
    expect(result.problems).toEqual([
      expect.objectContaining({ code: "TEMPLATE_PARAM_UNDECLARED", path: "/use" }),
    ]);
  });

  it("refuses to interpolate a list or an object into text", () => {
    const result = expandTemplate({ template: "t", type: "action", params: ["roles"], when: "x == ${roles}" }, { roles: ["a"] });
    expect(result.problems).toEqual([
      expect.objectContaining({ code: "TEMPLATE_PARAM_NOT_SCALAR", path: "/with/roles" }),
    ]);
  });

  it("refuses a placeholder in a key instead of leaving it unexpanded", () => {
    const result = expandTemplate(
      { template: "t", type: "workflow", params: ["name"], transitions: { "${name}": { from: "a", to: "b" } } },
      { name: "go" }
    );
    expect(codes(result)).toEqual(["TEMPLATE_PARAM_IN_KEY"]);
  });

  it("refuses a template whose body is itself an instance", () => {
    const result = expandTemplate({ template: "t", type: "workflow", use: "std:approval" }, {});
    expect(codes(result)).toEqual(["TEMPLATE_INVALID"]);
  });

  it("refuses params in neither legal form", () => {
    expect(templateParams({ params: "entity" })).toEqual({
      problem: expect.objectContaining({ code: "TEMPLATE_INVALID" }),
    });
    expect(templateParams({ params: [1] })).toEqual({
      problem: expect.objectContaining({ code: "TEMPLATE_INVALID" }),
    });
    expect(templateParams({ params: ["a"] })).toEqual({ params: { a: {} } });
  });

  it("strips only the template's description from what it expands to", () => {
    const result = expandTemplate(
      { template: "t", type: "view", description: "d", params: [], list: "A" },
      {}
    );
    expect(result.value).toEqual({ list: "A" });
  });
});

describe("the official packs", () => {
  it("expand every template with its declared defaults alone", async () => {
    const { OFFICIAL_PACKS } = await import("../src/index.js");
    for (const pack of Object.values(OFFICIAL_PACKS)) {
      for (const [name, template] of Object.entries(pack.templates ?? {})) {
        const result = expandTemplate(template as Record<string, unknown>, {}, `${pack.package}:${name}`);
        expect(result.problems, `${pack.package}:${name}`).toEqual([]);
      }
    }
  });
});
