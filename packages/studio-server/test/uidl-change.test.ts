import { describe, expect, it } from "vitest";
import { applyDraftOperations, type DraftOperation, type SourceSnapshot, sourceRevision } from "../src/index.js";

/**
 * Changing a page.
 *
 * The page is the author's document. A property, a position, and a definition are all
 * changes to that document, and each of them changes one thing and leaves every other
 * byte alone.
 */

const document = {
  version: "1.0",
  id: "help",
  name: "Synthetic Help",
  root: {
    id: "help-root",
    type: "Container",
    props: {},
    style: {},
    children: [
      { id: "help-text", type: "Text", props: { value: "Synthetic help" }, style: {}, children: [] },
      { id: "help-note", type: "Text", props: { value: "Note" }, style: {}, children: [] },
    ],
  },
};

const text = `${JSON.stringify(document, null, 2)}\n`;

function snapshot(): SourceSnapshot {
  const sources = {
    "app.kerangka.json": { format: "json" as const, text: '{"kerangka":"0.1","app":"probe"}' },
    "help.uidl.json": { format: "json" as const, text },
  };
  return { entry: "app.kerangka.json", revision: sourceRevision(sources), sources, excluded: 0 };
}

function apply(operations: DraftOperation[]) {
  const before = snapshot();
  const result = applyDraftOperations(before, { expectedRevision: before.revision, operations });
  return { result, page: result.sources["help.uidl.json"]?.text ?? "" };
}

describe("changing a page", () => {
  it("changes a property and leaves the rest of the file alone", () => {
    const { result, page } = apply([
      { op: "uidlSetNodeProp", source: "help.uidl.json", node: "help-text", prop: { key: "value", value: "Changed" } },
    ]);
    expect(result.applied).toEqual(["uidlSetNodeProp help.uidl.json"]);
    const parsed = JSON.parse(page);
    expect(parsed.root.children[0].props.value).toBe("Changed");
    expect(parsed.root.children[1].props.value).toBe("Note");
  });

  it("adds a property that was not there", () => {
    const { page } = apply([
      { op: "uidlSetNodeProp", source: "help.uidl.json", node: "help-text", prop: { key: "align", value: "center" } },
    ]);
    expect(JSON.parse(page).root.children[0].props.align).toBe("center");
  });

  it("refuses a property name a node cannot carry", () => {
    const { result, page } = apply([
      { op: "uidlSetNodeProp", source: "help.uidl.json", node: "help-text", prop: { key: "not a name", value: 1 } },
    ]);
    expect(result.applied).toEqual([]);
    expect(page).toBe(text);
  });

  it("moves a node within its parent", () => {
    const { result, page } = apply([
      { op: "uidlMoveNode", source: "help.uidl.json", node: "help-note", parent: "help-root", index: 0 },
    ]);
    expect(result.applied).toEqual(["uidlMoveNode help.uidl.json"]);
    const parsed = JSON.parse(page);
    expect(parsed.root.children.map((child: { id: string }) => child.id)).toEqual(["help-note", "help-text"]);
  });

  it("adds a definition and lets a node use it", () => {
    const { result, page } = apply([
      { op: "uidlAddDefinition", source: "help.uidl.json", name: "callout", node: { id: "callout", type: "Text" } },
    ]);
    expect(result.applied).toEqual(["uidlAddDefinition help.uidl.json"]);
    expect(JSON.parse(page).definitions.callout.type).toBe("Text");

    const withUse = apply([
      { op: "uidlAddDefinition", source: "help.uidl.json", name: "callout", node: { id: "callout", type: "Text" } },
      { op: "uidlUseDefinition", source: "help.uidl.json", node: "help-text", definition: "callout" },
    ]);
    expect(JSON.parse(withUse.page).root.children[0].componentId).toBe("callout");
  });

  it("refuses to use a definition the document does not have", () => {
    const { result, page } = apply([
      { op: "uidlUseDefinition", source: "help.uidl.json", node: "help-text", definition: "missing" },
    ]);
    expect(result.applied).toEqual([]);
    expect(page).toBe(text);
  });
});
