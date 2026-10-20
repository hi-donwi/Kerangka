import { describe, expect, it } from "vitest";
import { inspectProject, type SourceSnapshot } from "../src/index.js";

const snapshot = (text: string, format: "json" | "yaml" = "json"): SourceSnapshot => ({
  entry: `app.${format}`,
  revision: "test-revision",
  excluded: 0,
  sources: { [`app.${format}`]: { format, text } },
});
const model = {
  kerangka: "0.1",
  app: "inspection-probe",
  roles: ["employee"],
  entities: {
    Request: {
      fields: { id: "string!", title: "string!", status: "enum(draft, submitted) = draft" },
      workflow: {
        field: "status",
        transitions: { submit: { from: "draft", to: "submitted", roles: ["employee"] } },
      },
    },
  },
  views: { requests: { list: "Request" }, request: { form: "Request" } },
};

describe("bounded Studio inspection subprocess", () => {
  it("reuses the compiler/projector and produces synthetic presentation metadata", async () => {
    const result = await inspectProject(snapshot(JSON.stringify(model)));
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(result.inspection?.app).toBe("inspection-probe");
    expect(result.inspection?.entities[0]?.fields.map((field) => field.name)).toContain("title");
    expect(result.inspection?.outputs.openapi).toContain("/api/request");
    expect(result.inspection?.outputs.postgres).toContain("CREATE TABLE");
    expect(result.inspection?.screens.map((screen) => screen.label)).toEqual(
      expect.arrayContaining(["requests", "request"]),
    );
    expect(result.inspection?.synthetic.Request?.[0]?.title).toBe("Synthetic Request 1");
    expect(result.inspection?.sandbox).toMatchObject({ filesystemWrites: false, childProcesses: false });
  });

  it("returns source-linked sanitized compiler diagnostics", async () => {
    const text =
      '{\n "kerangka":"0.1",\n "app":"broken",\n "entities":{"Request":{"fields":{"title":{"required":true}}}}\n}';
    const result = await inspectProject(snapshot(text));
    expect(result.inspection).toBeNull();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_FIELD_TYPE",
          source: "app.json",
          path: "/entities/Request/fields/title",
        }),
      ]),
    );
    expect(result.diagnostics[0]?.line).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/\/Users\/|node:fs|stack|ERR_ACCESS_DENIED/);
  });

  it.each([
    ['{"kerangka":"0.1","app":"first","app":"second"}', "json", "STUDIO_PARSE_ERROR"],
    ["kerangka: '0.1'\napp: alias\na: &ref {x: 1}\nb: *ref\n", "yaml", "STUDIO_ALIAS_DENIED"],
    [JSON.stringify({ ...model, contexts: ["../outside"] }), "json", "STUDIO_CONTEXTS_UNSUPPORTED"],
    [
      JSON.stringify({ ...model, packages: { "../outside": "file:/private/unknown" } }),
      "json",
      "STUDIO_PACKAGE_UNSUPPORTED",
    ],
    [JSON.stringify({ ...model, packages: ["file:/private/unknown"] }), "json", "STUDIO_PACKAGE_UNSUPPORTED"],
    [JSON.stringify({ ...model, meta: { constructor: { prototype: {} } } }), "json", "STUDIO_KEY_UNSUPPORTED"],
  ] as const)("does not execute or resolve unsafe input %#", async (text, format, code) => {
    const input = snapshot(text, format);
    const before = structuredClone(input);
    const result = await inspectProject(input);
    expect(result.inspection).toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toContain(code);
    expect(input).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("/private/unknown");
  });

  it("keeps valid YAML text unchanged and supports only shipped official packs", async () => {
    const input = snapshot(
      "# preserve\nkerangka: '0.1'\napp: yaml-probe\npackages:\n  '@kerangka/identity': '^0.1'\n",
      "yaml",
    );
    const result = await inspectProject(input);
    expect(result.inspection?.app).toBe("yaml-probe");
    expect(input.sources["app.yaml"]?.text).toContain("# preserve");
  });

  it("rejects deep parse graphs before semantic compilation", async () => {
    const text = '{"kerangka":"0.1","app":"deep","meta":{"data":' + "[".repeat(40) + "0" + "]".repeat(40) + "}}";
    expect((await inspectProject(snapshot(text))).diagnostics.map((item) => item.code)).toContain("STUDIO_JOB_LIMIT");
  });

  it("inspects the accepted 50-entity and 500-field reference scale", async () => {
    const fields = {
      id: "string!",
      title: "string!",
      ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`field${i}`, "string"])),
    };
    const entities = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`Entity${i}`, { fields }]));
    const result = await inspectProject(
      snapshot(JSON.stringify({ kerangka: "0.1", app: "reference-scale", entities })),
    );
    expect(result.inspection, JSON.stringify(result.diagnostics)).not.toBeNull();
    expect(result.inspection?.entities).toHaveLength(50);
    expect(result.inspection?.entities.reduce((count, item) => count + item.fields.length, 0)).toBe(500);
    expect(result.inspection?.screens).toHaveLength(100);
  });
});
