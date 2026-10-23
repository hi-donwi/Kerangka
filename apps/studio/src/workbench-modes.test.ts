import { describe, expect, it } from "vitest";
import { findDocumentNode, findNode, nodeSummary, WORKBENCH_MODES } from "./workbench-modes.js";
import type { UIDLDocument } from "uidl-runtime";

const document: UIDLDocument = {
  version: "1.0",
  id: "doc",
  name: "Doc",
  root: {
    id: "root",
    type: "Container",
    props: { className: "p-4" },
    children: [
      { id: "text", type: "Text", props: { value: "Hello" }, events: { onClick: [{ setState: { path: "a", value: 1 } }] } },
      {
        id: "column",
        type: "Column",
        props: {},
        children: [],
        slots: { footer: [{ id: "footer-text", type: "Text", props: {}, children: [] }] },
      },
    ],
  },
};

describe("workbench modes", () => {
  it("offers the three ways of working, each with an explanation", () => {
    expect(WORKBENCH_MODES.map((mode) => mode.id)).toEqual(["page", "journey", "model"]);
    for (const mode of WORKBENCH_MODES) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.description.length).toBeGreaterThan(0);
    }
  });

  it("finds a node in the tree and in a slot", () => {
    expect(findNode(document.root, "text")?.type).toBe("Text");
    expect(findNode(document.root, "footer-text")?.id).toBe("footer-text");
    expect(findNode(document.root, "missing")).toBeNull();
    expect(findDocumentNode(document, "column")?.type).toBe("Column");
    expect(findDocumentNode(null, "column")).toBeNull();
  });

  it("summarizes a node without inventing facts", () => {
    const summary = nodeSummary(document.root.children![0]!);
    expect(summary).toEqual({
      id: "text",
      type: "Text",
      propKeys: ["value"],
      eventNames: ["onClick"],
      childCount: 0,
    });
  });

  it("counts slot children as children", () => {
    expect(nodeSummary(document.root.children![1]!).childCount).toBe(1);
  });
});
