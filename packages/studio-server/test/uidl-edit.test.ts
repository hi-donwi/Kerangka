import { describe, expect, it } from "vitest";
import { applyDraftOperations, type DraftOperation, type SourceSnapshot, sourceRevision } from "../src/index.js";

/**
 * Adding a component to an authored page.
 *
 * The page is the author's document, so an edit changes one node and leaves every
 * other byte alone. The result is checked before it is returned, so an edit that would
 * break the page is refused and the file is left as it was.
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

describe("editing an authored page", () => {
  it("adds a node under a parent and keeps the rest of the file as it was", () => {
    const { result, page } = apply([
      { op: "uidlAddNode", source: "help.uidl.json", parent: "help-root", node: { id: "help-button", type: "Button" } },
    ]);

    expect(result.applied).toEqual(["uidlAddNode help.uidl.json"]);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    const parsed = JSON.parse(page);
    expect(parsed.root.children).toHaveLength(2);
    expect(parsed.root.children[1]).toMatchObject({ id: "help-button", type: "Button" });
    // The bytes the author wrote are still there.
    expect(page).toContain('"value": "Synthetic help"');
  });

  it("removes a node", () => {
    const { result, page } = apply([
      { op: "uidlRemoveNode", source: "help.uidl.json", node: "help-text" },
    ]);
    expect(result.applied).toEqual(["uidlRemoveNode help.uidl.json"]);
    expect(JSON.parse(page).root.children).toEqual([]);
  });

  it("refuses a node that is already there", () => {
    const { result, page } = apply([
      { op: "uidlAddNode", source: "help.uidl.json", parent: "help-root", node: { id: "help-text", type: "Text" } },
    ]);
    expect(result.applied).toEqual([]);
    expect(page).toBe(text);
  });

  it("refuses a parent that does not exist", () => {
    const { result, page } = apply([
      { op: "uidlAddNode", source: "help.uidl.json", parent: "nowhere", node: { id: "new", type: "Button" } },
    ]);
    expect(result.applied).toEqual([]);
    expect(page).toBe(text);
  });

  it("refuses a file that is not part of the project", () => {
    const { result } = apply([
      { op: "uidlAddNode", source: "missing.uidl.json", parent: "help-root", node: { id: "new", type: "Button" } },
    ]);
    expect(result.applied).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === "STUDIO_OPERATION_TARGET")).toBe(true);
  });
});
