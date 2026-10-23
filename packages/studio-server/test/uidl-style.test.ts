import { describe, expect, it } from "vitest";
import { applyDraftOperations, type DraftOperation, type SourceSnapshot, sourceRevision } from "../src/index.js";

/**
 * Styling a page, and copying a node.
 *
 * A style value belongs to the node, and a breakpoint value belongs to the field it
 * varies. A copy is new content, so it carries identifiers of its own; the original
 * stays exactly as the author wrote it.
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
    responsive: {},
    children: [
      {
        id: "help-text",
        type: "Text",
        props: { value: "Synthetic help" },
        style: {},
        responsive: { display: { base: "block" } },
        children: [],
      },
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

describe("styling a page", () => {
  it("sets a style value", () => {
    const { result, page } = apply([
      { op: "uidlSetNodeStyle", source: "help.uidl.json", node: "help-text", field: "gap", value: "1rem" },
    ]);
    expect(result.applied).toEqual(["uidlSetNodeStyle help.uidl.json"]);
    expect(JSON.parse(page).root.children[0].style.gap).toBe("1rem");
  });

  it("sets a style value at a breakpoint", () => {
    const { result, page } = apply([
      { op: "uidlSetNodeResponsive", source: "help.uidl.json", node: "help-text", field: "display", breakpoint: "md", value: "flex" },
    ]);
    expect(result.applied).toEqual(["uidlSetNodeResponsive help.uidl.json"]);
    expect(JSON.parse(page).root.children[0].responsive.display.md).toBe("flex");
    // The other breakpoint is untouched.
    expect(JSON.parse(page).root.children[0].responsive.display.base).toBe("block");
  });

  it("adds a responsive value for a field the node does not have yet", () => {
    const { result, page } = apply([
      { op: "uidlSetNodeResponsive", source: "help.uidl.json", node: "help-text", field: "padding", breakpoint: "md", value: "1rem" },
    ]);
    expect(result.applied).toEqual(["uidlSetNodeResponsive help.uidl.json"]);
    expect(JSON.parse(page).root.children[0].responsive.padding.md).toBe("1rem");
    // The value the node already had is untouched.
    expect(JSON.parse(page).root.children[0].responsive.display.base).toBe("block");
  });

  it("refuses a field name a node cannot carry", () => {
    const { result, page } = apply([
      { op: "uidlSetNodeStyle", source: "help.uidl.json", node: "help-text", field: "not a field", value: 1 },
    ]);
    expect(result.applied).toEqual([]);
    expect(page).toBe(text);
  });

  it("copies a node with identifiers of its own", () => {
    const { result, page } = apply([
      { op: "uidlCopyNode", source: "help.uidl.json", node: "help-text", parent: "help-root", index: 1 },
    ]);
    expect(result.applied).toEqual(["uidlCopyNode help.uidl.json"]);
    const parsed = JSON.parse(page);
    expect(parsed.root.children).toHaveLength(2);
    expect(parsed.root.children[1].id).not.toBe("help-text");
    expect(parsed.root.children[1].id).toContain("copy");
    // The original is untouched.
    expect(parsed.root.children[0].id).toBe("help-text");
  });
});
