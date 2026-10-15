import { describe, expect, it } from "vitest";
import { compile, generateUIDL } from "../src/index.js";
import type { UIDLNode } from "../src/projections/uidl.js";
import { validateModelStructure } from "../src/meta-schema.js";

const kir = compile(JSON.stringify({
  kerangka: "0.1", app: "layout-fixture",
  entities: { Workspace: { fields: { name: "string!", ownerEmail: "email!", status: "enum(active, suspended) = active" } } },
  views: { workspace: { form: "Workspace", sections: [["name", "ownerEmail"], ["status"]] } },
}));

function find(node: UIDLNode, id: string): UIDLNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const result = find(child, id);
    if (result) return result;
  }
  return undefined;
}

describe("static UIDL form presentation", () => {
  it("lets line-table forms use their container instead of the single-column cap", () => {
    const model = {
      kerangka: "0.1", app: "line-table",
      entities: {
        Record: { fields: { name: "string", entries: "list(Entry)" } },
        Entry: { embedded: true, fields: { label: "string" } },
      },
      views: { record: { form: "Record", sections: [["name", "entries"]] } },
    };
    const form = find(generateUIDL(compile(JSON.stringify(model))).record!.root, "record-fields")!;
    expect(form.props?.className).toBe("uidl-admin-form uidl-admin-form-wide");
    expect(form.style?.maxWidth).toBe("max-w-full");
  });

  it("projects declared section titles and rejects incomplete or ambiguous titles", () => {
    const model = {
      kerangka: "0.1", app: "sections",
      entities: { Workspace: { fields: { name: "string", status: "string" } } },
      views: { workspace: { form: "Workspace", sections: [["name"], ["status"]], sectionTitles: ["Identity", "Lifecycle"] } },
    };
    const doc = generateUIDL(compile(JSON.stringify(model))).workspace!;
    expect(find(doc.root, "workspace-section-0-title")?.props?.value).toBe("Identity");
    expect(find(doc.root, "workspace-section-1-title")?.props?.value).toBe("Lifecycle");
    for (const titles of [["Identity"], ["Identity", ""], ["Same", " Same "], ["Same", "same"], ["A B", "a-b"]]) {
      const invalid = structuredClone(model);
      invalid.views.workspace.sectionTitles = titles;
      expect(validateModelStructure(invalid).some(d => d.code === "VIEW_SECTION_TITLES_INVALID")).toBe(true);
    }
  });

  it("bounds forms and groups section fields without changing submit wiring", () => {
    const doc = generateUIDL(kir).workspace!;
    const form = find(doc.root, "workspace-fields")!;
    expect(form.props?.className).toBe("uidl-admin-form");
    expect(form.style).toMatchObject({ display: "flex", flexDirection: "column", gap: "gap-6", maxWidth: "max-w-2xl" });
    const section = find(form, "workspace-section-0")!;
    expect(section.props?.className).toBe("uidl-admin-section");
    expect(section.children?.map(node => node.id)).toEqual(["workspace-section-0-title", "field-name", "field-ownerEmail"]);
    expect(find(form, "field-name")?.props?.value).toEqual({ $bind: "state.form.name" });
    expect(form.events?.onSubmit).toMatchObject([{ command: { name: "workspace.save" } }]);
  });

  it("uses addressable wrapping header/action hooks and keeps all registry widget types", () => {
    const doc = generateUIDL(kir).workspace!;
    expect(find(doc.root, "workspace-header")?.props?.className).toBe("uidl-admin-header");
    expect(find(doc.root, "workspace-actions")?.props?.className).toBe("uidl-admin-actions");
    expect(find(doc.root, "field-status")?.type).toBe("Select");
  });
});
