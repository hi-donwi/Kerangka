import { describe, expect, it } from "vitest";
import { applyDraftOperations, sourceRevision, type DraftOperation, type SourceSnapshot } from "../src/index.js";

const catalog = {
  components: {
    Container: { acceptsChildren: true, slots: ["footer"], props: [] },
    Column: { acceptsChildren: true, slots: [], props: [] },
    Text: { acceptsChildren: false, slots: [], props: [{ name: "value", type: "string", bindable: true }] },
    Button: { acceptsChildren: false, slots: [], props: [{ name: "disabled", type: "boolean" }, { name: "variant", type: "enum", values: ["primary", "secondary"] }] },
    Slider: { acceptsChildren: false, slots: [], props: [{ name: "min", type: "number" }] },
    TextField: { acceptsChildren: false, slots: [], props: [{ name: "aria-label", type: "string" }] },
  },
  themes: [{ id: "theme-light", variants: { button: ["primary", "danger"] } }, { id: "theme-dark", variants: { button: ["primary", "danger"] } }],
};
const document = {
  version: "1.0", id: "page", name: "Page", theme: "theme-light",
  root: { id: "root", type: "Container", children: [
    { id: "group", type: "Column", children: [{ id: "text", type: "Text", props: { value: "Keep" } }] },
    { id: "button", type: "Button", props: { label: "Submit" } },
    { id: "slider", type: "Slider" },
    { id: "input", type: "TextField" },
  ], slots: { footer: [{ id: "foot", type: "Text", props: { value: "Footer" } }] } },
};

function edit(operation: Record<string, unknown>, value: unknown = document) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const sources = { "app.kerangka.json": { format: "json" as const, text: '{"kerangka":"0.1","app":"probe"}' }, "page.uidl.json": { format: "json" as const, text } };
  const snapshot: SourceSnapshot = { entry: "app.kerangka.json", sources, revision: sourceRevision(sources), excluded: 0 };
  const result = applyDraftOperations(snapshot, { expectedRevision: snapshot.revision, operations: [{ ...operation, source: "page.uidl.json" } as DraftOperation] }, { catalog });
  return { result, before: text, text: result.sources["page.uidl.json"]!.text, page: JSON.parse(result.sources["page.uidl.json"]!.text) };
}

describe("page designer source edits", () => {
  it("sets the document theme while preserving unrelated source spans", () => {
    const { result, text, before } = edit({ op: "uidlSetTheme", theme: "theme-dark" });
    expect(result.applied).toHaveLength(1);
    expect(text).toBe(before.replace('"theme-light"', '"theme-dark"'));
  });

  it("sets and clears a node theme variant outside props", () => {
    const first = edit({ op: "uidlSetNodeThemeRef", node: "button", themeRef: "danger" });
    expect(first.result.applied).toHaveLength(1);
    expect(first.page.root.children[1].themeRef).toBe("danger");
    const cleared = edit({ op: "uidlSetNodeThemeRef", node: "button", themeRef: "" }, first.page);
    expect(cleared.page.root.children[1].themeRef).toBe("");
    expect(cleared.page.root.children[1].props).toEqual({ label: "Submit" });
  });

  it.each([
    { op: "uidlSetTheme", theme: "unavailable" },
    { op: "uidlSetNodeThemeRef", node: "button", themeRef: "missing" },
    { op: "uidlSetNodeProp", node: "button", prop: { key: "disabled", value: "false" } },
    { op: "uidlSetNodeProp", node: "button", prop: { key: "variant", value: "missing" } },
    { op: "uidlSetNodeProp", node: "slider", prop: { key: "min", value: "three" } },
  ])("rejects an invalid typed value without changing source: %j", (operation) => {
    const { result, text, before } = edit(operation);
    expect(result.applied).toEqual([]);
    expect(result.diagnostics.some((item) => item.severity === "error")).toBe(true);
    expect(text).toBe(before);
  });

  it("adds a declared property when props is absent, including hyphenated names", () => {
    const { result, page } = edit({ op: "uidlSetNodeProp", node: "input", prop: { key: "aria-label", value: "Contact" } });
    expect(result.applied).toHaveLength(1);
    expect(page.root.children[3].props["aria-label"]).toBe("Contact");
  });

  it("preserves a binding rather than converting it to a string", () => {
    const { result, page } = edit({ op: "uidlSetNodeProp", node: "text", prop: { key: "value", value: { $bind: "state.title" } } });
    expect(result.applied).toHaveLength(1);
    expect(page.root.children[0].children[0].props.value).toEqual({ $bind: "state.title" });
  });

  it("moves into the destination's children, not its parent's children", () => {
    const { result, page, text, before } = edit({ op: "uidlMoveNode", node: "button", parent: "group", index: 0 });
    expect(result.applied).toHaveLength(1);
    expect(page.root.children.map((n: { id: string }) => n.id)).toEqual(["group", "slider", "input"]);
    expect(page.root.children[0].children.map((n: { id: string }) => n.id)).toEqual(["button", "text"]);
    expect(text).toContain(before.slice(before.indexOf('{\n        "id": "button"'), before.indexOf('\n      },', before.indexOf('"id": "button"')) + 8).trim());
  });

  it("moves between slots without flattening them", () => {
    const { result, page } = edit({ op: "uidlMoveNode", node: "button", parent: "root", slot: "footer", index: 0 });
    expect(result.applied).toHaveLength(1);
    expect(page.root.slots.footer.map((n: { id: string }) => n.id)).toEqual(["button", "foot"]);
    expect(page.root.children.some((n: { id: string }) => n.id === "button")).toBe(false);
  });

  it.each([
    { node: "group", parent: "group", index: 0 },
    { node: "group", parent: "text", index: 0 },
    { node: "button", parent: "text", index: 0 },
    { node: "root", parent: "group", index: 0 },
  ])("rejects unsafe moves: %j", (move) => {
    const { result, before, text } = edit({ op: "uidlMoveNode", ...move });
    expect(result.applied).toEqual([]);
    expect(text).toBe(before);
  });

  it("does not report a same-position move as an edit", () => {
    const { result, text, before } = edit({ op: "uidlMoveNode", node: "button", parent: "root", index: 1 });
    expect(result.applied).toEqual([]);
    expect(text).toBe(before);
  });
});
